// Building, describing and dissecting frames
import { ETH_HDR, VLAN_TAG, IP_HDR, UDP_HDR, ICMP_HDR, VXLAN_HDR, ARP_LEN, FCS, PROTO, LLC_LEN, BPDU_LEN,
  ipTotalLen, frameLen, frameWireLen, isGroupMac, isLocalMac, BCAST, STP_MAC, tcpHdrLen, dnsLen, udpPayloadLen } from './net.js';

let FRAME_SEQ = 1, TRACE_SEQ = 1, IP_ID = 1000;
export const nextTrace = () => TRACE_SEQ++;
export const nextIpId = () => (IP_ID = (IP_ID + 1) & 0xffff);

export function ethFrame(src, dst, type, payload, vlan = null) {
  return { id: FRAME_SEQ++, src, dst, vlan, type, payload };
}
export function arpPacket(op, sha, spa, tha, tpa) {
  return { op, sha, spa, tha: tha || '00:00:00:00:00:00', tpa };
}
export function ipPacket({ src, dst, ttl = 64, proto, df = false, l4, trace, id }) {
  const p = { src, dst, ttl, proto, df, mf: false, fragOffset: 0, tos: 0,
    id: id ?? nextIpId(), l4, trace: trace ?? nextTrace(), checksum: 0, totalLength: 0 };
  p.totalLength = ipTotalLen(p);
  p.checksum = ipChecksum(p);
  return p;
}
export function icmp(type, code, extra = {}) { return { kind: 'icmp', type, code, ...extra }; }
export function udp(sport, dport, payload) { return { kind: 'udp', sport, dport, payload }; }
export function tcp(sport, dport, seq, ack, flags, extra = {}) { return { kind: 'tcp', sport, dport, seq: seq >>> 0, ack: ack >>> 0, flags, win: 64240, dataLen: 0, ...extra }; }
export const tcpFlags = f => ['SYN', 'FIN', 'RST', 'PSH', 'ACK'].filter(k => f[k]).join(', ') || 'none';
export const fmtBid = b => b ? `${b.prio}.${b.mac}` : '';

// Simplified but deterministic header checksum (changes with TTL)
export function ipChecksum(p) {
  const words = [0x4500, p.totalLength & 0xffff, p.id & 0xffff,
    (p.df ? 0x4000 : 0) | (p.mf ? 0x2000 : 0) | ((p.fragOffset >> 3) & 0x1fff),
    ((p.ttl & 255) << 8) | (p.proto & 255)];
  for (const ip of [p.src, p.dst]) {
    const o = ip.split('.').map(Number);
    words.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
  }
  let s = words.reduce((a, b) => a + b, 0);
  while (s >> 16) s = (s & 0xffff) + (s >> 16);
  return (~s) & 0xffff;
}
export const hex4 = n => '0x' + (n & 0xffff).toString(16).padStart(4, '0');

export const ICMP_NAMES = {
  '0/0': 'Echo Reply', '8/0': 'Echo Request', '11/0': 'Time Exceeded (TTL expired)',
  '3/0': 'Destination Unreachable: Network Unreachable', '3/1': 'Destination Unreachable: Host Unreachable',
  '3/3': 'Destination Unreachable: Port Unreachable', '3/4': 'Destination Unreachable: Fragmentation Needed',
  '3/13': 'Destination Unreachable: Communication Administratively Prohibited'
};
export function icmpName(t, c) { return ICMP_NAMES[`${t}/${c}`] || `Type ${t} code ${c}`; }

