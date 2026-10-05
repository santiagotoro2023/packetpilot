import m1 from './m1.js';
import m2 from './m2.js';
import m3 from './m3.js';
import m4 from './m4.js';
import m5 from './m5.js';

// Reihenfolge der Anzeige: Layer 2 komplett, dann Layer 3, VLAN/VXLAN, Transport
export const MODULES = [m1, m4, m2, m3, m5];
export const UPCOMING = [
  { title: 'Statisches Routing und ECMP', text: 'Mehrere gleich gute Wege, Lastverteilung über Hashes.' },
  { title: 'OSPF und BFD', text: 'Routen dynamisch lernen und Ausfälle in Millisekunden erkennen.' },
  { title: 'VRRP', text: 'Ein Gateway, das nicht ausfällt.' },
  { title: 'DHCP und DNS im Detail', text: 'Adressen verteilen mit Relay über Router, DNS-Hierarchie und rekursive Auflösung.' },
  { title: 'VPN', text: 'WireGuard und IPsec zwischen Standorten, MTU mit doppelter Hülle.' },
  { title: 'BGP und EVPN', text: 'Routing zwischen Netzen und eine echte Control Plane für VXLAN.' },
  { title: 'IPv6', text: 'Adressen, Neighbor Discovery statt ARP, SLAAC und Dual Stack.' }
];
export function findLesson(id) {
  for (const m of MODULES) {
    const i = m.lessons.findIndex(l => l.id === id);
    if (i >= 0) return { module: m, lesson: m.lessons[i], index: i };
  }
  return null;
}
export function nextLesson(id) {
  const flat = MODULES.flatMap(m => m.lessons);
  const i = flat.findIndex(l => l.id === id);
  return flat[i + 1] || null;
}
