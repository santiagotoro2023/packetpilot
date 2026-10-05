// Interactive exercises for the lessons
import { h, esc } from './ui.js';
import { I } from './icons.js';
import { inNet, parseCidr, isGroupMac, isLocalMac } from './net.js';

const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');

export function renderWidget(step, el, done) {
  const fn = { quiz, label, stack, mac, lpm, build }[step.type];
  const wrap = h('div', { class: 'widget' });
  if (step.title) wrap.append(h('h2', {}, step.title));
  if (step.intro) wrap.append(h('div', { class: 'theory', style: { padding: 0, margin: 0 }, html: step.intro }));
  el.append(wrap);
  fn(step, wrap, done);
}

// ---------------------------------------------------------------- Quiz
function quiz(step, el, done) {
  const state = step.questions.map(() => false);
  const check = () => { if (state.every(Boolean)) done(); };
  step.questions.forEach((q, qi) => {
    const box = h('div', { class: 'quiz-q' }, h('div', { style: { fontWeight: 600 }, html: q.q }));
    const explain = h('div', { class: 'explain hidden', html: q.explain || '' });
    if (q.input) {
      const inp = h('input', { class: 'input mono', type: 'text', 'aria-label': 'Answer' });
      const fb = h('span', { class: 'feedback' });
      const test = () => {
        const ok = q.input.some(a => norm(a) === norm(inp.value));
        fb.textContent = ok ? 'Correct' : 'Not yet';
        fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
        if (ok) { state[qi] = true; explain.classList.remove('hidden'); inp.disabled = true; check(); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') test(); });
      box.append(h('div', { class: 'row', style: { marginTop: '10px' } }, inp, q.unit ? h('span', { class: 'muted' }, q.unit) : null,
        h('button', { class: 'btn', onclick: test }, 'Check'), fb));
    } else {
      const opts = h('div', { class: 'opts', role: 'radiogroup' });
      q.options.forEach((o, oi) => {
        const lab = h('label', {}, h('input', { type: 'radio', name: `q${step.id}-${qi}` }), h('span', { html: o }));
        lab.querySelector('input').addEventListener('change', () => {
          opts.querySelectorAll('label').forEach(l => l.classList.remove('right', 'wrong'));
          if (oi === q.correct) { lab.classList.add('right'); state[qi] = true; explain.classList.remove('hidden'); check(); }
          else { lab.classList.add('wrong'); explain.classList.add('hidden'); }
        });
        opts.append(lab);
      });
      box.append(opts);
    }
    box.append(explain);
    el.append(box);
  });
}

// ---------------------------------------------------------------- Label the frame
function label(step, el, done) {
  const rows = step.rows || [step.slots];
  const all = rows.flat();
  const labels = shuffle([...all.map(s => s.label), ...(step.distractors || [])]);
  let picked = null;
  const chips = h('div', { class: 'chips', 'aria-label': 'Terms' });
  const fill = new Map();
  const chipEls = new Map();
  const drawChips = () => {
    chips.innerHTML = '';
    const used = new Set(fill.values());
    for (const l of labels) {
      if (used.has(l)) continue;
      const c = h('button', { class: 'dchip' + (picked === l ? ' sel' : ''), draggable: 'true' }, l);
      c.addEventListener('click', () => { picked = picked === l ? null : l; drawChips(); });
      c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', l); picked = l; });
      chipEls.set(l, c);
      chips.append(c);
    }
    if (!chips.childElementCount) chips.append(h('span', { class: 'muted small' }, 'All terms placed.'));
  };
  const slotEls = [];
  const put = (slot, se, l) => {
    for (const [k, v] of fill) if (v === l) fill.delete(k);
    fill.set(slot, l); picked = null;
    drawSlots(); drawChips();
  };
  const drawSlots = () => {
    for (const { slot, se } of slotEls) {
      const l = fill.get(slot);
      se.className = 'slot' + (l ? ' filled' : '');
      se.innerHTML = '';
      se.append(h('div', { style: { fontWeight: l ? 600 : 400, color: l ? 'var(--ink)' : 'var(--ink-3)' } }, l || 'drop here'),
        h('div', { class: 'size' }, slot.size || ''));
      se.style.borderTop = `5px solid var(--l-${slot.kind || 'data'})`;
    }
  };
  const grid = h('div', { style: { display: 'grid', gap: '6px' } });
  for (const r of rows) {
    const rowEl = h('div', { class: 'slotrow' });
    for (const slot of r) {
      const se = h('button', { class: 'slot', style: { width: `${slot.w || 90}px` }, 'aria-label': 'Field' });
      se.addEventListener('click', () => { if (picked) put(slot, se, picked); else if (fill.has(slot)) { fill.delete(slot); drawSlots(); drawChips(); } });
      se.addEventListener('dragover', e => { e.preventDefault(); se.classList.add('over'); });
      se.addEventListener('dragleave', () => se.classList.remove('over'));
      se.addEventListener('drop', e => { e.preventDefault(); put(slot, se, e.dataTransfer.getData('text/plain')); });
      slotEls.push({ slot, se });
      rowEl.append(se);
    }
    grid.append(rowEl);
  }
  const fb = h('div', { class: 'feedback' });
  const explain = h('div', { class: 'explain hidden', html: step.explain || '' });
  el.append(h('p', { class: 'muted small' }, 'Click or drag a term and drop it on a field. Clicking a filled field clears it.'),
    chips, grid,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      let right = 0;
      for (const { slot, se } of slotEls) {
        const ok = fill.get(slot) === slot.label;
        se.classList.toggle('right', ok); se.classList.toggle('wrong', !!fill.get(slot) && !ok);
        if (ok) right++;
      }
      const all = right === slotEls.length;
      fb.textContent = all ? 'Everything placed correctly.' : `${right} of ${slotEls.length} correct. Wrong fields are marked red.`;
      fb.className = 'feedback ' + (all ? 'ok' : 'bad');
      if (all) { explain.classList.remove('hidden'); done(); }
    } }, 'Check'), fb), explain);
  drawChips(); drawSlots();
}

