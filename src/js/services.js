// Network services on top of L3: DHCP server and relay, NAT, VRRP and OSPF. No DOM.
import { PROTO, BCAST, VRRP_MAC, OSPF_MAC, isIp, inNet, parseCidr, ipToInt, intToIp, netOf, clone } from './net.js';
import { ipPacket, udp, arpPacket } from './packets.js';

const hex2 = n => Number(n).toString(16).padStart(2, '0');
const ipCmp = (a, b) => (ipToInt(a) ?? 0) - (ipToInt(b) ?? 0);

// ================================================================ DHCP server and relay
export const DHCP_TIMING = { retry: 4000, tries: 3 };

/** Pools of a DHCP server, normalized. A pool: { net: '10.10.0.0/24', from, to, router, dns, lease } */
function pools(cfg) { return (cfg.dhcpServer?.enabled ? cfg.dhcpServer.pools || [] : []).filter(p => parseCidr(p.net) && isIp(p.from) && isIp(p.to)); }

/**
 * Handles a DHCP message arriving on UDP port 67 (server or relay). Returns true when handled.
 * l3: the receiving L3 instance, ip: the IP packet, ifname: logical interface it arrived on.
 */
export function dhcpOn67(l3, ip, ifname, frame) {
  const d = ip.l4.payload;
  const dev = l3.dev, cfg = l3.cfg;
  if (!d || d.kind !== 'dhcp') return false;
  // Relay: requests from clients on an interface with a helper address
  const helper = cfg.ifaces?.[ifname]?.helper;
  if (['DISCOVER', 'REQUEST', 'RELEASE'].includes(d.op) && isIp(helper) && !pools(cfg).length) {
    const gi = d.giaddr && d.giaddr !== '0.0.0.0' ? d.giaddr : l3.ifIp(ifname);
    const m = { ...clone(d), giaddr: gi, hops: (d.hops || 0) + 1 };
    dev.record('fwd', `relays DHCP ${d.op} from ${d.chaddr} to the server ${helper} (giaddr ${gi})`, { frame, tag: 'dhcp-relayed', data: { op: d.op, to: helper } });
    l3.output(ipPacket({ src: gi, dst: helper, proto: PROTO.UDP, trace: ip.trace, l4: udp(67, 67, m) }), {});
    return true;
  }
  // Relay: answers from the server go back to the client segment as a broadcast
  if (['OFFER', 'ACK', 'NAK'].includes(d.op) && d.giaddr && l3.isOwn(d.giaddr) && !pools(cfg).length) {
    const out = l3.ifaces().find(i => i.ip === d.giaddr);
    if (!out) return true;
    dev.record('fwd', `passes DHCP ${d.op} for ${d.chaddr} on to ${out.name} as a broadcast`, { frame, tag: 'dhcp-relayed', data: { op: d.op, to: out.name } });
    l3.sendFrame(out.name, BCAST, 'ipv4', ipPacket({ src: d.giaddr, dst: '255.255.255.255', proto: PROTO.UDP, trace: ip.trace, l4: udp(67, 68, clone(d)) }));
    return true;
  }
  const ps = pools(cfg);
  if (!ps.length) return false;
  if (!['DISCOVER', 'REQUEST', 'RELEASE'].includes(d.op)) return true;
  const leases = l3.dhcpLeases;
  // A release arrives as a unicast from the client's own address, no pool lookup needed
  if (d.op === 'RELEASE') {
    if (leases.get(d.chaddr)?.ip === d.ciaddr) { leases.delete(d.chaddr); dev.record('info', `${d.chaddr} releases ${d.ciaddr}`, { frame, tag: 'dhcp-released' }); }
    return true;
  }
  // Which pool: the relay's giaddr or the interface the request came in on
  const via = d.giaddr && d.giaddr !== '0.0.0.0' ? d.giaddr : l3.ifIp(ifname);
  const pool = ps.find(p => { const c = parseCidr(p.net); return via && inNet(via, c.net, c.len); });
  const myIp = l3.ifIp(ifname) || l3.srcFor(via || '0.0.0.0');
  if (!pool) {
    dev.record('err', `DHCP ${d.op} from ${d.chaddr} via ${via || '?'}: no pool for that network`, { frame, tag: 'dhcp-no-pool', data: { via } });
    return true;
  }
  const c = parseCidr(pool.net);
  const reply = (op, yiaddr) => {
    const m = { kind: 'dhcp', op, xid: d.xid, chaddr: d.chaddr, ciaddr: '0.0.0.0', yiaddr: yiaddr || '0.0.0.0', giaddr: d.giaddr || '0.0.0.0',
      server: myIp, prefix: c.len, router: pool.router || '', dns: pool.dns || '', lease: Number(pool.lease || 3600), hops: 0 };
    if (d.giaddr && d.giaddr !== '0.0.0.0') l3.output(ipPacket({ src: myIp, dst: d.giaddr, proto: PROTO.UDP, trace: ip.trace, l4: udp(67, 67, m) }), {});
    else l3.sendFrame(ifname, BCAST, 'ipv4', ipPacket({ src: myIp, dst: '255.255.255.255', proto: PROTO.UDP, trace: ip.trace, l4: udp(67, 68, m) }));
  };
  if (d.op === 'DISCOVER') {
    let ip4 = leases.get(d.chaddr)?.ip;
    if (!ip4 || !inNet(ip4, c.net, c.len)) {
      const used = new Set([...leases.values()].map(l => l.ip));
      for (let n = ipToInt(pool.from); n <= ipToInt(pool.to); n++) { const cand = intToIp(n); if (!used.has(cand)) { ip4 = cand; break; } }
    }
    if (!ip4) { dev.record('err', `DHCP pool ${pool.net} is exhausted, ${d.chaddr} gets no address`, { frame, tag: 'dhcp-exhausted' }); return true; }
    leases.set(d.chaddr, { ip: ip4, state: 'offered', t: l3.sim.time, lease: Number(pool.lease || 3600) });
    dev.record('info', `offers ${ip4}/${c.len} to ${d.chaddr} (gateway ${pool.router || 'none'}, DNS ${pool.dns || 'none'})`, { frame, tag: 'dhcp-offer-sent', data: { ip: ip4 } });
    reply('OFFER', ip4);
    return true;
  }
  // REQUEST: only answer when this server is meant (server id) or for a renewal
  if (d.server && d.server !== myIp && !l3.isOwn(d.server)) {
    const l = leases.get(d.chaddr);
    if (l?.state === 'offered') leases.delete(d.chaddr);
    return true;
  }
  const want = d.requested || d.ciaddr;
  const l = leases.get(d.chaddr);
  if (!l || l.ip !== want || !inNet(want, c.net, c.len)) {
    dev.record('err', `refuses ${want} for ${d.chaddr}: DHCPNAK`, { frame, tag: 'dhcp-nak-sent', data: { ip: want } });
    reply('NAK', null);
    return true;
  }
  l.state = 'bound'; l.t = l3.sim.time;
  dev.record('ok', `confirms ${want} for ${d.chaddr} for ${l.lease} s: DHCPACK`, { frame, tag: 'dhcp-ack-sent', data: { ip: want } });
  reply('ACK', want);
  return true;
}

