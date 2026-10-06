import { bar, note, tag, pingOk, pingFailed } from './helpers.js';
import { natTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = (id, port = 'eth1') => macFor(`${id}/${port}`);
const natOn = sim => sim.dev('home').cfg.nat?.outside === 'eth2';

export default {
  id: 'm7', title: 'NAT: many devices, one address', bands: ['ip', 'tcp', 'udp'],
  text: 'Private addresses, how a router rewrites addresses and ports for a whole network, the translation table, and port forwarding from the outside in.',
  lessons: [
    { id: 'm7-l1', title: 'Private addresses and PAT', minutes: 10, steps: [
      { type: 'theory', title: 'Why your home network uses 192.168.x.x', html: `
<p>IPv4 has about 4 billion addresses, far too few for every device. Three ranges are reserved for private networks (RFC 1918). They can be used by anyone, as often as they like, but they are <b>never routed on the internet</b>:</p>
<table><tr><th>Range</th><th>Size</th><th>Typical use</th></tr>
<tr><td><code>10.0.0.0/8</code></td><td>16.7 million addresses</td><td>companies, data centers</td></tr>
<tr><td><code>172.16.0.0/12</code></td><td>1 million</td><td>Docker (172.17.0.0/16), VPNs</td></tr>
<tr><td><code>192.168.0.0/16</code></td><td>65,536</td><td>home routers</td></tr></table>
<p>To still reach the internet, the router at the border rewrites the source address of every outgoing packet to its own public address: <b>Network Address Translation</b>. When several devices share one address, the router also rewrites the source port when needed, so it can tell the answers apart. This is called <b>PAT</b> (port address translation), masquerading on Linux, overload on Cisco.</p>
<pre>inside              router (NAT)                     outside
192.168.1.10:51000  →  203.0.113.2:51000  →  198.51.100.80:80
192.168.1.11:51000  →  203.0.113.2:1024   →  198.51.100.80:80   (port taken, changed)
answers:  198.51.100.80:80 → 203.0.113.2:1024  →  back to 192.168.1.11:51000</pre>
<p>The router remembers every translation in a table (Linux: <code>conntrack -L</code>). An answer is only let in if it matches an entry. For pings, the ICMP identifier plays the role of the port.</p>
${note('NAT is not a firewall, but it acts like one: a connection started from the outside finds no entry in the table and goes nowhere. To reach a server inside, you need a <b>port forward</b>, the next lesson.')}
${note('Providers short of IPv4 addresses put another NAT in front of yours (CGNAT, range <code>100.64.0.0/10</code>). Then port forwarding at home no longer works, because the outside address is not yours. IPv6 solves this with enough addresses for everyone.', true)}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which of these addresses is private?', options: ['172.32.1.1', '172.20.1.1', '192.169.1.1', '11.0.0.1'], correct: 1, explain: '172.16.0.0/12 covers 172.16.0.0 to 172.31.255.255.' },
        { q: 'Two PCs behind one NAT router use the same source port 51000 to the same server. What does the router do?', options: ['It drops the second connection', 'It changes the source port of one of them', 'It uses a second public address', 'Nothing, the server sorts it out'], correct: 1 },
        { q: 'Which field lets the router tell apart pings from two inside hosts?', options: ['The TTL', 'The ICMP identifier', 'The sequence number', 'The MAC address'], correct: 1 }] }
    ] },

    { id: 'm7-l2', title: 'NAT in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Bring the home network online', topo: () => natTopo({ nat: false }), edit: 'config',
        intro: '<p>pc1 and pc2 have private addresses. The router <b>home</b> has the public address 203.0.113.2 on eth2 and a default route to the provider <b>isp</b>. NAT is still off.</p>',
        presets: { pc1: ['ping -c 1 198.51.100.80', 'curl http://198.51.100.80/'], pc2: ['curl http://198.51.100.80/'], home: ['conntrack -L', 'show ip route'], isp: ['ip route'] },
        goals: [
          { text: 'Ping the web server 198.51.100.80 from pc1. It fails.', check: pingFailed('pc1', '198.51.100.80') },
          { text: 'The request reaches web. Which router has no route back to 192.168.1.0/24?', ask: true, expect: () => ['isp'] },
          { text: 'Turn on NAT on home (Configuration → NAT, outside interface eth2) and ping again.', check: sim => natOn(sim) && pingOk('pc1', '198.51.100.80')(sim) },
          { text: 'Which source address does web see in the pings?', ask: true, expect: () => ['203.0.113.2'] },
          { text: 'Fetch the web page from pc1 and from pc2. Both work through the same public address.', check: sim => ['pc1', 'pc2'].every(d => sim.log.some(e => e.dev === d && e.tag === 'tcp-done' && e.data.ok)) }],
        hints: ['Filter the log to "Only isp": it tries to send the answer to 192.168.1.10 and has no route.', 'After the page loads, look at conntrack -L on home: every connection has an entry.'],
        outro: '<p>The provider never learns your private addresses, and it does not need to: every packet leaving home carries 203.0.113.2. Click a packet on both sides of home and compare the source addresses and ports.</p>' },
      { type: 'build', title: 'Build the ping after the translation', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp'],
        task: '<p>pc1 (192.168.1.10) pings web (198.51.100.80). NAT is on. Build the echo request as <b>home</b> sends it out of eth2 to the provider.</p>',
        addresses: { mac: [[M('pc1'), 'pc1'], [M('home'), 'home eth1'], [M('home', 'eth2'), 'home eth2'], [M('isp'), 'isp eth1'], [M('web'), 'web']],
          ip: [['192.168.1.10', 'pc1'], ['192.168.1.1', 'home eth1'], ['203.0.113.2', 'home eth2'], ['203.0.113.1', 'isp eth1'], ['198.51.100.80', 'web']] },
        expected: [
          { block: 'eth', fields: { dst: M('isp'), src: M('home', 'eth2'), type: '0x0800' } },
          { block: 'ip', fields: { src: '203.0.113.2', dst: '198.51.100.80', proto: '1', ttl: '63' } },
          { block: 'icmp', fields: { type: '8' } }],
        explain: 'Like every router, home builds a new Ethernet frame (its own MAC, the MAC of the next hop isp) and lowers the TTL. NAT additionally replaces the private source address 192.168.1.10 with 203.0.113.2.' }
    ] },

    { id: 'm7-l3', title: 'Port forwarding', minutes: 12, steps: [
      { type: 'theory', title: 'From the outside in', html: `
<p>pc1 runs a small web server on port 80. From the internet, only the router's address 203.0.113.2 is reachable, and the router itself does not run a web server. A <b>port forward</b> (destination NAT) tells the router: whatever arrives for my port 8080, send to 192.168.1.10 port 80.</p>
<pre>web → 203.0.113.2:8080   →   home rewrites the destination   →   192.168.1.10:80
answer 192.168.1.10:80   →   home rewrites the source         →   203.0.113.2:8080 → web</pre>
${note('Only forward what you really need. Every forward makes an inside device reachable for the whole internet, including everyone scanning for weak passwords.', true)}` },
      { type: 'lab', title: 'Make pc1 reachable from outside', topo: () => natTopo({ nat: true }), edit: 'config',
        intro: '<p>NAT is on. From the server <b>web</b> on the internet, try to reach the web server on pc1 through the router\'s public address.</p>',
        presets: { web: ['curl http://203.0.113.2:8080/', 'ping -c 1 192.168.1.10'], home: ['conntrack -L'] },
        goals: [
          { text: 'From web, try <code>curl http://203.0.113.2:8080/</code>. The router itself refuses the connection.', check: tag('web', 'tcp-refused', d => d.port === 8080) },
          { text: 'Add a port forward on home: TCP 8080 to 192.168.1.10 port 80. Then try again.', check: tag('web', 'tcp-done', d => d.ok && d.port === 8080) },
          { text: 'Which destination port arrives at pc1?', ask: true, expect: () => ['80'] },
          { text: 'Can web ping 192.168.1.10 directly? (yes or no)', ask: true, expect: () => ['no'] }],
        hints: ['The port forward is in Configuration → NAT on home, below the outside interface.'],
        outro: '<p>The forward only opens this one port. The private address itself stays unreachable from the internet: the provider does not even have a route to it.</p>' }
    ] }
  ]
};
