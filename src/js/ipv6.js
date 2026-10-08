// IPv6 next to IPv4: addresses (link-local, static, SLAAC), Neighbor Discovery (NS/NA with
// solicited-node multicast, duplicate address detection, unreachability detection),
// router advertisements, routing and forwarding, ICMPv6. Attached to every L3 as l3.v6.
import { PROTO, parse6, fmt6, isIp6, norm6, inNet6, parseCidr6, linkLocalFor, slaacFor, isLinkLocal6, isMcast6,
  solicitedNode, mcastMac6, ALL_NODES, ALL_ROUTERS, clone, zoneOf6 } from './net.js';
import { ipPacket, icmp6 } from './packets.js';

export const T6 = { dad: 1000, ndRetry: 1000, ndTries: 3, reachable: 30000, delay: 5000, rsRetry: 4000, rsTries: 3, raInterval: 30000, routerLifetime: 1800 };
export const ICMP6_TEXT = {
  '1/0': 'Destination unreachable: No route', '1/1': 'Destination unreachable: Administratively prohibited', '1/3': 'Destination unreachable: Address unreachable',
  '1/4': 'Destination unreachable: Port unreachable', '2/0': 'Packet too big', '3/0': 'Time exceeded: Hop limit', '128/0': 'Echo Request', '129/0': 'Echo Reply',
  '133/0': 'Router Solicitation', '134/0': 'Router Advertisement', '135/0': 'Neighbor Solicitation', '136/0': 'Neighbor Advertisement'
};
export const icmp6Name = (t, c) => ICMP6_TEXT[`${t}/${c}`] || `ICMPv6 type ${t} code ${c}`;
// ICMPv6 errors in the numbers of ICMPv4, so ping, traceroute and curl can share their handling
const V4_EQUIV = { '1/0': [3, 0], '1/1': [3, 13], '1/3': [3, 1], '1/4': [3, 3], '3/0': [11, 0], '2/0': [3, 4] };

/** Static IPv6 addresses of an interface, from "2001:db8::1/64" strings */
export function staticAddrs(ifc) {
  return (Array.isArray(ifc?.ip6) ? ifc.ip6 : String(ifc?.ip6 || '').split(/[\s,]+/)).map(s => {
    const [a, l] = String(s).trim().split('/');
    return isIp6(a) && !isLinkLocal6(a) ? { ip: norm6(a), len: l === undefined ? 64 : Number(l) } : null;
  }).filter(Boolean);
}

export class Ip6 {
  constructor(l3) { this.l3 = l3; this.dev = l3.dev; this.sim = l3.sim; this.timers = []; this.reset(); }
  reset() {
    this.nd = new Map(); this.pending = new Map(); this.slaac = new Map(); this.routers = new Map();
    this.rdnss = []; this.state = new Map(); this.rsTries = 0; this.raSeen = false;
    for (const t of this.timers || []) this.sim.cancel(t);
    this.timers = [];
  }
  get cfg() { return this.l3.cfg; }
  get on() { return !!this.cfg.ipv6?.enabled; }
  get isRouter() { return this.cfg.type === 'router'; }
  later(ms, fn) { const ev = this.sim.schedule(ms, () => { this.timers = this.timers.filter(x => x !== ev); fn(); }); this.timers.push(ev); return ev; }
  rec(kind, text, extra) { return this.dev.record(kind, text, extra); }