// ================================================================ NAT (masquerade and port forwarding)
// Entries: { proto, inIp, inPort, outIp, outPort, remIp, remPort, kind }
const natPorts = (p) => {
  const l4 = p.l4;
  if (!l4) return null;
  if (l4.kind === 'tcp' || l4.kind === 'udp') return { sp: l4.sport, dp: l4.dport };
  if (l4.kind === 'icmp' && (l4.type === 8 || l4.type === 0)) return { sp: l4.ident, dp: l4.ident };
  return null;
};
function setPorts(p, sp, dp) {
  const l4 = p.l4;
  if (l4.kind === 'icmp') { l4.ident = sp ?? dp; return; }
  if (sp !== undefined) l4.sport = sp;
  if (dp !== undefined) l4.dport = dp;
}

/** Translate a packet leaving through the outside interface. Mutates and returns pkt. */
export function natOut(l3, pkt, frame) {
  const nat = l3.cfg.nat, outIp = l3.ifIp(nat.outside);
  const pp = natPorts(pkt);
  if (!pp || !outIp || pkt.frag) return pkt;
  const t = l3.natTable;
  const icmp = pkt.l4.kind === 'icmp';
  let e = t.find(x => x.proto === pkt.proto && x.inIp === pkt.src && x.inPort === pp.sp && x.remIp === pkt.dst && (icmp || x.remPort === pp.dp));
  if (!e) {
    if (!nat.masquerade) return pkt;
    const busy = port => t.some(x => x.proto === pkt.proto && x.outPort === port && x.remIp === pkt.dst && (icmp || x.remPort === pp.dp));
    let port = pp.sp;
    if (busy(port)) { port = 1024; while (busy(port) && port < 65535) port++; }
    e = { proto: pkt.proto, inIp: pkt.src, inPort: pp.sp, outIp, outPort: port, remIp: pkt.dst, remPort: icmp ? port : pp.dp, kind: 'masquerade', t: l3.sim.time };
    t.push(e);
    if (t.length > 400) t.shift();
    const what = icmp ? `ICMP id ${pp.sp}` : `${pkt.src}:${pp.sp}`;
    l3.dev.record('info', `NAT: translates ${icmp ? pkt.src + ' ' + what : what} → ${outIp}:${port} (masquerade)${port !== pp.sp ? ', port changed because it was already in use' : ''}`,
      { frame, tag: 'nat-new', data: { inIp: pkt.src, outPort: port, kind: 'masquerade' } });
  }
  pkt.src = e.outIp;
  setPorts(pkt, e.outPort, undefined);
  return pkt;
}

