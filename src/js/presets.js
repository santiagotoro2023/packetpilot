// Building blocks for topologies and the example networks
let LN = 1;
export const host = (name, x, y, ip = '', prefix = 24, gw = '', vlan = null, type = 'pc') =>
  ({ id: name, type, name, x, y, ifaces: { eth1: { ip, prefix, vlan } }, gw });
export const server = (name, x, y, ip, prefix, gw, vlan) => host(name, x, y, ip, prefix, gw, vlan, 'server');
export const router = (name, x, y, ifaces = {}, routes = [], extra = {}) => {
  const i = {};
  for (const [k, v] of Object.entries(ifaces)) { const [ip, p] = v.split('/'); i[k] = { ip, prefix: Number(p ?? 24) }; }
  return { id: name, type: 'router', name, x, y, ifaces: i, routes: routes.map(([dst, via]) => ({ dst, via })), ...extra };
};
export const sw = (name, x, y, ports = {}, extra = {}) => ({ id: name, type: 'switch', name, x, y, ports, ...extra });
export const vtep = (name, x, y, { uplink, lo, routes = [], ports = {}, vxlans = [] }) => {
  const [ip, p] = uplink.split('/');
  return { id: name, type: 'vtep', name, x, y, ifaces: { eth1: { ip, prefix: Number(p ?? 24) }, lo: { ip: lo, prefix: 32 } },
    routes: routes.map(([dst, via]) => ({ dst, via })), ports, vxlans };
};
export const link = (a, ai, b, bi, mtu = 1500) => ({ id: 'l' + (LN++), a: { dev: a, if: ai }, b: { dev: b, if: bi }, mtu, up: true });
export const acc = vlan => ({ mode: 'access', vlan });
export const trunk = (allowed = '1-4094', native = 1) => ({ mode: 'trunk', allowed, native });

export function topo(name, devices, links, zones) { return { name, devices, links, zones }; }

