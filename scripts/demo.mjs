#!/usr/bin/env node
/**
 * Runs the whole system on this computer with sample data, on one port.
 *
 *   npm run demo                 # http://localhost:7860
 *   npm run demo -- --public     # also a public https://….trycloudflare.com link (Cloudflare quick tunnel)
 *   npm run demo -- --port 8080
 *
 * Needs Node 22 and Python 3.11+ (for the ML service; without Python the
 * dashboard runs but shows no prediction). Works on Windows, macOS and Linux.
 * Data is sample data and is recreated on every start. Ctrl+C stops everything.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 7860;
const PUBLIC = args.includes('--public');
const ML_PORT = 8765;
const children = [];

const say = (msg) => console.log(`\x1b[36m›\x1b[0m ${msg}`);
const fail = (msg) => { console.error(`\x1b[31m✖ ${msg}\x1b[0m`); stop(1); };

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: opts.quiet ? 'pipe' : 'inherit', shell: WIN, env: { ...process.env, ...opts.env } });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed${opts.quiet ? `:\n${r.stderr?.toString().slice(-2000)}` : ''}`);
  return r;
}

/** Starts a long-running child. Its output goes to this console unless `capture` asks for it. */
function start(name, cmd, cmdArgs, opts, capture = false) {
  const child = spawn(cmd, cmdArgs, { stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'], ...opts });
  let tail = '';
  if (capture) for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { tail = (tail + d.toString()).slice(-1500); });
  child.on('exit', (code) => {
    if (!stopping) fail(`${name} stopped (exit ${code}).${capture ? `\n${tail.trim()}` : ' Its last output is above.'}`);
  });
  children.push(child);
  return child;
}

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  process.exit(code);
}
process.on('SIGINT', () => { console.log('\nStopping…'); stop(0); });
process.on('SIGTERM', () => stop(0));

async function waitFor(url, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function findPython() {
  for (const [cmd, pre] of [['python3', []], ['python', []], ['py', ['-3']]]) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info[:2] >= (3, 11))'], { shell: WIN, encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'True') return [cmd, pre];
  }
  return null;
}

/** Starts a Cloudflare quick tunnel to the port and returns its https URL. */
async function openTunnel() {
  say('Opening a public link through Cloudflare (first time downloads cloudflared)…');
  const tunnel = start('Cloudflare tunnel', WIN ? 'npx.cmd' : 'npx', ['--yes', 'cloudflared@latest', 'tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { cwd: ROOT, shell: WIN }, true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => fail('No tunnel URL after 90 seconds. Run without --public, or check that this network allows Cloudflare.'), 90_000);
    const look = (buf) => {
      // The tunnel's own address, not api.trycloudflare.com from an error message.
      const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    tunnel.stdout.on('data', look);
    tunnel.stderr.on('data', look);
  });
}

/** True when nothing else listens on the port (otherwise health checks would reach the other program). */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

// ---------------------------------------------------------------------------

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) fail(`Node 22 or newer is needed (this is ${process.version}). Get it from https://nodejs.org`);
if (!(await portFree(PORT))) fail(`Port ${PORT} is already in use (is the demo already running?). Close that program or use: npm run demo -- --port 8080`);
if (!(await portFree(ML_PORT))) fail(`Port ${ML_PORT} (ML service) is already in use. Stop the other demo first.`);

if (!existsSync(join(ROOT, 'node_modules'))) { say('Installing packages (first run only)…'); run('npm', ['ci', '--no-audit', '--no-fund']); }
say('Building shared code, API and web app…');
run('npm', ['run', 'build', '-w', '@diu/shared'], { quiet: true });
run('npm', ['run', 'build', '-w', '@diu/api'], { quiet: true });
run('npm', ['run', 'build', '-w', '@diu/web'], { quiet: true, env: { VITE_API_URL: '/api' } });

