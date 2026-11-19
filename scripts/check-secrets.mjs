#!/usr/bin/env node
/**
 * Secret guard for DIU Smart Transport.
 *
 * Blocks commits and pushes that contain secret files (.env, keys, service
 * accounts) or values that look like real credentials. No dependencies.
 *
 *   node scripts/check-secrets.mjs --staged    files staged for commit (pre-commit hook)
 *   node scripts/check-secrets.mjs --all       every tracked file (CI)
 *   node scripts/check-secrets.mjs --history   every line ever added in git history (CI, pre-push)
 *
 * A line that is a deliberate example can be allowed with the marker
 * `secret-scan: allow` on the same line. Use it rarely and never for a real value.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const mode = process.argv[2] ?? '--staged';

/** File names that must never be committed. `.env.example` is the only env file allowed. */
const FORBIDDEN_FILES = [
  { re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/, why: 'environment file with real values (commit .env.example instead)' },
  { re: /\.(pem|key|p12|pfx|jks|keystore|der|ppk|mobileprovision)$/i, why: 'private key / certificate store' },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, why: 'SSH key' },
  { re: /(^|\/)(credentials|service-account)[^/]*\.json$/i, why: 'cloud credentials file' },
  { re: /firebase-adminsdk[^/]*\.json$/i, why: 'Firebase admin service account' },
  { re: /(^|\/)(google-services\.json|GoogleService-Info\.plist)$/, why: 'Firebase app config (keep out of a public repo)' },
  { re: /(^|\/)(\.npmrc|\.pypirc|\.netrc)$/, why: 'package registry / login credentials' },
  { re: /\.(sqlite3?|db|dump)$/i, why: 'database dump (may contain personal data)' },
];

/** Content patterns that are almost always a real secret. */
const SECRET_PATTERNS = [
  { re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/, why: 'private key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS access key ID' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, why: 'GitHub token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/, why: 'GitHub fine-grained token' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, why: 'Google API key' },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, why: 'Slack token' },
  { re: /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/, why: 'live payment API key' },
  { re: /"type"\s*:\s*"service_account"/, why: 'Google service account JSON' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, why: 'JSON Web Token' },
  { re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:/@]+:[^\s@/]{4,}@(?!localhost|127\.0\.0\.1|postgres\b|db\b|redis\b)/i, why: 'database URL with a password for a non-local host' },
];

/**
 * `NAME = value` assignments where NAME sounds secret and the value looks real.
 * Placeholders (change-me, <...>, ${...}, xxx, example, dev-only...) are ignored.
 */
const ASSIGNMENT = /\b([A-Z0-9_]*(SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|TOKEN|STORE_PASS|CLIENT_SECRET)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'#,;]+)/i;
const PLACEHOLDER = /^(change[-_]?me.*|changeme.*|replace[-_]?me.*|generate[-_].*|your[-_].*|<.*>|\$\{.*\}|\$[A-Z_]+|x{3,}|\*{3,}|example.*|dummy.*|placeholder.*|test.*|dev[-_]only.*|local[-_]only.*|sandbox.*|null|undefined|none|true|false|process\.env.*|env\(.*|os\.environ.*|settings\..*|config\..*|z\..*|string|required|optional|\[.*\]|\(.*\)|[0-9]{1,6})$/i;

const SKIP_CONTENT = [/^package-lock\.json$/, /(^|\/)node_modules\//, /\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|zip|gz|xlsx)$/i, /^scripts\/check-secrets\.mjs$/];
const ALLOW_MARK = 'secret-scan: allow';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

function scanLine(line) {
  if (line.includes(ALLOW_MARK)) return null;
  for (const p of SECRET_PATTERNS) if (p.re.test(line)) return p.why;
  const m = ASSIGNMENT.exec(line);
  if (m) {
    const value = m[3];
    const looksReal = value.length >= 12 && /[A-Za-z]/.test(value) && /[0-9]/.test(value) && !PLACEHOLDER.test(value);
    if (looksReal) return `possible hard-coded secret in ${m[1]}`;
  }
  return null;
}

function checkName(file) {
  for (const f of FORBIDDEN_FILES) if (f.re.test(file)) return f.why;
  return null;
}

const findings = [];

function scanText(file, text, lineOffset = 0) {
  if (SKIP_CONTENT.some((re) => re.test(file))) return;
  text.split(/\r?\n/).forEach((line, i) => {
    const why = scanLine(line);
    if (why) findings.push({ file, line: i + 1 + lineOffset, why });
  });
}

if (mode === '--staged' || mode === '--all') {
  const files = (mode === '--staged'
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : git(['ls-files'])).split('\n').filter(Boolean);
  for (const file of files) {
    const badName = checkName(file);
    if (badName) { findings.push({ file, line: 0, why: badName }); continue; }
    let text;
    try {
      if (mode === '--staged') text = git(['show', `:${file}`]);
      else {
        if (statSync(file).size > MAX_FILE_BYTES) { findings.push({ file, line: 0, why: 'file larger than 5 MB' }); continue; }
        text = readFileSync(file, 'utf8');
      }
    } catch { continue; }
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) { findings.push({ file, line: 0, why: 'file larger than 5 MB' }); continue; }
    scanText(file, text);
  }
} else if (mode === '--history') {
  // Every file name that ever existed, and every line ever added, across all commits.
  for (const file of new Set(git(['log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A']).split('\n').filter(Boolean))) {
    const badName = checkName(file);
    if (badName) findings.push({ file, line: 0, why: `${badName} (in history)` });
  }
  let current = '';
  let commit = '';
  for (const raw of git(['log', '--all', '-p', '--no-color', '--unified=0', '--pretty=format:@@commit %h']).split('\n')) {
    if (raw.startsWith('@@commit ')) { commit = raw.slice(9); continue; }
    if (raw.startsWith('+++ b/')) { current = raw.slice(6); continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    if (SKIP_CONTENT.some((re) => re.test(current))) continue;
    const why = scanLine(raw.slice(1));
    if (why) findings.push({ file: `${current} @ ${commit}`, line: 0, why });
  }
} else {
  console.error(`Unknown mode ${mode}. Use --staged, --all or --history.`);
  process.exit(2);
}

if (findings.length) {
  console.error('\n✖ Secret guard blocked this. Remove the secret, rotate it if it was real, and try again:\n');
  for (const f of findings) console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}  →  ${f.why}`);
  console.error('\nPut real values in .env (git-ignored) or the server secret store. Only .env.example with placeholders belongs in git.\n');
  process.exit(1);
}
console.log(`✔ Secret guard: nothing found (${mode.slice(2)}).`);
