// Browser checks: partial answers survive navigation and reloads, Ctrl+C stops a command,
// panels can be resized and keep their size, routers show their addresses
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || 'test/.output';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const wait = ms => page.waitForTimeout(ms);
const away = async () => { await page.goto(BASE + '#/lesson/m1-l1/0'); await wait(300); };
let n = 0;
const ok = (name, fn) => fn().then(() => { n++; console.log('ok  ', name); });

await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload(); await wait(300);

await ok('quiz: a typed partial answer and a chosen option survive', async () => {
  await page.goto(BASE + '#/lesson/m1-l2/2'); await wait(300);
  await page.locator('.quiz-q input[type=text]').nth(1).fill('15');
  await page.locator('.quiz-q').nth(3).locator('label').nth(0).click();
  await away(); await page.goto(BASE + '#/lesson/m1-l2/2'); await wait(300);
  assert.equal(await page.locator('.quiz-q input[type=text]').nth(1).inputValue(), '15');
  assert.ok(await page.locator('.quiz-q').nth(3).locator('label').nth(0).locator('input').isChecked());
  assert.ok(await page.locator('.quiz-q').nth(3).locator('label.wrong').count() === 1);
});

await ok('label: placed terms survive a reload', async () => {
  await page.goto(BASE + '#/lesson/m3-l1/1'); await wait(300);
  await page.click('.dchip:text-is("TPID")'); await page.locator('.slot').nth(0).click();
  await page.click('.dchip:text-is("VID")'); await page.locator('.slot').nth(3).click();
  await page.reload(); await wait(400);
  assert.match(await page.locator('.slot').nth(0).innerText(), /TPID/);
  assert.match(await page.locator('.slot').nth(3).innerText(), /VID/);
  assert.equal(await page.locator('.dchip:text-is("TPID")').count(), 0);
});

await ok('stack: the order survives navigation', async () => {
  await page.goto(BASE + '#/lesson/m1-l1/1'); await wait(300);
  const before = await page.locator('.stack-item b').allInnerTexts();
  await page.locator('.stack-item').nth(1).locator('button[title="move up"]').click();
  const moved = await page.locator('.stack-item b').allInnerTexts();
  assert.notDeepEqual(moved, before);
  await away(); await page.goto(BASE + '#/lesson/m1-l1/1'); await wait(300);
  assert.deepEqual(await page.locator('.stack-item b').allInnerTexts(), moved);
});

await ok('build: layers and field values survive navigation', async () => {
  await page.goto(BASE + '#/lesson/m4-l2/2'); await wait(300);
  await page.click('.bld-pal button:has-text("Ethernet")'); await page.click('.bld-pal button:has-text("BPDU")');
  await page.locator('.bld-layer select').nth(0).selectOption('01:80:c2:00:00:00');
  await page.fill('.bld-layer input', '0');
  await away(); await page.goto(BASE + '#/lesson/m4-l2/2'); await wait(300);
  assert.equal(await page.locator('.bld-layer').count(), 2);
  assert.equal(await page.locator('.bld-layer select').nth(0).inputValue(), '01:80:c2:00:00:00');
  assert.equal(await page.locator('.bld-layer input').inputValue(), '0');
});

await ok('lab: met goals, typed answers, hints and the edited network survive', async () => {
  await page.goto(BASE + '#/lesson/m2-l4/1'); await wait(600);
  await page.locator('.player input[type=range]').fill('100');
  await page.click('.console .quick button:has-text("ping -c 2 10.0.4.10")');
  await page.waitForFunction(() => document.querySelectorAll('.goals li.ok').length >= 1, null, { timeout: 30000 });
  await page.fill('.goals input', 'r9');
  await page.click('.goalcol button:has-text("Show a hint")');
  await page.locator('svg.net .dev', { hasText: 'r2' }).first().dblclick(); await wait(200);
  await page.fill('.console .in input', 'ip route add 10.0.1.0/24 via 10.0.12.1'); await page.keyboard.press('Enter');
  await wait(600);
  await away(); await page.goto(BASE + '#/lesson/m2-l4/1'); await wait(600);
  assert.ok(await page.locator('.goals li.ok').count() >= 1, 'goal stays met');
  assert.equal(await page.locator('.goals input').inputValue(), 'r9');
  assert.equal(await page.locator('.goalcol .hint').count(), 1);
  const routes = await page.evaluate(() => JSON.parse(localStorage.getItem('packetpilot.v1')).answers['m2-l4/1'].topo.devices.find(d => d.id === 'r2').routes);
  assert.ok(routes.some(r => r.dst === '10.0.1.0/24'), 'route added in the console is kept');
  await page.click('button:has-text("Reload network")'); await wait(300);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('packetpilot.v1')).answers['m2-l4/1'].topo);
  assert.equal(after, undefined, 'reload network forgets the edited network');
});