/** Short label for the animation */
export function shortLabel(f) {
  if (f.type === 'stp') return 'BPDU';
  if (f.type === 'arp') {
    const a = f.payload;
    if (a.spa === a.tpa) return 'GARP';
    return a.op === 1 ? 'ARP ?' : 'ARP !';
  }
  const ip = f.payload;
  if (ip.frag && !ip.frag.first) return 'Frag';
  const l4 = ip.l4;
  if (!l4) return 'IP';
  if (l4.kind === 'icmp') {
    if (l4.type === 8) return 'Ping';
    if (l4.type === 0) return 'Pong';
    if (l4.type === 11) return 'TTL!';
    if (l4.type === 3 && l4.code === 4) return 'MTU!';
    if (l4.type === 3) return 'Unreach';
    return 'ICMP';
  }
  if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') return 'VXLAN';
  if (l4.kind === 'udp' && l4.payload?.kind === 'dns') return 'DNS';
  if (l4.kind === 'udp') return 'UDP';
  if (l4.kind === 'tcp') {
    const fl = l4.flags;
    if (fl.RST) return 'RST';
    if (fl.SYN && fl.ACK) return 'SYN/ACK';
    if (fl.SYN) return 'SYN';
    if (fl.FIN) return 'FIN';
    return l4.dataLen ? 'TCP' : 'ACK';
  }
  return 'IP';
}
/** Layers from outside to inside, for the stripes on the packet */
export function layerKinds(f) {
  const out = [];
  let cur = f;
  while (cur) {
    out.push('eth');
    if (cur.vlan) out.push('vlan');
    if (cur.type === 'stp') { out.push('stp'); break; }
    if (cur.type === 'arp') { out.push('arp'); break; }
    out.push('ip');
    const l4 = cur.payload.l4;
    if (!l4 || (cur.payload.frag && !cur.payload.frag.first)) { out.push('frag'); break; }
    if (l4.kind === 'icmp') { out.push('icmp'); break; }
    if (l4.kind === 'udp') {
      out.push('udp');
      if (l4.payload?.kind === 'vxlan') { out.push('vxlan'); cur = l4.payload.frame; continue; }
      out.push('data');
    }
    if (l4.kind === 'tcp') { out.push('tcp'); if (l4.dataLen) out.push('data'); }
    break;
  }
  return out;
}

/** One-line description in the style of tcpdump */
export function summary(f) {
  const tag = f.vlan ? `vlan ${f.vlan.vid}, ` : '';
  if (f.type === 'stp') {
    const b = f.payload;
    return `STP BPDU: Root ${fmtBid(b.root)}, cost ${b.cost}, from bridge ${fmtBid(b.bridge)} port ${b.port}${b.tc ? ', topology change' : ''}`;
  }
  if (f.type === 'arp') {
    const a = f.payload;
    if (a.spa === a.tpa) return `${tag}Gratuitous ARP ${a.op === 1 ? 'Request' : 'Reply'}: ${a.spa} is at ${a.sha}`;
    if (a.spa === '0.0.0.0') return `${tag}ARP probe: is anyone using ${a.tpa}?`;
    return a.op === 1 ? `${tag}ARP Request: who has ${a.tpa}? Tell ${a.spa}`
      : `${tag}ARP Reply: ${a.spa} is at ${a.sha}`;
  }
  const ip = f.payload;
  const base = `${ip.src} > ${ip.dst}`;
  if (ip.frag && !ip.frag.first) return `${tag}IP fragment ${base}, id ${ip.id}, offset ${ip.fragOffset}, ${ip.frag.len} bytes${ip.mf ? ', more follow' : ', last'}`;
  const l4 = ip.l4;
  let s;
  if (l4.kind === 'icmp') {
    if (l4.type === 8 || l4.type === 0) s = `ICMP ${l4.type === 8 ? 'Echo Request' : 'Echo Reply'} ${base}, seq ${l4.seq}, TTL ${ip.ttl}, ${ip.totalLength} bytes`;
    else s = `ICMP ${icmpName(l4.type, l4.code)}${l4.mtu ? ` (MTU ${l4.mtu})` : ''} ${base}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') {
    s = `VXLAN ${base}, VNI ${l4.payload.vni}, UDP ${l4.sport} > ${l4.dport}  ⟶  ${summary(l4.payload.frame)}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    s = d.qr ? `DNS response ${base}: ${d.qname} ${d.rcode === 'NOERROR' ? '→ ' + d.answers.map(a => a.ip).join(', ') : d.rcode}`
      : `DNS query ${base}: A ${d.qname}?`;
  } else if (l4.kind === 'udp') {
    s = `UDP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport}, TTL ${ip.ttl}`;
  } else if (l4.kind === 'tcp') {
    s = `TCP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport} [${tcpFlags(l4.flags)}] seq ${l4.seq}${l4.flags.ACK ? ' ack ' + l4.ack : ''}${l4.dataLen ? ', ' + l4.dataLen + ' bytes of data' : ''}${l4.app ? ' (' + l4.app + ')' : ''}`;
  } else s = `IP ${base}`;
  if (ip.frag?.first) s += ` (first fragment, more follow)`;
  return tag + s;
}

function macNote(m) {
  if (m === BCAST) return 'Broadcast, to everyone in the segment';
  if (isGroupMac(m)) return 'Multicast (I/G bit = 1)';
  return isLocalMac(m) ? 'Unicast, locally administered (U/L bit = 1)' : 'Unicast, assigned by the manufacturer';
}