// ---------------------------------------------------------------- Order
function stack(step, el, done) {
  let order = shuffle(step.items.map((_, i) => i));
  if (order.every((v, i) => v === i)) order = order.reverse();
  const list = h('div', { class: 'stack-list' });
  const fb = h('div', { class: 'feedback' });
  const explain = h('div', { class: 'explain hidden', html: step.explain || '' });
  let dragIdx = null;
  const draw = () => {
    list.innerHTML = '';
    order.forEach((idx, pos) => {
      const it = step.items[idx];
      const row = h('div', { class: 'stack-item', draggable: 'true', style: { borderLeftColor: `var(--l-${it.kind || 'data'})` } },
        h('span', { html: I.grip, style: { color: 'var(--ink-3)' } }),
        h('div', {}, h('b', {}, it.name), it.size ? h('span', { class: 'muted small' }, `  ${it.size}`) : null),
        h('div', { class: 'row', style: { gap: '2px' } },
          h('button', { class: 'btn icon ghost', title: 'move up', html: I.up, disabled: pos === 0 ? true : null, onclick: () => { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; draw(); } }),
          h('button', { class: 'btn icon ghost', title: 'move down', html: I.down, disabled: pos === order.length - 1 ? true : null, onclick: () => { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; draw(); } })));
      row.addEventListener('dragstart', () => { dragIdx = pos; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => { e.preventDefault(); if (dragIdx === null) return; const [m] = order.splice(dragIdx, 1); order.splice(pos, 0, m); dragIdx = null; draw(); });
      list.append(row);
    });
  };
  draw();
  el.append(h('p', { class: 'muted small' }, step.hint || 'Drag the blocks into the right order or use the arrows.'), list,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      const ok = order.every((v, i) => v === i);
      fb.textContent = ok ? 'Correct.' : 'Not quite yet. Remember: which layer goes onto the wire first?';
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      if (ok) { explain.classList.remove('hidden'); done(); }
    } }, 'Check'), fb), explain);
}

// ---------------------------------------------------------------- MAC decoder
const OUI = { '00:50:56': 'VMware (ESXi)', '00:0c:29': 'VMware (Workstation)', '52:54:00': 'QEMU/KVM (locally administered)', 'aa:c1:ab': 'containerlab (locally administered)',
  '02:42:ac': 'Docker (older versions)', '00:1b:21': 'Intel', '3c:fd:fe': 'Intel', 'f4:4d:30': 'Elitegroup', '00:00:5e': 'IANA (VRRP: 00:00:5e:00:01:xx)', '01:00:5e': 'IPv4 multicast', '33:33:00': 'IPv6 multicast' };
