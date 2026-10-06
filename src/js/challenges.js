// Troubleshooting challenges: a network with a hidden fault, a symptom and a goal.
// Every challenge has several variants with a different cause, one is picked at random.
import { PRESETS, chainTopo, vlanTopo, tcpPathTopo, dhcpTopo, natTopo, ospfTopo, vrrpTopo, stpTriangle, servicesTopo } from './presets.js';

const preset = id => PRESETS.find(p => p.id === id).make();
const dev = (t, id) => t.devices.find(d => d.id === id);
const link = (t, a, b) => t.links.find(l => (l.a.dev === a && l.b.dev === b) || (l.a.dev === b && l.b.dev === a));

// Goal checks
const pingAfterStart = (from, to) => sim => sim.log.some(e => e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received > 0);
const curlOk = (from, port = 80) => sim => sim.log.some(e => e.dev === from && e.tag === 'tcp-done' && e.data.ok && e.data.mode === 'http' && (!port || e.data.port === port));
const leased = d => sim => !!sim.dev(d)?.l3?.lease;

export const LEVELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

export const CHALLENGES = [
  { id: 'gateway', level: 1, title: 'The new PC only reaches its own network', topics: ['Gateway', 'Subnet mask'],
    symptom: '<p>A colleague set up <b>pc1</b>. It can ping pc2 next to it, but not the server srv1 behind the router. pc2 works fine.</p>',
    topo: () => preset('routed'),
    variants: [
      { fault: t => { dev(t, 'pc1').gw = '192.168.10.254'; }, cause: 'pc1 had the wrong default gateway 192.168.10.254. Nobody answers ARP for it, so pc1 reports "Destination Host Unreachable" for everything outside its network.' },
      { fault: t => { dev(t, 'pc1').gw = ''; }, cause: 'pc1 had no default gateway at all. Without one, Linux answers "Network is unreachable" for every address outside its own subnet.' },
      { fault: t => { dev(t, 'pc1').ifaces.eth1.prefix = 16; }, cause: 'pc1 had the prefix /16 instead of /24. It believed 192.168.20.20 was in its own network and asked for it via ARP directly instead of going through the gateway.' }],
    goals: [{ text: 'pc1 reaches srv1 (192.168.20.20).', check: pingAfterStart('pc1', '192.168.20.20') }],
    hints: ['Compare the configuration of pc1 and pc2.', 'Watch what pc1 asks for via ARP when you ping srv1.'],
    presets: { pc1: ['ping -c 2 192.168.20.20', 'ip route', 'ip addr', 'ip neigh'], pc2: ['ip route', 'ip addr'] } },

  { id: 'oneway', level: 2, title: 'The ping gets there, but never comes back', topics: ['Routing', 'Return path'],
    symptom: '<p>pc1 cannot reach srv1 across three routers. The admin of srv1 swears the pings arrive.</p>',
    topo: () => chainTopo(),
    variants: [
      { fault: t => { dev(t, 'r2').routes = [{ dst: '10.0.4.0/24', via: '10.0.23.3' }]; }, cause: 'r2 had no route back to 10.0.1.0/24. The echo request went through, the reply died at r2 with "no route".' },
      { fault: t => { dev(t, 'r3').routes = []; }, cause: 'r3 had lost its default route. It could deliver to srv1 but not send the reply back towards pc1.' },
      { fault: t => { dev(t, 'srv1').gw = '10.0.4.254'; }, cause: 'srv1 had the wrong gateway 10.0.4.254. Its replies never left its own network.' }],
    goals: [{ text: 'pc1 reaches srv1 (10.0.4.10).', check: pingAfterStart('pc1', '10.0.4.10') }],
    hints: ['Filter the log to srv1: does the echo request arrive?', 'Follow the reply: which device drops it, and why?'],
    presets: { pc1: ['ping -c 1 10.0.4.10', 'traceroute 10.0.4.10'], srv1: ['ip route'], r2: ['ip route'], r3: ['ip route'] } },

  { id: 'storm', level: 1, title: 'Everything stopped after the new cable', topics: ['STP', 'Loop'],
    symptom: '<p>Someone added a third cable between the switches "for redundancy". Since then, the first ping brings the whole network down.</p>',
    topo: () => stpTriangle({ enabled: true, rootPrio: 4096 }),
    variants: [
      { fault: t => { for (const id of ['sw1', 'sw2', 'sw3']) dev(t, id).stp.enabled = false; }, cause: 'Spanning tree was off on all three switches. With the triangle of cables there was a loop, and the first broadcast circled forever.' },
      { fault: t => { dev(t, 'sw3').stp.enabled = false; dev(t, 'sw2').stp.enabled = false; }, cause: 'Spanning tree was off on sw2 and sw3. sw1 alone could not block the loop, because the port that has to block was on a switch without STP.' }],
    goals: [{ text: 'pc1 pings pc2 (10.0.0.2) without a broadcast storm.', check: sim => !sim.halted && pingAfterStart('pc1', '10.0.0.2')(sim) }],
    hints: ['After a storm, reset the state with the circular arrow button.', 'Which protocol prevents loops on layer 2, and is it running on every switch?'],
    presets: { pc1: ['ping -c 2 10.0.0.2'], sw1: ['show spanning-tree'], sw2: ['show spanning-tree'], sw3: ['show spanning-tree'] } },

  { id: 'vlan', level: 2, title: 'VLAN 20 is cut in half', topics: ['VLAN', 'Trunk'],
    symptom: '<p>a10 and b10 in VLAN 10 work. a20 and b20 in VLAN 20 cannot reach each other, even though they are in the same VLAN.</p>',
    topo: () => vlanTopo(true),
    variants: [
      { fault: t => { dev(t, 's2').ports.eth8.allowed = '10'; }, cause: 'The trunk on s2 only allowed VLAN 10. Frames tagged with VLAN 20 were dropped at s2.' },
      { fault: t => { dev(t, 's1').ports.eth2 = { mode: 'access', vlan: 10 }; }, cause: 'The port of a20 on s1 was an access port in VLAN 10 instead of 20. a20 was in the wrong VLAN.' },
      { fault: t => { dev(t, 's1').ports.eth8.allowed = '10,30'; }, cause: 'The trunk on s1 allowed VLANs 10 and 30, but not 20. A typo in the allowed list.' }],
    goals: [{ text: 'a20 reaches b20 (10.20.0.2).', check: pingAfterStart('a20', '10.20.0.2') }, { text: 'a10 still reaches b10 (10.10.0.2).', check: pingAfterStart('a10', '10.10.0.2') }],
    hints: ['The log of each switch tells you when it drops a frame and why.', 'Compare the port configuration of s1 and s2.'],
    presets: { a20: ['ping -c 1 10.20.0.2'], a10: ['ping -c 1 10.10.0.2'], s1: ['bridge fdb'], s2: ['bridge fdb'] } },

  { id: 'dhcp', level: 1, title: 'New clients get no address', topics: ['DHCP', 'Relay'],
    symptom: '<p>The clients in 10.10.0.0/24 boot, but never get an address. The DHCP server in 10.20.0.0/24 is running.</p>',
    topo: () => dhcpTopo({ relay: true }),
    variants: [
      { fault: t => { delete dev(t, 'r1').ifaces.eth1.helper; }, cause: 'r1 had no DHCP relay (helper address) on eth1. The broadcasts of the clients stopped at the router.' },
      { fault: t => { dev(t, 'r1').ifaces.eth1.helper = '10.20.0.68'; }, cause: 'The helper address on r1 pointed to 10.20.0.68 instead of the server 10.20.0.67. The relayed requests went nowhere.' },
      { fault: t => { dev(t, 'dhcp').dhcpServer.pools[0].net = '10.11.0.0/24'; }, cause: 'The pool on the server was for 10.11.0.0/24. The relay marked the requests with giaddr 10.10.0.1, and the server had no pool for that network.' }],
    goals: [{ text: 'client1 gets an address.', check: leased('client1') }, { text: 'client2 gets an address.', check: leased('client2') }],
    hints: ['Let a client ask again with dhclient and follow the Discover.', 'Look at the logs of r1 and of the server.'],
    presets: { client1: ['dhclient', 'ip addr'], client2: ['dhclient'], dhcp: ['show ip dhcp binding'] } },

  { id: 'nat', level: 2, title: 'No internet at home', topics: ['NAT', 'Routing'],
    symptom: '<p>Since the router was replaced, nothing on the internet is reachable from home. The web server 198.51.100.80 is up.</p>',
    topo: () => natTopo({ nat: true }),
    variants: [
      { fault: t => { dev(t, 'home').nat.outside = 'eth1'; }, cause: 'NAT was set up with eth1 as the outside interface, which is the inside. Packets to the internet left untranslated with their private source address.' },
      { fault: t => { dev(t, 'home').routes = []; }, cause: 'The router had no default route to the provider. It did not know where to send anything outside its own networks.' },
      { fault: t => { dev(t, 'home').nat.masquerade = false; }, cause: 'Masquerading was off, so only port forwards were translated. Outgoing connections left with private source addresses and the answers could not find their way back.' }],
    goals: [{ text: 'pc1 fetches http://198.51.100.80/.', check: curlOk('pc1') }],
    hints: ['Look at the source address of the packets between home and isp.', 'Check the routing table and NAT settings of home.'],
    presets: { pc1: ['curl http://198.51.100.80/', 'ping -c 1 198.51.100.80'], home: ['conntrack -L', 'show ip route'] } },

  { id: 'dns', level: 1, title: '"Could not resolve host"', topics: ['DNS', 'UDP'],
    symptom: '<p><code>curl http://10.20.0.80/</code> works, but <code>curl http://web.lab/</code> fails.</p>',
    topo: () => servicesTopo(),
    variants: [
      { fault: t => { dev(t, 'client').resolver = '10.20.0.54'; }, cause: 'The client used 10.20.0.54 as its DNS server, which does not exist. The query timed out.' },
      { fault: t => { dev(t, 'dns').dns = dev(t, 'dns').dns.filter(r => r.name !== 'web.lab'); }, cause: 'The DNS server had no A record for web.lab and answered NXDOMAIN.' },
      { fault: t => { dev(t, 'r1').acl = [{ action: 'drop', proto: 'udp', port: 53, src: 'any', dst: 'any' }]; }, cause: 'A rule on r1 dropped UDP port 53. The DNS queries never reached the server.' }],
    goals: [{ text: 'client fetches http://web.lab/.', check: sim => sim.log.some(e => e.dev === 'client' && e.tag === 'dns-done' && e.data.ok && e.data.name === 'web.lab') && curlOk('client')(sim) }],
    hints: ['Try dig web.lab on the client and read the answer.', 'Is the DNS server reachable at all? Is there a record for web.lab?'],
    presets: { client: ['curl http://web.lab/', 'dig web.lab', 'dig @10.20.0.53 web.lab'], dns: ['ss -tuln'] } },

  { id: 'ospf', level: 2, title: 'One site is missing from the map', topics: ['OSPF'],
    symptom: '<p>Three sites run OSPF. pc1 cannot reach the server srv3 at site 3.</p>',
    topo: () => ospfTopo(),
    variants: [
      { fault: t => { dev(t, 'o3').ospf.ifaces.eth3.enabled = false; }, cause: 'o3 did not have OSPF enabled on eth3, so it never advertised the network 10.3.0.0/24 of srv3.' },
      { fault: t => { dev(t, 'o3').ospf.timers = 'standard'; }, cause: 'o3 used the standard timers (hello 10, dead 40) while its neighbors used 1 and 4. The hellos were ignored and o3 had no neighbors.' },
      { fault: t => { dev(t, 'o3').ospf.ifaces.eth1.passive = true; dev(t, 'o3').ospf.ifaces.eth2.passive = true; }, cause: 'Both uplinks of o3 were set to passive. Passive interfaces send no hellos, so o3 never formed an adjacency.' }],
    goals: [{ text: 'pc1 reaches srv3 (10.3.0.10).', check: pingAfterStart('pc1', '10.3.0.10') }, { text: 'pc2 reaches srv3 too.', check: pingAfterStart('pc2', '10.3.0.10') }],
    hints: ['show ip ospf neighbor on each router.', 'Does 10.3.0.0/24 appear in show ip ospf database?'],
    presets: { pc1: ['ping -c 1 10.3.0.10'], pc2: ['ping -c 1 10.3.0.10'], o1: ['show ip route', 'show ip ospf database'], o3: ['show ip ospf neighbor', 'show ip ospf interface'] } },

  { id: 'vrrp', level: 3, title: 'The failover test failed', topics: ['VRRP', 'OSPF'],
    symptom: '<p>ra and rb should share the gateway 10.0.0.1. In the failover test, the network went down as soon as ra lost its LAN cable.</p>',
    topo: () => vrrpTopo(),
    variants: [
      { fault: t => { dev(t, 'rb').vrrp[0].ifname = 'eth2'; }, cause: 'rb had its VRRP group on the uplink eth2 instead of the LAN interface eth1. On the LAN, only ra was in the group, and nobody took over when it failed.' },
      { fault: t => { dev(t, 'rb').ospf.ifaces.eth1.enabled = false; }, cause: 'rb did not advertise the LAN 10.0.0.0/24 via OSPF. After the failover, core had no way back to the hosts.' },
      { fault: t => { dev(t, 'rb').vrrp = []; }, cause: 'rb was not part of the VRRP group at all. When ra failed, nobody answered for 10.0.0.1 any more.' }],
    goals: [{ text: 'Run a long ping from pc1 to srv (10.50.0.5) and disconnect ra\'s cable to sw1 while it runs: the ping continues.',
      check: sim => { const cut = sim.log.find(e => e.tag === 'link-down' && /ra eth1/.test(e.text)); return !!cut && sim.log.some(e => e.seq > cut.seq && e.t - cut.t > 2000 && e.t - cut.t < 8000 && e.dev === 'pc1' && e.tag === 'echo-reply-received'); } }],
    hints: ['Compare show vrrp on ra and rb.', 'After the failover: does core still know a route to 10.0.0.0/24?'],
    presets: { pc1: ['ping -c 40 10.50.0.5', 'ip neigh'], ra: ['show vrrp', 'ip link set eth1 down', 'ip link set eth1 up'], rb: ['show vrrp', 'show ip ospf interface'], core: ['show ip route'] } },

  { id: 'slow', level: 2, title: 'The web page is painfully slow', topics: ['Packet loss', 'TCP'],
    symptom: '<p>Fetching the web page sometimes takes seconds, pings show strange gaps. The servers are idle.</p>',
    topo: () => servicesTopo(),
    variants: [
      { fault: t => { link(t, 'r1', 'sw1').loss = 30; }, cause: 'The link between r1 and sw1 lost 30 % of all frames, a broken cable or port. TCP retransmitted, which made everything slow. Pings simply showed losses.' },
      { fault: t => { link(t, 'client', 'r1').loss = 25; link(t, 'client', 'r1').delay = 150; }, cause: 'The link between client and r1 had 25 % packet loss and 150 ms latency, like a bad wireless connection.' }],
    goals: [{ text: 'Find the bad link and repair it (no more loss).', check: sim => sim.topo.links.every(l => !(Number(l.loss) > 0)) },
      { text: 'Then fetch http://web.lab/ from the client.', check: sim => sim.topo.links.every(l => !(Number(l.loss) > 0)) && curlOk('client')(sim) }],
    hints: ['Ping the devices one hop after the other and compare the losses.', 'The log shows "Frame lost on the link" for every lost frame. Click a cable to see its properties.'],
    presets: { client: ['ping -c 20 10.10.0.1', 'ping -c 20 10.20.0.80', 'curl http://web.lab/'] } },

  { id: 'mtu', level: 3, title: 'Small pages load, large ones hang', topics: ['MTU', 'PMTUD', 'TCP'],
    symptom: '<p>The connection to the web server is established, but the page never arrives. Ping works.</p>',
    topo: () => tcpPathTopo({ fwAcl: [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }),
    variants: [
      { fault: () => {}, cause: 'fw dropped all ICMP, including "Fragmentation Needed". The web server never learned that the path only fits 1400 bytes (PMTUD blackhole). The fix: allow ICMP type 3, or MSS clamping on a router before the narrow link.' },
      { fault: t => { dev(t, 'fw').acl = [{ action: 'allow', proto: 'icmp', icmpType: 8, src: 'any', dst: 'any' }, { action: 'allow', proto: 'icmp', icmpType: 0, src: 'any', dst: 'any' }, { action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }]; },
        cause: 'fw only let ping through and dropped every other ICMP message, including "Fragmentation Needed" (type 3). PMTUD could not work.' }],
    goals: [{ text: 'client fetches http://10.0.2.80/ completely.', check: curlOk('client') }],
    hints: ['Which link has the smallest MTU?', 'Which ICMP message would tell the server to send smaller segments, and does it arrive?'],
    presets: { client: ['curl http://10.0.2.80/', 'ping -c 1 -M do -s 1472 10.0.2.80'], fw: ['show ip route'] } }
];

/** Build the broken network of a challenge variant */
export function challengeTopo(c, variant) {
  const t = c.topo();
  c.variants[variant % c.variants.length].fault(t);
  return t;
}