await ok('console: Ctrl+C and the Stop button end a running ping', async () => {
  await page.goto(BASE + '#/lab/routed'); await wait(600);
  await page.locator('svg.net .dev', { hasText: 'pc1' }).first().dblclick(); await wait(200);
  await page.fill('.console .in input', 'ping -c 50 192.168.20.20'); await page.keyboard.press('Enter');
  await wait(1500);
  assert.ok(await page.locator('.console .in button:has-text("Stop")').isVisible());
  await page.focus('.console .in input'); await page.keyboard.press('Control+c'); await wait(300);
  const out = await page.locator('.console pre').innerText();
  assert.match(out, /\^C\n--- 192\.168\.20\.20 ping statistics ---/);
  assert.ok(!(await page.locator('.console .in button:has-text("Stop")').isVisible()));
  await page.fill('.console .in input', 'ping -c 50 192.168.20.20'); await page.keyboard.press('Enter'); await wait(800);
  await page.click('.console .in button:has-text("Stop")'); await wait(300);
  assert.equal((await page.locator('.console pre').innerText()).match(/\^C/g).length, 2);
});

await ok('router shows one address line per interface', async () => {
  const lines = await page.locator('svg.net .dev', { hasText: 'r1' }).first().locator('text.ip').allTextContents();
  assert.deepEqual(lines, ['eth1 192.168.10.1/24', 'eth2 192.168.20.1/24']);
});

await ok('panels resize and keep their size', async () => {
  const drag = async (sel, dx, dy) => {
    const b = await page.locator(sel).boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
  };
  const size = async () => ({ side: (await page.locator('.lab .side').boundingBox()).width, dock: (await page.locator('.lab .dock').boundingBox()).height,
    log: (await page.locator('.lab .dock-col').first().boundingBox()).width });
  const s0 = await size();
  await drag('.lab > .rz-col >> nth=0', -120, 0);
  await drag('.lab > .rz-row', 0, -150);
  const logBefore = (await size()).log;
  await drag('.lab > .rz-col >> nth=1', 160, 0);
  const s1 = await size();
  assert.ok(Math.abs(s1.side - s0.side - 120) < 4, `side ${s0.side} → ${s1.side}`);
  assert.ok(Math.abs(s1.dock - s0.dock - 150) < 4, `dock ${s0.dock} → ${s1.dock}`);
  assert.ok(Math.abs(s1.log - logBefore - 160) < 4, `log ${logBefore} → ${s1.log}`);
  await page.screenshot({ path: `${OUT}/40-resized.png` });
  await page.reload(); await wait(600);
  const s2 = await size();
  assert.ok(Math.abs(s2.side - s1.side) < 2 && Math.abs(s2.dock - s1.dock) < 2, 'sizes kept after reload');
  await page.locator('.lab > .rz-row').dblclick(); await wait(200);
  assert.ok(Math.abs((await size()).dock - s0.dock) < 2, 'double-click resets');
  await page.goto(BASE + '#/lesson/m2-l4/1'); await wait(500);
  const g0 = (await page.locator('.goalcol').boundingBox()).width;
  await drag('.lesson-body > .rz-col', 100, 0);
  assert.ok(Math.abs((await page.locator('.goalcol').boundingBox()).width - g0 - 100) < 4, 'goal column resizes');
  await page.screenshot({ path: `${OUT}/41-lesson-resized.png` });
});

assert.deepEqual(errors, []);
console.log(`\n${n} browser checks passed`);
await browser.close();