export function classifyMac(m) {
  if (m === 'ff:ff:ff:ff:ff:ff') return 'Broadcast';
  if (isGroupMac(m)) return 'Multicast';
  return isLocalMac(m) ? 'Unicast, locally administered' : 'Unicast, from the manufacturer';
}
function mac(step, el, done) {
  const inp = h('input', { class: 'input mono', value: '00:50:56:a3:1f:7c', 'aria-label': 'MAC address', style: { width: '210px' } });
  const out = h('div');
  const draw = () => {
    out.innerHTML = '';
    const m = inp.value.trim().toLowerCase().replace(/-/g, ':');
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)) { out.append(h('p', { class: 'muted' }, 'Format: six hex pairs, e.g. 00:50:56:a3:1f:7c')); return; }
    const b = parseInt(m.slice(0, 2), 16);
    const bits = h('div', { class: 'macbits' });
    for (let i = 7; i >= 0; i--) bits.append(h('div', { class: i <= 1 ? 'hl' : '' }, (b >> i) & 1, h('span', {}, 'b' + i)));
    const oui = OUI[m.slice(0, 8)];
    out.append(h('p', {}, 'First byte ', h('code', {}, m.slice(0, 2)), ' in binary, the two highlighted bits decide:'), bits,
      h('table', { class: 'rtable' },
        h('tr', {}, h('th', {}, 'Bit b0 (I/G)'), h('td', {}, (b & 1) ? '1: group (multicast or broadcast)' : '0: single interface (unicast)')),
        h('tr', {}, h('th', {}, 'Bit b1 (U/L)'), h('td', {}, (b & 2) ? '1: locally administered' : '0: assigned by the manufacturer (OUI)')),
        h('tr', {}, h('th', {}, 'OUI'), h('td', {}, `${m.slice(0, 8)}${oui ? '  ' + oui : '  (not in the short list)'}`)),
        h('tr', {}, h('th', {}, 'Result'), h('td', {}, classifyMac(m)))));
  };
  inp.addEventListener('input', draw);
  el.append(h('div', { class: 'row' }, h('label', { class: 'field' }, 'Try a MAC address', inp)), out);
  draw();
  const qs = step.classify || [];
  const state = qs.map(() => false);
  const box = h('div', { class: 'quiz-q', style: { marginTop: '16px' } }, h('div', { style: { fontWeight: 600 } }, 'Classify these addresses:'));
  qs.forEach((m, i) => {
    const s = h('select', { class: 'input' }, ['please choose', 'Unicast, from the manufacturer', 'Unicast, locally administered', 'Multicast', 'Broadcast'].map(o => h('option', {}, o)));
    const fb = h('span', { class: 'feedback' });
    s.addEventListener('change', () => {
      const ok = s.value === classifyMac(m);
      fb.textContent = ok ? 'Correct' : 'No'; fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      state[i] = ok;
      if (state.every(Boolean)) done();
    });
    box.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('code', { style: { width: '150px' } }, m), s, fb));
  });
  if (qs.length) el.append(box); else done();
}

// ---------------------------------------------------------------- Longest Prefix Match
export function lpmAnswer(table, ip) {
  let best = null;
  for (const [pre, nh] of table) {
    const p = parseCidr(pre);
    if (p && inNet(ip, p.net, p.len) && (!best || p.len > best.len)) best = { len: p.len, nh };
  }
  return best ? best.nh : 'no route';
}
function lpm(step, el, done) {
  const t = h('table', { class: 'rtable' }, h('tr', {}, h('th', {}, 'Destination'), h('th', {}, 'Next hop')),
    step.table.map(([p, n]) => h('tr', {}, h('td', {}, p), h('td', {}, n))));
  const nhs = [...new Set(step.table.map(x => x[1])), ...(step.table.some(x => x[0].endsWith('/0')) ? [] : ['no route'])];
  const state = step.dests.map(() => false);
  const qs = h('div', { style: { display: 'grid', gap: '8px', marginTop: '14px' } });
  step.dests.forEach((ip, i) => {
    const s = h('select', { class: 'input' }, h('option', {}, 'please choose'), nhs.map(n => h('option', {}, n)));
    const fb = h('span', { class: 'feedback' });
    s.addEventListener('change', () => {
      const ans = lpmAnswer(step.table, ip);
      const ok = s.value === ans;
      fb.textContent = ok ? 'Correct' : 'No, check which entries match and which one is the longest';
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      state[i] = ok;
      if (state.every(Boolean)) done();
    });
    qs.append(h('div', { class: 'row' }, h('span', {}, 'Packet to'), h('code', { style: { width: '120px' } }, ip), h('span', {}, 'goes to'), s, fb));
  });
  el.append(t, qs);
}

