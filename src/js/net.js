// Helper functions for addresses and packet sizes. No DOM, also usable in Node.

export const ETH_HDR = 14, VLAN_TAG = 4, FCS = 4, PREAMBLE = 8, IFG = 12;
export const IP_HDR = 20, UDP_HDR = 8, ICMP_HDR = 8, VXLAN_HDR = 8, ARP_LEN = 28, TCP_HDR = 20, LLC_LEN = 3, BPDU_LEN = 35, RST_BPDU_LEN = 36;
export const bpduLen = b => (b?.version === 2 ? RST_BPDU_LEN : BPDU_LEN);
export const STP_MAC = '01:80:c2:00:00:00';
export const BCAST = 'ff:ff:ff:ff:ff:ff';
export const VXLAN_PORT = 4789;
export const PROTO = { ICMP: 1, TCP: 6, UDP: 17, ICMP6: 58, OSPF: 89, VRRP: 112 };
export const PROTO_NAME = { 1: 'ICMP', 6: 'TCP', 17: 'UDP', 58: 'ICMPv6', 89: 'OSPF', 112: 'VRRP' };
export const DHCP_LEN = 300;
export const VRRP_MAC = '01:00:5e:00:00:12', OSPF_MAC = '01:00:5e:00:00:05';
export const isMcastIp = ip => { const n = ipToInt(ip); return n !== null && (n >>> 28) === 14; };

export function ipToInt(ip) {
  const p = String(ip).trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x)) return null;
    const v = Number(x);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}
