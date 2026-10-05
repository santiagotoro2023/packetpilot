import { bar, note, pingOk, tag, inspected, isVxlan } from './helpers.js';
import { vlanTopo, vxlanTopo, stickTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const subif = (sim, vid, ip) => Object.values(sim.dev('r1').cfg.ifaces).some(i => i.parent === 'eth1' && Number(i.vlan) === vid && i.ip === ip);

export default {
  id: 'm3', title: 'VLAN und VXLAN', bands: ['vlan', 'udp', 'vxlan'],
  text: 'Layer-2-Segmente mit 802.1Q trennen, Trunks verstehen und Segmente mit VXLAN über ein geroutetes Netz strecken.',
  lessons: [
    { id: 'm3-l1', title: 'VLANs und der 802.1Q-Tag', minutes: 10, steps: [
      { type: 'theory', title: 'Mehrere Switches in einem', html: `
<p>Ein <b>VLAN</b> teilt einen Switch in mehrere logische Switches. Jedes VLAN ist eine eigene Broadcast-Domäne. Zwischen VLANs gibt es keine Verbindung auf Layer 2, nur über einen Router.</p>
<p>Damit zwischen Switches erkennbar bleibt, zu welchem VLAN ein Frame gehört, wird nach der Quell-MAC ein 4 Byte langer <b>Tag</b> eingefügt:</p>
${bar([['Ziel-MAC', '6', 'eth', 1.1], ['Quell-MAC', '6', 'eth', 1.1], ['TPID 0x8100', '2', 'vlan', 1.2], ['PCP DEI VID', '2', 'vlan', 1.2], ['EtherType', '2', 'eth', .9], ['Nutzlast', 'bis 1500', 'ip', 2.4], ['FCS', '4', 'eth', .7]], 'Der Frame wird 4 Byte länger, die MTU bleibt 1500.')}
<table><tr><th>Feld</th><th>Bit</th><th>Bedeutung</th></tr>
<tr><td>TPID</td><td>16</td><td><code>0x8100</code> steht dort, wo sonst der EtherType steht</td></tr>
<tr><td>PCP</td><td>3</td><td>Priorität 0 bis 7</td></tr><tr><td>DEI</td><td>1</td><td>darf bei Überlast zuerst verworfen werden</td></tr>
<tr><td>VID</td><td>12</td><td>VLAN-Nummer, nutzbar 1 bis 4094</td></tr></table>` },
      { type: 'label', title: 'Beschrifte den Tag', distractors: ['TTL', 'VNI'],
        slots: [{ label: 'TPID', size: '16 Bit', kind: 'vlan', w: 210 }, { label: 'PCP', size: '3 Bit', kind: 'vlan', w: 74 }, { label: 'DEI', size: '1 Bit', kind: 'vlan', w: 58 }, { label: 'VID', size: '12 Bit', kind: 'vlan', w: 170 }] },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Wie viele VLANs kannst du mit 12 Bit nutzen?', input: ['4094'], explain: '2<sup>12</sup> = 4096, davon sind 0 und 4095 reserviert.' },
        { q: 'Welcher Wert steht im TPID?', input: ['0x8100', '8100'] }] }
    ] },

    { id: 'm3-l2', title: 'Access-Port und Trunk', minutes: 15, steps: [
      { type: 'theory', title: 'Wann Frames einen Tag tragen', html: `
<table><tr><th>Port</th><th>Auf dem Kabel</th><th>Typisch für</th></tr>
<tr><td><b>Access</b></td><td>ohne Tag, der Port gehört zu genau einem VLAN</td><td>PC, Drucker, Server mit einem Netz</td></tr>
<tr><td><b>Trunk</b></td><td>mit Tag, mehrere VLANs über ein Kabel</td><td>Switch zu Switch, Router, Hypervisor</td></tr></table>
<p>Auf einem Trunk darf ein VLAN zusätzlich ohne Tag laufen, das <b>Native VLAN</b>. Stimmt es auf beiden Seiten nicht überein, werden zwei VLANs unbemerkt verbunden.</p>
${note('Deine VMs auf dem ESXi kennen das: Die Portgruppe ist für die VM ein Access-Port. Der vSwitch setzt den Tag erst, wenn der Frame über den Uplink (einen Trunk) den Host verlässt.')}` },
      { type: 'lab', title: 'Verbinde zwei Switches richtig', topo: () => vlanTopo(false), edit: 'config',
        intro: '<p>a10 und b10 gehören in VLAN 10, a20 und b20 in VLAN 20. Das Kabel zwischen s1 und s2 ist aber auf beiden Seiten ein Access-Port in VLAN 1. Mache daraus einen Trunk.</p>',
        presets: { a10: ['ping -c 1 10.10.0.2'], a20: ['ping -c 1 10.20.0.2'] },
        goals: [
          { text: 'a10 erreicht b10 (10.10.0.2).', check: pingOk('a10', '10.10.0.2') },
          { text: 'a20 erreicht b20 (10.20.0.2).', check: pingOk('a20', '10.20.0.2') },
          { text: 'Klicke im Protokoll auf einen Frame, den s1 über eth8 sendet, und finde den Tag im Paketinspektor.', check: inspected(f => !!f.vlan) },
          { text: 'Welche VID tragen die Frames von a20 auf dem Trunk?', ask: true, expect: () => ['20'] }],
        hints: ['Bei s1 und s2 unter Konfiguration: eth8 auf Trunk stellen, erlaubte VLANs 10,20.'] }
    ] },

    { id: 'm3-stick', title: 'Routing zwischen VLANs: Router-on-a-Stick', minutes: 18, steps: [
      { type: 'theory', title: 'Ein Kabel, viele Netze', html: `
<p>Zwischen VLANs braucht es einen Router. Mit einem eigenen Router-Port pro VLAN gehen bei zehn VLANs schnell die Ports aus. Die Lösung: Der Router hängt mit <b>einem</b> Kabel an einem Trunk und hat dafür pro VLAN ein <b>Subinterface</b>. Jedes Subinterface sendet und empfängt nur Frames mit seinem VLAN-Tag und hat eine eigene IP-Adresse, das Gateway des jeweiligen VLANs.</p>
<pre># Linux
ip link add link eth1 name eth1.10 type vlan id 10
ip addr add 10.10.0.1/24 dev eth1.10
ip link add link eth1 name eth1.20 type vlan id 20
ip addr add 10.20.0.1/24 dev eth1.20

# Cisco IOS
interface GigabitEthernet0/0.10
 encapsulation dot1Q 10
 ip address 10.10.0.1 255.255.255.0</pre>
<h2>Der Weg eines Pakets von a1 (VLAN 10) zu b1 (VLAN 20)</h2>
<pre>a1 → sw1      ohne Tag, Access-Port in VLAN 10
sw1 → r1      Tag 10 auf dem Trunk
r1            nimmt es auf eth1.10 an, routet, sendet über eth1.20
r1 → sw1      Tag 20 auf dem Trunk, gleiches Kabel zurück
sw1 → b1      ohne Tag, Access-Port in VLAN 20</pre>
${note('Alle Subinterfaces teilen sich die MAC-Adresse der physischen Schnittstelle. Das stört nicht, weil jedes VLAN ein eigenes Segment ist.')}
${note('Jedes geroutete Paket läuft zweimal über dasselbe Kabel. Bei viel Verkehr zwischen VLANs wird dieser Link zum Engpass. Grössere Netze routen deshalb direkt im Switch (Layer-3-Switch mit einem SVI pro VLAN).', true)}` },
      { type: 'lab', title: 'Richte die Subinterfaces ein', topo: () => stickTopo(false), edit: 'config',
        intro: '<p>sw1 ist fertig konfiguriert: a1 und a2 in VLAN 10, b1 und b2 in VLAN 20, eth8 als Trunk zu r1. Auf r1 fehlt alles. Lege die beiden Subinterfaces an, unter Konfiguration oder in der Konsole.</p>',
        presets: { r1: ['ip link add link eth1 name eth1.10 type vlan id 10', 'ip link add link eth1 name eth1.20 type vlan id 20', 'ip addr add 10.10.0.1/24 dev eth1.10', 'ip addr add 10.20.0.1/24 dev eth1.20', 'ip -br a'], a1: ['ping -c 2 10.20.0.11'] },
        goals: [
          { text: 'r1 hat ein Subinterface für VLAN 10 mit 10.10.0.1/24.', check: sim => subif(sim, 10, '10.10.0.1') },
          { text: 'r1 hat ein Subinterface für VLAN 20 mit 10.20.0.1/24.', check: sim => subif(sim, 20, '10.20.0.1') },
          { text: 'Pinge von a1 aus b1 (10.20.0.11).', check: pingOk('a1', '10.20.0.11') },
          { text: 'Klicke auf einen Frame, den r1 mit Tag 20 sendet.', check: inspected(f => f.vlan?.vid === 20 && f.type === 'ipv4') },
          { text: 'Wie oft überquert der Ping von a1 auf dem Weg zu b1 das Kabel zwischen sw1 und r1?', ask: true, expect: () => ['2', 'zweimal'] },
          { text: 'Welche Quell-MAC hat der Frame, den r1 in VLAN 20 sendet?', ask: true, expect: sim => [sim.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' }],
        hints: ['Die Befehle stehen als Knöpfe in der Konsole von r1.', 'Unter Konfiguration: Subinterfaces, Parent eth1, VLAN eingeben, Anlegen. Dann die IP eintragen.'],
        outro: '<p>Die Quell-MAC ist die von eth1, egal über welches Subinterface r1 sendet. Was die VLANs unterscheidet, ist nur der Tag.</p>' },
      { type: 'build', title: 'Baue den Frame auf dem Trunk', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp'],
        task: `<p>a1 (10.10.0.11) pingt b1 (10.20.0.11). Baue den Echo Request, wie ihn <b>r1</b> über den Trunk Richtung b1 sendet. MAC von r1 eth1: <code>${M('r1')}</code>.</p>`,
        addresses: { mac: [[M('a1'), 'a1'], [M('b1'), 'b1'], [M('r1'), 'r1 eth1'], [M('sw1'), 'sw1']], ip: [['10.10.0.11', 'a1'], ['10.20.0.11', 'b1'], ['10.10.0.1', 'r1 eth1.10'], ['10.20.0.1', 'r1 eth1.20']] },
        expected: [
          { block: 'eth', fields: { dst: M('b1'), src: M('r1'), type: '0x8100' } },
          { block: 'vlan', fields: { vid: '20', type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.11', dst: '10.20.0.11', proto: '1', ttl: '63' } },
          { block: 'icmp', fields: { type: '8' } }],
        explain: 'Der EtherType im Ethernet-Header ist 0x8100 und kündigt den Tag an. Erst nach dem Tag folgt der eigentliche EtherType 0x0800. r1 hat die TTL um eins gesenkt, die IP-Adressen bleiben.' }
    ] },

    { id: 'm3-l3', title: 'VXLAN: Ethernet in UDP', minutes: 12, steps: [
      { type: 'theory', title: 'Layer 2 über ein geroutetes Netz', html: `
<p>VLANs brauchen einen durchgehenden Layer-2-Weg und sind auf 4094 beschränkt. Moderne Rechenzentren routen deshalb jeden Link und legen Layer-2-Segmente als <b>Overlay</b> darüber. Das Standardprotokoll dafür ist <b>VXLAN</b> (RFC 7348): Es packt einen ganzen Ethernet-Frame in ein UDP-Paket.</p>
${bar([['Ethernet', '14', 'eth', 1], ['IPv4', '20', 'ip', 1.1], ['UDP 4789', '8', 'udp', 1], ['VXLAN', '8', 'vxlan', 1], ['Ethernet', '14', 'eth', 1], ['IP-Paket des Hosts', 'bis 1500', 'ip', 2.6]], 'Aussen das Underlay, innen der unveränderte Frame des Hosts.')}
<table><tr><th>Begriff</th><th>Bedeutung</th></tr>
<tr><td>Underlay</td><td>das geroutete Netz, kennt nur die Adressen der VTEPs</td></tr>
<tr><td>Overlay</td><td>die Layer-2-Segmente darüber</td></tr>
<tr><td>VTEP</td><td>packt Frames ein und aus (VXLAN Tunnel Endpoint)</td></tr>
<tr><td>VNI</td><td>Nummer des Segments, 24 Bit, über 16 Millionen</td></tr></table>
${note('Warum UDP? UDP geht durch jedes IP-Netz. Und der VTEP berechnet den UDP-Quell-Port aus dem inneren Frame: Verschiedene Verbindungen bekommen verschiedene Ports, und Router mit mehreren gleich guten Wegen (ECMP) verteilen sie darauf.')}
${note('Linux nimmt ohne Angabe den alten Port <b>8472</b>. Gib immer <code>dstport 4789</code> an, sonst reden zwei VTEPs aneinander vorbei.', true)}
<p>Für Broadcasts und unbekannte Ziele (BUM-Verkehr) sendet ein VTEP eine Kopie an jeden VTEP in seiner <b>Flood-Liste</b> (Head-End Replication). Aus den Frames, die er auspackt, lernt er, welche MAC hinter welchem VTEP steckt: <b>Flood and Learn</b>.</p>` },
      { type: 'stack', title: 'Baue das VXLAN-Paket zusammen', hint: 'Oben steht, was zuerst über das Kabel des Underlays geht.',
        items: [{ name: 'Äusserer Ethernet-Header', size: '14 Byte', kind: 'eth' }, { name: 'Äusserer IPv4-Header (VTEP → VTEP)', size: '20 Byte', kind: 'ip' }, { name: 'UDP, Ziel-Port 4789', size: '8 Byte', kind: 'udp' },
          { name: 'VXLAN-Header mit VNI', size: '8 Byte', kind: 'vxlan' }, { name: 'Innerer Ethernet-Header (srv1 → srv2)', size: '14 Byte', kind: 'eth' }, { name: 'Innerer IPv4-Header', size: '20 Byte', kind: 'ip' }, { name: 'ICMP Echo Request', size: '64 Byte', kind: 'icmp' }] },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Wie viele Byte setzt VXLAN vor das IP-Paket des Hosts (ohne äusseren Ethernet-Header)?', input: ['50'], unit: 'Byte', explain: '20 (IP) + 8 (UDP) + 8 (VXLAN) + 14 (innerer Ethernet-Header).' },
        { q: 'Welcher UDP-Ziel-Port ist für VXLAN vergeben?', input: ['4789'] },
        { q: 'Ein Router im Underlay hat keine Route zu den Netzen der Server. Funktioniert VXLAN trotzdem?', options: ['Nein', 'Ja, er muss nur die Adressen der VTEPs erreichen', 'Nur mit Multicast'], correct: 1 }] }
    ] },

    { id: 'm3-l4', title: 'VXLAN im Lab', minutes: 15, steps: [
      { type: 'lab', title: 'Zerlege einen VXLAN-Frame', topo: () => vxlanTopo(), edit: 'view',
        intro: '<p>srv1 und srv2 liegen im selben Subnetz, aber an verschiedenen VTEPs. Dazwischen routet core. Tempo herunterdrehen und zuschauen, wie das Paket unterwegs eine zweite Hülle bekommt.</p>',
        presets: { srv1: ['ping -c 2 192.168.10.12'], vtep1: ['bridge fdb', 'show vxlan'], core: ['ip route'] },
        goals: [
          { text: 'Pinge von srv1 aus srv2 (192.168.10.12).', check: pingOk('srv1', '192.168.10.12') },
          { text: 'Klicke auf einen VXLAN-Frame zwischen vtep1 und core und klappe alle Schichten auf.', check: inspected(isVxlan) },
          { text: 'Welche Quell-IP hat das äussere IP-Paket von vtep1?', ask: true, expect: () => ['10.255.0.1'] },
          { text: 'Welchen VNI trägt der Frame?', ask: true, expect: () => ['10010'] },
          { text: 'Kennt core eine Route zu 192.168.10.0/24? (ja oder nein)', ask: true, expect: () => ['nein'] }],
        outro: '<p>In der MAC-Tabelle von vtep1 steht srv2 mit dem Vermerk <code>dst 10.255.0.2</code>: vtep1 hat aus dem ausgepackten Frame gelernt, hinter welchem VTEP srv2 steckt.</p>' }
    ] },

    { id: 'm3-l5', title: 'Fehlersuche im Overlay', minutes: 12, steps: [
      { type: 'theory', title: 'Von unten nach oben', html: `
<p>Funktioniert ein Overlay nicht, prüfe immer in dieser Reihenfolge:</p>
<ol><li><b>Underlay:</b> Erreichen sich die VTEPs? Ping zwischen den Loopbacks.</li>
<li><b>Kommen VXLAN-Pakete an?</b> Im Protokoll beim empfangenden VTEP filtern.</li>
<li><b>Werden sie ausgepackt?</b> VNI und UDP-Port müssen auf beiden Seiten gleich sein.</li>
<li><b>Lokal:</b> Stimmt das VLAN am Port zum Server?</li></ol>` },
      { type: 'lab', title: 'Etwas stimmt nicht', topo: () => vxlanTopo({ vni2: 10011 }), edit: 'config',
        intro: '<p>Die Verbindung zwischen srv1 und srv2 ist kaputt. Finde den Fehler und behebe ihn.</p>',
        presets: { srv1: ['ping -c 1 192.168.10.12'], vtep1: ['ping -c 1 10.255.0.2', 'show vxlan'], vtep2: ['show vxlan'] },
        goals: [
          { text: 'Der Ping von srv1 an srv2 scheitert.', check: tag('srv1', 'ping-done', d => d.received === 0) },
          { text: 'Finde im Protokoll die Meldung, warum vtep2 die Pakete verwirft.', check: tag('vtep2', 'vxlan-vni-unknown') },
          { text: 'Behebe den Fehler, bis der Ping klappt.', check: pingOk('srv1', '192.168.10.12') }],
        hints: ['Vergleiche bei vtep1 und vtep2 unter Konfiguration die VXLAN-Segmente.'] }
    ] },

    { id: 'm3-l6', title: 'Die MTU-Falle', minutes: 12, steps: [
      { type: 'theory', title: '50 Byte, die alles kaputt machen', html: `
<p>VXLAN setzt 50 Byte vor jedes Paket. Ein volles Paket mit 1500 Byte wird im Underlay 1550 Byte gross. Linux setzt die MTU eines VXLAN-Interfaces deshalb automatisch auf die MTU des Uplinks minus 50.</p>
${note('Passt ein Frame nicht, wird er <b>still verworfen</b>. Der VTEP ist für die Hosts ein Switch, und ein Switch sendet keine ICMP-Meldung, er hat im Segment gar keine IP-Adresse. Ping geht, grosse Übertragungen hängen.', true)}
<table><tr><th>Lösung</th><th>Bewertung</th></tr>
<tr><td>Underlay-MTU auf 1550 oder Jumbo Frames (9000)</td><td>Standard im Rechenzentrum, die Hosts merken nichts</td></tr>
<tr><td>Hosts im Overlay auf MTU 1450</td><td>Nötig, wenn das Underlay nicht anpassbar ist</td></tr></table>` },
      { type: 'lab', title: 'Stolpere und behebe', topo: () => vxlanTopo(), edit: 'config',
        intro: '<p>Sende ein grosses Paket mit DF von srv1 an srv2 und schau genau hin, wo es verschwindet.</p>',
        presets: { srv1: ['ping -c 1 -M do -s 1472 192.168.10.12', 'ping -c 1 -M do -s 1422 192.168.10.12'], vtep1: ['show vxlan'] },
        goals: [
          { text: 'Sende ping -c 1 -M do -s 1472 192.168.10.12 auf srv1. Das Paket verschwindet ohne Meldung.', check: tag('vtep1', 'vxlan-mtu-drop') },
          { text: 'Welche MTU hat das VXLAN-Interface von vtep1?', ask: true, expect: () => ['1450'] },
          { text: 'Erhöhe die MTU der beiden Underlay-Kabel auf 1550 (Kabel anklicken) und sende den Ping erneut.', check: pingOk('srv1', '192.168.10.12', { size: 1472, df: true }) }],
        hints: ['Underlay-Kabel sind vtep1 ↔ core und vtep2 ↔ core.'],
        outro: '<p>Mit 1550 im Underlay hat das VXLAN-Interface automatisch wieder MTU 1500, und die Server merken von der Kapselung nichts.</p>' }
    ] }
  ]
};
