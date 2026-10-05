// Bausteine für Topologien und die Beispielnetze
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

// -------------------------------------------------------------- Beispielnetze
export const PRESETS = [
  { id: 'switch3', title: 'Ein Switch, drei PCs', topics: ['Ethernet', 'ARP', 'Switching'],
    text: 'Das kleinste sinnvolle Netz. Beobachte ARP und wie der Switch seine MAC-Tabelle füllt.',
    make: () => topo('Ein Switch, drei PCs', [
      host('pc1', 120, 120, '10.0.0.1'), host('pc2', 120, 320, '10.0.0.2'), host('pc3', 520, 220, '10.0.0.3'), sw('sw1', 320, 220)],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('pc3', 'eth1', 'sw1', 'eth3')]) },
  { id: 'routed', title: 'Zwei Subnetze und ein Router', topics: ['Routing', 'ARP', 'TTL'],
    text: 'LAN A und LAN B, verbunden über r1. Ideal, um MAC- und TTL-Wechsel pro Segment zu sehen.',
    make: () => topo('Zwei Subnetze und ein Router', [
      host('pc1', 100, 120, '192.168.10.10', 24, '192.168.10.1'), host('pc2', 100, 320, '192.168.10.11', 24, '192.168.10.1'),
      sw('sw1', 290, 220), router('r1', 480, 220, { eth1: '192.168.10.1/24', eth2: '192.168.20.1/24' }),
      server('srv1', 680, 220, '192.168.20.20', 24, '192.168.20.1')],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('r1', 'eth1', 'sw1', 'eth4'), link('r1', 'eth2', 'srv1', 'eth1')]) },
  { id: 'chain', title: 'Drei Router in Reihe', topics: ['Statisches Routing', 'traceroute'],
    text: 'Statische Routen über drei Router. Starte auf pc1 ein traceroute 10.0.4.10.',
    make: chainTopo },
  { id: 'mtu', title: 'Engpass mit kleiner MTU', topics: ['MTU', 'PMTUD', 'Fragmentierung'],
    text: 'Der Link zwischen r1 und r2 hat nur MTU 1400. Teste ping -s 1472 -M do und -M dont.',
    make: () => topo('Engpass mit kleiner MTU', [
      host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'), router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']]),
      router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]), server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
    [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'srv1', 'eth1')]) },
  { id: 'vlans', title: 'VLANs über einen Trunk', topics: ['VLAN', '802.1Q', 'Trunk'],
    text: 'Zwei Switches, zwei VLANs, ein Trunk dazwischen. Schau dir die Tags auf dem Trunk an.',
    make: vlanTopo },
  { id: 'campus', title: 'Campus mit Routing zwischen VLANs', topics: ['VLAN', 'Routing', 'Regeln'],
    text: 'Clients in VLAN 10, Server in VLAN 20, r1 routet dazwischen. Probiere Regeln auf r1 aus.',
    make: () => topo('Campus mit Routing zwischen VLANs', [
      host('client1', 100, 100, '10.10.0.11', 24, '10.10.0.1'), host('client2', 100, 300, '10.10.0.12', 24, '10.10.0.1'),
      server('web', 640, 100, '10.20.0.80', 24, '10.20.0.1'), server('dns', 640, 300, '10.20.0.53', 24, '10.20.0.1'),
      sw('sw1', 370, 200, { eth1: acc(10), eth2: acc(10), eth3: acc(20), eth4: acc(20), eth5: acc(10), eth6: acc(20) }),
      router('r1', 370, 400, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' })],
    [link('client1', 'eth1', 'sw1', 'eth1'), link('client2', 'eth1', 'sw1', 'eth2'), link('web', 'eth1', 'sw1', 'eth3'), link('dns', 'eth1', 'sw1', 'eth4'),
      link('r1', 'eth1', 'sw1', 'eth5'), link('r1', 'eth2', 'sw1', 'eth6')]) },
  { id: 'vxlan', title: 'VXLAN über ein geroutetes Underlay', topics: ['VXLAN', 'Underlay', 'Overlay'],
    text: 'Zwei VTEPs, ein Router dazwischen, zwei Segmente. Der Router kennt die Netze der Server nicht.',
    make: () => vxlanTopo({ two: true }) },
  { id: 'stp', title: 'Redundanz mit Spanning Tree', topics: ['STP', 'Redundanz', 'Root Bridge'],
    text: 'Drei Switches im Dreieck. STP blockiert einen Port. Trenne ein Kabel und schau zu, wie das Netz umschaltet.',
    make: () => stpTriangle({ enabled: true, rootPrio: 4096 }) },
  { id: 'loop', title: 'Schleife ohne Spanning Tree', topics: ['Broadcast-Sturm', 'Schleife'],
    text: 'Das gleiche Dreieck, aber STP ist aus. Ein einziger Ping genügt für einen Broadcast-Sturm.',
    make: () => stpTriangle({ enabled: false }) },
  { id: 'stpsquare', title: 'Vier Switches im Ring', topics: ['STP', 'Portkosten', 'Port-Rollen'],
    text: 'Welcher Port blockiert, und wie verschiebst du ihn mit Portkosten?',
    make: () => stpSquare() },
  { id: 'stick', title: 'Router-on-a-Stick', topics: ['Subinterfaces', 'VLAN', 'Trunk'],
    text: 'Ein Router, ein Kabel, zwei VLANs: r1 routet über die Subinterfaces eth1.10 und eth1.20.',
    make: () => stickTopo(true) },
  { id: 'services', title: 'Web und DNS', topics: ['TCP', 'UDP', 'DNS', 'Regeln'],
    text: 'Ein Client, ein Webserver, ein DNS-Server. curl http://web.lab/ löst erst den Namen auf und baut dann eine TCP-Verbindung auf.',
    make: () => servicesTopo() },
  { id: 'failover', title: 'Failover mit Gratuitous ARP', topics: ['ARP', 'GARP', 'Failover'],
    text: 'Die Dienstadresse 10.0.0.100 zieht von srvA zu srvB um. Mit und ohne Gratuitous ARP ausprobieren.',
    make: () => failoverTopo() },
  { id: 'tcppath', title: 'TCP über einen Engpass', topics: ['TCP', 'MSS', 'PMTUD'],
    text: 'Zwischen r1 und r2 nur MTU 1400. Der Webserver muss seine Segmente verkleinern.',
    make: () => tcpPathTopo() },
  { id: 'empty', title: 'Leeres Netz', topics: ['Eigenes Netz'],
    text: 'Ein leerer Plan für deine eigene Topologie.',
    make: () => topo('Mein Netz', [], []) }
];

export function chainTopo() {
  return topo('Drei Router in Reihe', [
    host('pc1', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 250, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 420, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.4.0/24', '10.0.23.3']]),
    router('r3', 590, 220, { eth1: '10.0.23.3/24', eth2: '10.0.4.1/24' }, [['0.0.0.0/0', '10.0.23.2']]),
    server('srv1', 760, 220, '10.0.4.10', 24, '10.0.4.1')],
  [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'r3', 'eth1'), link('r3', 'eth2', 'srv1', 'eth1')]);
}
export function vlanTopo(trunked = true) {
  const up = trunked ? trunk('10,20', 1) : acc(1);
  return topo('VLANs über einen Trunk', [
    host('a10', 90, 110, '10.10.0.1'), host('a20', 90, 330, '10.20.0.1'),
    host('b10', 690, 110, '10.10.0.2'), host('b20', 690, 330, '10.20.0.2'),
    sw('s1', 270, 220, { eth1: acc(10), eth2: acc(20), eth8: up }), sw('s2', 510, 220, { eth1: acc(10), eth2: acc(20), eth8: up })],
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
  return topo('VXLAN über ein geroutetes Underlay', devs, links,
    [{ x: 20, y: 40, w: 860, h: 130, label: two ? 'Overlay: VNI 10010 (192.168.10.0/24) und VNI 10020 (192.168.20.0/24)' : 'Overlay: VNI 10010, 192.168.10.0/24', kind: 'overlay' },
      { x: 150, y: 320, w: 580, h: 120, label: 'Underlay: geroutet, kennt nur die Loopbacks der VTEPs', kind: 'underlay' }]);
}

// -------------------------------------------------------------- Spanning Tree, Subinterfaces, Dienste
const stpCfg = (enabled, prio = 32768, timers = 'schnell') => ({ stp: { enabled, priority: prio, timers } });
export function stpTriangle({ enabled = true, rootPrio = 32768, timers = 'schnell', edge = false } = {}) {
  const pcPort = edge ? { mode: 'access', vlan: 1, edge: true } : acc(1);
  return topo(enabled ? 'Redundanz mit Spanning Tree' : 'Schleife ohne Spanning Tree', [
    sw('sw1', 400, 110, {}, stpCfg(enabled, rootPrio, timers)), sw('sw2', 230, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers)), sw('sw3', 570, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers)),
    host('pc1', 80, 300, '10.0.0.1'), host('pc2', 720, 300, '10.0.0.2')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw1', 'eth2', 'sw3', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth2'),
    link('pc1', 'eth1', 'sw2', 'eth5'), link('pc2', 'eth1', 'sw3', 'eth5')],
  [{ x: 160, y: 40, w: 480, h: 330, label: 'Redundante Verkabelung: drei Wege, eine Schleife', color: 'yellow' }]);
}
export function stpSquare() {
  return topo('Vier Switches im Ring', [
    sw('sw1', 240, 110, {}, stpCfg(true, 4096)), sw('sw2', 560, 110, {}, stpCfg(true)), sw('sw3', 560, 340, { eth5: acc(1) }, stpCfg(true)), sw('sw4', 240, 340, {}, stpCfg(true)),
    host('pc1', 80, 110, '10.0.0.1'), host('pc3', 720, 340, '10.0.0.3')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth1'), link('sw3', 'eth2', 'sw4', 'eth2'), link('sw4', 'eth1', 'sw1', 'eth2'),
    link('pc1', 'eth1', 'sw1', 'eth5'), link('pc3', 'eth1', 'sw3', 'eth5')],
  [{ x: 170, y: 40, w: 460, h: 370, label: 'Ring aus vier Switches, sw1 ist Root', color: 'yellow' }]);
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
    { x: 290, y: 14, w: 220, h: 146, label: 'Router mit Subinterfaces', color: 'gray' }]);
}
export function servicesTopo({ acl = [] } = {}) {
  const web = server('web', 640, 110, '10.20.0.80', 24, '10.20.0.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 3000 }, { proto: 'tcp', port: 443, name: 'https', size: 3000 }];
  const dns = server('dns', 640, 330, '10.20.0.53', 24, '10.20.0.1');
  dns.services = [{ proto: 'udp', port: 53, name: 'dns' }];
  dns.dns = [{ name: 'web.lab', ip: '10.20.0.80' }, { name: 'dns.lab', ip: '10.20.0.53' }, { name: 'intranet.lab', ip: '10.20.0.80' }];
  const c1 = host('client', 100, 220, '10.10.0.10', 24, '10.10.0.1');
  c1.resolver = '10.20.0.53';
  return topo('Web und DNS', [c1, router('r1', 300, 220, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' }, [], { acl }), sw('sw1', 470, 220), web, dns],
    [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'sw1', 'eth1'), link('web', 'eth1', 'sw1', 'eth2'), link('dns', 'eth1', 'sw1', 'eth3')],
    [{ x: 400, y: 40, w: 340, h: 380, label: 'Servernetz 10.20.0.0/24', color: 'green' }]);
}
export function failoverTopo() {
  const a = server('srvA', 600, 110, '10.0.0.100'), b = server('srvB', 600, 330, '10.0.0.12');
  return topo('Failover mit Gratuitous ARP', [host('client', 120, 220, '10.0.0.5'), sw('sw1', 360, 220), a, b],
    [link('client', 'eth1', 'sw1', 'eth1'), link('srvA', 'eth1', 'sw1', 'eth2'), link('srvB', 'eth1', 'sw1', 'eth3')],
    [{ x: 500, y: 40, w: 220, h: 380, label: 'Cluster, Dienstadresse 10.0.0.100', color: 'orange' }]);
}
export function tcpPathTopo({ fwAcl = [] } = {}) {
  const web = server('web', 840, 220, '10.0.2.80', 24, '10.0.2.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 6000 }];
  return topo('TCP über einen Engpass', [host('client', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 270, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 460, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.2.0/24', '10.0.23.3']]),
    router('fw', 650, 220, { eth1: '10.0.23.3/24', eth2: '10.0.2.1/24' }, [['0.0.0.0/0', '10.0.23.2']], { acl: fwAcl }), web],
  [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'fw', 'eth1'), link('fw', 'eth2', 'web', 'eth1')],
  [{ x: 210, y: 130, w: 310, h: 150, label: 'Tunnel-Strecke, MTU 1400', color: 'orange' }]);
}
