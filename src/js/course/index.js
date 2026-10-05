import m1 from './m1.js';
import m2 from './m2.js';
import m3 from './m3.js';
import m4 from './m4.js';
import m5 from './m5.js';

// Display order: all of layer 2, then layer 3, VLAN/VXLAN, transport
export const MODULES = [m1, m4, m2, m3, m5];
export const UPCOMING = [
  { title: 'Static routing and ECMP', text: 'Several equally good paths, load balancing via hashes.' },
  { title: 'OSPF and BFD', text: 'Learn routes dynamically and detect failures in milliseconds.' },
  { title: 'VRRP', text: 'A gateway that does not fail.' },
  { title: 'DHCP and DNS in detail', text: 'Hand out addresses with a relay across routers, the DNS hierarchy and recursive resolution.' },
  { title: 'VPN', text: 'WireGuard and IPsec between sites, MTU with a double envelope.' },
  { title: 'BGP and EVPN', text: 'Routing between networks and a real control plane for VXLAN.' },
  { title: 'IPv6', text: 'Addresses, Neighbor Discovery instead of ARP, SLAAC and dual stack.' }
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