  // ---- Addresses
  ifnames() {
    if (!this.on) return [];
    return Object.entries(this.cfg.ifaces || {}).filter(([n, v]) => n !== 'lo' && !v.parent
      && (this.cfg.type !== 'router' || !!this.sim.linkAt(this.dev.id, n) || staticAddrs(v).length)).map(([n]) => n);
  }
  /** Every address of an interface with its state: tentative (DAD running), preferred, duplicate */
  addrs(ifname) {
    if (!this.on) return [];
    const st = ip => this.state.get(ifname + '|' + ip) || 'tentative';
    const ll = linkLocalFor(this.dev.mac(ifname));
    const out = [{ ip: ll, len: 64, scope: 'link', origin: 'kernel', state: st(ll) }];
    for (const a of staticAddrs(this.cfg.ifaces?.[ifname])) out.push({ ...a, scope: 'global', origin: 'static', state: st(a.ip) });
    for (const a of this.slaac.get(ifname) || []) if (!out.some(o => o.ip === a.ip)) out.push({ ...a, scope: 'global', origin: 'slaac', state: st(a.ip) });
    return out;
  }
  allAddrs() { return this.ifnames().flatMap(n => this.addrs(n).map(a => ({ ...a, ifname: n }))); }
  usable(a) { return a.state === 'preferred'; }
  hasGlobal() { return this.allAddrs().some(a => a.scope === 'global' && this.usable(a)); }
  isOwn(ip) {
    if (!this.on || !isIp6(ip)) return false;
    const n = norm6(ip);
    return this.allAddrs().some(a => a.ip === n && this.usable(a)) || this.joinedGroup(n);
  }
  joinedGroup(g) {
    if (g === ALL_NODES) return true;
    if (g === ALL_ROUTERS) return this.isRouter;
    return this.allAddrs().some(a => solicitedNode(a.ip) === g);
  }
  /** Multicast MACs this device listens to */
  acceptsMac(mac) {
    if (!this.on) return false;
    if (mac === '33:33:00:00:00:01') return true;
    if (mac === '33:33:00:00:00:02') return this.isRouter;
    return this.allAddrs().some(a => mcastMac6(solicitedNode(a.ip)) === mac);
  }
  ifAddr(ifname, preferGlobal = true, near = null) {
    const list = this.addrs(ifname).filter(a => this.usable(a));
    if (near) { const m = list.find(a => a.scope === 'global' && inNet6(near, a.ip, a.len)); if (m) return m.ip; }
    return (preferGlobal ? list.find(a => a.scope === 'global') : null)?.ip || list.find(a => a.scope === 'link')?.ip || null;
  }
  srcFor(dst, ifname = null) {
    if (isLinkLocal6(dst) || isMcast6(dst)) return this.ifAddr(ifname || this.lookup(dst)?.dev || this.ifnames()[0], false) || '::';
    const r = this.lookup(dst);
    return (r && this.ifAddr(r.dev, true, dst)) || this.allAddrs().find(a => a.scope === 'global' && this.usable(a))?.ip || this.ifAddr(this.ifnames()[0], false) || '::';
  }

  // ---- Routing
  routes() {
    const out = [];
    for (const n of this.ifnames()) {
      if (!this.l3.linkUp(n)) continue;
      out.push({ net: 'fe80::', len: 64, via: null, dev: n, proto: 'C', ll: true });
      for (const a of this.addrs(n)) if (a.scope === 'global' && this.usable(a)) {
        const c = parseCidr6(`${a.ip}/${a.len}`);
        if (!out.some(r => r.proto === 'C' && r.net === c.net && r.len === c.len && r.dev === n)) out.push({ net: c.net, len: c.len, via: null, dev: n, proto: a.origin === 'slaac' ? 'K' : 'C', src: a.ip });
      }
    }
    const statics = (this.cfg.routes || []).filter(r => parseCidr6(r.dst === 'default6' ? '::/0' : r.dst) && isIp6(r.via));
    if (this.cfg.ipv6?.gw && isIp6(this.cfg.ipv6.gw)) statics.push({ dst: '::/0', via: this.cfg.ipv6.gw, dev: this.cfg.ipv6.gwDev || null, auto: true });
    for (const r of statics) {
      const p = parseCidr6(r.dst === 'default6' ? '::/0' : r.dst);
      const via = norm6(r.via);
      let dev = null;
      if (isLinkLocal6(via)) dev = r.dev && this.ifnames().includes(r.dev) && this.l3.linkUp(r.dev) ? r.dev : (this.ifnames().length === 1 && this.l3.linkUp(this.ifnames()[0]) ? this.ifnames()[0] : null);
      else dev = out.find(c => c.proto !== 'S' && !c.ll && c.via === null && inNet6(via, c.net, c.len))?.dev || null;
      out.push({ net: p.net, len: p.len, via, dev, proto: 'S', active: !!dev, auto: r.auto, distance: Number(r.distance) > 0 ? Number(r.distance) : 1 });
    }
    for (const r of this.routers.values()) {
      if (r.until <= this.sim.time || !this.l3.linkUp(r.ifname)) continue;
      out.push({ net: '::', len: 0, via: r.ip, dev: r.ifname, proto: 'RA', metric: 1024, until: r.until });
    }
    return out;
  }
  lookupAll(dst) {
    const ad = r => r.proto === 'S' ? r.distance || 1 : { C: 0, K: 0, RA: 2 }[r.proto] ?? 255;
    let best = [];
    const better = (a, b) => a.len !== b.len ? a.len > b.len : ad(a) < ad(b);
    for (const r of this.routes()) {
      if (!r.dev || r.ll || !inNet6(dst, r.net, r.len)) continue;
      if (!best.length || better(r, best[0])) best = [r];
      else if (!better(best[0], r) && !best.some(b => b.via === r.via && b.dev === r.dev)) best.push(r);
    }
    return best;
  }
  lookup(dst, pkt = null) {
    if (!isIp6(dst)) return null;
    if (isLinkLocal6(dst) || isMcast6(dst)) {
      // Link-local addresses need the interface: ping fe80::1%eth1 (with one interface it is obvious)
      const z = zoneOf6(dst) || pkt?.zone;
      const names = this.ifnames().filter(n => this.l3.linkUp(n));
      const dev = z ? names.find(n => n === z) : names.length === 1 ? names[0] : null;
      return dev ? { net: 'fe80::', len: 64, via: null, dev, proto: 'C', ll: true } : null;
    }
    const all = this.lookupAll(norm6(dst));
    if (all.length <= 1 || !pkt) return all[0] || null;
    return all[0];
  }