/** Translate a packet arriving on the outside interface for the router's outside address. Returns a new packet or null. */
export function natIn(l3, ip, frame) {
  const nat = l3.cfg.nat, outIp = l3.ifIp(nat.outside);
  if (!outIp || ip.dst !== outIp || ip.frag) return null;
  const t = l3.natTable;
  const l4 = ip.l4;
  // ICMP errors about a translated packet (TTL exceeded, fragmentation needed, unreachable)
  if (l4?.kind === 'icmp' && [3, 11].includes(l4.type) && l4.orig?.src === outIp) {
    const o = l4.orig, oport = o.proto === PROTO.ICMP ? o.ident : o.sport;
    const e = t.find(x => x.proto === o.proto && x.outPort === oport && x.remIp === o.dst);
    if (!e) return null;
    const p = clone(ip);
    p.dst = e.inIp; p.l4.orig.src = e.inIp;
    if (o.proto === PROTO.ICMP) p.l4.orig.ident = e.inPort; else p.l4.orig.sport = e.inPort;
    return p;
  }
  const pp = natPorts(ip);
  if (!pp) return null;
  const icmp = l4.kind === 'icmp';
  let e = t.find(x => x.proto === ip.proto && x.outPort === pp.dp && x.remIp === ip.src && (icmp || x.remPort === pp.sp));
  if (!e && !icmp) {
    const kind = l4.kind;
    const fw = (nat.forwards || []).find(f => (f.proto || 'tcp') === kind && Number(f.port) === pp.dp && isIp(f.to));
    if (fw) {
      e = { proto: ip.proto, inIp: fw.to, inPort: Number(fw.toPort || fw.port), outIp, outPort: pp.dp, remIp: ip.src, remPort: pp.sp, kind: 'forward', t: l3.sim.time };
      t.push(e);
      l3.dev.record('info', `NAT: port forward ${kind.toUpperCase()} ${outIp}:${pp.dp} → ${e.inIp}:${e.inPort} for ${ip.src}`, { frame, tag: 'nat-new', data: { inIp: e.inIp, outPort: pp.dp, kind: 'forward' } });
    }
  }
  if (!e) return null;
  const p = clone(ip);
  p.dst = e.inIp;
  setPorts(p, undefined, e.inPort);
  if (icmp) p.l4.ident = e.inPort;
  l3.dev.record('fwd', `NAT: ${ip.src} → ${outIp}:${pp.dp} belongs to ${e.inIp}:${e.inPort}, translated back`, { frame, tag: 'nat-in', data: { to: e.inIp } });
  return p;
}

