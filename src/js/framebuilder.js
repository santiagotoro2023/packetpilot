// Frame-Baukasten: Schichten frei stapeln, Regeln prüfen, Grössen berechnen
import { h } from './ui.js';

const BLOCKS = {
  eth: { name: 'Ethernet', size: 14, kind: 'eth', note: 'Ziel-MAC, Quell-MAC, EtherType' },
  vlan: { name: '802.1Q-Tag', size: 4, kind: 'vlan', note: 'TPID 0x8100, PCP, DEI, VID' },
  arp: { name: 'ARP', size: 28, kind: 'arp', note: 'Request oder Reply' },
  stp: { name: 'BPDU (mit LLC)', size: 38, kind: 'stp', note: 'Spanning Tree: Root-ID, Kosten, Bridge-ID, Timer' },
  ip: { name: 'IPv4', size: 20, kind: 'ip', note: 'TTL, Protocol, Adressen' },
  icmp: { name: 'ICMP', size: 8, kind: 'icmp', note: 'Echo, Unreachable, Time Exceeded' },
  udp: { name: 'UDP', size: 8, kind: 'udp', note: 'Ports, Länge, Prüfsumme' },
  tcp: { name: 'TCP', size: 20, kind: 'tcp', note: 'Ports, Sequenz, Flags (ohne Optionen)' },
  vxlan: { name: 'VXLAN', size: 8, kind: 'vxlan', note: 'Flags, VNI' },
  data: { name: 'Daten', size: null, kind: 'data', note: 'Nutzdaten der Anwendung' }
};
const PRESETS = {
  'Ping': ['eth', 'ip', 'icmp', 'data'],
  'ARP-Anfrage': ['eth', 'arp'],
  'Ping in VLAN 10': ['eth', 'vlan', 'ip', 'icmp', 'data'],
  'DNS über UDP': ['eth', 'ip', 'udp', 'data'],
  'TCP-SYN': ['eth', 'ip', 'tcp'],
  'BPDU': ['eth', 'stp'],
  'Ping über VXLAN': ['eth', 'ip', 'udp', 'vxlan', 'eth', 'ip', 'icmp', 'data']
};

function validate(seq) {
  const msgs = [], bad = new Set();
  const err = (i, m) => { bad.add(i); msgs.push(m); };
  if (!seq.length) return { msgs: ['Ziehe Schichten in die Ablage. Ganz vorne steht, was zuerst auf das Kabel geht.'], bad, ok: false, empty: true };
  if (seq[0] !== 'eth') err(0, 'Ein Frame beginnt immer mit dem Ethernet-Header.');
  for (let i = 0; i < seq.length; i++) {
    const b = seq[i], prev = seq[i - 1], next = seq[i + 1];
    if (b === 'vlan' && prev !== 'eth') err(i, 'Der 802.1Q-Tag folgt direkt auf den Ethernet-Header (nach der Quell-MAC).');
    if (b === 'eth' && i > 0 && prev !== 'vxlan') err(i, 'Ein zweiter Ethernet-Header ist nur nach einem VXLAN-Header sinnvoll (innerer Frame).');
    if ((b === 'ip' || b === 'arp') && !['eth', 'vlan'].includes(prev)) err(i, `${BLOCKS[b].name} gehört direkt in den Ethernet-Frame (EtherType).`);
    if (b === 'arp' && next) err(i + 1, 'ARP hat keine weitere Nutzlast, danach folgt nichts mehr.');
    if (b === 'stp' && !['eth', 'vlan'].includes(prev)) err(i, 'Eine BPDU steht direkt im Ethernet-Frame (802.3 mit LLC).');
    if (b === 'stp' && next) err(i + 1, 'Nach der BPDU folgt nichts mehr.');
    if (['icmp', 'udp', 'tcp'].includes(b) && prev !== 'ip') err(i, `${BLOCKS[b].name} steckt in einem IP-Paket (Feld Protocol).`);
    if (b === 'vxlan' && prev !== 'udp') err(i, 'VXLAN steckt in UDP (Ziel-Port 4789).');
    if (b === 'vxlan' && next !== 'eth') err(i, 'Nach dem VXLAN-Header folgt der innere Ethernet-Frame.');
    if (b === 'data' && !['udp', 'tcp', 'icmp'].includes(prev)) err(i, 'Daten der Anwendung stecken in UDP, TCP oder ICMP.');
    if (b === 'data' && next) err(i + 1, 'Nach den Daten kommt nur noch die FCS.');
    if (b === 'vlan' && seq.filter(x => x === 'vlan').length > 2) err(i, 'Mehr als zwei Tags (QinQ) sind unüblich.');
  }
  return { msgs: msgs.length ? msgs : ['Gültiger Frame.'], bad, ok: !msgs.length };
}

