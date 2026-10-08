import { note, tag, inspected, pingOk } from './helpers.js';
import { evpnTopo } from '../presets.js';

const isEvpnUpdate = f => f.type === 'ipv4' && (f.payload.l4?.bgp?.evpn?.length || 0) > 0;

export default {
  id: 'm15', title: 'EVPN: BGP for VXLAN', bands: ['vxlan', 'rt'],
  text: 'VXLAN with a real control plane: the VTEPs find each other and learn every MAC address over BGP, instead of static lists and flooding.',
  lessons: [
    { id: 'm15-l1', title: 'Why VXLAN needs a control plane', minutes: 14, steps: [
      { type: 'theory', title: 'From flood and learn to EVPN', html: `
<p>Plain VXLAN works like a big switch stretched over IP: unknown destinations are flooded to all VTEPs of the segment, and MAC addresses are learned from the packets that come back (<b>flood and learn</b>). That has three problems:</p>
<ul><li>Without multicast in the underlay, every VTEP needs a <b>static flood list</b> of all other VTEPs. A new VTEP means touching every other one.</li>
<li>Broadcast, unknown unicast and multicast (BUM) are copied to every VTEP. Every ARP request crosses the whole fabric.</li>
<li>A MAC is only known after it has sent something, and after a move the old entry stays until it ages out.</li></ul>
<p><b>EVPN</b> (Ethernet VPN, RFC 7432 and 8365) solves this with BGP: the VTEPs announce what they know, like routers announce networks. The address family is <code>l2vpn evpn</code>, the transport iBGP or eBGP as usual.</p>
<h2>Route types</h2>
<table><tr><th>Type</th><th>Name</th><th>Meaning</th></tr>
<tr><td><b>2</b></td><td>MAC/IP advertisement</td><td>"The host with this MAC (and IP) is behind me, in VNI 10010"</td></tr>
<tr><td><b>3</b></td><td>Inclusive multicast</td><td>"I take part in VNI 10010: send me its flooded traffic"</td></tr>
<tr><td>5</td><td>IP prefix</td><td>routing between VNIs (not in this course)</td></tr>
<tr><td>1, 4</td><td>Ethernet auto-discovery (1), Ethernet segment (4)</td><td>one host connected to two VTEPs (multihoming)</td></tr></table>
<p>Type 3 routes build the flood lists automatically. Type 2 routes fill the MAC tables of all VTEPs, so unicast to every announced host goes straight to the right VTEP. Only MACs that nobody has announced yet are still flooded. With <b>ARP suppression</b> a VTEP even answers an ARP request itself when it knows the IP from a type 2 route.</p>
<h2>Who talks to whom</h2>
<p>In a leaf-spine fabric the leaves are VTEPs. They do not peer with each other. In an iBGP fabric the spines are <b>route reflectors</b>, every leaf has one iBGP session per spine (fabrics with eBGP between leaf and spine need none). The route reflector itself does not need VXLAN, it only passes the EVPN routes on.</p>
${note('Each route also carries a route distinguisher and route targets, so that several tenants can use the same MAC or IP. Here every VNI simply has its own.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A new VTEP joins VNI 10010. Which route tells the others to include it in their flood list?', options: ['Type 2', 'Type 3', 'Type 5', 'A static entry'], correct: 1 },
        { q: 'vtep1 knows the MAC of a host behind vtep3 before the host ever sent a frame to vtep1. Why?', options: ['Flood and learn', 'vtep3 announced it in a type 2 route', 'ARP', 'The spine told vtep1 over VXLAN'], correct: 1 },
        { q: 'What does ARP suppression save?', options: ['Bandwidth on the access port', 'Flooding ARP requests to all VTEPs', 'BGP sessions', 'The MAC table'], correct: 1 },
        { q: 'Does the spine route reflector need its own VXLAN interface for EVPN?', options: ['Yes', 'No, it only reflects the BGP routes'], correct: 1 }] }
    ] },

    { id: 'm15-l2', title: 'VTEPs find each other', minutes: 16, steps: [
      { type: 'lab', title: 'A VTEP without EVPN', topo: () => evpnTopo({ evpn: ['vtep1', 'vtep2'] }), edit: 'config',
        intro: '<p>Three VTEPs carry VNI 10010. None has a static flood list. vtep1 and vtep2 use EVPN, vtep3 runs BGP but its segment is not marked for EVPN yet. The spine reflects the routes.</p>',
        presets: { srv1: ['ping -c 2 192.168.10.12', 'ping -c 2 192.168.10.13'], vtep1: ['show vxlan', 'show bgp l2vpn evpn', 'show evpn mac'], vtep3: ['show vxlan', 'show ip bgp summary'], spine: ['show ip bgp summary'] },
        goals: [
          { text: 'srv1 pings srv2 (192.168.10.12).', check: pingOk('srv1', '192.168.10.12') },
          { text: 'How many remote VTEPs does vtep1 have in its flood list? (show vxlan)', ask: true, expect: () => ['1', 'one'] },
          { text: 'Turn on EVPN for the segment on vtep3. srv1 then reaches srv3 (192.168.10.13).', check: pingOk('srv1', '192.168.10.13') },
          { text: 'Which route type told vtep1 that vtep3 takes part in VNI 10010?', ask: true, expect: () => ['3', 'type 3'] },
          { text: 'From which BGP neighbor did vtep1 receive that route?', ask: true, expect: () => ['10.255.0.254', 'spine'] },
          { text: 'Click a BGP UPDATE with EVPN routes in the log and look at it in the packet inspector.', check: inspected(isEvpnUpdate) }],
        hints: ['The segment settings of vtep3 are under Configuration: the checkbox "EVPN".', 'show bgp l2vpn evpn on vtep1 lists every route with its type and where it came from.'],
        outro: '<p>As soon as vtep3 announced its type 3 route, the spine reflected it to vtep1 and vtep2, and both added 10.255.0.3 to their flood lists. Nobody had to type an address. That is the difference to plain VXLAN with static flood lists.</p>' }
    ] },

    { id: 'm15-l3', title: 'MAC learning over BGP', minutes: 16, steps: [
      { type: 'lab', title: 'Nothing is flooded twice', topo: () => evpnTopo(), edit: 'config',
        intro: '<p>All three VTEPs use EVPN with ARP suppression. At the start no VTEP knows any MAC address, because no host has sent anything yet.</p>',
        presets: { srv1: ['ping -c 1 192.168.10.13'], srv2: ['ping -c 1 192.168.10.13'], vtep1: ['show evpn mac', 'show bgp l2vpn evpn'], vtep2: ['show evpn mac'] },
        goals: [
          { text: 'srv1 pings srv3 (192.168.10.13).', check: pingOk('srv1', '192.168.10.13') },
          { text: 'Now srv2 pings srv3. Who answers the ARP request of srv2 for 192.168.10.13? (the log of vtep2)', ask: true, expect: () => ['vtep2'] },
          { text: 'The ARP request of srv2 was not flooded into the fabric.', check: tag('vtep2', 'evpn-arp-suppress') },
          { text: 'vtep1 knows the MAC of srv2, although srv2 never sent a frame to vtep1. With which route type did it learn it?', ask: true, expect: () => ['2', 'type 2'] },
          { text: 'Behind which VTEP is 192.168.10.13? (show evpn mac on vtep1)', ask: true, expect: () => ['10.255.0.3', 'vtep3'] }],
        hints: ['Each VTEP announces the MACs it learns on its access ports as type 2 routes, with the IP it saw in their ARP or IP packets.', 'Filter the log to vtep2 and look for "ARP suppression".'],
        outro: '<p>The first ARP request of srv1 still had to be flooded: nobody knew srv3 yet. Its reply taught vtep3 the MAC and IP of srv3, which went out to all VTEPs as a type 2 route. From then on, vtep2 could answer the ARP request of srv2 itself. In a data center with thousands of hosts this removes most of the flooding.</p>' }
    ] }
  ]
};