  // ---- Sending
  output(pkt, ctx = {}) {
    if (!this.on) return { ok: false, error: 'IPv6 is turned off on this device' };
    if (this.isOwn(pkt.dst) && !isMcast6(pkt.dst)) { this.sim.schedule(0.01, () => this.l3.deliver(pkt, 'lo')); return { ok: true }; }
    if (isMcast6(pkt.dst)) {
      const ifn = ctx.ifname || this.lookup(pkt.dst, pkt)?.dev;
      if (!ifn) return { ok: false, error: 'connect: Invalid argument (a multicast or link-local address needs an interface, e.g. %eth1)' };
      this.sendFrame(ifn, mcastMac6(pkt.dst), pkt);
      return { ok: true };
    }
    const r = this.lookup(pkt.dst, pkt);
    if (!r) {
      if (ctx.forwarded) { this.rec('drop', `no IPv6 route to ${pkt.dst}, sends ICMPv6 Destination Unreachable (no route) to ${pkt.src}`, { tag: 'no-route', data: { dst: pkt.dst } }); this.icmpError(pkt, 1, 0); }
      else this.rec('err', isLinkLocal6(pkt.dst) ? `${pkt.dst} is link-local: which interface? (e.g. ${pkt.dst}%eth1)` : `no IPv6 route to ${pkt.dst}: Network is unreachable`, { tag: 'no-route', data: { dst: pkt.dst } });
      return { ok: false, error: isLinkLocal6(pkt.dst) ? 'connect: Invalid argument (add %eth1)' : 'Network is unreachable' };
    }
    const mtu = Math.min(this.l3.mtu(r.dev), ctx.forwarded ? Infinity : this.l3.pmtu.get(norm6(pkt.dst)) || Infinity);
    if (pkt.totalLength > mtu && !ctx.forwarded && !pkt.noFrag && !pkt.frag) {
      // Only the sender may fragment in IPv6, with a fragment header (8 bytes) in every piece
      const frags = this.fragment(pkt, mtu);
      this.rec('info', `IPv6 packet (${pkt.totalLength} bytes) larger than the path MTU ${mtu}: the sender splits it into ${frags.length} fragments (fragment header)`, { tag: 'fragmented', data: { count: frags.length, mtu, v6: true } });
      for (const f of frags) this.l2send(f, r.dev, r.via || norm6(pkt.dst));
      return { ok: true };
    }
    if (pkt.totalLength > mtu) {
      // IPv6 routers never fragment: the sender has to send smaller packets
      if (ctx.forwarded) {
        this.rec('drop', `IPv6 packet (${pkt.totalLength} bytes) larger than MTU ${mtu} of ${r.dev}: dropped, ICMPv6 Packet Too Big to ${pkt.src} (IPv6 routers never fragment)`, { tag: 'frag-needed-sent', data: { mtu, v6: true } });
        this.icmpError(pkt, 2, 0, { mtu });
      }
      return { ok: false, error: `message too long, mtu=${mtu}`, mtu };
    }
    this.l2send(pkt, r.dev, r.via || norm6(pkt.dst));
    return { ok: true };
  }
  sendFrame(ifname, mac, pkt) { this.l3.sendFrame(ifname, mac, 'ipv6', pkt); }
  fragment(pkt, mtu) {
    const total = pkt.totalLength - 40, chunk = Math.floor((mtu - 48) / 8) * 8, out = [];
    for (let off = 0; off < total; off += chunk) {
      const len = Math.min(chunk, total - off), first = off === 0;
      const f = { ...clone(pkt), fragOffset: off, mf: off + len < total, l4: first ? clone(pkt.l4) : null, frag: { first, len, total, origL4: clone(pkt.l4), v6: true } };
      f.totalLength = 48 + len;
      out.push(f);
    }
    return out;
  }
  l2send(pkt, egress, nh) {
    const e = this.nd.get(nh);
    if (e && e.mac && e.ifname === egress && e.state !== 'INCOMPLETE') {
      this.sendFrame(egress, e.mac, pkt);
      this.nudCheck(nh, e);
      return;
    }
    if (!this.pending.has(nh)) this.pending.set(nh, []);
    this.pending.get(nh).push({ pkt, egress });
    if (!e || e.state !== 'INCOMPLETE') this.solicit(nh, egress);
  }
  /** Neighbor Solicitation to the solicited-node group of the target: like an ARP request, but multicast */
  solicit(nh, egress) {
    const entry = { mac: null, ifname: egress, t: this.sim.time, state: 'INCOMPLETE', tries: 0 };
    this.nd.set(nh, entry);
    const ask = () => {
      if (this.nd.get(nh) !== entry || entry.mac) return;
      if (entry.tries >= T6.ndTries) {
        this.nd.delete(nh);
        this.rec('err', `no Neighbor Advertisement from ${nh} after ${T6.ndTries} solicitations: address unreachable`, { tag: 'nd-failed', data: { ip: nh } });
        const q = this.pending.get(nh) || [];
        this.pending.delete(nh);
        for (const { pkt } of q) {
          if (this.isOwn(pkt.src)) for (const s of [...this.l3.sessions]) s.onArpFail?.(pkt);
          else this.icmpError(pkt, 1, 3);
        }
        return;
      }
      entry.tries++;
      const src = this.ifAddr(egress, true, nh) || this.ifAddr(egress, false);
      const g = solicitedNode(nh);
      this.rec('info', `does not know the MAC of ${nh} and asks its solicited-node group ${g} (Neighbor Solicitation, attempt ${entry.tries})`, { tag: 'ns-sent', data: { ip: nh } });
      this.sendFrame(egress, mcastMac6(g), ipPacket({ src, dst: g, ttl: 255, proto: PROTO.ICMP6, l4: icmp6(135, 0, { target: nh, slla: this.dev.mac(egress) }) }));
      this.later(T6.ndRetry, ask);
    };
    ask();
  }
  nudCheck(nh, e) {
    if (this.sim.time - e.t <= T6.reachable || e.probing) return;
    e.probing = true; e.state = 'DELAY';
    this.later(T6.delay, () => {
      if (this.nd.get(nh) !== e) return;
      if (this.sim.time - e.t <= T6.reachable) { e.probing = false; e.state = 'REACHABLE'; return; }
      e.state = 'PROBE';
      let n = 0;
      const probe = () => {
        if (this.nd.get(nh) !== e) return;
        if (this.sim.time - e.t <= T6.reachable) { e.probing = false; e.state = 'REACHABLE'; return; }
        if (n++ >= T6.ndTries) { this.nd.delete(nh); this.rec('err', `${nh} no longer answers at ${e.mac}: neighbor entry deleted (FAILED)`, { tag: 'nud-failed', data: { ip: nh } }); return; }
        this.rec('info', `checks with a unicast Neighbor Solicitation whether ${nh} is still at ${e.mac} (probe ${n})`, { tag: 'nud-probe', data: { ip: nh } });
        this.sendFrame(e.ifname, e.mac, ipPacket({ src: this.ifAddr(e.ifname, true, nh), dst: nh, ttl: 255, proto: PROTO.ICMP6, l4: icmp6(135, 0, { target: nh, slla: this.dev.mac(e.ifname) }) }));
        this.later(T6.ndRetry, probe);
      };
      probe();
    });
  }
  learn(ip, mac, ifname, state, how, router = null) {
    const old = this.nd.get(ip);
    const changed = !old || old.mac !== mac;
    this.nd.set(ip, { mac, ifname, t: state === 'REACHABLE' ? this.sim.time : (old?.t ?? this.sim.time - T6.reachable - 1), state, router: router ?? old?.router ?? false });
    if (changed) this.rec('learn', `adds ${ip} → ${mac} to the neighbor cache (${how})`, { tag: 'nd-learned', data: { ip, mac } });
    const q = this.pending.get(ip);
    if (q) { this.pending.delete(ip); for (const { pkt, egress } of q) this.sendFrame(egress, mac, pkt); }
  }
  neighborTable() {
    return [...this.nd.entries()].map(([ip, e]) => ({ ip, mac: e.mac, ifname: e.ifname, router: !!e.router,
      state: e.state === 'REACHABLE' && this.sim.time - e.t > T6.reachable ? 'STALE' : e.state }));
  }
  icmpError(orig, type, code, extra = {}) {
    if (orig.l4?.kind === 'icmp6' && orig.l4.type < 128) return;
    if (isMcast6(orig.dst) || orig.src === '::') return;
    const o = orig.l4 || {};
    const pkt = ipPacket({ src: this.srcFor(orig.src), dst: orig.src, proto: PROTO.ICMP6,
      l4: icmp6(type, code, { dataLen: Math.min(orig.totalLength, 1232), mtu: extra.mtu, orig: { src: orig.src, dst: orig.dst, proto: orig.proto, ident: o.ident, seq: o.seq, sport: o.sport, dport: o.dport } }) });
    this.output(pkt, {});
  }

