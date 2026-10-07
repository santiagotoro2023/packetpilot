// Runs the tests of PacketPilot the same way as in every blueprint project (blueprint 1.0.0).
//
//   node test/run.mjs                 unit tests: test/unit/*.test.mjs
//   node test/run.mjs --browser       browser tests: test/browser/*.test.mjs against a local server
//   node test/run.mjs --browser ui    only the files whose name starts with "ui"
//
// Every test file is a plain script: it exits with 0 when everything passed and prints
// one line at the end that says what it checked ("engine: 37 tests passed").
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const browser = argv.includes('--browser');
const only = argv.filter(a => !a.startsWith('--'));
const dir = path.join(ROOT, 'test', browser ? 'browser' : 'unit');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs') && (!only.length || only.some(o => f.startsWith(o)))).sort();
if (!files.length) { console.error(`No tests in ${path.relative(ROOT, dir)}${only.length ? ` matching ${only.join(', ')}` : ''}`); process.exit(1); }

const env = { ...process.env, OUT: process.env.OUT || path.join(ROOT, 'test', '.output') };
fs.mkdirSync(env.OUT, { recursive: true });
const stops = [];
const stopAll = () => { for (const s of stops.reverse()) { try { s(); } catch { /* ignore */ } } };
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));


if (browser) {
  // The web app from src/, served with the same headers as nginx in production
  const srv = await serve({ root: path.join(ROOT, 'src'), version: fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim() });
  stops.push(() => srv.close());
  env.BASE = `http://127.0.0.1:${srv.port}/`;
}

let failed = 0;
const t0 = Date.now();
for (const f of files) {
  const name = f.replace(/\.test\.mjs$/, '');
  const out = await new Promise(res => {
    let text = '';
    const p = spawn(process.execPath, [path.join(dir, f)], { env, cwd: ROOT });
    p.stdout.on('data', d => { text += d; });
    p.stderr.on('data', d => { text += d; });
    p.on('close', code => res({ code, text }));
  });
  const last = out.text.trim().split('\n').filter(Boolean).pop() || '';
  if (out.code === 0) console.log(`\x1b[32m ✓ \x1b[0m ${name}: ${last.replace(new RegExp(`^${name}: `), '')}`);
  else { failed++; console.log(`\x1b[31m ✗ \x1b[0m ${name} failed:\n${out.text.trim().replace(/^/gm, '    ')}`); }
}
console.log(`${files.length - failed} of ${files.length} ${browser ? 'browser' : 'unit'} test files passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
stopAll();
process.exit(failed ? 1 : 0);
