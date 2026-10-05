// Helper functions for addresses and packet sizes. No DOM, also usable in Node.

export const ETH_HDR = 14, VLAN_TAG = 4, FCS = 4, PREAMBLE = 8, IFG = 12;
export const IP_HDR = 20, UDP_HDR = 8, ICMP_HDR = 8, VXLAN_HDR = 8, ARP_LEN = 28, TCP_HDR = 20, LLC_LEN = 3, BPDU_LEN = 35;
export const STP_MAC = '01:80:c2:00:00:00';
export const BCAST = 'ff:ff:ff:ff:ff:ff';
export const VXLAN_PORT = 4789;
export const PROTO = { ICMP: 1, TCP: 6, UDP: 17 };
export const PROTO_NAME = { 1: 'ICMP', 6: 'TCP', 17: 'UDP' };

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
  if (l4.kind === 'udp') return UDP_HDR + udpPayloadLen(l4);
  if (l4.kind === 'tcp') return tcpHdrLen(l4) + (l4.dataLen || 0);
  return 0;
}
export function tcpHdrLen(t) { return TCP_HDR + (t.mss ? 4 : 0); }
export function dnsLen(d) {
  const q = 12 + (d.qname.length + 2) + 4;
  return q + (d.answers || []).length * 16;
}
export function udpPayloadLen(udp) {
  const p = udp.payload;
  if (!p) return udp.dataLen || 0;
  if (p.kind === 'vxlan') return VXLAN_HDR + frameLen(p.frame);
  if (p.kind === 'dns') return dnsLen(p);
  return p.len || 0;
}
export function ipTotalLen(ip) { return IP_HDR + l4Len(ip); }
/** Length from destination MAC to end of payload, without FCS (as tcpdump shows it) */
export function frameLen(f) {
  return ETH_HDR + (f.vlan ? VLAN_TAG : 0) + framePayloadLen(f);
}
export function framePayloadLen(f) {
  if (f.type === 'arp') return ARP_LEN;
  if (f.type === 'ipv4') return f.payload.totalLength;
  if (f.type === 'stp') return LLC_LEN + BPDU_LEN;
  return f.payload?.len || 0;
}
/** On the wire: with FCS and padding to 64 bytes */
export function frameWireLen(f) { return Math.max(64, frameLen(f) + FCS); }

export function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