  // ---- Receiving
  rx(ifname, ip, frame) {
    if (!this.on) { this.rec('ignore', `receives an IPv6 packet, but IPv6 is turned off: dropped`, { frame, tag: 'v6-off' }); return; }
    const dst = norm6(ip.dst);
    if (isMcast6(dst)) { if (this.joinedGroup(dst)) this.l3.deliver(ip, ifname, frame); return; }
    if (this.isOwn(dst) && ip.frag) return this.l3.reassemble(ip, ifname);
    if (this.isOwn(dst) || (ip.l4?.kind === 'icmp6' && ip.l4.type === 136 && this.addrs(ifname).some(a => a.ip === dst))) return this.l3.deliver(ip, ifname, frame);
    if (!this.isRouter || this.cfg.forwarding === false) { this.rec('drop', `IPv6 packet to ${ip.dst} is not for me, and I do not forward`, { frame, tag: 'not-forwarding' }); return; }
    if (isLinkLocal6(dst)) { this.rec('drop', `IPv6 packet to the link-local address ${ip.dst} is not for me: link-local packets never cross a router`, { frame, tag: 'not-forwarding' }); return; }
    this.forward(ip, ifname, frame);
  }
  forward(ip, inIf, frame) {
    if (isLinkLocal6(ip.src)) { this.rec('drop', `does not forward a packet with the link-local source ${ip.src}: it only exists on its own link`, { frame, tag: 'v6-ll-src' }); return; }
    const m = this.l3.aclMatch(ip);
    if (m && m.rule.action !== 'allow') {
      this.rec('drop', `Rule ${m.index} (${m.rule.action}) matches: IPv6 packet ${ip.src} > ${ip.dst} is not forwarded`, { frame, tag: 'acl-drop', data: { rule: m.index } });
      if (m.rule.action === 'reject') this.icmpError(ip, 1, 1);
      return;
    }
    if (ip.ttl <= 1) {
      this.rec('drop', `hop limit of ${ip.src} > ${ip.dst} expired, sends ICMPv6 Time Exceeded to ${ip.src}`, { frame, tag: 'ttl-expired' });
      this.icmpError(ip, 3, 0);
      return;
    }
    const r = this.lookup(ip.dst, ip);
    const out = clone(ip);
    out.ttl = ip.ttl - 1;
    if (r) this.rec('fwd', `forwards ${ip.src} > ${ip.dst}: IPv6 route ${r.net}/${r.len}${r.via ? ' via ' + r.via : ' direct'} out ${r.dev}, hop limit ${ip.ttl} → ${out.ttl}`,
      { frame, tag: 'forwarded', data: { dst: ip.dst, route: `${r.net}/${r.len}`, from: inIf, to: r.dev, via: r.via, v6: true } });
    this.output(out, { forwarded: true, inIf });
  }
  /** ICMPv6 for this device: echo, errors and Neighbor Discovery */
  deliverIcmp(ip, ifname, frame) {
    const m = ip.l4;
    if (m.type === 135) return this.onNs(ip, ifname, frame);
    if (m.type === 136) return this.onNa(ip, ifname, frame);
    if (m.type === 133) return this.onRs(ip, ifname, frame);
    if (m.type === 134) { for (const s of [...this.l3.sessions]) s.onRa?.(ip, ifname); return this.onRa(ip, ifname, frame); }
    if (m.type === 128) {
      const src = isMcast6(ip.dst) ? this.ifAddr(ifname, !isLinkLocal6(ip.src)) : ip.dst;
      this.rec('ok', `receives Echo Request from ${ip.src} (seq ${m.seq}) and replies`, { frame, tag: 'echo-request-received', data: { from: ip.src, v6: true } });
      const reply = ipPacket({ src, dst: ip.src, proto: PROTO.ICMP6, trace: ip.trace, l4: icmp6(129, 0, { ident: m.ident, seq: m.seq, dataLen: m.dataLen }) });
      if (isLinkLocal6(ip.src)) reply.zone = ifname;
      this.output(reply, { ifname });
      return;
    }
    if (m.type === 129) {
      this.rec('ok', `receives Echo Reply from ${ip.src} (seq ${m.seq})`, { frame, tag: 'echo-reply-received', data: { from: ip.src, size: m.dataLen, v6: true } });
      for (const s of [...this.l3.sessions]) s.onEchoReply?.(ip);
      return;
    }
    if (m.type === 1 || m.type === 2 || m.type === 3) {
      if (m.type === 2 && m.mtu && m.orig) {
        this.l3.pmtu.set(m.orig.dst, m.mtu);
        this.rec('learn', `remembers: path to ${m.orig.dst} has MTU ${m.mtu} (ICMPv6 Packet Too Big)`, { frame, tag: 'pmtu-learned', data: { mtu: m.mtu, v6: true } });
        if (m.orig.proto === PROTO.TCP) this.l3.tcpPmtu(m.orig, m.mtu);
      } else this.rec('err', `receives ICMPv6 ${icmp6Name(m.type, m.code)} from ${ip.src}`, { frame, tag: 'icmp-error-received', data: { type: m.type, code: m.code, v6: true } });
      const [t, c] = V4_EQUIV[`${m.type}/${m.code}`] || [3, 1];
      const shim = { ...ip, l4: { ...m, type: t, code: c, t6: m.type, c6: m.code } };
      for (const s of [...this.l3.sessions]) s.onIcmpError?.(shim);
    }
  }
  onNs(ip, ifname, frame) {
    const m = ip.l4, target = norm6(m.target);
    const mine = this.addrs(ifname).find(a => a.ip === target);
    if (ip.src === '::') {
      // Duplicate address detection by someone else
      if (!mine || frame.src === this.dev.mac(ifname)) return;
      if (mine.state === 'tentative') return this.duplicate(ifname, target, frame);
      this.rec('info', `defends ${target}: another device is testing it (DAD), answers with a Neighbor Advertisement to all nodes`, { frame, tag: 'dad-defend', data: { ip: target } });
      this.sendFrame(ifname, mcastMac6(ALL_NODES), ipPacket({ src: target, dst: ALL_NODES, ttl: 255, proto: PROTO.ICMP6, l4: icmp6(136, 0, { target, tlla: this.dev.mac(ifname), r: this.isRouter, s: false, o: true }) }));
      return;
    }
    if (m.slla) this.learn(norm6(ip.src), m.slla, ifname, 'STALE', 'from the solicitation');
    if (!mine || !this.usable(mine)) return;
    this.rec('info', `answers the Neighbor Solicitation: ${target} is at ${this.dev.mac(ifname)}`, { frame, tag: 'na-sent', data: { ip: target } });
    this.sendFrame(ifname, m.slla || frame.src, ipPacket({ src: target, dst: ip.src, ttl: 255, proto: PROTO.ICMP6, trace: ip.trace, l4: icmp6(136, 0, { target, tlla: this.dev.mac(ifname), r: this.isRouter, s: true, o: true }) }));
  }
  onNa(ip, ifname, frame) {
    const m = ip.l4, target = norm6(m.target);
    const mine = this.addrs(ifname).find(a => a.ip === target);
    if (mine && frame.src !== this.dev.mac(ifname)) { if (mine.state === 'tentative') this.duplicate(ifname, target, frame); return; }
    const e = this.nd.get(target);
    if (!e && !this.pending.has(target)) { this.rec('ignore', `unsolicited Neighbor Advertisement for ${target}: no entry, ignored`, { frame, tag: 'na-ignored' }); return; }
    this.learn(target, m.tlla || frame.src, ifname, m.s ? 'REACHABLE' : 'STALE', m.s ? 'Neighbor Advertisement' : 'unsolicited advertisement', !!m.r);
  }

