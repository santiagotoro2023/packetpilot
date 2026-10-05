// Static preview of a topology and the live mini simulation on the home page
import { Sim, TIMING } from './engine.js';
import { layerKinds, shortLabel } from './packets.js';
import { svgEl } from './ui.js';
import { DEV_ICON } from './icons.js';

function frame(topo, pad = 70) {
  const xs = topo.devices.map(d => d.x), ys = topo.devices.map(d => d.y);
  if (!xs.length) return '0 0 400 200';
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  return `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;
}
const ZC = { blue: 'eth', violet: 'vlan', green: 'ip', orange: 'arp', pink: 'vxlan', yellow: 'stp' };
const KC = { vlan: 'violet', overlay: 'pink', underlay: 'blue' };
function drawStatic(svg, topo, scale = 1) {
  const byId = new Map(topo.devices.map(d => [d.id, d]));
  for (const z of topo.zones || []) {
    const c = z.color || KC[z.kind] || 'gray';
    const col = c === 'gray' ? 'var(--ink-3)' : `var(--l-${ZC[c]})`;
    svg.append(svgEl('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 14, fill: `color-mix(in srgb, ${col} 8%, transparent)`, stroke: col, 'stroke-dasharray': '8 6', 'stroke-width': 1.5 * scale }));
  }
  for (const l of topo.links) {
    const A = byId.get(l.a.dev), B = byId.get(l.b.dev);
    if (A && B) svg.append(svgEl('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: 'var(--ink-3)', 'stroke-width': 2.5 * scale }));
  }
  for (const d of topo.devices) {
    const g = svgEl('g', { transform: `translate(${d.x - 26 * scale},${d.y - 22 * scale}) scale(${1.3 * scale})`, class: `t-${d.type}` });
    g.append(svgEl('rect', { x: -2, y: 0, width: 44, height: 36, rx: 8, fill: 'var(--panel)', stroke: 'var(--line)' }));
    const ic = svgEl('g', { transform: 'translate(0,-2)' }); ic.innerHTML = DEV_ICON[d.type]; g.append(ic);
    svg.append(g);
    const t = svgEl('text', { x: d.x, y: d.y + 40 * scale, 'text-anchor': 'middle', 'font-size': 12 * scale, 'font-weight': 600, fill: 'var(--ink)' });
    t.textContent = d.name; svg.append(t);
  }
}
export function preview(topo) {
  const svg = svgEl('svg', { viewBox: frame(topo, 95), class: 'net', 'aria-hidden': 'true' });
  drawStatic(svg, topo, 1.8);
  return svg;
}

/** Live simulation: pc1 pings in a loop through a router */
export function heroSim(container, topo, script) {
  const svg = svgEl('svg', { viewBox: frame(topo, 80), class: 'net', style: 'width:100%;height:100%' });
  container.append(svg);
  drawStatic(svg, topo, 1.35);
  const gp = svgEl('g'); svg.append(gp);
  const sim = new Sim(topo);
  const byId = new Map(topo.devices.map(d => [d.id, d]));
  const els = new Map();
  let last = 0, idle = 0, raf, nextRun = 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const msPerHop = 700;
  const tick = ts => {
    const dt = Math.min(100, ts - (last || ts)); last = ts;
    if (!sim.queue.length && ts > nextRun) { script(sim); nextRun = ts + 6000; }
    if (sim.inflight.length) sim.runUntil(sim.time + dt * TIMING.linkDelay / msPerHop);
    else if (sim.queue.length) { if (!idle) idle = ts + 350; else if (ts > idle) { idle = 0; sim.runUntil(sim.nextTime()); } }
    const seen = new Set();
    for (const f of sim.inflight) {
      const A = byId.get(f.from), B = byId.get(f.to);
      const p = Math.min(1, Math.max(0, (sim.time - f.t0) / (f.t1 - f.t0)));
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      const x = A.x + dx * p - dy / len * 10, y = A.y + dy * p + dx / len * 10;
      let g = els.get(f.id);
      if (!g) {
        g = svgEl('g', { class: 'pkt' });
        const kinds = layerKinds(f.frame), W = 14 + kinds.length * 8, H = 22;
        g.append(svgEl('rect', { class: 'box', x: -W / 2, y: -H / 2, width: W, height: H, rx: 3, fill: 'var(--panel)' }));
        kinds.forEach((k, i) => g.append(svgEl('rect', { x: -W / 2 + 4 + i * 8, y: -H / 2 + 3.5, width: 6.5, height: H - 7, rx: 1, fill: `var(--l-${k})` })));
        const t = svgEl('text', { x: 0, y: H / 2 + 14, 'font-size': 12 }); t.textContent = shortLabel(f.frame); g.append(t);
        gp.append(g); els.set(f.id, g);
      }
      g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      seen.add(f.id);
    }
    for (const [id, g] of els) if (!seen.has(id)) { g.remove(); els.delete(id); }
    raf = requestAnimationFrame(tick);
  };
  if (!reduce) raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
