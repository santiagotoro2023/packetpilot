import m1 from './m1.js';
import m2 from './m2.js';
import m3 from './m3.js';
import m4 from './m4.js';
import m5 from './m5.js';
import m6 from './m6.js';
import m7 from './m7.js';
import m8 from './m8.js';
import m9 from './m9.js';

// Display order: all of layer 2, then layer 3, VLAN/VXLAN, transport, then the network services
export const MODULES = [m1, m4, m2, m3, m5, m6, m7, m8, m9];
export const UPCOMING = [
  { title: 'IPv6', text: 'Addresses, Neighbor Discovery instead of ARP, SLAAC and dual stack.' },
  { title: 'ECMP and BFD', text: 'Several equally good paths, load balancing via hashes, and failure detection in milliseconds.' },
  { title: 'DNS in depth', text: 'The DNS hierarchy, recursive resolution and caching.' },
  { title: 'VPN', text: 'WireGuard and IPsec between sites, MTU with a double envelope.' },
  { title: 'BGP and EVPN', text: 'Routing between networks and a real control plane for VXLAN.' }
]
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