  // ---- Duplicate address detection
  dad(ifname, ip, then) {
    const key = ifname + '|' + ip;
    this.state.set(key, 'tentative');
    this.rec('info', `tests whether ${ip} is free (duplicate address detection: Neighbor Solicitation from ::)`, { tag: 'dad-start', data: { ip, ifname } });
    this.sendFrame(ifname, mcastMac6(solicitedNode(ip)), ipPacket({ src: '::', dst: solicitedNode(ip), ttl: 255, proto: PROTO.ICMP6, l4: icmp6(135, 0, { target: ip }) }));
    this.later(T6.dad, () => {
      if (this.state.get(key) !== 'tentative') return;
      this.state.set(key, 'preferred');
      this.rec('ok', `${ip} on ${ifname} is unique and usable now`, { tag: 'dad-ok', data: { ip, ifname } });
      this.sim.emit('config', this.dev.id);
      then?.();
    });
  }
  duplicate(ifname, ip, frame) {
    this.state.set(ifname + '|' + ip, 'duplicate');
    this.rec('err', `${ip} is already in use by ${frame.src}: duplicate address detected, the address is not used (dadfailed)`, { frame, tag: 'dad-failed', data: { ip, ifname, by: frame.src } });
    this.sim.emit('config', this.dev.id);
  }

