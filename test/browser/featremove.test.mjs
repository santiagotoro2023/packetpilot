// Optional device features can be removed again: by the button at the end of the section
// and by right-clicking the section header. Ctrl+Z brings a removed feature back.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const wait = ms => page.waitForTimeout(ms);
let n = 0;

await page.goto(BASE + '#/');
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '#/lab/routed'); await wait(800);

const open = async name => {
  await page.locator('svg.net .dev', { hasText: name }).first().click();
  await page.click('.side .tabs button:has-text("Configuration")'); await wait(200);
};
const sect = title => page.locator('.side details.sect > summary', { hasText: title });
const box = title => page.locator('.side details.sect').filter({ has: page.locator('summary', { hasText: title }) });
const add = async title => {
  await page.click('.side .btn.addfeat'); await wait(100);
  await page.click(`.side .featmenu .featitem:has(b:text-is("${title}"))`); await wait(300);
};
const inMenu = async title => (await page.locator(`.side .featmenu .featitem:has(b:text-is("${title}"))`).count()) === 1;

// Router: add BGP, remove it with a right-click on the section header
await open('r1');
await add('BGP');
assert.equal(await sect('BGP').count(), 1, 'BGP section shown after adding'); n++;
assert.match(await sect('BGP').textContent(), /AS 65001/); n++;
await sect('BGP').click({ button: 'right' }); await wait(100);
assert.equal(await page.locator('.ctxmenu .ctx-item', { hasText: 'Remove BGP' }).count(), 1, 'context menu offers Remove BGP'); n++;
await page.click('.ctxmenu .ctx-item:has-text("Remove BGP")'); await wait(300);
assert.equal(await sect('BGP').count(), 0, 'BGP section gone'); n++;
assert.ok(await inMenu('BGP'), 'BGP is back in the add menu'); n++;
assert.match(await page.locator('.toast').textContent(), /BGP removed from r1\. Ctrl\+Z brings it back\./); n++;

// Ctrl+Z restores it, the button at the end of the section removes it again
await page.locator('.canvas-wrap').click({ position: { x: 600, y: 600 } });
await page.keyboard.press('Control+z'); await wait(400);
await open('r1');
assert.equal(await sect('BGP').count(), 1, 'Ctrl+Z brought BGP back'); n++;
await box('BGP').locator('button:has-text("Remove BGP")').click(); await wait(300);
assert.equal(await sect('BGP').count(), 0, 'the remove button removed BGP'); n++;

// OSPF in use, removed: the router console no longer shows it
await add('OSPF');
await box('OSPF').locator('label:has-text("OSPF on") input, label:has-text("Enable") input').first().check().catch(() => {});
await wait(200);
await box('OSPF').locator('button:has-text("Remove OSPF")').click(); await wait(300);
assert.equal(await sect('OSPF').count(), 0); n++;

// A feature that was only opened (nothing configured yet) disappears without a toast about undo
await add('Rules');
await box('Rules').locator('button:has-text("Remove Rules")').click(); await wait(200);
assert.equal(await sect('Rules').count(), 0); n++;

// Switch: spanning tree
await open('sw1');
await add('Spanning tree');
await sect('Spanning tree').click({ button: 'right' }); await page.click('.ctxmenu .ctx-item:has-text("Remove Spanning tree")'); await wait(300);
assert.equal(await sect('Spanning tree').count(), 0); n++;

// Host: IPv6 and WireGuard
await open('pc1');
await add('IPv6');
assert.equal(await sect('IPv6').count(), 1); n++;
await box('IPv6').locator('button:has-text("Remove IPv6")').click(); await wait(300);
assert.equal(await sect('IPv6').count(), 0); n++;
assert.ok(await inMenu('IPv6')); n++;

assert.deepEqual(errors, []);
console.log(`featremove: ${n} browser checks passed`);
await browser.close();
