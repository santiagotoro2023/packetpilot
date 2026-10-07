// Glossary: technical terms in the course text get a short explanation on hover, focus or tap.
// Only the first occurrence per block is marked, so the text stays calm.
export const GLOSSARY = [
  ['ARP', 'Address Resolution Protocol: finds the MAC address that belongs to an IP address in the local network.'],
  ['gratuitous ARP', 'An unsolicited ARP announcement of one\'s own address, used after a failover so neighbors update their tables.'],
  ['MAC address', '48-bit hardware address of a network interface, valid only in the local segment.', ['MAC addresses', 'MAC']],
  ['OUI', 'Organizationally Unique Identifier: the first three bytes of a MAC address, assigned to the manufacturer.'],
  ['broadcast', 'A message to all devices in the segment, MAC ff:ff:ff:ff:ff:ff or IP 255.255.255.255.', ['broadcasts']],
  ['multicast', 'A message to a group of interested devices, e.g. 224.0.0.5 for all OSPF routers.'],
  ['unicast', 'A message to exactly one device.'],
  ['frame', 'The unit of data on layer 2: Ethernet header, payload and checksum.', ['frames']],
  ['packet', 'The unit of data on layer 3: an IP header and its payload.', ['packets']],
  ['segment', 'A TCP data unit, or a part of the network between two routers.', ['segments']],
  ['datagram', 'A UDP data unit: sent once, without acknowledgment.', ['datagrams']],
  ['payload', 'The data a layer carries for the layer above it.'],
  ['header', 'Control information a layer puts in front of the payload.', ['headers']],
  ['encapsulation', 'Wrapping the data of the upper layer into the header of the lower layer.'],
  ['MTU', 'Maximum Transmission Unit: the largest payload a link carries in one frame, usually 1500 bytes.'],
  ['MSS', 'Maximum Segment Size: the largest amount of TCP data in one segment, normally the MTU minus 40.'],
  ['TTL', 'Time To Live: every router subtracts one, at 0 the packet is dropped. Prevents endless loops.'],
  ['FCS', 'Frame Check Sequence: a CRC-32 checksum at the end of every Ethernet frame.'],
  ['EtherType', 'Field in the Ethernet header that says what the payload is: 0x0800 IPv4, 0x0806 ARP, 0x8100 VLAN tag.'],
  ['VLAN', 'Virtual LAN: splits one switch into several separate layer 2 networks.', ['VLANs']],
  ['trunk', 'A switch port that carries several VLANs, each frame marked with an 802.1Q tag.', ['trunks']],
  ['access port', 'A switch port in exactly one VLAN, frames without a tag.', ['access ports']],
  ['native VLAN', 'The one VLAN on a trunk whose frames travel without a tag.'],
  ['802.1Q', 'The standard for VLAN tags: 4 bytes inserted after the source MAC.'],
  ['subinterface', 'A logical interface for one VLAN on a router port, e.g. eth1.10.', ['subinterfaces']],
  ['VXLAN', 'Virtual Extensible LAN: carries Ethernet frames inside UDP across a routed network.'],
  ['VNI', 'VXLAN Network Identifier: the 24-bit number of an overlay segment.'],
  ['VTEP', 'VXLAN Tunnel Endpoint: wraps frames into VXLAN and unwraps them.', ['VTEPs']],
  ['underlay', 'The routed network that carries the tunnels.'],
  ['overlay', 'Virtual networks built on top of the underlay with tunnels.'],
  ['spanning tree', 'Protocol (STP, 802.1D) that blocks redundant switch ports so no loop forms.', ['Spanning tree', 'STP']],
  ['BPDU', 'Bridge Protocol Data Unit: the messages spanning tree switches exchange.', ['BPDUs']],
  ['root bridge', 'The switch at the center of the spanning tree, the one with the lowest bridge ID.'],
  ['PortFast', 'Lets a switch port to an end device forward immediately instead of waiting 30 seconds.'],
  ['RSTP', 'Rapid Spanning Tree Protocol (802.1w): the same tree as STP, but ports are negotiated with proposal and agreement in milliseconds instead of timers.', ['Rapid spanning tree', 'rapid spanning tree']],
  ['edge port', 'A switch port to an end device. It forwards immediately and never causes a topology change.', ['edge ports']],
  ['proposal', 'RSTP: a designated port asks its neighbor whether it may forward right away.'],
  ['agreement', 'RSTP: the answer to a proposal. The neighbor sends it after blocking its own other ports (sync).'],
  ['alternate port', 'A blocked port with a second path to the root. With RSTP it takes over at once when the root port fails.', ['Alternate port', 'alternate ports']],
  ['broadcast storm', 'Broadcasts circling endlessly in a loop until the network stands still.'],
  ['subnet', 'A range of addresses that share the same network part, e.g. 192.168.10.0/24.', ['subnets', 'subnetting']],
  ['prefix', 'The number after the slash: how many bits belong to the network, e.g. /24.'],
  ['subnet mask', 'The prefix written as an address, e.g. 255.255.255.0 for /24.'],
  ['default gateway', 'The router a host sends everything to that is not in its own network.', ['gateway']],
  ['routing table', 'The list of networks a device knows and where to send packets for them.'],
  ['longest prefix match', 'Rule for choosing a route: the most specific matching entry wins.'],
  ['next hop', 'The next router on the way to the destination.'],
  ['static route', 'A route entered by hand.', ['static routes']],
  ['administrative distance', 'Trust in the source of a route: connected 0, static 1, OSPF 110. Lower wins.'],
  ['ICMP', 'Internet Control Message Protocol: error and test messages like ping and "Destination Unreachable".'],
  ['traceroute', 'Shows the routers on a path by sending packets with increasing TTL.'],
  ['fragmentation', 'Splitting an IP packet that is too large for a link into smaller pieces.'],
  ['PMTUD', 'Path MTU Discovery: the sender learns the smallest MTU on the path from ICMP "Fragmentation Needed" messages.', ['Path MTU Discovery']],
  ['TCP', 'Transmission Control Protocol: a reliable byte stream with acknowledgments and retransmission.'],
  ['UDP', 'User Datagram Protocol: simple datagrams without connection or acknowledgment.'],
  ['port', 'A 16-bit number that tells which program on a host gets the data, e.g. 443 for HTTPS.', ['ports']],
  ['socket', 'The combination of IP address, protocol and port of one end of a connection.'],
  ['three-way handshake', 'SYN, SYN/ACK, ACK: how TCP opens a connection.'],
  ['SYN', 'TCP flag to open a connection.'],
  ['RST', 'TCP flag that aborts a connection, e.g. when a port is closed.'],
  ['retransmission', 'Sending data again that was not acknowledged in time.'],
  ['DNS', 'Domain Name System: translates names like web.lab into IP addresses.'],
  ['NXDOMAIN', 'DNS answer: this name does not exist.'],
  ['DHCP', 'Dynamic Host Configuration Protocol: hands out IP addresses, gateway and DNS automatically.'],
  ['lease', 'The time a DHCP address is lent to a client.', ['leases']],
  ['DHCP relay', 'A router that forwards DHCP broadcasts to a server in another network.', ['relay', 'helper address']],
  ['giaddr', 'Field the DHCP relay fills with its own address, so the server picks the right pool.'],
  ['NAT', 'Network Address Translation: a router rewrites addresses, typically private to public.'],
  ['PAT', 'Port Address Translation: many inside hosts share one outside address, told apart by port.', ['masquerade', 'masquerading']],
  ['port forward', 'A NAT rule that sends traffic for an outside port to an inside host.', ['port forwards', 'port forwarding']],
  ['conntrack', 'The connection tracking table of Linux, it remembers every NAT translation.'],
  ['OSPF', 'Open Shortest Path First: a link-state routing protocol, routers share a map and compute shortest paths.'],
  ['LSA', 'Link-State Advertisement: one router\'s description of its links in OSPF.', ['LSAs']],
  ['LSDB', 'Link-state database: the map of the network every OSPF router collects.'],
  ['SPF', 'Shortest Path First: the Dijkstra algorithm OSPF uses to compute routes.'],
  ['router ID', 'The unique 32-bit name of an OSPF router, written like an IP address.'],
  ['adjacency', 'Two OSPF neighbors that have synchronized their databases (state Full).'],
  ['hello', 'Small periodic message to find and keep neighbors (OSPF, VRRP advertisements are similar).', ['hellos']],
  ['dead interval', 'How long OSPF waits without a hello before it declares a neighbor down.'],
  ['VRRP', 'Virtual Router Redundancy Protocol: several routers share one gateway address, one is master.'],
  ['virtual MAC', 'The MAC address of a VRRP group, 00:00:5e:00:01 followed by the group number.'],
  ['preempt', 'VRRP: a router with a higher priority takes the master role back.', ['preemption']],
  ['failover', 'Switching to a backup automatically when something fails.'],
  ['latency', 'The delay a packet needs from one end to the other.'],
  ['packet loss', 'Packets that never arrive, in percent.'],
  ['loopback', 'A virtual interface that is always up, often used as a stable router address.'],
  ['ECMP', 'Equal-Cost Multi-Path: several equally good routes used at the same time.'],
  ['BFD', 'Bidirectional Forwarding Detection: neighbors exchange tiny packets every few hundred milliseconds and report a dead neighbor to OSPF, BGP or static routes in under a second.'],
  ['discriminator', 'A random number that identifies one BFD session on each side, so both routers know which session a packet belongs to.', ['discriminators']],
  ['floating static route', 'A backup static route with a higher administrative distance; it only enters the routing table when the better route disappears.', ['floating static routes', 'floating route']],
  ['hash policy', 'Which header fields a router feeds into the hash that picks one of several ECMP paths: layer 3 (addresses) or layer 4 (addresses, protocol and ports).'],
  ['detection time', 'How long BFD waits without a packet before it declares the neighbor dead: interval × multiplier.'],
  ['RFC 1918', 'The standard that reserves 10/8, 172.16/12 and 192.168/16 for private networks.']
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ENTRIES = GLOSSARY.flatMap(([term, def, alts = []]) => [term, ...alts].map(w => ({ w, term, def, exact: w === w.toUpperCase() && /[A-Z]/.test(w) })));
ENTRIES.sort((a, b) => b.w.length - a.w.length);
const RX = new RegExp(`(?<![\\w./:-])(${ENTRIES.map(e => esc(e.w)).join('|')})(?![\\w/:-])`, 'gi');
const lookup = w => ENTRIES.find(e => e.exact ? e.w === w : e.w.toLowerCase() === w.toLowerCase());

const BLOCKS = '.theory p, .theory li, .theory td, .theory .note, .quiz-q > div, .opts span, .goals .txt > span, .explain, .hint, .symptom, .netcard p, .module p.muted, .widget > p';
const SKIP = 'code, pre, a, button, input, textarea, select, abbr, svg, h1, h2, h3, .feedback, .crumb';

function markBlock(block) {
  if (block.dataset.gl) return;
  block.dataset.gl = '1';
  const seen = new Set();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    RX.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = RX.exec(text))) {
      const e = lookup(m[1]);
      if (!e || seen.has(e.term)) continue;
      seen.add(e.term);
      frag ??= document.createDocumentFragment();
      frag.append(text.slice(last, m.index));
      const a = document.createElement('abbr');
      a.className = 'gl'; a.tabIndex = 0; a.dataset.def = e.def; a.dataset.term = e.term; a.textContent = m[1];
      frag.append(a);
      last = m.index + m[1].length;
    }
    if (frag) { frag.append(text.slice(last)); node.replaceWith(frag); }
  }
}

