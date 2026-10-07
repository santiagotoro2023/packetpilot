// Frame builder: stack layers freely, check rules, compute sizes
import { h } from './ui.js';

const BLOCKS = {
  eth: { name: 'Ethernet', size: 14, kind: 'eth', note: 'Destination MAC, source MAC, EtherType' },
  vlan: { name: '802.1Q tag', size: 4, kind: 'vlan', note: 'TPID 0x8100, PCP, DEI, VID' },
  arp: { name: 'ARP', size: 28, kind: 'arp', note: 'Request or reply' },
  stp: { name: 'BPDU (with LLC)', size: 38, kind: 'stp', note: 'Spanning tree: root ID, cost, bridge ID, timers' },
  ip: { name: 'IPv4', size: 20, kind: 'ip', note: 'TTL, protocol, addresses' },
  icmp: { name: 'ICMP', size: 8, kind: 'icmp', note: 'Echo, Unreachable, Time Exceeded' },
  udp: { name: 'UDP', size: 8, kind: 'udp', note: 'Ports, length, checksum' },
  tcp: { name: 'TCP', size: 20, kind: 'tcp', note: 'Ports, sequence, flags (without options)' },
  vxlan: { name: 'VXLAN', size: 8, kind: 'vxlan', note: 'Flags, VNI' },
  // Protocols on top: where they may sit (in) and whether anything may follow (last)
  dhcp: { name: 'DHCP', size: 300, kind: 'data', in: ['udp'], last: true, note: 'Discover, Offer, Request, ACK on UDP 67/68' },
  dns: { name: 'DNS', size: 32, kind: 'data', in: ['udp'], last: true, note: 'Query or answer on UDP 53 (size depends on the name)' },
  vrrp: { name: 'VRRP', size: 12, kind: 'rt', in: ['ip'], last: true, note: 'Advertisement: group, priority, virtual IP (protocol 112)' },
  ospf: { name: 'OSPF Hello', size: 48, kind: 'rt', in: ['ip'], last: true, note: 'Router ID, area, timers, neighbors (protocol 89)' },
  bfd: { name: 'BFD', size: 24, kind: 'rt', in: ['udp'], last: true, note: 'Control packet: state, discriminators, intervals (UDP 3784)' },
  data: { name: 'Data', size: null, kind: 'data', note: 'Application payload' }
};
// Headings in the palette, so the growing list stays easy to scan
const GROUP = { eth: 'Layer 2', vlan: 'Layer 2', arp: 'Layer 2', stp: 'Layer 2', ip: 'Layer 3', icmp: 'Layer 3', udp: 'Transport', tcp: 'Transport', vxlan: 'Tunnels' };
const PRESETS = {
  'Ping': ['eth', 'ip', 'icmp', 'data'],
  'ARP request': ['eth', 'arp'],
  'Ping in VLAN 10': ['eth', 'vlan', 'ip', 'icmp', 'data'],
  'DNS over UDP': ['eth', 'ip', 'udp', 'data'],
  'TCP SYN': ['eth', 'ip', 'tcp'],
  'BPDU': ['eth', 'stp'],
  'DHCP Discover': ['eth', 'ip', 'udp', 'dhcp'],
  'DNS query': ['eth', 'ip', 'udp', 'dns'],
  'OSPF Hello': ['eth', 'ip', 'ospf'],
  'VRRP': ['eth', 'ip', 'vrrp'],
  'BFD': ['eth', 'ip', 'udp', 'bfd'],
  'Ping over VXLAN': ['eth', 'ip', 'udp', 'vxlan', 'eth', 'ip', 'icmp', 'data']
};