export function renderFrameBuilder(root) {
  let seq = [...PRESETS['Ping']];
  let dataLen = 56;
  let dragFrom = null;
  const pal = h('div', { class: 'fb-pal' });
  for (const [k, b] of Object.entries(BLOCKS)) {
    const el = h('div', { class: 'fb-blk', draggable: 'true', style: { '--lc': `var(--l-${b.kind})` }, tabindex: '0', role: 'button', title: `${b.note}. Klicken fügt hinten an.` },
      b.name, h('span', { class: 'sz' }, b.size === null ? 'variabel' : `${b.size} B`));
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/fb', k); dragFrom = null; });
    el.addEventListener('click', () => { seq.push(k); draw(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { seq.push(k); draw(); } });
    pal.append(el);
  }
  const drop = h('div', { class: 'fb-drop', 'aria-label': 'Frame' });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const k = e.dataTransfer.getData('text/fb');
    const target = e.target.closest('.fb-cell');
    const pos = target ? Number(target.dataset.i) : seq.length;
    if (dragFrom !== null) { const [m] = seq.splice(dragFrom, 1); seq.splice(pos > dragFrom ? pos - 1 : pos, 0, m); dragFrom = null; }
    else if (k) seq.splice(pos, 0, k);
    draw();
  });
  const msgs = h('div', { class: 'fb-msgs', role: 'status' });
  const stats = h('div', { class: 'fb-stats' });
  const dataIn = h('input', { class: 'input mono', type: 'number', min: '0', max: '9000', value: dataLen, style: { width: '96px' } });
  dataIn.addEventListener('input', () => { dataLen = Math.max(0, Math.min(9000, Number(dataIn.value) || 0)); draw(); });
  const presetRow = h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Vorlagen:'),
    ...Object.keys(PRESETS).map(n => h('button', { class: 'btn', onclick: () => { seq = [...PRESETS[n]]; draw(); } }, n)),
    h('button', { class: 'btn ghost', onclick: () => { seq = []; draw(); } }, 'Leeren'));

  function draw() {
    drop.innerHTML = '';
    const v = validate(seq);
    seq.forEach((k, i) => {
      const b = BLOCKS[k];
      const size = b.size ?? dataLen;
      const cell = h('div', { class: `fb-cell bg-${b.kind}${v.bad.has(i) ? ' bad' : ''}`, draggable: 'true', 'data-i': i,
        style: { flex: `${Math.max(1, Math.log2(size + 2))} 0 auto` } },
        h('span', { class: 'n' }, b.name), h('span', { class: 'sz' }, `${size} Byte`),
        h('button', { title: 'entfernen', 'aria-label': `${b.name} entfernen`, onclick: () => { seq.splice(i, 1); draw(); } }, '✕'));
      cell.addEventListener('dragstart', () => { dragFrom = i; });
      drop.append(cell);
    });
    if (v.empty) drop.append(h('div', { class: 'muted', style: { alignSelf: 'center', padding: '0 8px' } }, 'Hier ablegen'));
    msgs.innerHTML = '';
    for (const m of v.msgs) msgs.append(h('div', { class: 'm ' + (v.ok ? 'ok' : 'bad') }, m));
    stats.innerHTML = '';
    if (!v.ok) return;
    const sizes = seq.map(k => BLOCKS[k].size ?? dataLen);
    const total = sizes.reduce((a, b) => a + b, 0);
    const outerL2 = 14 + (seq[1] === 'vlan' ? 4 : 0);
    const payload = total - outerL2;
    const frameLen = Math.max(64, total + 4);
    const wire = frameLen + 8 + 12;
    const useful = seq.includes('data') ? dataLen : 0;
    const mtuOk = payload <= 1500;
    const stat = (val, label) => h('div', {}, h('b', {}, val), h('span', {}, label));
    stats.append(
      stat(`${total} B`, 'Frame ohne FCS (so zeigt ihn tcpdump)'),
      stat(`${frameLen} B`, total + 4 < 64 ? `mit FCS, auf 64 Byte aufgefüllt (${64 - total - 4} Byte Padding)` : 'mit FCS'),
      stat(`${wire} B`, 'auf dem Kabel mit Präambel, SFD und Pause'),
      stat(`${payload} B`, mtuOk ? 'Nutzlast des äusseren Frames, passt in MTU 1500' : 'Nutzlast über 1500: braucht grössere MTU (Jumbo)'),
      stat(useful ? `${(useful / wire * 100).toFixed(1)} %` : '0 %', 'Anteil der Anwendungsdaten auf dem Kabel'));
    if (!mtuOk) stats.lastChild.previousSibling.style.borderColor = 'var(--err)';
  }
  root.append(h('div', { class: 'page' },
    h('h1', {}, 'Frame-Baukasten'),
    h('p', { class: 'muted' }, 'Staple Header zu einem Frame und sieh sofort, ob die Reihenfolge stimmt und wie viel Platz jede Schicht kostet.'),
    presetRow,
    h('div', { class: 'fb' }, pal, h('div', {},
      drop,
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('label', { class: 'field' }, 'Grösse der Daten (Byte)', dataIn),
        h('span', { class: 'small muted', style: { maxWidth: '52ch' } }, 'Tipp: Bei "Ping über VXLAN" mit 1472 Byte Daten siehst du, warum das Underlay 1550 Byte braucht.')),
      msgs, stats))));
  draw();
}