  // ---- Router solicitation and advertisement, SLAAC
  raIfaces() { const ra = this.cfg.ipv6?.ra || []; return this.isRouter ? this.ifnames().filter(n => ra.includes(n)) : []; }
  sendRs(ifname) {
    if (this.raSeen || this.rsTries >= T6.rsTries) return;
    this.rsTries++;
    const src = this.ifAddr(ifname, false) || '::';
    this.rec('info', `asks the routers on ${ifname} for their prefixes: Router Solicitation to ff02::2${this.rsTries > 1 ? ` (attempt ${this.rsTries})` : ''}`, { tag: 'rs-sent' });
    this.sendFrame(ifname, mcastMac6(ALL_ROUTERS), ipPacket({ src, dst: ALL_ROUTERS, ttl: 255, proto: PROTO.ICMP6, l4: icmp6(133, 0, { slla: src === '::' ? null : this.dev.mac(ifname) }) }));
    this.later(T6.rsRetry, () => {
      if (!this.raSeen && this.rsTries >= T6.rsTries) this.rec('err', `no Router Advertisement on ${ifname}: no IPv6 prefix and no default router`, { tag: 'ra-none' });
      this.sendRs(ifname);
    });
  }
  onRs(ip, ifname, frame) {
    if (!this.raIfaces().includes(ifname)) {
      if (this.isRouter) this.rec('ignore', `Router Solicitation on ${ifname}: router advertisements are not turned on for this interface`, { frame, tag: 'rs-ignored' });
      return;
    }
    if (ip.l4.slla && ip.src !== '::') this.learn(norm6(ip.src), ip.l4.slla, ifname, 'STALE', 'from the router solicitation');
    this.sendRa(ifname, true);
  }
  sendRa(ifname, solicited = false) {
    const src = this.ifAddr(ifname, false);
    if (!src) return;
    const prefixes = this.addrs(ifname).filter(a => a.scope === 'global' && a.origin === 'static').map(a => ({ prefix: parseCidr6(`${a.ip}/${a.len}`).net, len: a.len, auto: true, valid: 2592000, preferred: 604800 }));
    const rdnss = String(this.cfg.ipv6?.rdnss || '').split(/[\s,]+/).filter(isIp6).map(norm6);
    const ra = icmp6(134, 0, { hopLimit: 64, managed: false, other: false, lifetime: T6.routerLifetime, slla: this.dev.mac(ifname), mtu: this.l3.mtu(ifname), prefixes, rdnss, periodic: !solicited });
    this.rec('info', `${solicited ? 'answers with' : 'sends'} a Router Advertisement on ${ifname}: ${prefixes.length ? 'prefix ' + prefixes.map(p => `${p.prefix}/${p.len}`).join(', ') : 'no prefix'}${rdnss.length ? ', DNS ' + rdnss.join(', ') : ''}, default router ${src}`,
      { tag: solicited ? 'ra-sent' : 'ra-periodic', data: { ifname } });
    this.sendFrame(ifname, mcastMac6(ALL_NODES), ipPacket({ src, dst: ALL_NODES, ttl: 255, proto: PROTO.ICMP6, l4: ra }));
  }
  onRa(ip, ifname, frame) {
    if (this.isRouter) return;
    const m = ip.l4;
    if (!isLinkLocal6(ip.src)) { this.rec('drop', `ignores a Router Advertisement from ${ip.src}: it must come from a link-local address`, { frame, tag: 'ra-bad' }); return; }
    const first = !this.raSeen;
    this.raSeen = true;
    const key = norm6(ip.src) + '|' + ifname;
    if (m.lifetime > 0) {
      const isNew = !this.routers.has(key);
      this.routers.set(key, { ip: norm6(ip.src), ifname, until: this.sim.time + m.lifetime * 1000, mtu: m.mtu });
      if (isNew) this.rec('learn', `uses ${ip.src} as its IPv6 default router (from the Router Advertisement, valid ${m.lifetime} s)`, { frame, tag: 'ra-router', data: { router: ip.src } });
    } else this.routers.delete(key);
    if (m.slla) this.learn(norm6(ip.src), m.slla, ifname, 'STALE', 'from the router advertisement', true);
    if (m.rdnss?.length && m.rdnss.join() !== this.rdnss.join()) { this.rdnss = [...m.rdnss]; this.rec('learn', `learns the DNS server ${m.rdnss.join(', ')} from the Router Advertisement (RDNSS)`, { frame, tag: 'ra-rdnss', data: { dns: m.rdnss } }); }
    if (this.cfg.ipv6?.slaac !== false) {
      const list = this.slaac.get(ifname) || [];
      for (const p of m.prefixes || []) {
        if (!p.auto) continue;
        // The interface ID has 64 bits, so only a /64 adds up to 128 (RFC 4862 5.5.3)
        if (p.len !== 64) {
          const key = `${ifname} ${p.prefix}/${p.len}`;
          if (!(this.slaacIgnored ??= new Set()).has(key)) { this.slaacIgnored.add(key); this.rec('info', `ignores the prefix ${p.prefix}/${p.len} from the Router Advertisement: SLAAC needs a /64, a /${p.len} and a 64-bit interface ID do not add up to 128 bits`, { frame, tag: 'slaac-wrong-length' }); }
          continue;
        }
        const ip6 = slaacFor(p.prefix, this.dev.mac(ifname));
        if (list.some(a => a.ip === ip6)) continue;
        list.push({ ip: ip6, len: 64, prefix: p.prefix });
        this.slaac.set(ifname, list);
        this.rec('learn', `forms ${ip6} from the prefix ${p.prefix}/64 and its MAC ${this.dev.mac(ifname)} (SLAAC, EUI-64)`, { frame, tag: 'slaac-addr', data: { ip: ip6, prefix: p.prefix } });
        this.dad(ifname, ip6);
      }
    }
    if (first) this.sim.emit('config', this.dev.id);
  }