// -------------------------------------------------------------- Example networks
export const PRESETS = [
  { id: 'switch3', title: 'One switch, three PCs', topics: ['Ethernet', 'ARP', 'Switching'],
    text: 'The smallest useful network. Watch ARP and how the switch fills its MAC table.',
    make: () => topo('One switch, three PCs', [
      host('pc1', 120, 120, '10.0.0.1'), host('pc2', 120, 320, '10.0.0.2'), host('pc3', 520, 220, '10.0.0.3'), sw('sw1', 320, 220)],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('pc3', 'eth1', 'sw1', 'eth3')]) },
  { id: 'routed', title: 'Two subnets and a router', topics: ['Routing', 'ARP', 'TTL'],
    text: 'LAN A and LAN B, connected via r1. Ideal for seeing how MAC addresses and TTL change per segment.',
    make: () => topo('Two subnets and a router', [
      host('pc1', 100, 120, '192.168.10.10', 24, '192.168.10.1'), host('pc2', 100, 320, '192.168.10.11', 24, '192.168.10.1'),
      sw('sw1', 290, 220), router('r1', 480, 220, { eth1: '192.168.10.1/24', eth2: '192.168.20.1/24' }),
      server('srv1', 680, 220, '192.168.20.20', 24, '192.168.20.1')],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('r1', 'eth1', 'sw1', 'eth4'), link('r1', 'eth2', 'srv1', 'eth1')]) },
  { id: 'chain', title: 'Three routers in a row', topics: ['Static routing', 'traceroute'],
    text: 'Static routes across three routers. Run traceroute 10.0.4.10 on pc1.',
    make: chainTopo },
  { id: 'mtu', title: 'Bottleneck with a small MTU', topics: ['MTU', 'PMTUD', 'Fragmentation'],
    text: 'The link between r1 and r2 only has MTU 1400. Try ping -s 1472 -M do and -M dont.',
    make: () => topo('Bottleneck with a small MTU', [
      host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'), router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']]),
      router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]), server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
    [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'srv1', 'eth1')]) },
  { id: 'vlans', title: 'VLANs over a trunk', topics: ['VLAN', '802.1Q', 'Trunk'],
    text: 'Two switches, two VLANs, a trunk in between. Take a look at the tags on the trunk.',
    make: vlanTopo },
  { id: 'campus', title: 'Campus with routing between VLANs', topics: ['VLAN', 'Routing', 'Rules'],
    text: 'Clients in VLAN 10, servers in VLAN 20, r1 routes between them. Try out rules on r1.',
    make: () => topo('Campus with routing between VLANs', [
      host('client1', 100, 100, '10.10.0.11', 24, '10.10.0.1'), host('client2', 100, 300, '10.10.0.12', 24, '10.10.0.1'),
      server('web', 640, 100, '10.20.0.80', 24, '10.20.0.1'), server('dns', 640, 300, '10.20.0.53', 24, '10.20.0.1'),
      sw('sw1', 370, 200, { eth1: acc(10), eth2: acc(10), eth3: acc(20), eth4: acc(20), eth5: acc(10), eth6: acc(20) }),
      router('r1', 370, 400, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' })],
    [link('client1', 'eth1', 'sw1', 'eth1'), link('client2', 'eth1', 'sw1', 'eth2'), link('web', 'eth1', 'sw1', 'eth3'), link('dns', 'eth1', 'sw1', 'eth4'),
      link('r1', 'eth1', 'sw1', 'eth5'), link('r1', 'eth2', 'sw1', 'eth6')]) },
  { id: 'vxlan', title: 'VXLAN over a routed underlay', topics: ['VXLAN', 'Underlay', 'Overlay'],
    text: 'Two VTEPs, a router in between, two segments. The router does not know the servers\' networks.',
    make: () => vxlanTopo({ two: true }) },
  { id: 'stp', title: 'Redundancy with spanning tree', topics: ['STP', 'Redundancy', 'Root bridge'],
    text: 'Three switches in a triangle. STP blocks one port. Disconnect a cable and watch the network fail over.',
    make: () => stpTriangle({ enabled: true, rootPrio: 4096 }) },
  { id: 'loop', title: 'Loop without spanning tree', topics: ['Broadcast storm', 'Loop'],
    text: 'The same triangle, but STP is off. A single ping is enough for a broadcast storm.',
    make: () => stpTriangle({ enabled: false }) },
  { id: 'rstp', title: 'Rapid spanning tree', topics: ['RSTP', 'Proposal/agreement', 'Fast failover'],
    text: 'The triangle with RSTP and the standard timers. Ports between switches are negotiated in milliseconds, a cable cut costs no ping.',
    make: () => stpTriangle({ enabled: true, rootPrio: 4096, timers: 'standard', edge: true, mode: 'rstp' }) },
  { id: 'ecmp', title: 'Two equal paths (ECMP)', topics: ['ECMP', 'OSPF', 'Load balancing'],
    text: 'r1 reaches the server over two paths with the same cost and uses both. Compare the L3 and the L4 hash.',
    make: () => ecmpTopo() },
  { id: 'bfd', title: 'Provider link with BFD', topics: ['BFD', 'OSPF', 'Failover'],
    text: 'The primary path runs through a provider switch. Set the loss of its cable to 100 % and compare OSPF alone with OSPF plus BFD.',
    make: () => bfdTopo({ bfd: ['r1', 'r2', 'r3'] }) },
  { id: 'stpsquare', title: 'Four switches in a ring', topics: ['STP', 'Port costs', 'Port roles'],
    text: 'Which port blocks, and how do you move it with port costs?',
    make: () => stpSquare() },
  { id: 'stick', title: 'Router-on-a-Stick', topics: ['Subinterfaces', 'VLAN', 'Trunk'],
    text: 'One router, one cable, two VLANs: r1 routes via the subinterfaces eth1.10 and eth1.20.',
    make: () => stickTopo(true) },
  { id: 'services', title: 'Web and DNS', topics: ['TCP', 'UDP', 'DNS', 'Rules'],
    text: 'A client, a web server, a DNS server. curl http://web.lab/ first resolves the name and then opens a TCP connection.',
    make: () => servicesTopo() },
  { id: 'failover', title: 'Failover with gratuitous ARP', topics: ['ARP', 'GARP', 'Failover'],
    text: 'The service address 10.0.0.100 moves from srvA to srvB. Try it with and without gratuitous ARP.',
    make: () => failoverTopo() },
  { id: 'tcppath', title: 'TCP across a bottleneck', topics: ['TCP', 'MSS', 'PMTUD'],
    text: 'Only MTU 1400 between r1 and r2. The web server has to shrink its segments.',
    make: () => tcpPathTopo() },
  { id: 'dhcp', title: 'DHCP with a relay', topics: ['DHCP', 'Relay', 'Broadcast'],
    text: 'Two clients get their address from a server in another network. r1 relays their broadcasts.',
    make: () => dhcpTopo({ relay: true }) },
  { id: 'nat', title: 'Home network with NAT', topics: ['NAT', 'PAT', 'Port forwarding'],
    text: 'Two PCs share one public address. Watch the router rewrite addresses and ports with conntrack -L.',
    make: () => natTopo({ nat: true, forward: true }) },
  { id: 'ospf', title: 'OSPF between three sites', topics: ['OSPF', 'SPF', 'Failover'],
    text: 'Three routers learn each other\'s networks by themselves. Disconnect a link and watch them reroute.',
    make: () => ospfTopo() },
  { id: 'vrrp', title: 'Redundant gateway with VRRP', topics: ['VRRP', 'Failover', 'Virtual MAC'],
    text: 'ra and rb share the gateway 10.0.0.1. Pull the master\'s cable while pc1 pings.',
    make: () => vrrpTopo() },
  { id: 'empty', title: 'Empty network', topics: ['Your own network'],
    text: 'An empty canvas for your own topology.',
    make: () => topo('My network', [], []) }
];

export function chainTopo() {
  return topo('Three routers in a row', [
    host('pc1', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 250, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 420, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.4.0/24', '10.0.23.3']]),
    router('r3', 590, 220, { eth1: '10.0.23.3/24', eth2: '10.0.4.1/24' }, [['0.0.0.0/0', '10.0.23.2']]),
    server('srv1', 760, 220, '10.0.4.10', 24, '10.0.4.1')],
  [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'r3', 'eth1'), link('r3', 'eth2', 'srv1', 'eth1')]);
}
export function vlanTopo(trunked = true) {
  // A fresh object per switch, so changing one trunk never changes the other
  const up = () => trunked ? trunk('10,20', 1) : acc(1);
  return topo('VLANs over a trunk', [
    host('a10', 90, 110, '10.10.0.1'), host('a20', 90, 330, '10.20.0.1'),
    host('b10', 690, 110, '10.10.0.2'), host('b20', 690, 330, '10.20.0.2'),
    sw('s1', 270, 220, { eth1: acc(10), eth2: acc(20), eth8: up() }), sw('s2', 510, 220, { eth1: acc(10), eth2: acc(20), eth8: up() })],
  [link('a10', 'eth1', 's1', 'eth1'), link('a20', 'eth1', 's1', 'eth2'), link('b10', 'eth1', 's2', 'eth1'), link('b20', 'eth1', 's2', 'eth2'), link('s1', 'eth8', 's2', 'eth8')],
  [{ x: 20, y: 40, w: 760, h: 140, label: 'VLAN 10', kind: 'vlan' }, { x: 20, y: 262, w: 760, h: 140, label: 'VLAN 20', kind: 'vlan' }]);
}
export function vxlanTopo({ two = false, vni2 = 10010, port2 = 4789, mtu = 1500, flood2 = true } = {}) {
  const maps1 = [{ vni: 10010, vlan: 10, flood: ['10.255.0.2'], dstport: 4789, learning: true }];
  const maps2 = [{ vni: vni2, vlan: 10, flood: flood2 ? ['10.255.0.1'] : [], dstport: port2, learning: true }];
  if (two) { maps1.push({ vni: 10020, vlan: 20, flood: ['10.255.0.2'], dstport: 4789, learning: true }); maps2.push({ vni: 10020, vlan: 20, flood: ['10.255.0.1'], dstport: 4789, learning: true }); }
  const devs = [
    server('srv1', 90, 120, '192.168.10.11'), server('srv2', 790, 120, '192.168.10.12'),
    vtep('vtep1', 230, 260, { uplink: '10.0.1.2/24', lo: '10.255.0.1', routes: [['10.255.0.2/32', '10.0.1.1']], ports: { eth2: acc(10), eth3: acc(20) }, vxlans: maps1 }),
    vtep('vtep2', 650, 260, { uplink: '10.0.2.2/24', lo: '10.255.0.2', routes: [['10.255.0.1/32', '10.0.2.1']], ports: { eth2: acc(10), eth3: acc(20) }, vxlans: maps2 }),
    router('core', 440, 380, { eth1: '10.0.1.1/24', eth2: '10.0.2.1/24' }, [['10.255.0.1/32', '10.0.1.2'], ['10.255.0.2/32', '10.0.2.2']])];
  const links = [link('vtep1', 'eth1', 'core', 'eth1', mtu), link('vtep2', 'eth1', 'core', 'eth2', mtu), link('srv1', 'eth1', 'vtep1', 'eth2'), link('srv2', 'eth1', 'vtep2', 'eth2')];
  if (two) {
    devs.push(host('pc1', 90, 400, '192.168.20.11'), host('pc2', 790, 400, '192.168.20.12'));
    links.push(link('pc1', 'eth1', 'vtep1', 'eth3'), link('pc2', 'eth1', 'vtep2', 'eth3'));
  }
  return topo('VXLAN over a routed underlay', devs, links,
    [{ x: 20, y: 40, w: 860, h: 130, label: two ? 'Overlay: VNI 10010 (192.168.10.0/24) and VNI 10020 (192.168.20.0/24)' : 'Overlay: VNI 10010, 192.168.10.0/24', kind: 'overlay' },
      { x: 150, y: 320, w: 580, h: 120, label: 'Underlay: routed, only knows the VTEP loopbacks', kind: 'underlay' }]);
}

// -------------------------------------------------------------- Spanning tree, subinterfaces, services
const stpCfg = (enabled, prio = 32768, timers = 'fast', mode = 'stp') => ({ stp: { enabled, mode, priority: prio, timers } });
/** modes: one protocol for all switches, or one per switch: { sw1: 'rstp', sw3: 'stp' } */
const modeOf = (mode, id) => (typeof mode === 'string' ? mode : mode[id] || 'stp');
export function stpTriangle({ enabled = true, rootPrio = 32768, timers = 'fast', edge = false, mode = 'stp' } = {}) {
  const pcPort = edge ? { mode: 'access', vlan: 1, edge: true } : acc(1);
  const rapid = modeOf(mode, 'sw1') === 'rstp' || modeOf(mode, 'sw2') === 'rstp';
  return topo(!enabled ? 'Loop without spanning tree' : rapid ? 'Redundancy with rapid spanning tree' : 'Redundancy with spanning tree', [
    sw('sw1', 400, 110, {}, stpCfg(enabled, rootPrio, timers, modeOf(mode, 'sw1'))), sw('sw2', 230, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers, modeOf(mode, 'sw2'))), sw('sw3', 570, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers, modeOf(mode, 'sw3'))),
    host('pc1', 80, 300, '10.0.0.1'), host('pc2', 720, 300, '10.0.0.2')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw1', 'eth2', 'sw3', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth2'),
    link('pc1', 'eth1', 'sw2', 'eth5'), link('pc2', 'eth1', 'sw3', 'eth5')],
  [{ x: 160, y: 40, w: 480, h: 330, label: 'Redundant cabling: three paths, one loop', color: 'yellow' }]);
}
export function stpSquare({ mode = 'stp', timers = 'fast', edge = false } = {}) {
  const pc = edge ? { mode: 'access', vlan: 1, edge: true } : acc(1);
  return topo('Four switches in a ring', [
    sw('sw1', 240, 110, { eth5: pc }, stpCfg(true, 4096, timers, modeOf(mode, 'sw1'))), sw('sw2', 560, 110, {}, stpCfg(true, 32768, timers, modeOf(mode, 'sw2'))),
    sw('sw3', 560, 340, { eth5: pc }, stpCfg(true, 32768, timers, modeOf(mode, 'sw3'))), sw('sw4', 240, 340, {}, stpCfg(true, 32768, timers, modeOf(mode, 'sw4'))),
    host('pc1', 80, 110, '10.0.0.1'), host('pc3', 720, 340, '10.0.0.3')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth1'), link('sw3', 'eth2', 'sw4', 'eth2'), link('sw4', 'eth1', 'sw1', 'eth2'),
    link('pc1', 'eth1', 'sw1', 'eth5'), link('pc3', 'eth1', 'sw3', 'eth5')],
  [{ x: 170, y: 40, w: 460, h: 370, label: 'Ring of four switches, sw1 is root', color: 'yellow' }]);
}
export function stickTopo(configured = true) {
  const r = { id: 'r1', type: 'router', name: 'r1', x: 400, y: 84, ifaces: { eth1: { ip: '', prefix: 24 } }, routes: [] };
  if (configured) {
    r.ifaces['eth1.10'] = { parent: 'eth1', vlan: 10, ip: '10.10.0.1', prefix: 24 };
    r.ifaces['eth1.20'] = { parent: 'eth1', vlan: 20, ip: '10.20.0.1', prefix: 24 };
  }
  return topo('Router-on-a-Stick', [r,
    sw('sw1', 400, 260, { eth1: acc(10), eth2: acc(10), eth3: acc(20), eth4: acc(20), eth8: trunk('10,20', 1) }),
    host('a1', 120, 200, '10.10.0.11', 24, '10.10.0.1'), host('a2', 120, 380, '10.10.0.12', 24, '10.10.0.1'),
    host('b1', 680, 200, '10.20.0.11', 24, '10.20.0.1'), server('b2', 680, 380, '10.20.0.12', 24, '10.20.0.1')],
  [link('a1', 'eth1', 'sw1', 'eth1'), link('a2', 'eth1', 'sw1', 'eth2'), link('b1', 'eth1', 'sw1', 'eth3'), link('b2', 'eth1', 'sw1', 'eth4'), link('r1', 'eth1', 'sw1', 'eth8')],
  [{ x: 30, y: 140, w: 210, h: 300, label: 'VLAN 10', color: 'blue' }, { x: 560, y: 140, w: 210, h: 300, label: 'VLAN 20', color: 'violet' },
    { x: 290, y: 14, w: 220, h: 146, label: 'Router with subinterfaces', color: 'gray' }]);
}
export function servicesTopo({ acl = [] } = {}) {
  const web = server('web', 640, 110, '10.20.0.80', 24, '10.20.0.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 3000 }, { proto: 'tcp', port: 443, name: 'https', size: 3000 }];
  const dns = server('dns', 640, 330, '10.20.0.53', 24, '10.20.0.1');
  dns.services = [{ proto: 'udp', port: 53, name: 'dns' }];
  dns.dns = [{ name: 'web.lab', ip: '10.20.0.80' }, { name: 'dns.lab', ip: '10.20.0.53' }, { name: 'intranet.lab', ip: '10.20.0.80' }];
  const c1 = host('client', 100, 220, '10.10.0.10', 24, '10.10.0.1');
  c1.resolver = '10.20.0.53';
  return topo('Web and DNS', [c1, router('r1', 300, 220, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' }, [], { acl }), sw('sw1', 470, 220), web, dns],
    [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'sw1', 'eth1'), link('web', 'eth1', 'sw1', 'eth2'), link('dns', 'eth1', 'sw1', 'eth3')],
    [{ x: 400, y: 40, w: 340, h: 380, label: 'Server network 10.20.0.0/24', color: 'green' }]);
}
export function failoverTopo() {
  const a = server('srvA', 600, 110, '10.0.0.100'), b = server('srvB', 600, 330, '10.0.0.12');
  return topo('Failover with gratuitous ARP', [host('client', 120, 220, '10.0.0.5'), sw('sw1', 360, 220), a, b],
    [link('client', 'eth1', 'sw1', 'eth1'), link('srvA', 'eth1', 'sw1', 'eth2'), link('srvB', 'eth1', 'sw1', 'eth3')],
    [{ x: 500, y: 40, w: 220, h: 380, label: 'Cluster, service address 10.0.0.100', color: 'orange' }]);
}
export function tcpPathTopo({ fwAcl = [] } = {}) {
  const web = server('web', 840, 220, '10.0.2.80', 24, '10.0.2.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 6000 }];
  return topo('TCP across a bottleneck', [host('client', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 270, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 460, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.2.0/24', '10.0.23.3']]),
    router('fw', 650, 220, { eth1: '10.0.23.3/24', eth2: '10.0.2.1/24' }, [['0.0.0.0/0', '10.0.23.2']], { acl: fwAcl }), web],
  [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'fw', 'eth1'), link('fw', 'eth2', 'web', 'eth1')],
  [{ x: 210, y: 130, w: 310, h: 150, label: 'Tunnel section, MTU 1400', color: 'orange' }]);
}

// -------------------------------------------------------------- DHCP, NAT, OSPF, VRRP
const ospfOn = (ifaces, extra = {}) => ({ enabled: true, timers: 'fast', rid: '', ifaces: Object.fromEntries(Object.entries(ifaces).map(([k, v]) => [k, { enabled: true, cost: 10, passive: false, ...v }])), ...extra });
export function dhcpTopo({ relay = false } = {}) {
  const c1 = host('client1', 90, 110), c2 = host('client2', 90, 330);
  for (const c of [c1, c2]) c.ifaces.eth1 = { ip: '', prefix: 24, vlan: null, dhcp: true };
  const srv = server('dhcp', 690, 220, '10.20.0.67', 24, '10.20.0.1');
  srv.services = [];
  srv.dhcpServer = { enabled: true, pools: [{ net: '10.10.0.0/24', from: '10.10.0.100', to: '10.10.0.199', router: '10.10.0.1', dns: '10.20.0.53', lease: 3600 }] };
  const r1 = router('r1', 470, 220, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' });
  if (relay) r1.ifaces.eth1.helper = '10.20.0.67';
  return topo('DHCP with a relay', [c1, c2, sw('sw1', 280, 220), r1, srv],
    [link('client1', 'eth1', 'sw1', 'eth1'), link('client2', 'eth1', 'sw1', 'eth2'), link('r1', 'eth1', 'sw1', 'eth8'), link('r1', 'eth2', 'dhcp', 'eth1')],
    [{ x: 20, y: 40, w: 340, h: 380, label: 'Clients 10.10.0.0/24', color: 'blue' }, { x: 600, y: 120, w: 180, h: 200, label: 'Servers 10.20.0.0/24', color: 'green' }]);
}
export function dhcpLanTopo() {
  const c1 = host('client1', 110, 120), c2 = host('client2', 110, 330);
  for (const c of [c1, c2]) c.ifaces.eth1 = { ip: '', prefix: 24, vlan: null, dhcp: true };
  const srv = server('dhcp', 560, 220, '10.10.0.2', 24, '10.10.0.1');
  srv.services = [];
  srv.dhcpServer = { enabled: true, pools: [{ net: '10.10.0.0/24', from: '10.10.0.100', to: '10.10.0.199', router: '10.10.0.1', dns: '10.10.0.2', lease: 3600 }] };
  return topo('DHCP in one network', [c1, c2, sw('sw1', 330, 220), srv],
    [link('client1', 'eth1', 'sw1', 'eth1'), link('client2', 'eth1', 'sw1', 'eth2'), link('dhcp', 'eth1', 'sw1', 'eth3')]);
}
export function natTopo({ nat = false, forward = false } = {}) {
  const in1 = host('pc1', 90, 110, '192.168.1.10', 24, '192.168.1.1');
  in1.services = [{ proto: 'tcp', port: 80, name: 'http', size: 1200 }];
  const gw = router('home', 420, 220, { eth1: '192.168.1.1/24', eth2: '203.0.113.2/30' }, [['0.0.0.0/0', '203.0.113.1']]);
  gw.nat = { outside: nat ? 'eth2' : '', masquerade: true, forwards: forward ? [{ proto: 'tcp', port: 8080, to: '192.168.1.10', toPort: 80 }] : [] };
  const web = server('web', 820, 220, '198.51.100.80', 24, '198.51.100.1');
  return topo('Home network with NAT', [in1, host('pc2', 90, 330, '192.168.1.11', 24, '192.168.1.1'), sw('sw1', 250, 220), gw,
    router('isp', 620, 220, { eth1: '203.0.113.1/30', eth2: '198.51.100.1/24' }), web],
  [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('home', 'eth1', 'sw1', 'eth8'), link('home', 'eth2', 'isp', 'eth1'), link('isp', 'eth2', 'web', 'eth1')],
  [{ x: 20, y: 40, w: 330, h: 380, label: 'Private network 192.168.1.0/24', color: 'green' }, { x: 540, y: 110, w: 360, h: 220, label: 'Internet', color: 'gray' }]);
}
export function ospfTopo({ configured = ['o1', 'o2', 'o3'], timers = {} } = {}) {
  const r = (name, x, y, ifaces, lan) => {
    const d = router(name, x, y, ifaces);
    d.ospf = configured.includes(name) ? ospfOn(Object.fromEntries(Object.keys(ifaces).map(k => [k, k === lan ? { passive: true } : {}])), { timers: timers[name] || 'fast' })
      : { enabled: false, timers: 'fast', rid: '', ifaces: {} };
    return d;
  };
  return topo('OSPF between three sites', [
    r('o1', 260, 120, { eth1: '10.0.12.1/24', eth2: '10.0.13.1/24', eth3: '10.1.0.1/24' }, 'eth3'),
    r('o2', 640, 120, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24', eth3: '10.2.0.1/24' }, 'eth3'),
    r('o3', 450, 390, { eth1: '10.0.13.3/24', eth2: '10.0.23.3/24', eth3: '10.3.0.1/24' }, 'eth3'),
    host('pc1', 70, 120, '10.1.0.10', 24, '10.1.0.1'), host('pc2', 830, 120, '10.2.0.10', 24, '10.2.0.1'), server('srv3', 450, 580, '10.3.0.10', 24, '10.3.0.1')],
  [link('o1', 'eth1', 'o2', 'eth1'), link('o1', 'eth2', 'o3', 'eth1'), link('o2', 'eth2', 'o3', 'eth2'),
    link('pc1', 'eth1', 'o1', 'eth3'), link('pc2', 'eth1', 'o2', 'eth3'), link('srv3', 'eth1', 'o3', 'eth3')]);
}
export function vrrpTopo({ vrrpB = true, prioB = 100 } = {}) {
  const ra = router('ra', 330, 120, { eth1: '10.0.0.2/24', eth2: '10.9.1.1/30' });
  ra.vrrp = [{ ifname: 'eth1', vrid: 1, vip: '10.0.0.1', priority: 110, preempt: true }];
  ra.ospf = ospfOn({ eth1: { passive: true }, eth2: {} });
  const rb = router('rb', 330, 400, { eth1: '10.0.0.3/24', eth2: '10.9.2.1/30' });
  rb.vrrp = vrrpB ? [{ ifname: 'eth1', vrid: 1, vip: '10.0.0.1', priority: prioB, preempt: true }] : [];
  rb.ospf = ospfOn({ eth1: { passive: true }, eth2: {} });
  const core = router('core', 600, 260, { eth1: '10.9.1.2/30', eth2: '10.9.2.2/30', eth3: '10.50.0.1/24' });
  core.ospf = ospfOn({ eth1: {}, eth2: {}, eth3: { passive: true } });
  return topo('Redundant gateway with VRRP', [host('pc1', 70, 180, '10.0.0.10', 24, '10.0.0.1'), host('pc2', 70, 360, '10.0.0.11', 24, '10.0.0.1'),
    sw('sw1', 170, 260), ra, rb, core, server('srv', 820, 260, '10.50.0.5', 24, '10.50.0.1')],
  [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('ra', 'eth1', 'sw1', 'eth7'), link('rb', 'eth1', 'sw1', 'eth8'),
    link('ra', 'eth2', 'core', 'eth1'), link('rb', 'eth2', 'core', 'eth2'), link('core', 'eth3', 'srv', 'eth1')],
  [{ x: 20, y: 40, w: 410, h: 470, label: 'LAN 10.0.0.0/24, gateway 10.0.0.1 (virtual)', color: 'orange' }]);
}

// -------------------------------------------------------------- ECMP and BFD
/** A diamond: two equal paths r1 → r2 → r4 and r1 → r3 → r4 */
export function ecmpTopo({ hash = 'l3', maxPaths = 4 } = {}) {
  const r = (name, x, y, ifaces, lan) => {
    const d = router(name, x, y, ifaces, [], { maxPaths, ecmpHash: hash });
    d.ospf = ospfOn(Object.fromEntries(Object.keys(ifaces).map(k => [k, k === lan ? { passive: true } : {}])));
    return d;
  };
  const srv = server('srv', 940, 250, '10.4.0.10', 24, '10.4.0.1');
  srv.services = [{ proto: 'tcp', port: 80, name: 'http', size: 3000 }];
  return topo('Two equal paths (ECMP)', [
    host('c1', 70, 150, '10.1.0.10', 24, '10.1.0.1'), host('c2', 70, 350, '10.1.0.11', 24, '10.1.0.1'), sw('sw1', 200, 250),
    r('r1', 370, 250, { eth1: '10.0.12.1/24', eth2: '10.0.13.1/24', eth3: '10.1.0.1/24' }, 'eth3'),
    r('r2', 570, 110, { eth1: '10.0.12.2/24', eth2: '10.0.24.2/24' }),
    r('r3', 570, 390, { eth1: '10.0.13.3/24', eth2: '10.0.34.3/24' }),
    r('r4', 770, 250, { eth1: '10.0.24.4/24', eth2: '10.0.34.4/24', eth3: '10.4.0.1/24' }, 'eth3'), srv],
  [link('c1', 'eth1', 'sw1', 'eth1'), link('c2', 'eth1', 'sw1', 'eth2'), link('sw1', 'eth8', 'r1', 'eth3'),
    link('r1', 'eth1', 'r2', 'eth1'), link('r1', 'eth2', 'r3', 'eth1'), link('r2', 'eth2', 'r4', 'eth1'), link('r3', 'eth2', 'r4', 'eth2'), link('r4', 'eth3', 'srv', 'eth1')],
  [{ x: 300, y: 40, w: 560, h: 420, label: 'Two paths with the same OSPF cost', color: 'green' }]);
}
/** Primary path through a provider switch (the link stays up when the far side fails), backup via r3 */
export function bfdTopo({ bfd = [], timers = 'standard' } = {}) {
  const on = name => bfd.includes(name);
  const r = (name, x, y, ifaces, costs, lan) => {
    const d = router(name, x, y, ifaces);
    d.ospf = ospfOn(Object.fromEntries(Object.keys(ifaces).map(k => [k, { cost: costs[k] || 10, ...(k === lan ? { passive: true } : {}) }])), { timers });
    d.bfd = { enabled: on(name), interval: 300, mult: 3, ospf: on(name) };
    return d;
  };
  return topo('Provider link and a backup path', [
    host('pc1', 70, 250, '10.1.0.10', 24, '10.1.0.1'),
    r('r1', 250, 250, { eth1: '10.0.12.1/24', eth2: '10.0.13.1/24', eth3: '10.1.0.1/24' }, { eth2: 30 }, 'eth3'),
    sw('prov', 470, 120),
    r('r2', 690, 250, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24', eth3: '10.2.0.1/24' }, { eth2: 30 }, 'eth3'),
    r('r3', 470, 420, { eth1: '10.0.13.3/24', eth2: '10.0.23.3/24' }, {}),
    server('srv', 880, 250, '10.2.0.10', 24, '10.2.0.1')],
  [link('pc1', 'eth1', 'r1', 'eth3'), link('r1', 'eth1', 'prov', 'eth1'), link('prov', 'eth2', 'r2', 'eth1'),
    link('r1', 'eth2', 'r3', 'eth1'), link('r3', 'eth2', 'r2', 'eth2'), link('r2', 'eth3', 'srv', 'eth1')],
  [{ x: 380, y: 40, w: 180, h: 150, label: 'Provider network', color: 'gray' }]);
}