// ---------------------------------------------------------------- Build a frame
const ETHERTYPES = [['0x0800', '0x0800 IPv4'], ['0x0806', '0x0806 ARP'], ['0x8100', '0x8100 802.1Q tag'], ['0x86dd', '0x86DD IPv6'], ['len', 'Length (802.3 with LLC)']];
export const BUILD_BLOCKS = {
  eth: { name: 'Ethernet', kind: 'eth', fields: [['dst', 'Destination MAC', 'mac'], ['src', 'Source MAC', 'mac'], ['type', 'EtherType', ETHERTYPES]] },
  vlan: { name: '802.1Q tag', kind: 'vlan', fields: [['vid', 'VLAN ID', 'num'], ['type', 'Following EtherType', ETHERTYPES]] },
  arp: { name: 'ARP', kind: 'arp', fields: [['op', 'Operation', [['1', '1 Request'], ['2', '2 Reply']]], ['sha', 'Sender MAC', 'mac'], ['spa', 'Sender IP', 'ip'], ['tha', 'Target MAC', 'mac'], ['tpa', 'Target IP', 'ip']] },
  stp: { name: 'BPDU', kind: 'stp', fields: [['root', 'Root ID', 'bid'], ['cost', 'Root path cost', 'num'], ['bridge', 'Bridge ID (sender)', 'bid']] },
  ip: { name: 'IPv4', kind: 'ip', fields: [['src', 'Source IP', 'ip'], ['dst', 'Destination IP', 'ip'], ['proto', 'Protocol', [['1', '1 ICMP'], ['6', '6 TCP'], ['17', '17 UDP']]], ['ttl', 'TTL', 'num']] },
  icmp: { name: 'ICMP', kind: 'icmp', fields: [['type', 'Type', [['8', '8 Echo Request'], ['0', '0 Echo Reply'], ['3', '3 Destination Unreachable'], ['11', '11 Time Exceeded']]]] },
  udp: { name: 'UDP', kind: 'udp', fields: [['sport', 'Source port', 'num'], ['dport', 'Destination port', 'num']] },
  tcp: { name: 'TCP', kind: 'tcp', fields: [['sport', 'Source port', 'num'], ['dport', 'Destination port', 'num'], ['flags', 'Flags', [['SYN', 'SYN'], ['SYN,ACK', 'SYN, ACK'], ['ACK', 'ACK'], ['PSH,ACK', 'PSH, ACK'], ['FIN,ACK', 'FIN, ACK'], ['RST', 'RST'], ['RST,ACK', 'RST, ACK']]]] },
  dns: { name: 'DNS', kind: 'udp', fields: [['qr', 'Kind', [['0', 'Query (QR 0)'], ['1', 'Response (QR 1)']]], ['name', 'Queried name', 'name']] },
  http: { name: 'HTTP', kind: 'data', fields: [['msg', 'Message', [['GET', 'GET / HTTP/1.1'], ['200', 'HTTP/1.1 200 OK']]]] },
  data: { name: 'Data', kind: 'data', fields: [] }
};
function matches(exp, val) {
  if (exp === '*') return val !== '' && val !== undefined;
  if (Array.isArray(exp)) return exp.some(e => matches(e, val));
  if (exp && typeof exp === 'object' && exp.range) { const n = Number(val); return val !== '' && n >= exp.range[0] && n <= exp.range[1]; }
  return String(exp).toLowerCase() === String(val ?? '').trim().toLowerCase();
}
export function checkBuild(expected, frame) {
  const res = { ok: true, layers: [], msgs: [] };
  const n = Math.max(expected.length, frame.length);
  for (let i = 0; i < n; i++) {
    const e = expected[i], f = frame[i];
    if (!f) { res.ok = false; res.msgs.push(`A layer is still missing after ${BUILD_BLOCKS[frame[i - 1]?.block]?.name || 'the start'}.`); break; }
    if (!e) { res.ok = false; res.layers[i] = { wrongBlock: true }; res.msgs.push(`${BUILD_BLOCKS[f.block].name} is one too many.`); continue; }
    if (e.block !== f.block) { res.ok = false; res.layers[i] = { wrongBlock: true }; res.msgs.push(`Position ${i + 1} needs a different layer than ${BUILD_BLOCKS[f.block].name}.`); continue; }
    const bad = Object.entries(e.fields || {}).filter(([k, v]) => !matches(v, f.fields[k])).map(([k]) => k);
    res.layers[i] = { bad };
    if (bad.length) res.ok = false;
  }
  if (res.ok) res.msgs.push('The frame is correct.');
  else if (!res.msgs.length) res.msgs.push('The layers are correct, the fields marked red are not yet.');
  return res;
}
function build(step, el, done) {
  const frame = [];
  const allowed = step.blocks || ['eth', 'vlan', 'arp', 'stp', 'ip', 'icmp', 'udp', 'tcp', 'dns', 'http', 'data'];
  const addr = step.addresses || {};
  const macs = [...(addr.mac || []), ['ff:ff:ff:ff:ff:ff', 'Broadcast'], ['00:00:00:00:00:00', 'unknown (zeros)'], ['01:80:c2:00:00:00', 'STP multicast']];
  const ips = [...(addr.ip || []), ['0.0.0.0', 'no address']];
  const optsFor = t => t === 'mac' ? macs.map(([v, l]) => [v, `${v}  ${l}`]) : t === 'ip' ? ips.map(([v, l]) => [v, `${v}  ${l}`]) : t === 'bid' ? (addr.bid || []).map(([v, l]) => [v, `${v}  ${l}`]) : t === 'name' ? (addr.name || []).map(n => [n, n]) : null;
  const pal = h('div', { class: 'fb-pal bld-pal' });
  for (const k of allowed) {
    const b = BUILD_BLOCKS[k];
    pal.append(h('button', { class: 'fb-blk', style: { '--lc': `var(--l-${b.kind})` }, onclick: () => { frame.push({ block: k, fields: {} }); draw(); } }, b.name, h('span', { class: 'sz', html: I.plus })));
  }
  const area = h('div', { class: 'bld-frame' });
  const fb = h('div', { class: 'feedback' });
  const explain = h('div', { class: 'explain hidden', html: step.explain || '' });
  let result = null;
  const draw = () => {
    area.innerHTML = '';
    if (!frame.length) area.append(h('div', { class: 'empty' }, 'Still empty. On the left, pick the layers in the order in which they go onto the wire.'));
    frame.forEach((layer, i) => {
      const b = BUILD_BLOCKS[layer.block];
      const lr = result?.layers[i];
      const card = h('div', { class: 'bld-layer' + (lr?.wrongBlock ? ' wrong' : ''), style: { '--lc': `var(--l-${b.kind})` } });
      card.append(h('div', { class: 'bld-head' }, h('b', {}, `${i + 1}. ${b.name}`), h('span', { class: 'grow' }),
        h('button', { class: 'btn icon ghost', title: 'move up', html: I.up, disabled: i === 0 ? true : null, onclick: () => { [frame[i - 1], frame[i]] = [frame[i], frame[i - 1]]; result = null; draw(); } }),
        h('button', { class: 'btn icon ghost', title: 'remove', html: I.trash, onclick: () => { frame.splice(i, 1); result = null; draw(); } })));
      if (b.fields.length) {
        const g = h('div', { class: 'bld-fields' });
        for (const [k, label, t] of b.fields) {
          const opts = Array.isArray(t) ? t : optsFor(t);
          let inp;
          if (opts) {
            inp = h('select', { class: 'input mono' }, h('option', { value: '' }, 'choose'), opts.map(([v, l]) => h('option', { value: v, selected: layer.fields[k] === v ? true : null }, l)));
          } else inp = h('input', { class: 'input mono', type: t === 'num' ? 'number' : 'text', value: layer.fields[k] ?? '', placeholder: t === 'num' ? 'number' : '' });
          inp.addEventListener('change', () => { layer.fields[k] = inp.value; result = null; card.querySelectorAll('.bad').forEach(x => x.classList.remove('bad')); });
          if (lr?.bad?.includes(k)) inp.classList.add('bad');
          g.append(h('label', { class: 'field' }, label, inp));
        }
        card.append(g);
      }
      area.append(card);
    });
  };
  draw();
  el.append(h('div', { class: 'quiz-q', html: step.task }),
    h('div', { class: 'bld' }, pal, area),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      result = checkBuild(step.expected, frame);
      draw();
      fb.textContent = result.msgs.join(' ');
      fb.className = 'feedback ' + (result.ok ? 'ok' : 'bad');
      if (result.ok) { explain.classList.remove('hidden'); done(); }
    } }, 'Check'), h('button', { class: 'btn ghost', onclick: () => { frame.length = 0; result = null; fb.textContent = ''; draw(); } }, 'Clear'), fb), explain);
}
export { esc };