  // ---- Life cycle
  start() {
    this.stop();
    this.snap = this.snapshot();
    if (!this.on) return;
    let k = 0;
    for (const n of this.ifnames()) {
      const delay = 200 + 100 * k++ + this.sim.random() * 200;
      this.later(delay, () => {
        const addrs = this.addrs(n);
        const ll = addrs[0];
        this.dad(n, ll.ip, () => {
          if (!this.isRouter && this.cfg.ipv6?.slaac !== false) this.sendRs(n);
          if (this.raIfaces().includes(n)) this.sendRa(n);
        });
        for (const a of addrs.slice(1)) if (a.origin === 'static') this.dad(n, a.ip);
      });
    }
    if (this.raIfaces().length) {
      const tick = () => { for (const n of this.raIfaces()) this.sendRa(n); this.later(T6.raInterval, tick); };
      this.later(T6.raInterval, tick);
    }
  }
  stop() { for (const t of this.timers) this.sim.cancel(t); this.timers = []; }
  /** A cable was plugged in: the interface tests its addresses, asks for routers or advertises itself */
  onLink(ifname, up) {
    if (!this.on || !up || !this.ifnames().includes(ifname)) return;
    for (const a of this.addrs(ifname)) if (!this.state.has(ifname + '|' + a.ip)) this.dad(ifname, a.ip, a.scope === 'link' ? () => {
      if (!this.isRouter && this.cfg.ipv6?.slaac !== false) { this.rsTries = 0; this.sendRs(ifname); }
      if (this.raIfaces().includes(ifname)) this.sendRa(ifname);
    } : null);
  }
  snapshot() { return JSON.stringify([this.cfg.ipv6, Object.values(this.cfg.ifaces || {}).map(i => i.ip6 || '')]); }
  /** After a configuration change: new addresses run DAD, RA settings take effect, or everything restarts */
  onConfig() {
    const snap = this.snapshot();
    if (snap === this.snap) return;
    const wasOn = this.snap && JSON.parse(this.snap)[0]?.enabled;
    this.snap = snap;
    if (!this.on) { this.stop(); this.nd.clear(); this.routers.clear(); return; }
    if (!wasOn) { this.reset(); return this.start(); }
    this.stop();
    for (const n of this.ifnames()) for (const a of this.addrs(n)) if (!this.state.has(n + '|' + a.ip)) this.dad(n, a.ip);
    // SLAAC was turned (back) on: ask the routers right away instead of waiting for the next advertisement
    if (!this.isRouter && this.cfg.ipv6?.slaac !== false) for (const n of this.ifnames()) if (!(this.slaac.get(n) || []).length) { this.raSeen = false; this.rsTries = 0; this.sendRs(n); }
    if (this.raIfaces().length) {
      for (const n of this.raIfaces()) this.sendRa(n);
      const tick = () => { for (const n of this.raIfaces()) this.sendRa(n); this.later(T6.raInterval, tick); };
      this.later(T6.raInterval, tick);
    }
  }
}
