// Helpers for lesson content and goal checks
export function bar(parts, caption = '') {
  // parts: [label, sizeText, kind, flex]
  const cells = parts.map(([l, s, k, f]) =>
    `<div style="flex:${f || 1} 0 0;min-width:54px;background:var(--l-${k});color:#fff;padding:6px 8px;border-right:1px solid rgba(255,255,255,.35)">
      <div style="font-weight:650;font-size:.82rem">${l}</div><div style="font-family:var(--mono);font-size:.72rem;opacity:.9">${s}</div></div>`).join('');
  return `<div style="display:flex;border-radius:8px;overflow:hidden;margin:14px 0 4px;border:1px solid var(--line)">${cells}</div>${caption ? `<div class="small muted">${caption}</div>` : ''}`;
}
export const note = (html, warn = false) => `<div class="note${warn ? ' warn' : ''}">${html}</div>`;

// Goal checks
export const pingOk = (from, to, o = {}) => sim => sim.log.some(e => e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received > 0
  && (o.size === undefined || e.data.size >= o.size) && (o.df === undefined || e.data.df === o.df));
export const pingFailed = (from, to, o = {}) => sim => sim.log.some(e => e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received === 0
  && (o.size === undefined || e.data.size >= o.size));
export const tag = (dev, t, pred = () => true) => sim => sim.log.some(e => e.tag === t && (!dev || e.dev === dev) && pred(e.data || {}, e));
export const inspected = pred => (sim, ctx) => ctx.inspected.some(e => e.frame && pred(e.frame));
export const isArpReq = f => f.type === 'arp' && f.payload.op === 1;
export const isVxlan = f => f.type === 'ipv4' && f.payload.l4?.payload?.kind === 'vxlan';
export const all = (...fs) => (sim, ctx) => fs.every(f => f(sim, ctx));
// Ping succeeded after a specific event occurred
export const pingOkAfter = (from, to, evPred) => sim => {
  const ev = sim.log.find(evPred);
  return !!ev && sim.log.some(e => e.seq > ev.seq && e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received > 0);
};
export const linkBetween = (sim, a, b) => sim.topo.links.find(l => (l.a.dev === a && l.b.dev === b) || (l.a.dev === b && l.b.dev === a));
export const isTcpSyn = f => f.type === 'ipv4' && f.payload.l4?.kind === 'tcp' && f.payload.l4.flags.SYN && !f.payload.l4.flags.ACK;
export const isDns = f => f.type === 'ipv4' && f.payload.l4?.payload?.kind === 'dns';
