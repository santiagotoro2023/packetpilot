// Aufbau, Beschreibung und Zerlegung von Frames
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
export const tcpFlags = f => ['SYN', 'FIN', 'RST', 'PSH', 'ACK'].filter(k => f[k]).join(', ') || 'keine';
export const fmtBid = b => b ? `${b.prio}.${b.mac}` : '';

// Vereinfachte, aber deterministische Header-Prüfsumme (ändert sich mit TTL)
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
  '0/0': 'Echo Reply', '8/0': 'Echo Request', '11/0': 'Time Exceeded (TTL abgelaufen)',
  '3/0': 'Destination Unreachable: Network Unreachable', '3/1': 'Destination Unreachable: Host Unreachable',
  '3/3': 'Destination Unreachable: Port Unreachable', '3/4': 'Destination Unreachable: Fragmentation Needed',
  '3/13': 'Destination Unreachable: Communication Administratively Prohibited'
};
export function icmpName(t, c) { return ICMP_NAMES[`${t}/${c}`] || `Typ ${t} Code ${c}`; }

/** Kurzes Etikett für die Animation */
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
/** Schichten von aussen nach innen, für die Balken auf dem Paket */
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

/** Einzeilige Beschreibung im Stil von tcpdump */
export function summary(f) {
  const tag = f.vlan ? `vlan ${f.vlan.vid}, ` : '';
  if (f.type === 'stp') {
    const b = f.payload;
    return `STP BPDU: Root ${fmtBid(b.root)}, Kosten ${b.cost}, von Bridge ${fmtBid(b.bridge)} Port ${b.port}${b.tc ? ', Topologieänderung' : ''}`;
  }
  if (f.type === 'arp') {
    const a = f.payload;
    if (a.spa === a.tpa) return `${tag}Gratuitous ARP ${a.op === 1 ? 'Request' : 'Reply'}: ${a.spa} ist bei ${a.sha}`;
    if (a.spa === '0.0.0.0') return `${tag}ARP-Probe: Benutzt jemand ${a.tpa}?`;
    return a.op === 1 ? `${tag}ARP Request: Wer hat ${a.tpa}? Antwort an ${a.spa}`
      : `${tag}ARP Reply: ${a.spa} ist bei ${a.sha}`;
  }
  const ip = f.payload;
  const base = `${ip.src} > ${ip.dst}`;
  if (ip.frag && !ip.frag.first) return `${tag}IP-Fragment ${base}, id ${ip.id}, Offset ${ip.fragOffset}, ${ip.frag.len} Byte${ip.mf ? ', weitere folgen' : ', letztes'}`;
  const l4 = ip.l4;
  let s;
  if (l4.kind === 'icmp') {
    if (l4.type === 8 || l4.type === 0) s = `ICMP ${l4.type === 8 ? 'Echo Request' : 'Echo Reply'} ${base}, seq ${l4.seq}, TTL ${ip.ttl}, ${ip.totalLength} Byte`;
    else s = `ICMP ${icmpName(l4.type, l4.code)}${l4.mtu ? ` (MTU ${l4.mtu})` : ''} ${base}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') {
    s = `VXLAN ${base}, VNI ${l4.payload.vni}, UDP ${l4.sport} > ${l4.dport}  ⟶  ${summary(l4.payload.frame)}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    s = d.qr ? `DNS-Antwort ${base}: ${d.qname} ${d.rcode === 'NOERROR' ? '→ ' + d.answers.map(a => a.ip).join(', ') : d.rcode}`
      : `DNS-Anfrage ${base}: A ${d.qname}?`;
  } else if (l4.kind === 'udp') {
    s = `UDP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport}, TTL ${ip.ttl}`;
  } else if (l4.kind === 'tcp') {
    s = `TCP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport} [${tcpFlags(l4.flags)}] seq ${l4.seq}${l4.flags.ACK ? ' ack ' + l4.ack : ''}${l4.dataLen ? ', ' + l4.dataLen + ' Byte Daten' : ''}${l4.app ? ' (' + l4.app + ')' : ''}`;
  } else s = `IP ${base}`;
  if (ip.frag?.first) s += ` (erstes Fragment, weitere folgen)`;
  return tag + s;
}

function macNote(m) {
  if (m === BCAST) return 'Broadcast, an alle im Segment';
  if (isGroupMac(m)) return 'Multicast (Bit I/G = 1)';
  return isLocalMac(m) ? 'Unicast, lokal vergeben (Bit U/L = 1)' : 'Unicast, vom Hersteller vergeben';
}

