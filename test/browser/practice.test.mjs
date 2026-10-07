// Browser checks for the practice pages, the glossary, share links, printing,
// the remembered speed and the transfer of progress between addresses
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { info } from '../../src/js/subnet.js';
import { pack } from '../../src/js/core/pack.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || 'test/.output';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const wait = ms => page.waitForTimeout(ms);
const state = async () => JSON.parse(await page.evaluate(() => localStorage.getItem('packetpilot.v1')) || '{}');
let n = 0;
const ok = (name, fn) => fn().then(() => { n++; console.log('ok  ', name); });

await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload(); await wait(300);

await ok('troubleshooting list and a challenge with timer, symptom and goals', async () => {
  await page.goto(BASE + '#/troubleshoot'); await wait(300);
  assert.ok(await page.locator('a.tile').count() >= 10);
  await page.goto(BASE + '#/troubleshoot/gateway'); await wait(1500);
  assert.ok(await page.locator('.symptom').count() === 1);
  assert.match(await page.locator('.chtimer').innerText(), /\d+:\d\d/);
  await page.screenshot({ path: `${OUT}/practice-challenge.png` });
  await page.reload(); await wait(800);
  assert.ok((await state()).practice.challenges.gateway, 'challenge state is saved');
});

await ok('subnetting trainer: a correct answer counts and shows the explanation', async () => {
  await page.goto(BASE + '#/subnetting'); await wait(300);
  await page.click('[role=tab]:has-text("Network and broadcast")'); await wait(100);
  const [ip, len] = (await page.locator('.subq').innerText()).trim().split('/');
  const i = info(ip, Number(len));
  const vals = [i.net, i.bc, i.first, i.last, String(i.hosts)];
  for (let k = 0; k < vals.length; k++) await page.locator('.subgrid input').nth(k).fill(vals[k]);
  await page.click('button:text-is("Check")'); await wait(100);
  assert.equal(await page.locator('.subgrid .feedback.ok').count(), 5);
  assert.ok(await page.locator('.explain:not(.hidden)').count() === 1);
  assert.equal((await state()).practice.subnet.range.right, 1);
});

await ok('glossary: terms in the theory explain themselves on hover', async () => {
  await page.goto(BASE + '#/lesson/m6-l1/0'); await wait(500);
  const terms = page.locator('.theory abbr.gl');
  assert.ok(await terms.count() >= 5);
  await page.locator('.theory abbr.gl[data-term="DHCP"]').first().hover(); await wait(150);
  assert.match(await page.locator('.gl-tip.on').innerText(), /Dynamic Host Configuration/);
  assert.equal(await page.locator('pre abbr.gl, code abbr.gl').count(), 0, 'code stays untouched');
});

await ok('share link: the network travels in the address and opens in the lab', async () => {
  await page.goto(BASE + '#/lab/ospf'); await wait(800);
  await page.click('button:has-text("Share")'); await wait(300);
  const link = await page.locator('.dlg input').inputValue();
  assert.match(link, /#\/share\/z/);
  await page.goto(BASE + '#/'); await wait(200);
  await page.goto(link); await wait(1000);
  assert.match(page.url(), /#\/lab$/);
  assert.equal(await page.locator('svg.net .dev').count(), 6);
});

await ok('speed slider is remembered', async () => {
  await page.goto(BASE + '#/lab'); await wait(500);
  const s = page.locator('input[type=range][aria-label=Speed]');
  await s.evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.reload(); await wait(500);
  assert.equal(await page.locator('input[type=range][aria-label=Speed]').inputValue(), '20');
});

await ok('print page: picked lessons appear in the preview', async () => {
  await page.goto(BASE + '#/print/m7-l1'); await wait(400);
  assert.equal(await page.locator('.print-lesson').count(), 1);
  await page.locator('.print-mod', { hasText: 'Dynamic routing with OSPF' }).locator('label.row input').first().check(); await wait(200);
  assert.ok(await page.locator('.print-lesson').count() >= 2);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.rail').isVisible(), false);
  await page.emulateMedia({ media: 'screen' });
});

await ok('progress from another address is merged, nothing here is lost', async () => {
  const before = await state();
  const code = await pack({ progress: { 'm9-l1': { steps: { 0: true }, done: true } }, nets: { 'from old': { topo: { devices: [], links: [] }, saved: 1 } }, prefs: {}, answers: {} });
  await page.goto(BASE + `#/migrate/${code}?to=${encodeURIComponent('#/networks')}`); await wait(600);
  assert.match(page.url(), /#\/networks$/);
  const after = await state();
  assert.ok(after.progress['m9-l1'].done);
  assert.ok(after.nets['from old']);
  assert.deepEqual(after.practice.subnet, before.practice.subnet);
});

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : '\nno browser errors');
console.log(`${n} browser checks passed`);
await browser.close();
if (errors.length) process.exit(1);
