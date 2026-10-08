// Building, describing and dissecting frames
import { ETH_HDR, VLAN_TAG, IP_HDR, UDP_HDR, ICMP_HDR, VXLAN_HDR, ARP_LEN, FCS, PROTO, LLC_LEN, bpduLen,
  ipTotalLen, frameLen, frameWireLen, isGroupMac, isLocalMac, BCAST, STP_MAC, tcpHdrLen, dnsLen, udpPayloadLen, PROTO_NAME, ospfLen, DHCP_LEN, IP6_HDR, icmp6Len, isMcast6, isLinkLocal6 } from './net.js';
const ROLE_NAME = { root: 'Root port', designated: 'Designated', alternate: 'Alternate', backup: 'Backup' };

const DHCP_NAME = { DISCOVER: 'Discover', OFFER: 'Offer', REQUEST: 'Request', ACK: 'ACK', NAK: 'NAK', RELEASE: 'Release' };

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
  // IPv6: same field names (ttl is the hop limit, proto the next header), 40 byte header without checksum
  if (String(dst).includes(':') || String(src).includes(':')) {
    const p6 = { v: 6, src, dst, ttl, proto: proto === PROTO.ICMP ? PROTO.ICMP6 : proto, df: true, mf: false, fragOffset: 0, tc: 0, flow: 0,
      id: id ?? nextIpId(), l4, trace: trace ?? nextTrace(), checksum: 0, totalLength: 0 };
    p6.totalLength = ipTotalLen(p6);
    return p6;
  }
  const p = { src, dst, ttl, proto, df, mf: false, fragOffset: 0, tos: 0,
    id: id ?? nextIpId(), l4, trace: trace ?? nextTrace(), checksum: 0, totalLength: 0 };
  p.totalLength = ipTotalLen(p);
  p.checksum = ipChecksum(p);
  return p;
}
export function icmp(type, code, extra = {}) { return { kind: 'icmp', type, code, ...extra }; }
export function icmp6(type, code, extra = {}) { return { kind: 'icmp6', type, code, ...extra }; }
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
const ICMP6_NAMES = { '1/0': 'Destination Unreachable: No Route', '1/1': 'Destination Unreachable: Administratively Prohibited', '1/3': 'Destination Unreachable: Address Unreachable',
  '1/4': 'Destination Unreachable: Port Unreachable', '2/0': 'Packet Too Big', '3/0': 'Time Exceeded (hop limit)', '128/0': 'Echo Request', '129/0': 'Echo Reply',
  '133/0': 'Router Solicitation', '134/0': 'Router Advertisement', '135/0': 'Neighbor Solicitation', '136/0': 'Neighbor Advertisement' };
export function icmp6Text(t, c) { return ICMP6_NAMES[`${t}/${c}`] || `Type ${t} code ${c}`; }

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
  if (l4.kind === 'icmp6') return { 128: 'Ping6', 129: 'Pong6', 133: 'RS', 134: 'RA', 135: 'NS', 136: 'NA', 1: 'Unreach', 2: 'MTU!', 3: 'HL!' }[l4.type] || 'ICMPv6';
  if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') return 'VXLAN';
  if (l4.kind === 'udp' && l4.payload?.kind === 'wg') return { init: 'WG hello', resp: 'WG hello', data: l4.payload.inner ? 'WG' : 'WG keep' }[l4.payload.type] || 'WG';
  if (l4.kind === 'udp' && l4.payload?.kind === 'dns') return 'DNS';
  if (l4.kind === 'udp' && l4.payload?.kind === 'dhcp') return 'DHCP ' + (DHCP_NAME[l4.payload.op] || '');
  if (l4.kind === 'udp' && l4.payload?.kind === 'bfd') return 'BFD';
  if (l4.kind === 'vrrp') return 'VRRP';
  if (l4.kind === 'ospf') return l4.type === 'hello' ? 'Hello' : 'LSU';
  if (l4.kind === 'udp') return 'UDP';
  if (l4.kind === 'tcp' && l4.bgp) return { OPEN: 'OPEN', KEEPALIVE: 'KEEP', UPDATE: 'UPDATE', NOTIFICATION: 'NOTIFY' }[l4.bgp.type] || 'BGP';
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
    if (l4.kind === 'icmp' || l4.kind === 'icmp6') { out.push('icmp'); break; }
    if (l4.kind === 'vrrp' || l4.kind === 'ospf') { out.push('rt'); break; }
    if (l4.kind === 'udp') {
      out.push('udp');
      if (l4.payload?.kind === 'vxlan') { out.push('vxlan'); cur = l4.payload.frame; continue; }
      if (l4.payload?.kind === 'wg') { out.push('vpn'); if (l4.payload.inner) out.push('ip', l4.payload.inner.l4?.kind === 'tcp' ? 'tcp' : l4.payload.inner.l4?.kind === 'udp' ? 'udp' : 'icmp'); break; }
      out.push(l4.payload?.kind === 'bfd' ? 'rt' : 'data');
    }
    if (l4.kind === 'tcp') { out.push('tcp'); if (l4.bgp) out.push('rt'); else if (l4.dataLen) out.push('data'); }
    break;
  }
  return out;
}

