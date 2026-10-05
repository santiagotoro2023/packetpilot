import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(BASE + '#/lektion/m2-l4/1'); await p.waitForTimeout(800);
// Tempo maximal
await p.locator('.player input[type=range]').fill('100');
await p.click('.console .quick button:has-text("ping -c 2 10.0.4.10")');
await p.waitForTimeout(9000);
// r2 Konsole öffnen
await p.locator('svg.net .dev', { hasText: 'r2' }).first().dblclick();
await p.waitForTimeout(300);
await p.fill('.console .in input', 'ip route add 10.0.1.0/24 via 10.0.12.1'); await p.keyboard.press('Enter');
await p.fill('.goals input', 'r2'); await p.click('.goals button:has-text("Prüfen")');
await p.locator('svg.net .dev', { hasText: 'pc1' }).first().dblclick(); await p.waitForTimeout(300);
await p.click('.console .quick button:has-text("ping -c 2 10.0.4.10")');
await p.waitForTimeout(9000);
const okCount = await p.locator('.goals li.ok').count();
const nextDisabled = await p.locator('.lesson-nav .btn.primary').isDisabled();
console.log('Ziele erfüllt:', okCount, 'Weiter gesperrt:', nextDisabled);
await p.screenshot({ path: '/tmp/claude-0/shots/20-lesson-solved.png' });
// Label-Widget per Klick lösen
await p.goto(BASE + '#/lektion/m3-l1/1'); await p.waitForTimeout(500);
for (const name of ['TPID', 'PCP', 'DEI', 'VID']) {
  await p.click(`.dchip:text-is("${name}")`);
  const idx = ['TPID', 'PCP', 'DEI', 'VID'].indexOf(name);
  await p.locator('.slot').nth(idx).click();
}
await p.click('button:has-text("Prüfen")'); await p.waitForTimeout(200);
console.log('Label:', await p.locator('.feedback').first().innerText());
await p.screenshot({ path: '/tmp/claude-0/shots/21-label-solved.png' });
console.log('ERRORS:', errs.join('\n') || 'keine');
await b.close();