// ================================================================ VRRP (RFC 5798, simplified)
export const VRRP_TIMING = { adv: 1000 };
export const vrrpMac = vrid => `00:00:5e:00:01:${hex2(vrid)}`;

export class Vrrp {
  constructor(dev) {
    this.dev = dev; this.sim = dev.sim; this.l3 = dev.l3; this.gen = 0;
    this.groups = [];
  }
  get cfg() { return this.dev.cfg; }
  start() {
    this.stop();
    const gen = ++this.gen;
    this.groups = (this.cfg.vrrp || []).filter(g => g.ifname && Number(g.vrid) >= 1 && Number(g.vrid) <= 255 && isIp(g.vip))
      .map(g => ({ ifname: g.ifname, vrid: Number(g.vrid), vip: g.vip, prio: Math.min(254, Math.max(1, Number(g.priority ?? 100))), preempt: g.preempt !== false,
        state: 'init', master: null, timer: null, adv: null, gen }));
    for (const g of this.groups) this.up(g);
  }
  stop() { this.gen++; for (const g of this.groups) { this.sim.cancel(g.timer); this.sim.cancel(g.adv); } }
  skew(g) { return (256 - g.prio) * VRRP_TIMING.adv / 256; }
  ready(g) { return this.l3.linkUp(g.ifname) && !!this.l3.ifIp(g.ifname); }
  up(g) {
    if (!this.ready(g)) { g.state = 'init'; return; }
    this.backup(g, 'starts');
  }
  backup(g, why) {
    const was = g.state;
    this.sim.cancel(g.adv); g.adv = null;
    g.state = 'backup';
    if (was !== 'backup') this.dev.record('info', `VRRP ${g.vrid} on ${g.ifname}: Backup (${why}), waits for advertisements of the master`, { tag: 'vrrp-state', data: { vrid: g.vrid, state: 'backup' } });
    this.armDown(g, 3 * VRRP_TIMING.adv + this.skew(g));
  }
  armDown(g, ms) {
    this.sim.cancel(g.timer);
    const gen = this.gen;
    g.timer = this.sim.schedule(ms, () => { if (gen === this.gen && g.state === 'backup' && this.ready(g)) this.becomeMaster(g); });
  }
  becomeMaster(g) {
    this.sim.cancel(g.timer); g.timer = null;
    g.state = 'master'; g.master = this.l3.ifIp(g.ifname);
    this.dev.record('ok', `VRRP ${g.vrid} on ${g.ifname}: becomes Master for ${g.vip} (priority ${g.prio}) and announces it with a gratuitous ARP`, { tag: 'vrrp-state', data: { vrid: g.vrid, state: 'master', vip: g.vip } });
    const vm = vrrpMac(g.vrid);
    this.l3.sendFrame(g.ifname, BCAST, 'arp', arpPacket(1, vm, g.vip, null, g.vip), vm);
    this.advertise(g);
  }
  advertise(g) {
    if (g.state !== 'master') return;
    if (!this.ready(g)) { g.state = 'init'; return; }
    const pkt = ipPacket({ src: this.l3.ifIp(g.ifname), dst: '224.0.0.18', ttl: 255, proto: PROTO.VRRP, l4: { kind: 'vrrp', version: 3, vrid: g.vrid, prio: g.prio, adv: VRRP_TIMING.adv / 1000, vips: [g.vip] } });
    this.l3.sendFrame(g.ifname, VRRP_MAC, 'ipv4', pkt, vrrpMac(g.vrid));
    const gen = this.gen;
    g.adv = this.sim.schedule(VRRP_TIMING.adv, () => { if (gen === this.gen) this.advertise(g); });
  }
  onAdvert(ip, ifname, frame) {
    const a = ip.l4;
    const g = this.groups.find(x => x.ifname === ifname && x.vrid === a.vrid);
    if (!g || g.state === 'init') return;
    const higher = a.prio > g.prio || (a.prio === g.prio && ipCmp(ip.src, this.l3.ifIp(ifname)) > 0);
    if (g.state === 'master') {
      if (higher) { g.master = ip.src; this.backup(g, `${ip.src} has priority ${a.prio}`); }
      return;
    }
    if (a.prio === 0) { this.armDown(g, this.skew(g)); return; }
    if (!g.preempt || a.prio >= g.prio || higher) {
      if (g.master !== ip.src) { g.master = ip.src; this.dev.record('learn', `VRRP ${g.vrid}: ${ip.src} is Master (priority ${a.prio})`, { frame, tag: 'vrrp-master-seen', data: { vrid: g.vrid, master: ip.src } }); }
      this.armDown(g, 3 * VRRP_TIMING.adv + this.skew(g));
    }
    // A lower priority master and preemption on: the timer is not reset, this router takes over
  }
  onLink(ifname, up) {
    for (const g of this.groups.filter(x => x.ifname === ifname)) {
      if (!up) {
        this.sim.cancel(g.timer); this.sim.cancel(g.adv);
        if (g.state !== 'init') this.dev.record('err', `VRRP ${g.vrid} on ${ifname}: link down, leaves the group`, { tag: 'vrrp-state', data: { vrid: g.vrid, state: 'init' } });
        g.state = 'init';
      } else if (g.state === 'init') this.up(g);
    }
  }
  /** Group that is master on this interface and answers for the virtual MAC */
  masterOn(ifname) { return this.groups.find(g => g.ifname === ifname && g.state === 'master'); }
  ownsIp(ip) { return this.groups.some(g => g.state === 'master' && g.vip === ip); }
  vipGroup(ip, ifname) { return this.groups.find(g => g.state === 'master' && g.vip === ip && (!ifname || g.ifname === ifname)); }
  accepts(ifname, mac) { return this.groups.some(g => g.ifname === ifname && g.state === 'master' && vrrpMac(g.vrid) === mac); }
  table() { return this.groups.map(g => ({ ifname: g.ifname, vrid: g.vrid, vip: g.vip, prio: g.prio, preempt: g.preempt, state: g.state, master: g.state === 'master' ? this.l3.ifIp(g.ifname) : g.master, vmac: vrrpMac(g.vrid) })); }
}

