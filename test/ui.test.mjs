import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || '/tmp/claude-0/shots';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

async function shot(name) { await page.screenshot({ path: `${OUT}/${name}.png` }); }
const wait = ms => page.waitForTimeout(ms);

await page.goto(BASE);
await wait(2500);
await shot('01-home');

// Labor: Gerät hinzufügen, verbinden, ping
await page.goto(BASE + '#/labor/routed');
await wait(800);
await page.locator('svg.net .dev', { hasText: 'pc1' }).first().dblclick();
await wait(300);
await page.fill('.console .in input', 'ping -c 2 192.168.20.20');
await page.keyboard.press('Enter');
await wait(1800);
await shot('02-lab-ping');
await wait(6000);
await shot('03-lab-after');
const consoleText = await page.locator('.console pre').innerText();
console.log('CONSOLE:', consoleText.split('\n').slice(-3).join(' | '));
// Paket im Protokoll anklicken
await page.locator('.log .e.has-frame').nth(3).click();
await wait(300);
await shot('04-inspector');

// Lektionen durchklicken
const lessons = await page.evaluate(async () => (await import('./js/course/index.js')).MODULES.flatMap(m => m.lessons.map(l => ({ id: l.id, n: l.steps.length }))));
for (const l of lessons) {
  for (let i = 0; i < l.n; i++) {
    await page.goto(`${BASE}#/lektion/${l.id}/${i}`);
    await wait(350);
  }
}
await page.goto(BASE + '#/lektion/m1-l2/1'); await wait(400); await shot('05-label');
await page.goto(BASE + '#/lektion/m3-l4/0'); await wait(1200); await shot('06-lesson-lab');
await page.goto(BASE + '#/netze'); await wait(500); await shot('07-nets');
await page.goto(BASE + '#/baukasten'); await wait(400); await shot('08-frames');
await page.click('text=Ping über VXLAN'); await wait(200); await shot('09-frames-vxlan');
await page.goto(BASE + '#/lektion/m1-l1/0'); await wait(400); await shot('10-theory');
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(BASE + '#/labor/vxlan'); await wait(800); await shot('11-dark-lab');
await page.goto(BASE); await wait(1500); await shot('12-dark-home');
await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ colorScheme: 'light' });
await page.goto(BASE); await wait(800); await shot('13-mobile');

console.log('ERRORS:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
