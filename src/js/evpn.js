// EVPN on a VTEP: type 3 routes build the flood lists, type 2 routes carry the MAC (and IP)
// addresses behind each VTEP, so remote MACs are known without flood and learn. With ARP
// suppression the VTEP answers ARP requests for remote hosts itself.
import { isGroupMac } from './net.js';
import { ethFrame, arpPacket } from './packets.js';

export class Evpn {
  constructor(dev) { this.dev = dev; this.sim = dev.sim; this.arp = new Map(); this.vteps = new Map(); this.macs = new Map(); }
  maps() { return this.dev.maps().filter(m => m.evpn); }
  on() { return this.maps().length > 0 && !!this.dev.bgp?.enabled; }
  rec(kind, text, extra) { return this.dev.record(kind, text, extra); }
  /** Watch local frames: which IP belongs to which MAC (for type 2 routes with IP) */
  snoop(frame) {
    if (isGroupMac(frame.src)) return;
    if (frame.type === 'arp' && frame.payload.spa !== '0.0.0.0') this.arp.set(frame.src, frame.payload.spa);
    else if (frame.type === 'ipv4' && frame.payload.src !== '0.0.0.0') this.arp.set(frame.src, frame.payload.src);
  }
  localRoutes() {
    if (!this.on()) return [];
    const me = this.dev.localIp(), out = [];
    for (const m of this.maps()) {
      out.push({ rt: 3, key: `3|${m.vni}|${me}`, vni: Number(m.vni), vtep: me });
      for (const e of this.dev.bridge.table()) {
        if (e.vid !== Number(m.vlan) || e.port.startsWith('vxlan') || e.remote) continue;
        out.push({ rt: 2, key: `2|${m.vni}|${e.mac}`, vni: Number(m.vni), mac: e.mac, ip: this.arp.get(e.mac) || '', vtep: me });
      }
    }
    return out;
  }
  received() {
    const out = [];
    for (const p of this.dev.bgp?.peers.values() || []) if (p.state === 'Established') for (const e of p.rxEvpn.values()) out.push({ ...e, from: p.ip });
    return out;
  }
  /** Called after every BGP recomputation: flood lists and remote MACs follow the received routes */
  recomputeBgp() {
    if (!this.on()) return;
    const me = this.dev.localIp();
    const rx = this.received().filter(e => (e.vtep || e.nextHop) !== me);
    const vteps = new Map(), macs = new Map();
    for (const e of rx) {
      const vtep = e.vtep || e.nextHop;
      if (e.rt === 3) { if (!vteps.has(e.vni)) vteps.set(e.vni, new Set()); vteps.get(e.vni).add(vtep); }
      if (e.rt === 2) macs.set(`${e.vni}|${e.mac}`, { vni: e.vni, mac: e.mac, ip: e.ip, vtep });
    }
    for (const [vni, set] of vteps) for (const v of set) if (!this.vteps.get(vni)?.has(v)) this.rec('learn', `EVPN: VTEP ${v} takes part in VNI ${vni} (type 3 route), added to the flood list`, { tag: 'evpn-vtep', data: { vni, vtep: v } });
    for (const [vni, set] of this.vteps) for (const v of set) if (!vteps.get(vni)?.has(v)) this.rec('info', `EVPN: VTEP ${v} no longer in VNI ${vni}, removed from the flood list`, { tag: 'evpn-vtep-gone', data: { vni, vtep: v } });
    this.vteps = vteps;
    const fdb = this.dev.bridge.fdb;
    for (const [k, x] of macs) {
      const m = this.maps().find(y => Number(y.vni) === Number(x.vni));
      if (!m) continue;
      const key = `${Number(m.vlan)}|${x.mac}`;
      const old = fdb.get(key);
      fdb.set(key, { port: 'vxlan' + m.vni, t: this.sim.time, remote: x.vtep, evpn: true });
      if (!this.macs.has(k) || old?.remote !== x.vtep) this.rec('learn', `EVPN: ${x.mac}${x.ip ? ' (' + x.ip + ')' : ''} is behind VTEP ${x.vtep} in VNI ${x.vni} (type 2 route), no flooding needed`, { tag: 'evpn-mac', data: { mac: x.mac, vtep: x.vtep, vni: x.vni } });
    }
    for (const [k, x] of this.macs) if (!macs.has(k)) {
      const m = this.maps().find(y => Number(y.vni) === Number(x.vni));
      if (m && fdb.get(`${Number(m.vlan)}|${x.mac}`)?.evpn) fdb.delete(`${Number(m.vlan)}|${x.mac}`);
      this.rec('info', `EVPN: ${x.mac} withdrawn by VTEP ${x.vtep}`, { tag: 'evpn-mac-gone', data: { mac: x.mac } });
    }
    this.macs = macs;
  }
  floodList(m) {
    const list = new Set((m.flood || []).filter(Boolean));
    if (m.evpn) for (const v of this.vteps.get(Number(m.vni)) || []) list.add(v);
    return [...list];
  }
  /** ARP suppression: answer an ARP request for a remote host from the EVPN table */
  suppress(port, frame) {
    if (frame.type !== 'arp' || frame.payload.op !== 1 || frame.payload.spa === frame.payload.tpa) return false;
    const vid = this.dev.bridge.vidIn(port, frame);
    const m = this.maps().find(x => Number(x.vlan) === vid && x.arpSuppress);
    if (!m) return false;
    const hit = [...this.macs.values()].find(x => Number(x.vni) === Number(m.vni) && x.ip === frame.payload.tpa);
    if (!hit) return false;
    this.rec('info', `ARP suppression: answers the ARP request for ${hit.ip} itself (${hit.mac}, known from EVPN), nothing is flooded`, { frame, tag: 'evpn-arp-suppress', data: { ip: hit.ip } });
    const a = frame.payload;
    this.dev.transmit(port, ethFrame(hit.mac, a.sha, 'arp', arpPacket(2, hit.mac, hit.ip, a.sha, a.spa)));
    return true;
  }
  bgpTable() {
    const me = this.dev.localIp();
    return [...this.localRoutes().map(e => ({ ...e, nextHop: me, from: 'local', best: true })), ...this.received().map(e => ({ ...e, nextHop: e.vtep || e.nextHop, best: true }))]
      .sort((a, b) => a.rt - b.rt || a.vni - b.vni);
  }
}