// ================================================================ OSPF (single area, point-to-point style adjacencies)
export const OSPF_TIMERS = { standard: { hello: 10, dead: 40 }, fast: { hello: 1, dead: 4 } };
export const OSPF_COST = 10;

export class Ospf {
  constructor(dev) {
    this.dev = dev; this.sim = dev.sim; this.l3 = dev.l3; this.gen = 0;
    this.nbrs = new Map(); this.lsdb = new Map(); this.routes = []; this.seq = 0; this.helloTimer = null; this.spfTimer = null;
  }
  get cfg() { return this.dev.cfg.ospf || {}; }
  get enabled() { return !!this.cfg.enabled; }
  timers() { return OSPF_TIMERS[this.cfg.timers] || OSPF_TIMERS.fast; }
  get rid() {
    if (isIp(this.cfg.rid)) return this.cfg.rid;
    const ips = this.l3.ifaces().map(i => i.ip).sort(ipCmp);
    const lo = this.l3.ifaces().find(i => i.name === 'lo');
    return lo?.ip || ips[ips.length - 1] || '0.0.0.0';
  }
  /** Interfaces taking part: { name, ip, prefix, cost, passive } */
  ifs() {
    const conf = this.cfg.ifaces || {};
    return this.l3.ifaces().filter(i => conf[i.name]?.enabled).map(i => ({ ...i, cost: Number(conf[i.name].cost || OSPF_COST), passive: i.name === 'lo' || !!conf[i.name].passive }));
  }
  start() {
    this.stop();
    this.nbrs = new Map(); this.lsdb = new Map(); this.routes = [];
    if (!this.enabled) return;
    const gen = ++this.gen;
    this.dev.record('info', `OSPF starts with router ID ${this.rid} on ${this.ifs().map(i => i.name).join(', ') || 'no interface'}`, { tag: 'ospf-start' });
    this.originate();
    const tick = () => { if (gen !== this.gen) return; this.sendHellos(); this.helloTimer = this.sim.schedule(this.timers().hello * 1000, tick); };
    this.helloTimer = this.sim.schedule(20 + this.sim.random() * 30, tick);
  }
  stop() {
    this.gen++;
    this.sim.cancel(this.helloTimer); this.sim.cancel(this.spfTimer);
    this.helloTimer = null; this.spfTimer = null;
    for (const n of this.nbrs.values()) this.sim.cancel(n.dead);
    if (this.routes.length) { this.routes = []; }
  }
  sendHellos() {
    const t = this.timers();
    for (const i of this.ifs()) {
      if (i.passive || !this.l3.linkUp(i.name)) continue;
      const seen = [...this.nbrs.values()].filter(n => n.ifname === i.name).map(n => n.rid);
      const pkt = ipPacket({ src: i.ip, dst: '224.0.0.5', ttl: 1, proto: PROTO.OSPF,
        l4: { kind: 'ospf', type: 'hello', rid: this.rid, area: '0.0.0.0', hello: t.hello, dead: t.dead, prefix: i.prefix, nbrs: seen } });
      this.l3.sendFrame(i.name, OSPF_MAC, 'ipv4', pkt);
    }
  }
  key(ifname, rid) { return `${ifname}|${rid}`; }
  onPacket(ip, ifname, frame) {
    if (!this.enabled) return;
    const i = this.ifs().find(x => x.name === ifname);
    const o = ip.l4;
    if (!i || i.passive) return;
    if (o.rid === this.rid) return;
    if (o.type === 'hello') return this.onHello(ip, i, frame);
    if (o.type === 'lsu') {
      const n = this.nbrs.get(this.key(ifname, o.rid));
      if (!n || n.state === 'Init') return;
      if (n.state !== 'Full') this.setState(n, 'Full', 'database synchronized');
      for (const l of o.lsas) this.install(l, n, frame);
    }
  }
  onHello(ip, i, frame) {
    const o = ip.l4, t = this.timers();
    if (o.hello !== t.hello || o.dead !== t.dead) {
      this.dev.record('err', `OSPF: hello from ${ip.src} on ${i.name} ignored, timers differ (hello ${o.hello}/${t.hello} s, dead ${o.dead}/${t.dead} s)`, { frame, tag: 'ospf-mismatch', data: { what: 'timers', from: ip.src } });
      return;
    }
    if (!inNet(ip.src, intToIp(netOf(i.ip, i.prefix)), i.prefix) || o.prefix !== i.prefix) {
      this.dev.record('err', `OSPF: hello from ${ip.src} on ${i.name} ignored, it is not in my subnet ${intToIp(netOf(i.ip, i.prefix))}/${i.prefix}`, { frame, tag: 'ospf-mismatch', data: { what: 'subnet', from: ip.src } });
      return;
    }
    const k = this.key(i.name, o.rid);
    let n = this.nbrs.get(k);
    if (!n) { n = { rid: o.rid, ip: ip.src, ifname: i.name, state: 'Down', dead: null }; this.nbrs.set(k, n); }
    n.ip = ip.src;
    this.sim.cancel(n.dead);
    const gen = this.gen;
    n.dead = this.sim.schedule(t.dead * 1000, () => { if (gen === this.gen && this.nbrs.get(k) === n) this.down(n, `no hello for ${t.dead} s (dead interval)`); });
    const sees = o.nbrs.includes(this.rid);
    if (n.state === 'Down') this.setState(n, 'Init', `hello from ${ip.src} received`);
    if (sees && n.state === 'Init') {
      this.setState(n, '2-Way', 'it sees me in its hello');
      this.setState(n, 'Exchange', 'exchanges the link-state database');
      // Hello first, so the neighbor reaches 2-Way before the database arrives
      this.sendHellos();
      this.sendLsu(n.ifname, [...this.lsdb.values()]);
    } else if (!sees && n.state !== 'Init' && n.state !== 'Down') {
      this.setState(n, 'Init', 'it no longer lists me in its hello');
      this.originate();
    }
  }
  setState(n, s, why) {
    const prev = n.state;
    n.state = s;
    const ok = s === 'Full';
    this.dev.record(ok ? 'ok' : 'info', `OSPF neighbor ${n.rid} (${n.ip} on ${n.ifname}): ${prev} → ${s}, ${why}`, { tag: 'ospf-neighbor', data: { rid: n.rid, state: s, ifname: n.ifname } });
    if (ok) { this.sendLsu(n.ifname, [...this.lsdb.values()]); this.originate(); }
  }
  down(n, why) {
    this.sim.cancel(n.dead);
    this.nbrs.delete(this.key(n.ifname, n.rid));
    this.dev.record('err', `OSPF neighbor ${n.rid} (${n.ifname}): ${n.state} → Down, ${why}`, { tag: 'ospf-neighbor', data: { rid: n.rid, state: 'Down', ifname: n.ifname } });
    this.originate();
  }
  onLink(ifname, up) {
    if (!this.enabled) return;
    if (!up) for (const n of [...this.nbrs.values()]) if (n.ifname === ifname) this.down(n, 'link down');
    this.originate();
  }
  /** Own router LSA: a link to each full neighbor and a stub per network */
  originate() {
    if (!this.enabled) return;
    const links = [];
    for (const i of this.ifs()) {
      if (i.name !== 'lo' && !this.l3.linkUp(i.name)) continue;
      for (const n of this.nbrs.values()) if (n.ifname === i.name && n.state === 'Full') links.push({ type: 'router', rid: n.rid, cost: i.cost, ifname: i.name });
      links.push({ type: 'stub', net: intToIp(netOf(i.ip, i.prefix)), len: i.prefix, cost: i.name === 'lo' ? 0 : i.cost });
    }
    const lsa = { rid: this.rid, seq: ++this.seq, links };
    const old = this.lsdb.get(this.rid);
    if (old && old.seq >= lsa.seq) lsa.seq = this.seq = old.seq + 1;
    this.lsdb.set(this.rid, lsa);
    this.flood(lsa, null);
    this.scheduleSpf();
  }
  install(lsa, from, frame) {
    const cur = this.lsdb.get(lsa.rid);
    if (lsa.rid === this.rid) { if (lsa.seq >= this.seq) { this.seq = lsa.seq; this.originate(); } return; }
    if (cur && cur.seq >= lsa.seq) return;
    this.lsdb.set(lsa.rid, clone(lsa));
    this.dev.record('learn', `OSPF: router LSA of ${lsa.rid} (sequence ${lsa.seq}, ${lsa.links.length} links) installed`, { frame, tag: 'ospf-lsa', data: { rid: lsa.rid } });
    this.flood(lsa, from);
    this.scheduleSpf();
  }
  flood(lsa, from) {
    const ifs = new Set([...this.nbrs.values()].filter(n => n.state === 'Full' || n.state === 'Exchange').map(n => n.ifname));
    if (from) ifs.delete(from.ifname);
    for (const ifname of ifs) this.sendLsu(ifname, [lsa]);
  }
  sendLsu(ifname, lsas) {
    if (!lsas.length) return;
    const src = this.l3.ifIp(ifname);
    if (!src) return;
    const pkt = ipPacket({ src, dst: '224.0.0.5', ttl: 1, proto: PROTO.OSPF, l4: { kind: 'ospf', type: 'lsu', rid: this.rid, area: '0.0.0.0', lsas: clone(lsas) } });
    this.l3.sendFrame(ifname, OSPF_MAC, 'ipv4', pkt);
  }
  scheduleSpf() {
    if (this.spfTimer) return;
    const gen = this.gen;
    this.spfTimer = this.sim.schedule(50, () => { this.spfTimer = null; if (gen === this.gen) this.spf(); });
  }
  /** Dijkstra over the router LSAs, links only count when both ends list each other */
  spf() {
    const me = this.rid, dist = new Map([[me, 0]]), first = new Map(), done = new Set();
    const linksOf = rid => this.lsdb.get(rid)?.links || [];
    while (true) {
      let u = null;
      for (const [r, d] of dist) if (!done.has(r) && (u === null || d < dist.get(u) || (d === dist.get(u) && ipCmp(r, u) < 0))) u = r;
      if (u === null) break;
      done.add(u);
      for (const l of linksOf(u)) {
        if (l.type !== 'router' || !linksOf(l.rid).some(b => b.type === 'router' && b.rid === u)) continue;
        const nd = dist.get(u) + l.cost;
        if (!dist.has(l.rid) || nd < dist.get(l.rid)) {
          dist.set(l.rid, nd);
          first.set(l.rid, u === me ? { rid: l.rid, ifname: l.ifname } : first.get(u));
        }
      }
    }
    const connected = this.l3.ifaces().map(i => `${intToIp(netOf(i.ip, i.prefix))}/${i.prefix}`);
    const best = new Map();
    for (const [r, d] of dist) {
      if (r === me) continue;
      const hop = first.get(r);
      const n = hop && [...this.nbrs.values()].find(x => x.rid === hop.rid && x.ifname === hop.ifname && x.state === 'Full');
      if (!n) continue;
      for (const l of linksOf(r)) {
        if (l.type !== 'stub') continue;
        const k = `${l.net}/${l.len}`;
        if (connected.includes(k)) continue;
        const cost = d + l.cost;
        const cur = best.get(k);
        if (!cur || cost < cur.cost) best.set(k, { net: l.net, len: l.len, via: n.ip, dev: n.ifname, cost, adv: r });
      }
    }
    const routes = [...best.values()].sort((a, b) => ipCmp(a.net, b.net) || a.len - b.len);
    const fmt = rs => new Set(rs.map(x => `${x.net}/${x.len} via ${x.via} cost ${x.cost}`));
    const before = fmt(this.routes), after = fmt(routes);
    const added = [...after].filter(x => !before.has(x)), removed = [...before].filter(x => !after.has(x));
    this.routes = routes;
    if (added.length || removed.length) {
      const parts = [];
      if (added.length) parts.push(`new: ${added.join('; ')}`);
      if (removed.length) parts.push(`gone: ${removed.join('; ')}`);
      this.dev.record('learn', `OSPF: SPF computed, ${routes.length} route${routes.length === 1 ? '' : 's'}. ${parts.join('. ')}`, { tag: 'ospf-spf', data: { routes: routes.length, added: added.length, removed: removed.length } });
      this.sim.emit('config', this.dev.id);
    }
  }
  neighborTable() { return [...this.nbrs.values()].map(n => ({ rid: n.rid, ip: n.ip, ifname: n.ifname, state: n.state })); }
}
