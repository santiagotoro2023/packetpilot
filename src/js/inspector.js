// Paketinspektor: Schichten, Felder, Byte-Balken
import { dissect, summary } from './packets.js';
import { frameLen, frameWireLen } from './net.js';
import { h, esc } from './ui.js';

export function renderInspector(el, entry, { onTrace } = {}) {
  el.innerHTML = '';
  if (!entry || !entry.frame) {
    el.append(h('div', { class: 'empty' }, 'Klicke auf ein Paket im Netzplan oder auf eine Zeile im Protokoll, um es Schicht für Schicht zu zerlegen.'));
    return;
  }
  const f = entry.frame;
  const layers = dissect(f);
  const total = frameLen(f);
  el.append(h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, summary(f)));
  el.append(h('div', { class: 'muted small' },
    `${entry.dev ? entry.dev + ', ' : ''}t = ${(entry.t / 1000).toFixed(4)} s, ${total} Byte ohne FCS, ${frameWireLen(f)} Byte im Frame mit FCS`));
  const bar = h('div', { class: 'bytebar', title: 'Anteil jeder Schicht an der Framegrösse' });
  for (const l of layers) bar.append(h('i', { class: `bg-${l.kind}`, style: { flex: `${Math.max(l.bytes, 1)} 0 0` }, title: `${l.name}: ${l.bytes} Byte` }));
  el.append(bar, h('div', { class: 'bytelegend' }, h('span', {}, '0'), h('span', {}, `${total} Byte`)));
  if (entry.trace && onTrace) el.append(h('div', { class: 'row', style: { margin: '6px 0' } },
    h('button', { class: 'btn', onclick: () => onTrace(entry.trace) }, 'Weg dieses Pakets verfolgen')));
  for (const l of layers) {
    const d = h('details', { class: `layer lc-${l.kind}${l.depth ? ' inner' : ''}`, open: l.depth === 0 && ['ip', 'arp', 'vxlan', 'icmp'].includes(l.kind) ? true : null });
    d.append(h('summary', {}, l.name, h('span', { class: 'b' }, `${l.bytes} Byte`)));
    const t = h('table');
    for (const [k, v, hint] of l.fields) t.append(h('tr', {}, h('td', {}, k), h('td', { class: 'v' }, v), h('td', { class: 'h' }, hint || '')));
    d.append(t);
    el.append(d);
  }
}
export { esc };
