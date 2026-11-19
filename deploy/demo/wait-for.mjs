// Waits until a URL answers 200, or exits 1 after the given number of seconds.
const [url, seconds = '60'] = process.argv.slice(2);
const until = Date.now() + Number(seconds) * 1000;
while (Date.now() < until) {
  try { if ((await fetch(url)).ok) process.exit(0); } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
console.error(`Timed out waiting for ${url}`);
process.exit(1);