// ML service: a virtual environment and a model trained on synthetic data, made once.
const ml = join(ROOT, 'services', 'ml');
const venvPython = join(ml, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
const modelDir = join(ml, 'artifacts');
let mlReady = false;
const python = findPython();
if (!python) {
  console.warn('\x1b[33m! Python 3.11+ not found: running without the ML service (no predictions). Install Python from https://python.org and run again.\x1b[0m');
} else {
  const reqHash = createHash('sha256').update(readFileSync(join(ml, 'requirements.txt'))).digest('hex');
  const stamp = join(ml, '.venv', '.demo-requirements');
  if (!existsSync(venvPython)) { say('Creating the Python environment (first run only)…'); run(python[0], [...python[1], '-m', 'venv', join(ml, '.venv')]); }
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== reqHash) {
    say('Installing ML libraries (first run only, a few minutes)…');
    run(venvPython, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', join(ml, 'requirements.txt')]);
    writeFileSync(stamp, reqHash);
  }
  if (!existsSync(join(modelDir, 'latest.json'))) {
    say('Training the ridership model on synthetic data (first run only)…');
    spawnSync(venvPython, ['-m', 'app.train', '--synthetic'], { cwd: ml, stdio: 'ignore', env: { ...process.env, MODEL_DIR: modelDir } });
  }
  mlReady = true;
}

const PUBLIC_URL = PUBLIC ? await openTunnel() : `http://localhost:${PORT}`;
const pgliteDir = join(ROOT, 'apps', 'api', '.data', 'demo');
rmSync(pgliteDir, { recursive: true, force: true });
mkdirSync(dirname(pgliteDir), { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'development', DEMO_MODE: 'true', PORT: String(PORT), TRUST_PROXY: PUBLIC ? 'true' : 'false',
  PUBLIC_API_URL: `${PUBLIC_URL}/api`, WEB_APP_URL: PUBLIC_URL, CORS_ORIGINS: PUBLIC_URL,
  WEB_DIST_DIR: join(ROOT, 'apps', 'web', 'dist'), PGLITE_DIR: pgliteDir,
  JWT_SECRET: randomBytes(48).toString('base64url'), DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ML_SERVICE_URL: `http://127.0.0.1:${ML_PORT}`, ML_SERVICE_TOKEN: randomBytes(24).toString('base64url'),
  DEMO_ADMIN_PASSWORD: process.env.DEMO_ADMIN_PASSWORD ?? 'diu-demo-2026', LOG_LEVEL: 'warn',
};
env.SEED_ADMIN_PASSWORD = env.DEMO_ADMIN_PASSWORD;

if (mlReady) {
  say('Starting the ML service…');
  start('ML service', venvPython, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(ML_PORT), '--log-level', 'warning'], { cwd: ml, env: { ...env, MODEL_DIR: modelDir } });
  if (!(await waitFor(`http://127.0.0.1:${ML_PORT}/health`, 90))) fail('The ML service did not start.');
}

say('Loading sample data (940 riders, payments, routines, tickets)…');
const api = join(ROOT, 'apps', 'api');
const node = (script, extra = []) => {
  const r = spawnSync(process.execPath, [join(api, script), ...extra], { cwd: api, env, stdio: 'pipe' });
  if (r.status !== 0) fail(`${script} failed:\n${r.stderr.toString().slice(-2000)}`);
};
node('dist/db/seed.js');
node('dist/db/demo.js');
if (mlReady) { say('Forecasting today and the next 7 days…'); node('dist/jobs/worker.js', ['--run=forecast']); }

say('Starting the server…');
start('Server', process.execPath, [join(api, 'dist', 'server.js')], { cwd: api, env });
if (!(await waitFor(`http://127.0.0.1:${PORT}/api/health`, 60))) fail(`The server did not start on port ${PORT}. Is another program using it? Try --port 8080.`);
if (mlReady) {
  say('Publishing suggested buses for the next service days…');
  spawnSync(process.execPath, [join(ROOT, 'deploy', 'demo', 'warmup.mjs'), `http://127.0.0.1:${PORT}/api`], { env, stdio: 'ignore' });
}

console.log(`
\x1b[32m✔ DIU Smart Transport is running\x1b[0m

  Open:              \x1b[1mhttp://localhost:${PORT}\x1b[0m${PUBLIC ? `\n  Public link:       \x1b[1m${PUBLIC_URL}\x1b[0m   (works while this window stays open)` : ''}
  Transport office:  710215 / ${env.DEMO_ADMIN_PASSWORD}   (no 2FA in the demo)
  Student / faculty: Sign in with DIU account → 232-35-797 or 710410

  Sample data only, recreated on every start. Press Ctrl+C to stop.
`);