/** Zerlegt einen Frame in Schichten für den Paketinspektor */
export function dissect(f, depth = 0) {
  const layers = [];
  const pre = depth ? 'Innerer ' : '';
  if (f.type === 'stp') {
    const b = f.payload;
    layers.push({ kind: 'eth', depth, name: 'IEEE 802.3 (mit Längenfeld)', bytes: ETH_HDR, fields: [
      ['Ziel-MAC', f.dst, 'Gruppenadresse für Bridges, wird nie weitergeleitet'], ['Quell-MAC', f.src, 'MAC des sendenden Switch-Ports'],
      ['Länge', `${LLC_LEN + BPDU_LEN} Byte`, 'Kein EtherType: Werte bis 1500 sind eine Länge']] });
    layers.push({ kind: 'stp', depth, name: 'LLC', bytes: LLC_LEN, fields: [['DSAP / SSAP', '0x42 / 0x42', 'Spanning Tree'], ['Control', '0x03', 'Unnumbered Information']] });
    layers.push({ kind: 'stp', depth, name: 'STP Configuration BPDU', bytes: BPDU_LEN, fields: [
      ['Protocol / Version', '0 / 0 (802.1D)', ''], ['Flags', b.tc ? 'Topology Change' : 'keine', b.tc ? 'Empfänger verkürzen das Aging ihrer MAC-Tabelle' : ''],
      ['Root Bridge ID', fmtBid(b.root), 'Priorität.MAC der Bridge, die der Sender für die Root hält'],
      ['Root Path Cost', String(b.cost), 'Kosten des Senders bis zur Root'],
      ['Bridge ID', fmtBid(b.bridge), 'Wer sendet'], ['Port ID', b.port, 'Priorität.Nummer des sendenden Ports'],
      ['Message Age', `${b.age} s`, ''], ['Max Age / Hello / Forward Delay', `${b.maxAge} / ${b.hello} / ${b.fwd} s`, 'Timer, die die Root vorgibt']] });
    return layers;
  }
  layers.push({ kind: 'eth', depth, name: `${pre}Ethernet II`, bytes: ETH_HDR, fields: [
    ['Ziel-MAC', f.dst, macNote(f.dst)],
    ['Quell-MAC', f.src, macNote(f.src)],
    ['EtherType', f.vlan ? '0x8100 (802.1Q-Tag folgt)' : (f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)'), 'Sagt, wie die Nutzlast zu lesen ist']
  ]});
  if (f.vlan) layers.push({ kind: 'vlan', depth, name: `${pre}802.1Q-Tag`, bytes: VLAN_TAG, fields: [
    ['TPID', '0x8100', 'Kennzeichnet den Tag'],
    ['PCP (Priorität)', String(f.vlan.pcp || 0), '0 bis 7'],
    ['DEI', '0', 'Darf bei Überlast verworfen werden'],
    ['VID (VLAN)', String(f.vlan.vid), 'Nutzbar 1 bis 4094'],
    ['EtherType', f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)', '']
  ]});
  if (f.type === 'arp') {
    const a = f.payload;
    layers.push({ kind: 'arp', depth, name: `${pre}ARP ${a.op === 1 ? 'Request' : 'Reply'}`, bytes: ARP_LEN, fields: [
      ['Hardware Type', '1 (Ethernet)', ''], ['Protocol Type', '0x0800 (IPv4)', ''],
      ['Hardware / Protocol Length', '6 / 4', ''],
      ['Operation', a.op === 1 ? '1 (Request)' : '2 (Reply)', ''],
      ['Sender MAC', a.sha, ''], ['Sender IP', a.spa, ''],
      ['Target MAC', a.tha, a.op === 1 ? 'Noch unbekannt, deshalb Nullen' : ''], ['Target IP', a.tpa, a.spa === a.tpa ? 'Gleich wie Sender IP: Gratuitous ARP' : a.spa === '0.0.0.0' ? 'Probe: Sender IP 0.0.0.0' : '']
    ]});
    return layers;
  }
  const ip = f.payload;
  const flags = [ip.df ? 'DF' : null, ip.mf ? 'MF' : null].filter(Boolean).join(', ') || 'keine';
  layers.push({ kind: 'ip', depth, name: `${pre}IPv4`, bytes: IP_HDR, fields: [
    ['Version / IHL', '4 / 5 (20 Byte)', ''],
    ['Total Length', `${ip.totalLength} Byte`, 'Header und Nutzlast'],
    ['Identification', String(ip.id), 'Gleich in allen Fragmenten eines Pakets'],
    ['Flags', flags, ip.df ? 'Don\'t Fragment: Router dürfen nicht zerlegen' : 'Router dürfen zerlegen'],
    ['Fragment Offset', `${ip.fragOffset} Byte`, ''],
    ['TTL', String(ip.ttl), 'Jeder Router zieht 1 ab'],
    ['Protocol', `${ip.proto} (${ip.proto === 1 ? 'ICMP' : ip.proto === 17 ? 'UDP' : ip.proto === 6 ? 'TCP' : '?'})`, ''],
    ['Header Checksum', hex4(ip.checksum), 'Wird bei jedem Hop neu berechnet'],
    ['Quell-IP', ip.src, 'Bleibt von Ende zu Ende gleich'],
    ['Ziel-IP', ip.dst, '']
  ]});
  if (ip.frag && !ip.frag.first) {
    layers.push({ kind: 'frag', depth, name: 'Fragment-Daten', bytes: ip.frag.len, fields: [
      ['Inhalt', `${ip.frag.len} Byte`, 'Fortsetzung des ersten Fragments, ohne eigenen ICMP- oder UDP-Header']] });
    return layers;
  }
  const l4 = ip.l4;
  if (l4.kind === 'icmp') {
    const fields = [['Type / Code', `${l4.type} / ${l4.code}`, icmpName(l4.type, l4.code)]];
    if (l4.type === 8 || l4.type === 0) fields.push(['Identifier / Sequence', `${l4.ident} / ${l4.seq}`, ''], ['Daten', `${l4.dataLen} Byte`, '']);
    if (l4.mtu) fields.push(['Next-Hop MTU', String(l4.mtu), 'So gross darf das Paket höchstens sein']);
    if (l4.orig) fields.push(['Betrifft Paket', `${l4.orig.src} > ${l4.orig.dst}`, 'Kopie des ursprünglichen Headers']);
    layers.push({ kind: 'icmp', depth, name: `${pre}ICMP ${icmpName(l4.type, l4.code)}`, bytes: ICMP_HDR + (l4.dataLen || 0), fields });
  } else if (l4.kind === 'tcp') {
    layers.push({ kind: 'tcp', depth, name: `${pre}TCP`, bytes: tcpHdrLen(l4), fields: [
      ['Quell-Port', String(l4.sport), l4.sport >= 49152 ? 'Kurzlebiger Port des Clients' : ''],
      ['Ziel-Port', String(l4.dport), l4.dport === 80 ? 'HTTP' : l4.dport === 22 ? 'SSH' : l4.dport === 443 ? 'HTTPS' : ''],
      ['Sequenznummer', String(l4.seq), 'Nummer des ersten Bytes in diesem Segment'],
      ['Bestätigungsnummer', l4.flags.ACK ? String(l4.ack) : '0', l4.flags.ACK ? 'Nächstes Byte, das erwartet wird' : 'nur gültig mit ACK'],
      ['Header-Länge', `${tcpHdrLen(l4)} Byte`, l4.mss ? 'mit Option MSS' : ''],
      ['Flags', tcpFlags(l4.flags), ''], ['Fenster', String(l4.win), 'So viele Byte darf die Gegenseite unbestätigt senden'],
      ...(l4.mss ? [['Option MSS', String(l4.mss), 'Grösstes Segment, das dieser Host annimmt']] : [])] });
    if (l4.dataLen) layers.push({ kind: 'data', depth, name: 'Daten der Anwendung', bytes: l4.dataLen, fields: [['Inhalt', `${l4.dataLen} Byte${l4.app ? ': ' + l4.app : ''}`, '']] });
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Quell-Port', String(l4.sport), ''], ['Ziel-Port', String(l4.dport), l4.dport === 53 || l4.sport === 53 ? 'DNS' : ''], ['Länge', `${UDP_HDR + udpPayloadLen(l4)} Byte`, '']] });
    layers.push({ kind: 'data', depth, name: `DNS ${d.qr ? 'Antwort' : 'Anfrage'}`, bytes: dnsLen(d), fields: [
      ['ID', String(d.id), 'Ordnet Antwort und Anfrage einander zu'], ['QR', d.qr ? '1 (Antwort)' : '0 (Anfrage)', ''],
      ['Frage', `${d.qname} A`, ''], ...(d.qr ? [['Antwortcode', d.rcode, ''], ...d.answers.map(a => ['Antwort', `${a.name} A ${a.ip}`, 'TTL 300'])] : [])] });
  } else if (l4.kind === 'udp') {
    const vx = l4.payload?.kind === 'vxlan';
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [
      ['Quell-Port', String(l4.sport), vx ? 'Hash über den inneren Frame (Verteilung bei ECMP)' : ''],
      ['Ziel-Port', String(l4.dport), vx ? (l4.dport === 4789 ? 'VXLAN (IANA)' : 'Nicht der Standard-Port 4789!') : (l4.dport >= 33434 && l4.dport < 33534 ? 'traceroute-Probe' : '')],
      ['Länge', `${UDP_HDR + (vx ? VXLAN_HDR + frameLen(l4.payload.frame) : (l4.payload?.len || 0))} Byte`, '']
    ]});
    if (vx) {
      layers.push({ kind: 'vxlan', depth, name: 'VXLAN', bytes: VXLAN_HDR, fields: [
        ['Flags', '0x08 (I: VNI gültig)', ''], ['VNI', String(l4.payload.vni), 'Nummer des Overlay-Segments, 24 Bit']] });
      layers.push(...dissect(l4.payload.frame, depth + 1));
    } else if (l4.payload?.len) {
      layers.push({ kind: 'data', depth, name: 'Daten', bytes: l4.payload.len, fields: [['Inhalt', `${l4.payload.len} Byte`, '']] });
    }
  }
  return layers;
}

export function frameStats(f) {
  return { len: frameLen(f), wire: frameWireLen(f), fcs: FCS };
}