/** One-line description in the style of tcpdump */
export function summary(f) {
  const tag = f.vlan ? `vlan ${f.vlan.vid}, ` : '';
  if (f.type === 'stp') {
    const b = f.payload;
    if (b.version === 2) {
      const flags = [b.proposal && 'proposal', b.agreement && 'agreement', b.tc && 'topology change'].filter(Boolean);
      return `RST BPDU (${ROLE_NAME[b.role] || b.role}): Root ${fmtBid(b.root)}, cost ${b.cost}, from bridge ${fmtBid(b.bridge)} port ${b.port}${flags.length ? ', ' + flags.join(', ') : ''}`;
    }
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
  if (ip.frag && !ip.frag.first) return `${tag}IP${ip.v === 6 ? 'v6' : ''} fragment ${base}, id ${ip.id}, offset ${ip.fragOffset}, ${ip.frag.len} bytes${ip.mf ? ', more follow' : ', last'}`;
  const l4 = ip.l4;
  let s;
  if (l4.kind === 'icmp6') {
    const m = l4;
    s = m.type === 128 || m.type === 129 ? `ICMPv6 ${m.type === 128 ? 'Echo Request' : 'Echo Reply'} ${base}, seq ${m.seq}, hop limit ${ip.ttl}, ${ip.totalLength} bytes`
      : m.type === 135 ? (ip.src === '::' ? `ICMPv6 Neighbor Solicitation (DAD): is anyone using ${m.target}?` : `ICMPv6 Neighbor Solicitation: who has ${m.target}? Tell ${ip.src}`)
      : m.type === 136 ? `ICMPv6 Neighbor Advertisement: ${m.target} is at ${m.tlla}${m.r ? ' (router)' : ''}`
      : m.type === 133 ? `ICMPv6 Router Solicitation from ${ip.src}`
      : m.type === 134 ? `ICMPv6 Router Advertisement from ${ip.src}: ${(m.prefixes || []).map(p => `${p.prefix}/${p.len}`).join(', ') || 'no prefix'}${m.rdnss?.length ? ', DNS ' + m.rdnss.join(', ') : ''}`
      : `ICMPv6 ${icmp6Text(m.type, m.code)}${m.mtu ? ` (MTU ${m.mtu})` : ''} ${base}`;
  } else if (l4.kind === 'icmp') {
    if (l4.type === 8 || l4.type === 0) s = `ICMP ${l4.type === 8 ? 'Echo Request' : 'Echo Reply'} ${base}, seq ${l4.seq}, TTL ${ip.ttl}, ${ip.totalLength} bytes`;
    else s = `ICMP ${icmpName(l4.type, l4.code)}${l4.mtu ? ` (MTU ${l4.mtu})` : ''} ${base}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'wg') {
    const w = l4.payload, ends = `${ip.src}:${l4.sport} > ${ip.dst}:${l4.dport}`;
    s = w.type === 'init' ? `WireGuard handshake initiation ${ends}` : w.type === 'resp' ? `WireGuard handshake response ${ends}`
      : w.inner ? `WireGuard data ${ends}, counter ${w.counter}  ⟶  encrypted inside: ${w.inner.src} > ${w.inner.dst}` : `WireGuard keepalive ${ends}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') {
    s = `VXLAN ${base}, VNI ${l4.payload.vni}, UDP ${l4.sport} > ${l4.dport}  ⟶  ${summary(l4.payload.frame)}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dhcp') {
    const d = l4.payload;
    const what = { DISCOVER: `Discover from ${d.chaddr}`, OFFER: `Offer ${d.yiaddr} to ${d.chaddr}`, REQUEST: `Request ${d.requested || d.ciaddr} for ${d.chaddr}`,
      ACK: `ACK ${d.yiaddr} for ${d.chaddr}`, NAK: `NAK for ${d.chaddr}`, RELEASE: `Release ${d.ciaddr} from ${d.chaddr}` }[d.op] || d.op;
    s = `DHCP ${what} (${base}${d.giaddr && d.giaddr !== '0.0.0.0' ? ', relayed via ' + d.giaddr : ''})`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'bfd') {
    const b = l4.payload;
    s = `BFD control ${base}: state ${b.state}, discriminators ${b.myDisc}/${b.yourDisc || 0}, every ${b.interval} ms × ${b.mult}${b.diag ? `, ${b.diag}` : ''}`;
  } else if (l4.kind === 'vrrp') {
    s = `VRRP advertisement ${base}: group ${l4.vrid}, priority ${l4.prio}, virtual IP ${(l4.vips || []).join(', ')}`;
  } else if (l4.kind === 'ospf') {
    s = l4.type === 'hello' ? `OSPF Hello from router ${l4.rid} (${base}), sees ${l4.nbrs.length ? l4.nbrs.join(', ') : 'no neighbor yet'}`
      : `OSPF LS Update from router ${l4.rid} (${base}): ${l4.lsas.length} LSA${l4.lsas.length === 1 ? '' : 's'} (${l4.lsas.map(l => l.rid).join(', ')})`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    const qn = d.qname || '.', qt = d.qtype || 'A';
    const ns = (d.authority || []).filter(r => r.type === 'NS');
    s = !d.qr ? `DNS query ${base}: ${qt} ${qn}?${d.rd === 0 ? ' (iterative)' : ''}`
      : d.rcode !== 'NOERROR' ? `DNS response ${base}: ${qn} ${d.rcode}`
      : d.answers?.length ? `DNS response ${base}: ${qn} → ${d.answers.map(a => a.type === 'CNAME' ? 'alias ' + a.data : a.data).join(', ')}${d.aa ? ' (authoritative)' : ''}`
      : ns.length ? `DNS referral ${base}: ask ${ns[0].name || '.'} at ${ns.map(n => n.data).join(', ')}` : `DNS response ${base}: ${qn} has no ${qt} record`;
  } else if (l4.kind === 'udp') {
    s = `UDP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport}, TTL ${ip.ttl}`;
  } else if (l4.kind === 'tcp' && l4.bgp) {
    const m = l4.bgp, ends = `${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport}`;
    s = m.type === 'OPEN' ? `BGP OPEN ${ends}: AS ${m.asn}, hold time ${m.hold} s, router ID ${m.rid}`
      : m.type === 'KEEPALIVE' ? `BGP KEEPALIVE ${ends}`
      : m.type === 'NOTIFICATION' ? `BGP NOTIFICATION ${ends}: ${bgpNotif(m.code, m.sub)}`
      : `BGP UPDATE ${ends}: ${[...(m.nlri?.length ? [`${m.nlri.join(', ')} with AS path ${(m.attrs.asPath || []).join(' ') || '(empty)'}, next hop ${m.attrs.nextHop}`] : []), ...(m.withdrawn?.length ? [`withdraws ${m.withdrawn.join(', ')}`] : []),
        ...(m.evpn?.length ? [`${m.evpn.length} EVPN route${m.evpn.length === 1 ? '' : 's'} (${m.evpn.map(e => 'type ' + e.rt).join(', ')})`] : []), ...(m.evpnWithdrawn?.length ? [`withdraws ${m.evpnWithdrawn.length} EVPN route${m.evpnWithdrawn.length === 1 ? '' : 's'}`] : [])].join('; ') || 'empty'}`;
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
    const len = bpduLen(b), rst = b.version === 2;
    layers.push({ kind: 'eth', depth, name: 'IEEE 802.3 (with length field)', bytes: ETH_HDR, fields: [
      ['Destination MAC', f.dst, 'Group address for bridges, never forwarded'], ['Source MAC', f.src, 'MAC of the sending switch port'],
      ['Length', `${LLC_LEN + len} bytes`, 'No EtherType: values up to 1500 are a length']] });
    layers.push({ kind: 'stp', depth, name: 'LLC', bytes: LLC_LEN, fields: [['DSAP / SSAP', '0x42 / 0x42', 'Spanning Tree'], ['Control', '0x03', 'Unnumbered Information']] });
    const common = [['Root Bridge ID', fmtBid(b.root), 'Priority.MAC of the bridge the sender believes is the root'],
      ['Root Path Cost', String(b.cost), 'Sender\'s cost to the root'],
      ['Bridge ID', fmtBid(b.bridge), 'Who is sending'], ['Port ID', b.port, 'Priority.number of the sending port'],
      ['Message Age', `${b.age} s`, ''], ['Max Age / Hello / Forward Delay', `${b.maxAge} / ${b.hello} / ${b.fwd} s`, 'Timers set by the root']];
    if (rst) {
      const bit = (on, name, why) => [name, on ? '1' : '0', on ? why : ''];
      layers.push({ kind: 'stp', depth, name: 'RST BPDU (802.1w)', bytes: len, fields: [
        ['Protocol / Version / Type', '0 / 2 / 0x02', 'Version 2 and type 2: Rapid Spanning Tree. A classic 802.1D switch discards it'],
        bit(b.tc, 'Flag: Topology Change', 'Receivers flush their MAC tables and pass the change on'),
        bit(b.proposal, 'Flag: Proposal', 'The designated port asks: may I forward right away?'),
        ['Flag: Port Role', `${ROLE_NAME[b.role] || b.role} (${{ alternate: '01', backup: '01', root: '10', designated: '11' }[b.role] || '00'})`, 'Role of the sending port: 2 bits'],
        bit(b.learning, 'Flag: Learning', 'The sending port learns MAC addresses'),
        bit(b.forwarding, 'Flag: Forwarding', 'The sending port forwards'),
        bit(b.agreement, 'Flag: Agreement', 'Answer to a proposal: all my other ports are synced, go ahead'),
        ...common, ['Version 1 Length', '0', 'The one extra byte of the RST BPDU']] });
    } else {
      layers.push({ kind: 'stp', depth, name: 'STP Configuration BPDU', bytes: len, fields: [
        ['Protocol / Version', '0 / 0 (802.1D)', ''], ['Flags', b.tc ? 'Topology Change' : 'none', b.tc ? 'Receivers shorten the aging of their MAC table' : ''], ...common] });
    }
    return layers;
  }
  layers.push({ kind: 'eth', depth, name: `${pre}Ethernet II`, bytes: ETH_HDR, fields: [
    ['Destination MAC', f.dst, macNote(f.dst)],
    ['Source MAC', f.src, macNote(f.src)],
    ['EtherType', f.vlan ? '0x8100 (802.1Q tag follows)' : (f.type === 'arp' ? '0x0806 (ARP)' : f.type === 'ipv6' ? '0x86DD (IPv6)' : '0x0800 (IPv4)'), 'Says how to read the payload']
  ]});
  if (f.vlan) layers.push({ kind: 'vlan', depth, name: `${pre}802.1Q tag`, bytes: VLAN_TAG, fields: [
    ['TPID', '0x8100', 'Identifies the tag'],
    ['PCP (priority)', String(f.vlan.pcp || 0), '0 to 7'],
    ['DEI', '0', '0: normal. 1 would mark the frame as the first to drop under congestion'],
    ['VID (VLAN)', String(f.vlan.vid), 'Usable 1 to 4094'],
    ['EtherType', f.type === 'arp' ? '0x0806 (ARP)' : f.type === 'ipv6' ? '0x86DD (IPv6)' : '0x0800 (IPv4)', '']
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
  if (ip.v === 6) return dissect6(f, ip, layers, depth, pre);
  const flags = [ip.df ? 'DF' : null, ip.mf ? 'MF' : null].filter(Boolean).join(', ') || 'none';
  layers.push({ kind: 'ip', depth, name: `${pre}IPv4`, bytes: IP_HDR, fields: [
    ['Version / IHL', '4 / 5 (20 bytes)', ''],
    ['Total Length', `${ip.totalLength} bytes`, 'Header and payload'],
    ['Identification', String(ip.id), 'Same in all fragments of a packet'],
    ['Flags', flags, ip.df ? 'Don\'t Fragment: routers must not fragment' : 'Routers may fragment'],
    ['Fragment Offset', `${ip.fragOffset} bytes`, ''],
    ['TTL', String(ip.ttl), 'Every router subtracts 1'],
    ['Protocol', `${ip.proto} (${PROTO_NAME[ip.proto] || '?'})`, ''],
    ['Header Checksum', hex4(ip.checksum), 'Recomputed at every hop'],
    ['Source IP', ip.src, 'Stays the same end to end, unless a NAT router rewrites it'],
    ['Destination IP', ip.dst, '']
  ]});
  return l4Layers(f, ip, layers, depth, pre);
}
function dissect6(f, ip, layers, depth, pre) {
  const g = a => isMcast6(a) ? (a === 'ff02::1' ? 'All nodes on the link' : a === 'ff02::2' ? 'All routers on the link' : a.startsWith('ff02::1:ff') ? 'Solicited-node group of one address' : 'Multicast group')
    : isLinkLocal6(a) ? 'Link-local: only valid on this link' : a === '::' ? 'Unspecified: the sender has no address yet' : 'Global address';
  layers.push({ kind: 'ip', depth, name: `${pre}IPv6`, bytes: IP6_HDR, fields: [
    ['Version', '6', ''], ['Traffic Class / Flow Label', `${ip.tc || 0} / ${ip.flow || 0}`, 'Priority and flow marking'],
    ['Payload Length', `${ip.totalLength - IP6_HDR} bytes`, 'Only the payload, the header always has 40 bytes'],
    ['Next Header', `${ip.frag ? '44 (Fragment)' : `${ip.proto} (${PROTO_NAME[ip.proto] || '?'})`}`, ip.frag ? 'A fragment header follows: only the sender may fragment in IPv6' : 'Like the protocol field in IPv4'],
    ['Hop Limit', String(ip.ttl), 'The TTL of IPv6: every router subtracts 1'],
    ['Source Address', ip.src, g(ip.src)], ['Destination Address', ip.dst, g(ip.dst)]] });
  if (ip.frag) layers.push({ kind: 'ip', depth, name: 'Fragment header', bytes: 8, fields: [['Next Header', `${ip.proto} (${PROTO_NAME[ip.proto] || '?'})`, ''],
    ['Fragment Offset', `${ip.fragOffset} bytes`, ''], ['M flag', ip.mf ? '1 (more follow)' : '0 (last)', ''], ['Identification', String(ip.id), 'Same in all fragments']] });
  const m = ip.l4;
  if (m?.kind !== 'icmp6' || (ip.frag && !ip.frag.first)) return l4Layers(f, ip, layers, depth, pre);
  const fields = [['Type', `${m.type} (${icmp6Text(m.type, m.code)})`, m.type >= 133 && m.type <= 136 ? 'Neighbor Discovery: replaces ARP and finds routers' : ''], ['Code', String(m.code), '']];
  if (m.type === 128 || m.type === 129) fields.push(['Identifier / Sequence', `${m.ident} / ${m.seq}`, ''], ['Data', `${m.dataLen} bytes`, '']);
  if (m.type === 135 || m.type === 136) fields.push(['Target Address', m.target, m.type === 135 ? 'Whose MAC address is wanted' : 'The address this answer is about']);
  if (m.type === 136) fields.push(['Flags', [m.r && 'R (router)', m.s && 'S (solicited)', m.o && 'O (override)'].filter(Boolean).join(', ') || 'none', '']);
  if (m.slla) fields.push(['Option: source link-layer address', m.slla, 'The MAC of the sender']);
  if (m.tlla) fields.push(['Option: target link-layer address', m.tlla, 'The answer: the wanted MAC']);
  if (m.type === 134) {
    fields.push(['Cur Hop Limit', String(m.hopLimit), 'Hop limit the hosts should use'], ['Flags M / O', `${m.managed ? 1 : 0} / ${m.other ? 1 : 0}`, 'M: addresses from DHCPv6. O: other settings from DHCPv6'],
      ['Router Lifetime', `${m.lifetime} s`, 'How long this router may be the default router']);
    for (const x of m.prefixes || []) fields.push(['Option: prefix information', `${x.prefix}/${x.len}`, `A flag ${x.auto ? '1: hosts form their own address (SLAAC)' : '0'}, valid ${x.valid} s`]);
    if (m.mtu) fields.push(['Option: MTU', String(m.mtu), '']);
    for (const d of m.rdnss || []) fields.push(['Option: recursive DNS server', d, 'RDNSS: the DNS server, without DHCP']);
  }
  if (m.type === 2) fields.push(['MTU', String(m.mtu), 'The sender has to send smaller packets: routers never fragment in IPv6']);
  if (m.orig) fields.push(['Original packet', `${m.orig.src} > ${m.orig.dst}`, 'Part of the packet that caused the error']);
  layers.push({ kind: 'icmp', depth, name: 'ICMPv6', bytes: icmp6Len(m), fields });
  return layers;
}
function l4Layers(f, ip, layers, depth, pre) {
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
      ['Destination port', String(l4.dport), l4.dport === 80 ? 'HTTP' : l4.dport === 22 ? 'SSH' : l4.dport === 443 ? 'HTTPS' : l4.dport === 179 || l4.sport === 179 ? 'BGP' : ''],
      ['Sequence number', String(l4.seq), 'Number of the first byte in this segment'],
      ['Acknowledgment number', l4.flags.ACK ? String(l4.ack) : '0', l4.flags.ACK ? 'Next byte expected' : 'only valid with ACK'],
      ['Header length', `${tcpHdrLen(l4)} bytes`, l4.mss ? 'with MSS option' : ''],
      ['Flags', tcpFlags(l4.flags), ''], ['Window', String(l4.win), 'How many bytes the peer may send unacknowledged'],
      ...(l4.mss ? [['MSS option', String(l4.mss), 'Largest segment this host accepts']] : [])] });
    if (l4.bgp) layers.push(bgpLayer(l4.bgp, l4.dataLen, depth));
    else if (l4.dataLen) layers.push({ kind: 'data', depth, name: 'Application data', bytes: l4.dataLen, fields: [['Content', `${l4.dataLen} bytes${l4.app ? ': ' + l4.app : ''}`, '']] });
  } else if (l4.kind === 'vrrp') {
    layers.push({ kind: 'rt', depth, name: `${pre}VRRP advertisement`, bytes: 8 + 4 * (l4.vips?.length || 1), fields: [
      ['Version / Type', `${l4.version || 3} / 1 (Advertisement)`, ''], ['Virtual router ID', String(l4.vrid), 'Group number, also the last byte of the virtual MAC'],
      ['Priority', String(l4.prio), 'The highest priority becomes master. 0 means: master resigns'],
      ['Advertisement interval', `${l4.adv} s`, 'Backups take over after about 3 missed advertisements'],
      ['Virtual IP', (l4.vips || []).join(', '), 'The gateway address the hosts use']] });
  } else if (l4.kind === 'ospf') {
    const fields = [['Version / Type', l4.type === 'hello' ? '2 / 1 (Hello)' : '2 / 4 (Link State Update)', ''], ['Router ID', l4.rid, 'Unique ID of the sending router'], ['Area', l4.area || '0.0.0.0', 'Backbone area']];
    if (l4.type === 'hello') fields.push(['Hello / dead interval', `${l4.hello} / ${l4.dead} s`, 'Must match on both sides, or no adjacency forms'],
      ['Network mask', `/${l4.prefix}`, 'Must match the receiving interface'], ['Neighbors seen', l4.nbrs.join(', ') || 'none', 'When a router finds its own ID here, the link is 2-Way']);
    else for (const l of l4.lsas) fields.push([`Router LSA ${l.rid}`, `seq ${l.seq}`, l.links.map(k => k.type === 'router' ? `→ ${k.rid} (${k.cost})` : `${k.net}/${k.len} (${k.cost})`).join(', ')]);
    layers.push({ kind: 'rt', depth, name: `${pre}OSPF ${l4.type === 'hello' ? 'Hello' : 'LS Update'}`, bytes: ospfLen(l4), fields });
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dhcp') {
    const d = l4.payload;
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Source port', String(l4.sport), l4.sport === 68 ? 'DHCP client' : 'DHCP server or relay'], ['Destination port', String(l4.dport), l4.dport === 67 ? 'DHCP server or relay' : 'DHCP client'], ['Length', `${UDP_HDR + DHCP_LEN} bytes`, '']] });
    layers.push({ kind: 'data', depth, name: `DHCP ${DHCP_NAME[d.op] || d.op}`, bytes: DHCP_LEN, fields: [
      ['Message type', d.op, { DISCOVER: 'Is there a server?', OFFER: 'Here is an address', REQUEST: 'I take that address', ACK: 'Confirmed, use it', NAK: 'Refused, start over', RELEASE: 'I no longer need it' }[d.op] || ''],
      ['Transaction ID', '0x' + (d.xid >>> 0).toString(16), 'Matches offer and request of the same client'],
      ['Client MAC (chaddr)', d.chaddr, 'The server hands out addresses per MAC'],
      ['Client IP (ciaddr)', d.ciaddr || '0.0.0.0', ''], ['Your IP (yiaddr)', d.yiaddr || '0.0.0.0', d.yiaddr && d.yiaddr !== '0.0.0.0' ? 'The address for the client' : ''],
      ['Relay agent (giaddr)', d.giaddr || '0.0.0.0', d.giaddr && d.giaddr !== '0.0.0.0' ? 'Set by the relay, the server picks the pool by it' : 'No relay involved'],
      ...(d.requested ? [['Option 50: requested IP', d.requested, '']] : []), ...(d.server ? [['Option 54: server ID', d.server, '']] : []),
      ...(d.op === 'OFFER' || d.op === 'ACK' ? [['Option 1: subnet mask', `/${d.prefix}`, ''], ['Option 3: router', d.router || '-', 'Default gateway'], ['Option 6: DNS', d.dns || '-', ''], ['Option 51: lease time', `${d.lease} s`, '']] : [])] });
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'bfd') {
    const b = l4.payload;
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Source port', String(l4.sport), 'From 49152 up'], ['Destination port', String(l4.dport), '3784: BFD single hop'], ['Length', `${UDP_HDR + 24} bytes`, '']] });
    layers.push({ kind: 'rt', depth, name: `${pre}BFD Control`, bytes: 24, fields: [
      ['Version / Diagnostic', `1 / ${b.diag || 'No Diagnostic'}`, 'Why the session last went down'],
      ['State', b.state, { Down: 'No session yet, or it failed', Init: 'I hear you, do you hear me?', Up: 'Both sides hear each other' }[b.state] || ''],
      ['Detect multiplier', String(b.mult), 'Missed packets before the session goes down'],
      ['My discriminator', String(b.myDisc), 'Random number that names the session on the sender'],
      ['Your discriminator', String(b.yourDisc || 0), 'The number the neighbor uses, 0 while unknown'],
      ['Desired min TX / required min RX', `${b.interval} ms`, `Detection time = ${b.interval} × ${b.mult} = ${b.interval * b.mult} ms`]] });
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Source port', String(l4.sport), ''], ['Destination port', String(l4.dport), l4.dport === 53 || l4.sport === 53 ? 'DNS' : ''], ['Length', `${UDP_HDR + udpPayloadLen(l4)} bytes`, '']] });
    const rrF = (sec, a) => [sec, `${a.name || '.'} ${a.type} ${a.data}`, `TTL ${a.ttl} s`];
    const flags = d.qr ? [['AA', d.aa ? '1' : '0', d.aa ? 'Authoritative: the server is responsible for the name' : 'Not authoritative (from a cache or a referral)'],
      ['RD', d.rd ? '1' : '0', 'Recursion desired, copied from the query'], ['RA', d.ra ? '1' : '0', d.ra ? 'Recursion available: this server resolves for others' : 'This server does not resolve for others']]
      : [['RD', d.rd === 0 ? '0' : '1', d.rd === 0 ? 'Iterative: "just tell me what you know"' : 'Recursion desired: "find the answer for me"']];
    layers.push({ kind: 'data', depth, name: `DNS ${d.qr ? 'response' : 'query'}`, bytes: dnsLen(d), fields: [
      ['ID', String(d.id), 'Matches response and query to each other'], ['QR', d.qr ? '1 (response)' : '0 (query)', ''], ...flags,
      ['Question', `${d.qname || '.'} ${d.qtype || 'A'}`, ''], ...(d.qr ? [['Response code', d.rcode, { NOERROR: 'No error', NXDOMAIN: 'The name does not exist', REFUSED: 'The server refuses to answer', SERVFAIL: 'The resolver failed to find an answer' }[d.rcode] || ''],
        ...(d.answers || []).map(a => rrF('Answer', a)), ...(d.authority || []).map(a => rrF('Authority', a)), ...(d.additional || []).map(a => rrF('Additional', a))] : [])] });
  } else if (l4.kind === 'udp') {
    if (l4.payload?.kind === 'wg') {
      const w = l4.payload;
      layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Source port', String(l4.sport), 'Listen port of the sending peer'],
        ['Destination port', String(l4.dport), l4.dport === 51820 ? 'WireGuard (usual port)' : 'Listen port of the peer'], ['Length', `${UDP_HDR + udpPayloadLen(l4)} bytes`, '']] });
      const fields = [['Type', { init: '1 (handshake initiation)', resp: '2 (handshake response)', data: '4 (transport data)' }[w.type], '']];
      if (w.type === 'init') fields.push(['Sender index', String(w.sender), 'Number the initiator uses for this session'], ['Ephemeral key', '32 bytes, in the clear', 'A fresh key pair for this handshake only'], ['Static key, timestamp', '48 + 28 bytes, encrypted', 'Encrypted with a key that only the holder of the receiver\'s private key can derive: only the right peer can read it'],
        ['MAC1 / MAC2', '32 bytes', 'Protection against strangers and floods']);
      if (w.type === 'resp') fields.push(['Sender / receiver index', `${w.sender} / ${w.receiver}`, 'Both sides now know each other\'s session number'], ['Ephemeral key', '32 bytes, in the clear', 'Completes the key exchange'], ['Empty', '16 bytes, encrypted', 'Proves that the responder could derive the keys'], ['MAC1 / MAC2', '32 bytes', 'Protection against strangers and floods']);
      if (w.type === 'data') fields.push(['Receiver index', String(w.receiver), 'Tells the receiver which session (and key) to use'], ['Counter', String(w.counter), 'Nonce and protection against replays'],
        ['Encrypted packet', w.inner ? `${Math.ceil(w.inner.totalLength / 16) * 16} bytes (padded to 16)` : '0 bytes: keepalive', 'ChaCha20: nobody on the way can read it'], ['Authentication tag', '16 bytes', 'Poly1305: any change is noticed']);
      layers.push({ kind: 'vpn', depth, name: 'WireGuard', bytes: udpPayloadLen(l4) - (w.inner ? Math.ceil(w.inner.totalLength / 16) * 16 : 0), fields });
      if (w.inner) layers.push(...dissect({ type: w.inner.v === 6 ? 'ipv6' : 'ipv4', payload: w.inner, src: '', dst: '' }, depth + 1).slice(1)
        .map((l, i) => i === 0 ? { ...l, name: `${l.name} (encrypted, shown decrypted)` } : l));
      return layers;
    }
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

/** The conversation a frame belongs to (all DHCP messages of one client, one TCP
 *  connection, one ping, one ARP exchange …), for tracking it across the network.
 *  kind also selects the log entries without a frame that belong to it. */
export function flowOf(f) {
  if (!f) return null;
  const pair = (a, b) => [a, b].sort().join('|');
  if (f.type === 'stp') return { key: 'stp', kind: 'stp', label: 'Spanning tree BPDUs' };
  if (f.type === 'arp') {
    const a = f.payload;
    if (a.spa === a.tpa || a.spa === '0.0.0.0') return { key: `arp:${a.tpa}`, kind: 'arp', label: `ARP for ${a.tpa}` };
    return { key: `arp:${pair(a.spa, a.tpa)}`, kind: 'arp', label: `ARP between ${a.spa} and ${a.tpa}` };
  }
  if (f.type !== 'ipv4' && f.type !== 'ipv6') return null;
  const ip = f.payload, l4 = ip.l4;
  if (l4?.kind === 'icmp6') {
    if (l4.type >= 133 && l4.type <= 136) {
      if (l4.type === 135 || l4.type === 136) return { key: `nd:${l4.target}`, kind: 'nd', label: `Neighbor Discovery for ${l4.target}` };
      return { key: 'ra', kind: 'nd', label: 'Router solicitations and advertisements' };
    }
    const o = l4.orig;
    if (o) return { key: `icmp:${pair(o.src, o.dst)}:${o.ident}`, kind: 'icmp', label: `Ping between ${o.src} and ${o.dst}` };
    return { key: `icmp:${pair(ip.src, ip.dst)}:${l4.ident}`, kind: 'icmp', label: `Ping between ${ip.src} and ${ip.dst}` };
  }
  if (l4?.kind === 'udp' && l4.payload?.kind === 'vxlan') return flowOf(l4.payload.frame);
  if (l4?.kind === 'udp' && l4.payload?.kind === 'wg') {
    if (l4.payload.inner) return flowOf({ type: l4.payload.inner.v === 6 ? 'ipv6' : 'ipv4', payload: l4.payload.inner });
    return { key: `wg:${pair(ip.src, ip.dst)}`, kind: 'wg', label: `WireGuard between ${ip.src} and ${ip.dst}` };
  }
  if (!l4) return { key: `ip:${pair(ip.src, ip.dst)}`, kind: 'ip', label: `IP between ${ip.src} and ${ip.dst}` };
  if (l4.kind === 'udp' && l4.payload?.kind === 'dhcp') return { key: `dhcp:${l4.payload.chaddr}`, kind: 'dhcp', label: `DHCP of ${l4.payload.chaddr}` };
  if (l4.kind === 'udp' && l4.payload?.kind === 'dns') return { key: `dns:${l4.payload.id}:${l4.payload.qname}`, kind: 'dns', label: `DNS query for ${l4.payload.qname}` };
  if (l4.kind === 'icmp') {
    // Error messages belong to the conversation of the packet they report on
    const o = l4.orig;
    if (o) {
      if (o.proto === PROTO.ICMP) return { key: `icmp:${pair(o.src, o.dst)}:${o.ident}`, kind: 'icmp', label: `Ping between ${o.src} and ${o.dst}` };
      const p = o.proto === PROTO.TCP ? 'tcp' : 'udp';
      return { key: `${p}:${pair(`${o.src}:${o.sport}`, `${o.dst}:${o.dport}`)}`, kind: p, label: `${p.toUpperCase()} ${o.src}:${o.sport} ↔ ${o.dst}:${o.dport}` };
    }
    return { key: `icmp:${pair(ip.src, ip.dst)}:${l4.ident}`, kind: 'icmp', label: `Ping between ${ip.src} and ${ip.dst}` };
  }
  if (l4.kind === 'tcp' || l4.kind === 'udp') {
    const [a, b] = [`${ip.src}:${l4.sport}`, `${ip.dst}:${l4.dport}`];
    const label = l4.dport < l4.sport ? `${l4.kind.toUpperCase()} ${a} → ${b}` : `${l4.kind.toUpperCase()} ${b} → ${a}`;
    return { key: `${l4.kind}:${pair(a, b)}`, kind: l4.kind, label };
  }
  return { key: `${l4.kind}:${ip.src}`, kind: l4.kind, label: `${l4.kind.toUpperCase()} from ${ip.src}` };
}

const BGP_NOTIF = { '2/2': 'OPEN Message Error: Bad Peer AS', '2/3': 'OPEN Message Error: Bad BGP Identifier', '4/0': 'Hold Timer Expired', '6/2': 'Cease: Administrative Shutdown', '6/4': 'Cease: Administrative Reset' };
const bgpNotif = (c, s) => BGP_NOTIF[`${c}/${s}`] || `code ${c}, subcode ${s}`;
function bgpLayer(m, bytes, depth) {
  const fields = [['Marker / Length', `16 × 0xff / ${bytes} bytes`, 'Every BGP message starts like this'], ['Type', { OPEN: '1 (OPEN)', UPDATE: '2 (UPDATE)', NOTIFICATION: '3 (NOTIFICATION)', KEEPALIVE: '4 (KEEPALIVE)' }[m.type], '']];
  if (m.type === 'OPEN') fields.push(['Version', '4', ''], ['My AS', String(m.asn), 'Must match the remote-as the neighbor configured'], ['Hold time', `${m.hold} s`, 'The lower value of both sides applies'],
    ['BGP identifier', m.rid, 'Router ID'], ['Capabilities', (m.caps || []).join(', '), 'Address families and features this router supports']);
  if (m.type === 'KEEPALIVE') fields.push(['Content', 'none', 'Only the header: "I am still here". Sent every hold time / 3']);
  if (m.type === 'NOTIFICATION') fields.push(['Error', bgpNotif(m.code, m.sub), 'After a NOTIFICATION the session is closed'], ...(m.text ? [['Data', m.text, '']] : []));
  if (m.type === 'UPDATE') {
    if (m.withdrawn?.length) fields.push(['Withdrawn routes', m.withdrawn.join(', '), 'No longer reachable via this neighbor']);
    if (m.nlri?.length || m.evpn?.length) {
      const a = m.attrs || {};
      fields.push(['ORIGIN', { i: 'IGP', e: 'EGP', '?': 'incomplete' }[a.origin] || 'IGP', ''], ['AS_PATH', (a.asPath || []).join(' ') || '(empty)', 'Every AS on the way, the newest first. Loop protection: an AS drops paths with its own number'],
        ['NEXT_HOP', String(a.nextHop), 'Where to send packets for these networks']);
      if (a.localPref != null) fields.push(['LOCAL_PREF', String(a.localPref), 'Only inside the AS (iBGP): the highest wins']);
      if (a.med != null) fields.push(['MULTI_EXIT_DISC', String(a.med), 'A hint to the neighbor AS: the lowest is preferred']);
      if (a.originatorId) fields.push(['ORIGINATOR_ID / CLUSTER_LIST', `${a.originatorId} / ${(a.clusterList || []).join(' ')}`, 'Added by a route reflector against loops']);
      if (m.nlri?.length) fields.push(['NLRI (networks)', m.nlri.join(', '), '']);
      for (const e of m.evpn || []) fields.push([`EVPN type ${e.rt}`, e.rt === 2 ? `MAC ${e.mac}${e.ip ? ', IP ' + e.ip : ''}, VNI ${e.vni}` : `VNI ${e.vni}, VTEP ${e.nextHop ?? a.nextHop}`, e.rt === 2 ? 'MAC/IP advertisement: this host is behind me' : 'Inclusive multicast: send flooded traffic for this VNI to me']);
    }
  }
  return { kind: 'rt', depth, name: `BGP ${m.type}`, bytes, fields };
}