function validate(seq) {
  const msgs = [], bad = new Set();
  const err = (i, m) => { bad.add(i); msgs.push(m); };
  if (!seq.length) return { msgs: ['Drag layers into the tray. Whatever goes onto the wire first is at the very front.'], bad, ok: false, empty: true };
  if (seq[0] !== 'eth') err(0, 'A frame always starts with the Ethernet header.');
  for (let i = 0; i < seq.length; i++) {
    const b = seq[i], prev = seq[i - 1], next = seq[i + 1];
    if (b === 'vlan' && prev !== 'eth') err(i, 'The 802.1Q tag follows directly after the Ethernet header (after the source MAC).');
    if (b === 'eth' && i > 0 && prev !== 'vxlan') err(i, 'A second Ethernet header only makes sense after a VXLAN header (inner frame).');
    if ((b === 'ip' || b === 'arp') && !['eth', 'vlan'].includes(prev)) err(i, `${BLOCKS[b].name} belongs directly in the Ethernet frame (EtherType).`);
    if (b === 'arp' && next) err(i + 1, 'ARP has no further payload, nothing follows it.');
    if (b === 'stp' && !['eth', 'vlan'].includes(prev)) err(i, 'A BPDU sits directly in the Ethernet frame (802.3 with LLC).');
    if (b === 'stp' && next) err(i + 1, 'Nothing follows the BPDU.');
    if (['icmp', 'udp', 'tcp'].includes(b) && prev !== 'ip') err(i, `${BLOCKS[b].name} is carried in an IP packet (protocol field).`);
    if (b === 'vxlan' && prev !== 'udp') err(i, 'VXLAN is carried in UDP (destination port 4789).');
    if (b === 'vxlan' && next !== 'eth') err(i, 'The inner Ethernet frame follows the VXLAN header.');
    if (b === 'data' && !['udp', 'tcp', 'icmp'].includes(prev)) err(i, 'Application data is carried in UDP, TCP or ICMP.');
    if (b === 'data' && next) err(i + 1, 'Only the FCS comes after the data.');
    if (b === 'vlan' && seq.filter(x => x === 'vlan').length > 2) err(i, 'More than two tags (QinQ) are unusual.');
    const B = BLOCKS[b];
    if (B.in && !B.in.includes(prev)) err(i, `${B.name} is carried in ${B.in.map(x => BLOCKS[x].name).join(' or ')}.`);
    if (B.last && next) err(i + 1, `Nothing follows ${B.name}, it is the payload itself.`);
  }
  return { msgs: msgs.length ? msgs : ['Valid frame.'], bad, ok: !msgs.length };
}

export function renderFrameBuilder(root) {
  let seq = [...PRESETS['Ping']];
  let dataLen = 56;
  let dragFrom = null;
  const pal = h('div', { class: 'fb-pal' });
  let lastGroup = null;
  for (const [k, b] of Object.entries(BLOCKS)) {
    const g = GROUP[k] || 'Protocols and data';
    if (g !== lastGroup) { pal.append(h('div', { class: 'fb-grp' }, g)); lastGroup = g; }
    const el = h('div', { class: 'fb-blk', draggable: 'true', style: { '--lc': `var(--l-${b.kind})` }, tabindex: '0', role: 'button', title: `${b.note}. Click to append at the end.` },
      b.name, h('span', { class: 'sz' }, b.size === null ? 'variable' : `${b.size} B`));
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
  const presetRow = h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Templates:'),
    ...Object.keys(PRESETS).map(n => h('button', { class: 'btn', onclick: () => { seq = [...PRESETS[n]]; draw(); } }, n)),
    h('button', { class: 'btn ghost', onclick: () => { seq = []; draw(); } }, 'Clear'));

  function draw() {
    drop.innerHTML = '';
    const v = validate(seq);
    seq.forEach((k, i) => {
      const b = BLOCKS[k];
      const size = b.size ?? dataLen;
      const cell = h('div', { class: `fb-cell bg-${b.kind}${v.bad.has(i) ? ' bad' : ''}`, draggable: 'true', 'data-i': i,
        style: { flex: `${Math.max(1, Math.log2(size + 2))} 0 auto` } },
        h('span', { class: 'n' }, b.name), h('span', { class: 'sz' }, `${size} bytes`),
        h('button', { title: 'remove', 'aria-label': `Remove ${b.name}`, onclick: () => { seq.splice(i, 1); draw(); } }, '✕'));
      cell.addEventListener('dragstart', () => { dragFrom = i; });
      drop.append(cell);
    });
    if (v.empty) drop.append(h('div', { class: 'muted', style: { alignSelf: 'center', padding: '0 8px' } }, 'Drop here'));
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
      stat(`${total} B`, 'Frame without FCS (as tcpdump shows it)'),
      stat(`${frameLen} B`, total + 4 < 64 ? `with FCS, padded to 64 bytes (${64 - total - 4} bytes of padding)` : 'with FCS'),
      stat(`${wire} B`, 'on the wire with preamble, SFD and inter-frame gap'),
      stat(`${payload} B`, mtuOk ? 'payload of the outer frame, fits in MTU 1500' : 'payload over 1500: needs a larger MTU (jumbo)'),
      stat(useful ? `${(useful / wire * 100).toFixed(1)} %` : '0 %', 'share of application data on the wire'));
    if (!mtuOk) stats.lastChild.previousSibling.style.borderColor = 'var(--err)';
  }
  root.append(h('div', { class: 'page' },
    h('h1', {}, 'Frame builder'),
    h('p', { class: 'muted' }, 'Stack headers into a frame and see right away whether the order is correct and how much space each layer takes.'),
    presetRow,
    h('div', { class: 'fb' }, pal, h('div', {},
      drop,
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('label', { class: 'field' }, 'Data size (bytes)', dataIn),
        h('span', { class: 'small muted', style: { maxWidth: '52ch' } }, 'Tip: with "Ping over VXLAN" and 1472 bytes of data you can see why the underlay needs 1550 bytes.')),
      msgs, stats))));
  draw();
}