/** Splits a frame into layers for the packet inspector */
export function dissect(f, depth = 0) {
  const layers = [];
  const pre = depth ? 'Inner ' : '';
  if (f.type === 'stp') {
    const b = f.payload;
    layers.push({ kind: 'eth', depth, name: 'IEEE 802.3 (with length field)', bytes: ETH_HDR, fields: [
      ['Destination MAC', f.dst, 'Group address for bridges, never forwarded'], ['Source MAC', f.src, 'MAC of the sending switch port'],
      ['Length', `${LLC_LEN + BPDU_LEN} bytes`, 'No EtherType: values up to 1500 are a length']] });
    layers.push({ kind: 'stp', depth, name: 'LLC', bytes: LLC_LEN, fields: [['DSAP / SSAP', '0x42 / 0x42', 'Spanning Tree'], ['Control', '0x03', 'Unnumbered Information']] });
    layers.push({ kind: 'stp', depth, name: 'STP Configuration BPDU', bytes: BPDU_LEN, fields: [
      ['Protocol / Version', '0 / 0 (802.1D)', ''], ['Flags', b.tc ? 'Topology Change' : 'none', b.tc ? 'Receivers shorten the aging of their MAC table' : ''],
      ['Root Bridge ID', fmtBid(b.root), 'Priority.MAC of the bridge the sender believes is the root'],
      ['Root Path Cost', String(b.cost), 'Sender\'s cost to the root'],
      ['Bridge ID', fmtBid(b.bridge), 'Who is sending'], ['Port ID', b.port, 'Priority.number of the sending port'],
      ['Message Age', `${b.age} s`, ''], ['Max Age / Hello / Forward Delay', `${b.maxAge} / ${b.hello} / ${b.fwd} s`, 'Timers set by the root']] });
    return layers;
  }
  layers.push({ kind: 'eth', depth, name: `${pre}Ethernet II`, bytes: ETH_HDR, fields: [
    ['Destination MAC', f.dst, macNote(f.dst)],
    ['Source MAC', f.src, macNote(f.src)],
    ['EtherType', f.vlan ? '0x8100 (802.1Q tag follows)' : (f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)'), 'Says how to read the payload']
  ]});
  if (f.vlan) layers.push({ kind: 'vlan', depth, name: `${pre}802.1Q tag`, bytes: VLAN_TAG, fields: [
    ['TPID', '0x8100', 'Identifies the tag'],
    ['PCP (priority)', String(f.vlan.pcp || 0), '0 to 7'],
    ['DEI', '0', 'May be dropped under congestion'],
    ['VID (VLAN)', String(f.vlan.vid), 'Usable 1 to 4094'],
    ['EtherType', f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)', '']
  ]});
  if (f.type === 'arp') {
    const a = f.payload;
    layers.push({ kind: 'arp', depth, name: `${pre}ARP ${a.op === 1 ? 'Request' : 'Reply'}`, bytes: ARP_LEN, fields: [
      ['Hardware Type', '1 (Ethernet)', ''], ['Protocol Type', '0x0800 (IPv4)', ''],
      ['Hardware / Protocol Length', '6 / 4', ''],
      ['Operation', a.op === 1 ? '1 (Request)' : '2 (Reply)', ''],
      ['Sender MAC', a.sha, ''], ['Sender IP', a.spa, ''],
      ['Target MAC', a.tha, a.op === 1 ? 'Still unknown, hence zeros' : ''], ['Target IP', a.tpa, a.spa === a.tpa ? 'Same as sender IP: gratuitous ARP' : a.spa === '0.0.0.0' ? 'Probe: sender IP 0.0.0.0' : '']
    ]});
    return layers;
  }
  const ip = f.payload;
  const flags = [ip.df ? 'DF' : null, ip.mf ? 'MF' : null].filter(Boolean).join(', ') || 'none';
  layers.push({ kind: 'ip', depth, name: `${pre}IPv4`, bytes: IP_HDR, fields: [
    ['Version / IHL', '4 / 5 (20 bytes)', ''],
    ['Total Length', `${ip.totalLength} bytes`, 'Header and payload'],
    ['Identification', String(ip.id), 'Same in all fragments of a packet'],
    ['Flags', flags, ip.df ? 'Don\'t Fragment: routers must not fragment' : 'Routers may fragment'],
    ['Fragment Offset', `${ip.fragOffset} bytes`, ''],
    ['TTL', String(ip.ttl), 'Every router subtracts 1'],
    ['Protocol', `${ip.proto} (${ip.proto === 1 ? 'ICMP' : ip.proto === 17 ? 'UDP' : ip.proto === 6 ? 'TCP' : '?'})`, ''],
    ['Header Checksum', hex4(ip.checksum), 'Recomputed at every hop'],
    ['Source IP', ip.src, 'Stays the same end to end'],
    ['Destination IP', ip.dst, '']
  ]});
  if (ip.frag && !ip.frag.first) {
    layers.push({ kind: 'frag', depth, name: 'Fragment data', bytes: ip.frag.len, fields: [
      ['Content', `${ip.frag.len} bytes`, 'Continuation of the first fragment, without its own ICMP or UDP header']] });
    return layers;
  }
  const l4 = ip.l4;
  if (l4.kind === 'icmp') {
    const fields = [['Type / Code', `${l4.type} / ${l4.code}`, icmpName(l4.type, l4.code)]];
    if (l4.type === 8 || l4.type === 0) fields.push(['Identifier / Sequence', `${l4.ident} / ${l4.seq}`, ''], ['Data', `${l4.dataLen} bytes`, '']);
    if (l4.mtu) fields.push(['Next-Hop MTU', String(l4.mtu), 'The maximum size the packet may have']);
    if (l4.orig) fields.push(['Concerns packet', `${l4.orig.src} > ${l4.orig.dst}`, 'Copy of the original header']);
    layers.push({ kind: 'icmp', depth, name: `${pre}ICMP ${icmpName(l4.type, l4.code)}`, bytes: ICMP_HDR + (l4.dataLen || 0), fields });
  } else if (l4.kind === 'tcp') {
    layers.push({ kind: 'tcp', depth, name: `${pre}TCP`, bytes: tcpHdrLen(l4), fields: [
      ['Source port', String(l4.sport), l4.sport >= 49152 ? 'Ephemeral port of the client' : ''],
      ['Destination port', String(l4.dport), l4.dport === 80 ? 'HTTP' : l4.dport === 22 ? 'SSH' : l4.dport === 443 ? 'HTTPS' : ''],
      ['Sequence number', String(l4.seq), 'Number of the first byte in this segment'],
      ['Acknowledgment number', l4.flags.ACK ? String(l4.ack) : '0', l4.flags.ACK ? 'Next byte expected' : 'only valid with ACK'],
      ['Header length', `${tcpHdrLen(l4)} bytes`, l4.mss ? 'with MSS option' : ''],
      ['Flags', tcpFlags(l4.flags), ''], ['Window', String(l4.win), 'How many bytes the peer may send unacknowledged'],
      ...(l4.mss ? [['MSS option', String(l4.mss), 'Largest segment this host accepts']] : [])] });
    if (l4.dataLen) layers.push({ kind: 'data', depth, name: 'Application data', bytes: l4.dataLen, fields: [['Content', `${l4.dataLen} bytes${l4.app ? ': ' + l4.app : ''}`, '']] });
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Source port', String(l4.sport), ''], ['Destination port', String(l4.dport), l4.dport === 53 || l4.sport === 53 ? 'DNS' : ''], ['Length', `${UDP_HDR + udpPayloadLen(l4)} bytes`, '']] });
    layers.push({ kind: 'data', depth, name: `DNS ${d.qr ? 'response' : 'query'}`, bytes: dnsLen(d), fields: [
      ['ID', String(d.id), 'Matches response and query to each other'], ['QR', d.qr ? '1 (response)' : '0 (query)', ''],
      ['Question', `${d.qname} A`, ''], ...(d.qr ? [['Response code', d.rcode, ''], ...d.answers.map(a => ['Answer', `${a.name} A ${a.ip}`, 'TTL 300'])] : [])] });
  } else if (l4.kind === 'udp') {
    const vx = l4.payload?.kind === 'vxlan';
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [
      ['Source port', String(l4.sport), vx ? 'Hash over the inner frame (distribution with ECMP)' : ''],
      ['Destination port', String(l4.dport), vx ? (l4.dport === 4789 ? 'VXLAN (IANA)' : 'Not the standard port 4789!') : (l4.dport >= 33434 && l4.dport < 33534 ? 'traceroute probe' : '')],
      ['Length', `${UDP_HDR + (vx ? VXLAN_HDR + frameLen(l4.payload.frame) : (l4.payload?.len || 0))} bytes`, '']
    ]});
    if (vx) {
      layers.push({ kind: 'vxlan', depth, name: 'VXLAN', bytes: VXLAN_HDR, fields: [
        ['Flags', '0x08 (I: VNI valid)', ''], ['VNI', String(l4.payload.vni), 'Number of the overlay segment, 24 bits']] });
      layers.push(...dissect(l4.payload.frame, depth + 1));
    } else if (l4.payload?.len) {
      layers.push({ kind: 'data', depth, name: 'Data', bytes: l4.payload.len, fields: [['Content', `${l4.payload.len} bytes`, '']] });
    }
  }
  return layers;
}

export function frameStats(f) {
  return { len: frameLen(f), wire: frameWireLen(f), fcs: FCS };
}