export function intToIp(n) {
  return [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
}
export const isIp = ip => ipToInt(ip) !== null;
export function maskOf(len) { return len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0; }
export function netOf(ip, len) { return (ipToInt(ip) & maskOf(len)) >>> 0; }
export function inNet(ip, net, len) {
  const a = ipToInt(ip), b = ipToInt(net);
  if (a === null || b === null) return false;
  return ((a & maskOf(len)) >>> 0) === ((b & maskOf(len)) >>> 0);
}
export function parseCidr(s) {
  if (s === 'default' || s === 'any') return { net: '0.0.0.0', len: 0 };
  const m = String(s).trim().match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const len = m[2] === undefined ? 32 : Number(m[2]);
  if (len > 32 || !isIp(m[1])) return null;
  return { net: intToIp(netOf(m[1], len)), len };
}
export const cidr = (net, len) => `${net}/${len}`;

// ---------- IPv6 ----------
export const IP6_HDR = 40;
/** 2001:db8::1 → [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1], or null. A zone like %eth1 is ignored. */
export function parse6(s) {
  if (typeof s !== 'string') return null;
  s = s.trim().split('%')[0].toLowerCase();
  if (!s.includes(':') || !/^[0-9a-f:]+$/.test(s)) return null;
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const side = x => (x ? x.split(':') : []);
  const a = side(parts[0]), b = parts.length === 2 ? side(parts[1]) : [];
  if (parts.length === 1 && a.length !== 8) return null;
  if (parts.length === 2 && a.length + b.length > 7) return null;
  const words = [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  if (words.some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.map(w => parseInt(w, 16));
}
/** Shortest form after RFC 5952: lower case, leading zeros dropped, the longest run of zeros as :: */
export function fmt6(w) {
  if (!w) return '';
  let best = -1, len = 0;
  for (let i = 0; i < 8;) {
    if (w[i] !== 0) { i++; continue; }
    let j = i; while (j < 8 && w[j] === 0) j++;
    if (j - i > len && j - i > 1) { best = i; len = j - i; }
    i = j;
  }
  const hex = w.map(x => x.toString(16));
  if (best < 0) return hex.join(':');
  return hex.slice(0, best).join(':') + '::' + hex.slice(best + len).join(':');
}
export const isIp6 = s => parse6(s) !== null;
export const norm6 = s => fmt6(parse6(s));
export const isAnyIp = s => isIp(s) || isIp6(s);
export const zoneOf6 = s => (String(s).includes('%') ? String(s).split('%')[1] : null);
export function mask6(w, len) {
  return w.map((x, i) => { const bits = Math.max(0, Math.min(16, len - i * 16)); return bits === 16 ? x : bits === 0 ? 0 : x & ((0xffff << (16 - bits)) & 0xffff); });
}
export function inNet6(addr, net, len) {
  const a = parse6(addr), b = parse6(net);
  if (!a || !b) return false;
  return mask6(a, len).every((x, i) => x === mask6(b, len)[i]);
}
export function parseCidr6(s) {
  if (s === 'default' || s === '::/0') return { net: '::', len: 0 };
  const [a, l] = String(s).trim().split('/');
  const w = parse6(a);
  const len = l === undefined ? 128 : Number(l);
  if (!w || !(len >= 0 && len <= 128) || !/^\d*$/.test(l ?? '')) return null;
  return { net: fmt6(mask6(w, len)), len };
}
/** Interface identifier from a MAC (modified EUI-64): flip the U/L bit, insert ff:fe in the middle */
export function eui64(mac) {
  const b = mac.split(':').map(x => parseInt(x, 16));
  b[0] ^= 2;
  return [(b[0] << 8) | b[1], (b[2] << 8) | 0xff, 0xfe00 | b[3], (b[4] << 8) | b[5]];
}
export const linkLocalFor = mac => fmt6([0xfe80, 0, 0, 0, ...eui64(mac)]);
export const slaacFor = (prefix, mac) => fmt6([...parse6(prefix).slice(0, 4), ...eui64(mac)]);
export const isLinkLocal6 = a => ((parse6(a)?.[0] ?? 0) & 0xffc0) === 0xfe80;
export const isMcast6 = a => ((parse6(a)?.[0] ?? 0) >> 8) === 0xff;
export const ALL_NODES = 'ff02::1', ALL_ROUTERS = 'ff02::2';
/** Solicited-node multicast group: ff02::1:ff plus the last 24 bits of the address */
export function solicitedNode(addr) {
  const w = parse6(addr);
  return fmt6([0xff02, 0, 0, 0, 0, 1, 0xff00 | (w[6] & 0xff), w[7]]);
}
/** Multicast MAC for an IPv6 group: 33:33 plus the last 32 bits */
export function mcastMac6(addr) {
  const w = parse6(addr);
  return ['33', '33', w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255].map(x => typeof x === 'string' ? x : x.toString(16).padStart(2, '0')).join(':');
}
/** ICMPv6 message length: echo with data, NDP messages with their options */
export function icmp6Len(m) {
  if (m.type === 128 || m.type === 129) return 8 + (m.dataLen || 0);
  if (m.type === 133) return 8 + (m.slla ? 8 : 0);
  if (m.type === 134) return 16 + (m.slla ? 8 : 0) + 32 * (m.prefixes?.length || 0) + (m.mtu ? 8 : 0) + (m.rdnss?.length ? 8 + 16 * m.rdnss.length : 0);
  if (m.type === 135 || m.type === 136) return 24 + (m.slla || m.tlla ? 8 : 0);
  return 8 + (m.dataLen || 48);
}
export const isBroadcastMac = m => m === BCAST;
export function isGroupMac(mac) { return (parseInt(mac.slice(0, 2), 16) & 1) === 1; }
export function isLocalMac(mac) { return (parseInt(mac.slice(0, 2), 16) & 2) === 2; }

// Stable MAC from a name (containerlab style aa:c1:ab:xx:xx:xx)
export function macFor(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const b = [(h >>> 16) & 255, (h >>> 8) & 255, h & 255].map(x => x.toString(16).padStart(2, '0'));
  return `aa:c1:ab:${b.join(':')}`;
}
export function hashFlow(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return 49152 + ((h >>> 0) % 16384);
}

// ---------- Sizes ----------
export function l4Len(ip) {
  const l4 = ip.l4;
  if (ip.frag) return ip.frag.len;
  if (!l4) return 0;
  if (l4.kind === 'icmp') return ICMP_HDR + (l4.dataLen || 0);
  if (l4.kind === 'icmp6') return icmp6Len(l4);
  if (l4.kind === 'udp') return UDP_HDR + udpPayloadLen(l4);
  if (l4.kind === 'tcp') return tcpHdrLen(l4) + (l4.dataLen || 0);
  if (l4.kind === 'vrrp') return 8 + 4 * (l4.vips?.length || 1);
  if (l4.kind === 'ospf') return ospfLen(l4);
  return 0;
}
// OSPF: 24 byte header, hello 20 + 4 per neighbor, LS update 4 + per LSA 24 + 12 per link
export function ospfLen(o) {
  if (o.type === 'hello') return 24 + 20 + 4 * (o.nbrs?.length || 0);
  return 24 + 4 + (o.lsas || []).reduce((s, l) => s + 24 + 12 * l.links.length, 0);
}
export function tcpHdrLen(t) { return TCP_HDR + (t.mss ? 4 : 0); }
// DNS: 12 byte header, the question, then every record: name (compressed to 2 bytes when it
// repeats an earlier name), type, class, TTL, length (10 bytes) and the data
export function dnsLen(d) {
  const nameLen = n => (n ? n.replace(/\.$/, '').length + 2 : 1);
  const seen = new Set([String(d.qname || '').toLowerCase()]);
  const rr = r => {
    const short = seen.has(r.name); seen.add(r.name);
    const data = r.type === 'A' ? 4 : r.type === 'AAAA' ? 16 : r.type === 'SOA' ? 22 + nameLen(r.name) : nameLen(r.data);
    return (short ? 2 : nameLen(r.name)) + 10 + data;
  };
  const all = [...(d.answers || []), ...(d.authority || []), ...(d.additional || [])];
  return 12 + nameLen(d.qname) + 4 + all.reduce((s, r) => s + rr(r), 0);
}
export function udpPayloadLen(udp) {
  const p = udp.payload;
  if (!p) return udp.dataLen || 0;
  if (p.kind === 'vxlan') return VXLAN_HDR + frameLen(p.frame);
  if (p.kind === 'dns') return dnsLen(p);
  if (p.kind === 'dhcp') return DHCP_LEN;
  if (p.kind === 'bfd') return 24;
  return p.len || 0;
}
export function ipTotalLen(ip) { return (ip.v === 6 ? IP6_HDR : IP_HDR) + l4Len(ip); }
/** Length from destination MAC to end of payload, without FCS (as tcpdump shows it) */
export function frameLen(f) {
  return ETH_HDR + (f.vlan ? VLAN_TAG : 0) + framePayloadLen(f);
}
export function framePayloadLen(f) {
  if (f.type === 'arp') return ARP_LEN;
  if (f.type === 'ipv4' || f.type === 'ipv6') return f.payload.totalLength;
  if (f.type === 'stp') return LLC_LEN + bpduLen(f.payload);
  return f.payload?.len || 0;
}
/** On the wire: with FCS and padding to 64 bytes */
export function frameWireLen(f) { return Math.max(64, frameLen(f) + FCS); }

export function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
