// Shareable links: the whole network travels compressed in the URL fragment.
// Nothing is uploaded, the server never sees the part after the #.
import { pack, unpack } from './core/pack.js';

/** Smallest form of a topology: drop defaults that normalizeDevice fills in again */
function slim(topo) {
  const t = JSON.parse(JSON.stringify(topo));
  for (const d of t.devices || []) {
    for (const [k, p] of Object.entries(d.ports || {})) if (p.mode === 'access' && Number(p.vlan) === 1 && !p.edge && Number(p.cost ?? 4) === 4) delete d.ports[k];
    for (const [k, i] of Object.entries(d.ifaces || {})) if (!i.ip && !i.parent && !i.dhcp && !i.helper && k !== 'eth1') delete d.ifaces[k];
    if (d.acl && !d.acl.length) delete d.acl;
    if (d.routes && !d.routes.length) delete d.routes;
    if (d.vrrp && !d.vrrp.length) delete d.vrrp;
    if (d.nat && !d.nat.outside && !d.nat.forwards?.length) delete d.nat;
    if (d.ospf && !d.ospf.enabled) delete d.ospf;
    if (d.dhcpServer && !d.dhcpServer.enabled) delete d.dhcpServer;
    if (d.dns && !d.dns.length) delete d.dns;
  }
  return t;
}

export { pack, unpack };
export const encodeTopo = topo => pack(slim(topo));
export async function decodeTopo(code) {
  const t = await unpack(code);
  if (!Array.isArray(t.devices) || !Array.isArray(t.links)) throw new Error('not a network');
  return t;
}
/** Links point to the main address of the server when it has one (see site.json) */
export async function shareLink(topo, base = location.origin + location.pathname) {
  return `${base}#/share/${await encodeTopo(topo)}`;
}