/** Mark terms in all text blocks below root */
export function glossify(root) {
  if (root.matches?.(BLOCKS)) markBlock(root);
  root.querySelectorAll?.(BLOCKS).forEach(markBlock);
}

// One tooltip for the whole page
let tip;
function show(a) {
  tip ??= Object.assign(document.createElement('div'), { className: 'gl-tip', role: 'tooltip', id: 'gl-tip' });
  if (!tip.isConnected) document.body.append(tip);
  tip.innerHTML = '';
  const b = document.createElement('b'); b.textContent = a.dataset.term;
  tip.append(b, document.createTextNode(' ' + a.dataset.def));
  a.setAttribute('aria-describedby', 'gl-tip');
  tip.classList.add('on');
  const r = a.getBoundingClientRect(), t = tip.getBoundingClientRect();
  const x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
  const above = r.top > t.height + 14;
  tip.style.left = `${x}px`;
  tip.style.top = `${above ? r.top - t.height - 8 : r.bottom + 8}px`;
}
function hide() { tip?.classList.remove('on'); }

export function initGlossary(main) {
  const target = e => e.target.closest?.('abbr.gl');
  document.addEventListener('mouseover', e => { const a = target(e); if (a) show(a); });
  document.addEventListener('mouseout', e => { if (target(e)) hide(); });
  document.addEventListener('focusin', e => { const a = target(e); if (a) show(a); else hide(); });
  document.addEventListener('click', e => { const a = target(e); if (a) { e.preventDefault(); show(a); } else hide(); }, true);
  document.addEventListener('scroll', hide, true);
  // New content (lesson steps, outros, explanations) is marked as it appears
  let queued = new Set(), timer = null;
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && !n.closest('.log, .console, .inspector, svg')) queued.add(n);
    if (queued.size && !timer) timer = setTimeout(() => { timer = null; const q = queued; queued = new Set(); for (const n of q) if (n.isConnected) glossify(n); }, 60);
  }).observe(main, { childList: true, subtree: true });
}
