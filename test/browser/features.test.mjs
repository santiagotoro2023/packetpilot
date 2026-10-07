// Newer features in the browser: areas, STP display, storm, subinterfaces, services, frame exercises
import { chromium } from 'playwright';
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
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
const consoleRun = async (dev, cmd) => {
  await page.locator('svg.net .dev', { hasText: dev }).first().dblclick(); await wait(200);
  await page.fill('.console .in input', cmd); await page.keyboard.press('Enter');
};

// STP lab: dots on the ports, root badge
await page.goto(BASE + '#/lab/stp'); await wait(600);
await page.click('button[title^="Fast-forward 5 seconds"]'); await wait(300);
await page.click('button[title^="Fast-forward 5 seconds"]'); await wait(600);
console.log('STP dots:', await page.locator('svg.net .stp-dot').count(), 'blocked:', await page.locator('svg.net .stp-dot.st-blocking').count());
console.log('Badge:', await page.locator('svg.net .stpbadge').first().textContent());
await consoleRun('sw2', 'show spanning-tree'); await wait(300);
await shot('20-stp');
await page.click('.side .tabs button:has-text("Tables")'); await wait(200);
await shot('21-stp-tables');
// Storm
await page.goto(BASE + '#/lab/loop'); await wait(600);
await consoleRun('pc1', 'ping -c 1 10.0.0.2');
await page.waitForSelector('.storm:not(.hidden)', { timeout: 20000 });
await wait(300); await shot('22-storm');
await page.click('.storm button'); await wait(300);
console.log('Storm banner visible after reset:', await page.locator('.storm:not(.hidden)').count());
// Add an area, move it, resize it, rename it
await page.goto(BASE + '#/lab/empty'); await wait(500);
await page.click('.pal-item:has-text("Area")'); await wait(300);
const tab = page.locator('svg.net .zone-tab').first();
const tb = await tab.boundingBox();
await page.mouse.move(tb.x + 10, tb.y + 8); await page.mouse.down(); await page.mouse.move(tb.x + 120, tb.y + 60, { steps: 5 }); await page.mouse.up();
const rs = page.locator('svg.net .zone-rs').first();
const rb = await rs.boundingBox();
await page.mouse.move(rb.x + 4, rb.y + 4); await page.mouse.down(); await page.mouse.move(rb.x + 140, rb.y + 90, { steps: 5 }); await page.mouse.up();
await page.fill('.side input.input', 'Server room'); await wait(100);
await page.click('.swatch[title="Green"]'); await wait(200);
await page.click('.pal-item:has-text("PC")'); await wait(200);
await page.click('.pal-item:has-text("Area")'); await wait(300);
await shot('23-zones');
const z = await page.evaluate(() => JSON.parse(localStorage.getItem('packetpilot') || '{}'));
console.log('Areas saved:', JSON.stringify(z?.prefs?.sandbox?.zones?.map(x => [x.label, x.color, x.w, x.h]) ?? z).slice(0, 200));
// Router on a stick: configuration panel
await page.goto(BASE + '#/lab/stick'); await wait(600);
await page.locator('svg.net .dev', { hasText: 'r1' }).first().click(); await wait(300);
await shot('24-stick-config');
await consoleRun('a1', 'ping -c 2 10.20.0.11'); await wait(9000);
console.log('Stick:', (await page.locator('.console pre').innerText()).split('\n').slice(-2).join(' | '));
// Services
await page.goto(BASE + '#/lab/services'); await wait(600);
await consoleRun('client', 'curl http://web.lab/'); await wait(14000);
console.log('curl:', (await page.locator('.console pre').innerText()).split('\n').slice(-3).join(' | '));
await page.locator('.log .e.has-frame', { hasText: 'SYN' }).first().click(); await wait(300);
await shot('25-tcp');
await page.locator('svg.net .dev', { hasText: 'web' }).first().click(); await page.click('.side .tabs button:has-text("Configuration")'); await wait(300);
await shot('26-services-config');
// Lessons: click through the new modules
const lessons = await page.evaluate(async () => (await import('./js/course/index.js')).MODULES.flatMap(m => m.lessons.map(l => ({ id: l.id, n: l.steps.length }))));
for (const l of lessons) for (let i = 0; i < l.n; i++) { await page.goto(`${BASE}#/lesson/${l.id}/${i}`); await wait(250); }
await page.goto(BASE + '#/lesson/m4-l2/2'); await wait(400);
// Build a BPDU
await page.click('.bld-pal button:has-text("Ethernet")'); await page.click('.bld-pal button:has-text("BPDU")');
const sels = page.locator('.bld-layer select');
await sels.nth(0).selectOption('01:80:c2:00:00:00');
await sels.nth(1).selectOption({ index: 1 });
await sels.nth(2).selectOption('len');
await sels.nth(3).selectOption({ index: 1 });
await page.fill('.bld-layer input', '0');
await sels.nth(4).selectOption({ index: 1 });
await page.click('button:has-text("Check")'); await wait(200);
console.log('Build:', await page.locator('.feedback').last().textContent());
await shot('27-build');
await page.goto(BASE + '#/lesson/m4-l3/2'); await wait(1500); await shot('28-lesson-stp');
await page.goto(BASE); await wait(800); await page.screenshot({ path: `${OUT}/29-home.png`, fullPage: true });
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(BASE + '#/lab/stick'); await wait(700); await shot('30-dark-stick');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
