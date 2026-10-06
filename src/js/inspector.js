// Packet inspector: layers, fields, byte bar
import { dissect, summary } from './packets.js';
import { frameLen, frameWireLen } from './net.js';
import { h, esc } from './ui.js';

export function renderInspector(el, entry, { onTrace } = {}) {
  el.innerHTML = '';
  if (!entry || !entry.frame) {
    el.append(h('div', { class: 'empty' }, 'Click a packet in the network diagram or a row in the log to take it apart layer by layer.'));
    return;
  }
  const f = entry.frame;
  const layers = dissect(f);
  const total = frameLen(f);
  el.append(h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, summary(f)));
  el.append(h('div', { class: 'muted small' },
    `${entry.dev ? entry.dev + ', ' : ''}t = ${(entry.t / 1000).toFixed(4)} s, ${total} bytes without FCS, ${frameWireLen(f)} bytes in the frame with FCS`));
  const bar = h('div', { class: 'bytebar', title: 'Share of each layer in the frame size' });
  for (const l of layers) bar.append(h('i', { class: `bg-${l.kind}`, style: { flex: `${Math.max(l.bytes, 1)} 0 0` }, title: `${l.name}: ${l.bytes} bytes` }));
  el.append(bar, h('div', { class: 'bytelegend' }, h('span', {}, '0'), h('span', {}, `${total} bytes`)));
  if (entry.trace && onTrace) el.append(h('div', { class: 'row', style: { margin: '6px 0' } },
    h('button', { class: 'btn', onclick: () => onTrace(entry.trace) }, 'Trace this packet\'s path')));
  for (const l of layers) {
    const d = h('details', { class: `layer lc-${l.kind}${l.depth ? ' inner' : ''}`, open: l.depth === 0 && ['ip', 'arp', 'vxlan', 'icmp', 'rt'].includes(l.kind) ? true : null });
    d.append(h('summary', {}, l.name, h('span', { class: 'b' }, `${l.bytes} bytes`)));
    const t = h('table');
    for (const [k, v, hint] of l.fields) t.append(h('tr', {}, h('td', {}, k), h('td', { class: 'v' }, v), h('td', { class: 'h' }, hint || '')));
    d.append(t);
    el.append(d);
  }
}
export { esc };
