import { bar, note, pingOk, tag, inspected, isArpReq } from './helpers.js';
import { PRESETS, topo, host, sw, link, failoverTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const isGarp = f => f.type === 'arp' && f.payload.spa === f.payload.tpa && f.payload.spa !== '0.0.0.0';

const switch3 = () => PRESETS.find(p => p.id === 'switch3').make();
const routed = () => PRESETS.find(p => p.id === 'routed').make();

export default {
  id: 'm1', title: 'Ethernet, MAC und ARP', bands: ['eth', 'arp', 'vlan'],
  text: 'Wie Daten verpackt werden, wie ein Frame Byte für Byte aussieht, wie ein Switch lernt und wie ARP IP-Adressen in MAC-Adressen übersetzt.',
  lessons: [
    { id: 'm1-l1', title: 'Kapselung: jede Schicht packt ein', minutes: 8, steps: [
      { type: 'theory', title: 'Jede Schicht packt ein', html: `
<p>Jede Schicht behandelt das, was sie von oben bekommt, als Nutzlast. Sie setzt ihren eigenen Header davor und gibt alles nach unten weiter. Ethernet hängt zusätzlich hinten eine Prüfsumme an. Der Empfänger packt in umgekehrter Reihenfolge wieder aus.</p>
${bar([['Ethernet', '14 Byte', 'eth', 1.2], ['IPv4', '20 Byte', 'ip', 1.4], ['UDP', '8 Byte', 'udp', 1], ['Daten der Anwendung', 'beliebig', 'data', 3.2], ['FCS', '4 Byte', 'eth', .8]], 'So liegt ein UDP-Paket auf dem Kabel: aussen Ethernet, innen die Anwendung.')}
<table><tr><th>Schicht</th><th>Dateneinheit</th><th>Adressiert mit</th><th>Gerät, das hier entscheidet</th></tr>
<tr><td>Anwendung</td><td>Nachricht</td><td>Hostname, URL</td><td>Server, Client</td></tr>
<tr><td>Transport</td><td>Segment (TCP), Datagramm (UDP)</td><td>Port</td><td>Firewall, Load Balancer</td></tr>
<tr><td>Internet</td><td>Paket</td><td>IP-Adresse</td><td>Router</td></tr>
<tr><td>Link</td><td>Frame</td><td>MAC-Adresse</td><td>Switch</td></tr></table>
${note('<b>Jedes Gerät schaut nur so tief hinein, wie es muss.</b> Ein Switch liest den Ethernet-Header. Ein Router packt den Frame aus, liest den IP-Header, entscheidet und packt das Paket in einen <i>neuen</i> Frame. Was darüber liegt, fasst keiner von beiden an.')}
<p>Im Labor siehst du das an jedem Paket: Die farbigen Streifen auf dem Umschlag sind seine Schichten, von aussen nach innen. Ein Klick auf ein Paket zerlegt es im Paketinspektor.</p>` },
      { type: 'stack', title: 'Bringe die Teile in die richtige Reihenfolge', hint: 'Oben steht, was zuerst über das Kabel geht.',
        items: [{ name: 'Ethernet-Header', size: '14 Byte', kind: 'eth' }, { name: 'IPv4-Header', size: '20 Byte', kind: 'ip' }, { name: 'UDP-Header', size: '8 Byte', kind: 'udp' },
          { name: 'Daten der Anwendung', size: 'z. B. eine DNS-Anfrage', kind: 'data' }, { name: 'FCS (Prüfsumme)', size: '4 Byte', kind: 'eth' }],
        explain: 'Die äusserste Schicht steht vorne, damit jedes Gerät sofort lesen kann, was es braucht. Nur die FCS steht am Ende: Die Karte kann sie erst berechnen, wenn alle Bytes vorbei sind.' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Welchen Header liest ein Switch, um zu entscheiden, wohin ein Frame geht?', options: ['IP-Header', 'Ethernet-Header', 'UDP-Header', 'Alle Header'], correct: 1,
          explain: 'Ein Switch arbeitet auf Layer 2. Er braucht nur die Ziel-MAC im Ethernet-Header.' },
        { q: 'Was verändert ein Router an einem Paket, das er weiterleitet?', options: ['Nichts, er reicht es nur durch', 'Die Ziel-IP-Adresse', 'Er baut einen neuen Ethernet-Frame und senkt die TTL im IP-Header', 'Den UDP-Port'], correct: 2,
          explain: 'Der Router entfernt den alten Ethernet-Header, zieht von der TTL eins ab und packt das Paket in einen neuen Frame für das nächste Segment. IP-Adressen und Ports bleiben (ohne NAT) gleich.' }] }
    ] },

    { id: 'm1-l2', title: 'Der Ethernet-Frame Byte für Byte', minutes: 12, steps: [
      { type: 'theory', title: 'Aufbau eines Ethernet-II-Frames', html: `
<p>Fast alle Netze, mit denen du arbeitest, verwenden <b>Ethernet II</b>. Vor und nach dem eigentlichen Frame kommen noch Felder der physischen Schicht dazu.</p>
${bar([['Präambel', '7', 'frag', .9], ['SFD', '1', 'frag', .5], ['Ziel-MAC', '6', 'eth', 1.1], ['Quell-MAC', '6', 'eth', 1.1], ['Type', '2', 'eth', .7], ['Nutzlast', '46 bis 1500', 'ip', 3], ['FCS', '4', 'eth', .7], ['IFG', '12', 'frag', .9]], 'Grau: physische Schicht, Blau: Ethernet, Grün: Nutzlast (z. B. ein IP-Paket). Zahlen in Byte.')}
<table><tr><th>Feld</th><th>Zweck</th></tr>
<tr><td>Präambel, SFD</td><td>Bitmuster zum Einschwingen des Empfängers, SFD markiert den Start. Gehört zur physischen Schicht.</td></tr>
<tr><td>Ziel-MAC</td><td>Steht <b>zuerst</b>, damit ein Switch so früh wie möglich entscheiden kann.</td></tr>
<tr><td>Quell-MAC</td><td>Absender. Daraus lernt der Switch, wo welches Gerät steckt.</td></tr>
<tr><td>EtherType</td><td>Was in der Nutzlast steckt: <code>0x0800</code> IPv4, <code>0x0806</code> ARP, <code>0x86DD</code> IPv6, <code>0x8100</code> VLAN-Tag.</td></tr>
<tr><td>Nutzlast</td><td>46 bis 1500 Byte. Zu kurze Nutzlast wird mit Nullen aufgefüllt (Padding). Die Obergrenze ist die <b>MTU</b>.</td></tr>
<tr><td>FCS</td><td>CRC-32 über den Frame. Stimmt sie nicht, wird der Frame <b>still</b> verworfen.</td></tr>
<tr><td>IFG</td><td>Mindestpause bis zum nächsten Frame.</td></tr></table>
${note('Ein Frame ist mindestens <b>64 Byte</b> gross (Ziel-MAC bis FCS). Das stammt aus der Zeit, als sich alle ein Kabel teilten: Ein Sender musste eine Kollision bemerken, solange er noch sendet. Eine ARP-Nachricht (28 Byte) wird deshalb auf 46 Byte Nutzlast aufgefüllt.')}
<h2>Was von 1 Gbit/s übrig bleibt</h2>
<pre>Auf dem Kabel:  8 + 14 + 1500 + 4 + 12          = 1538 Byte pro Frame
Nutzdaten TCP:  1500 - 20 (IP) - 20 (TCP) - 12 (Timestamps) = 1448 Byte
1448 / 1538 = 94,1 %   →   ca. 941 Mbit/s</pre>
<p>Genau diesen Wert misst <code>iperf3</code> auf einer sauberen Gigabit-Verbindung.</p>` },
      { type: 'label', title: 'Beschrifte den Frame', distractors: ['TTL', 'Port', 'VNI'],
        slots: [{ label: 'Präambel', size: '7 Byte', kind: 'frag', w: 92 }, { label: 'SFD', size: '1 Byte', kind: 'frag', w: 70 },
          { label: 'Ziel-MAC', size: '6 Byte', kind: 'eth', w: 100 }, { label: 'Quell-MAC', size: '6 Byte', kind: 'eth', w: 100 },
          { label: 'EtherType', size: '2 Byte', kind: 'eth', w: 92 }, { label: 'Nutzlast', size: '46 bis 1500 Byte', kind: 'ip', w: 150 },
          { label: 'FCS', size: '4 Byte', kind: 'eth', w: 70 }],
        explain: 'Präambel und SFD siehst du in keinem Mitschnitt, die Netzwerkkarte entfernt sie. Die FCS meistens auch.' },
      { type: 'quiz', title: 'Rechnen mit Frames', questions: [
        { q: 'Welcher EtherType kennzeichnet eine ARP-Nachricht?', input: ['0x0806', '806', '0806'], explain: '<code>0x0806</code> ist ARP, <code>0x0800</code> IPv4.' },
        { q: 'Wie viele Byte belegt ein voller Frame (MTU 1500) inklusive Präambel, SFD und IFG auf dem Kabel?', input: ['1538'], unit: 'Byte', explain: '8 + 14 + 1500 + 4 + 12 = 1538.' },
        { q: 'Eine ARP-Nachricht ist 28 Byte lang. Wie viele Byte Padding hängt die Netzwerkkarte an?', input: ['18'], unit: 'Byte', explain: 'Mindestnutzlast 46 Byte minus 28 Byte ARP = 18 Byte Nullen.' },
        { q: 'Ein Frame kommt mit falscher FCS an. Was passiert?', options: ['Der Empfänger fordert ihn neu an', 'Er wird still verworfen, nur ein Fehlerzähler der Karte steigt', 'Der Switch korrigiert ihn', 'Er wird trotzdem verarbeitet'], correct: 1,
          explain: 'Ethernet kennt keine Neuübertragung. Mit <code>ethtool -S eth0</code> siehst du die CRC-Fehler. Neu übertragen muss bei Bedarf TCP.' }] }
    ] },

    { id: 'm1-l3', title: 'Was eine MAC-Adresse verrät', minutes: 8, steps: [
      { type: 'theory', title: 'Aufbau der MAC-Adresse', html: `
<p>Eine MAC-Adresse hat 48 Bit und gilt nur im lokalen Segment. Die ersten 3 Byte sind der <b>OUI</b> (Organizationally Unique Identifier), den die IEEE an Hersteller vergibt. <code>00:50:56</code> gehört zu VMware, deshalb beginnen die Adressen deiner VMs auf dem ESXi damit.</p>
<p>Zwei Bits im ersten Byte haben eine besondere Bedeutung:</p>
<table><tr><th>Bit</th><th>0</th><th>1</th></tr>
<tr><td><b>b0</b> (I/G)</td><td>Unicast: eine Schnittstelle</td><td>Gruppe: Multicast oder Broadcast</td></tr>
<tr><td><b>b1</b> (U/L)</td><td>vom Hersteller vergeben</td><td>lokal vergeben (Docker, containerlab, zufällige MAC am Smartphone)</td></tr></table>
${note('Lokal vergebene Adressen erkennst du an der <b>zweiten</b> Hex-Ziffer: 2, 6, A oder E. Beispiele: <code>02:42:…</code> bei älteren Docker-Versionen, <code>aa:c1:ab:…</code> bei containerlab und hier im Labor.')}
<table><tr><th>Adresse</th><th>Bedeutung</th></tr>
<tr><td><code>ff:ff:ff:ff:ff:ff</code></td><td>Broadcast, alle im Segment</td></tr>
<tr><td><code>01:00:5e:…</code></td><td>IPv4-Multicast, z. B. OSPF an 224.0.0.5</td></tr>
<tr><td><code>33:33:…</code></td><td>IPv6-Multicast</td></tr>
<tr><td><code>00:00:5e:00:01:xx</code></td><td>virtuelle MAC von VRRP (Kapitel Gateway-Redundanz)</td></tr></table>` },
      { type: 'mac', title: 'Untersuche MAC-Adressen', classify: ['00:50:56:a3:1f:7c', 'aa:c1:ab:12:34:56', '01:00:5e:00:00:05', 'ff:ff:ff:ff:ff:ff', '02:42:ac:11:00:02', '33:33:00:00:00:01'] }
    ] },

    { id: 'm1-l4', title: 'Wie ein Switch lernt', minutes: 15, steps: [
      { type: 'theory', title: 'MAC-Tabelle, Fluten und Aging', html: `
<p>Ein Switch kennt anfangs kein Gerät. Er baut seine <b>MAC-Tabelle</b> nur aus den <b>Quell-MACs</b> der Frames, die er empfängt.</p>
<pre>Frame kommt an Port eth3 an: Quelle aa:aa, Ziel bb:bb
1. Lernen:      aa:aa ist an eth3
2. Weiterleiten:
   Broadcast oder Multicast       → an alle Ports ausser eth3 (fluten)
   bb:bb steht in der Tabelle     → nur an diesen Port
   bb:bb steht an eth3            → verwerfen (filtern)
   bb:bb unbekannt                → an alle Ports ausser eth3 (fluten)</pre>
<p>Einträge verfallen nach einer Weile ohne Verkehr (<b>Aging</b>, meist 300 Sekunden). So passt sich der Switch an, wenn ein Gerät umgesteckt wird.</p>
<table><tr><th>Begriff</th><th>Bedeutung</th></tr>
<tr><td>Kollisionsdomäne</td><td>Geräte, die sich ein Medium teilen. Bei einem Switch im Vollduplex ist jeder Port eine eigene.</td></tr>
<tr><td>Broadcast-Domäne</td><td>Alle Geräte, die ein Broadcast erreicht. Ein Switch flutet Broadcasts, ein Router nicht.</td></tr></table>
${note('Ein <b>Hub</b> lernt nichts und gibt jeden Frame an alle weiter. Im nächsten Schritt machst du aus dem Switch einen Hub, indem du die Aging-Zeit auf 0 setzt, und siehst den Unterschied.')}` },
      { type: 'lab', title: 'Der Switch lernt', topo: switch3, edit: 'config',
        intro: '<p>pc1, pc2 und pc3 hängen an sw1. Doppelklicke auf <b>pc1</b>, um seine Konsole zu öffnen, und pinge pc2.</p>',
        presets: { pc1: ['ping -c 2 10.0.0.2'], pc3: ['ip neigh'] },
        goals: [
          { text: 'Pinge von pc1 aus pc2 (10.0.0.2).', check: pingOk('pc1', '10.0.0.2') },
          { text: 'An welchem Port hat sw1 die MAC-Adresse von pc2 gelernt? Schau bei sw1 unter Tabellen nach.', ask: true, expect: () => ['eth2'], placeholder: 'z. B. eth1' },
          { text: 'pc3 hat die ARP-Anfrage gesehen, aber keinen einzigen Ping. Setze bei sw1 die Aging-Zeit auf 0 und pinge erneut. Jetzt sieht pc3 auch die ICMP-Pakete.',
            check: tag('pc3', 'frame-not-mine', d => d.kind === 'icmp') }],
        hints: ['Die Aging-Zeit findest du bei sw1 unter Konfiguration ganz unten.', 'Filtere das Protokoll auf "Nur pc3", um zu sehen, was bei pc3 ankommt.'],
        outro: '<p>Mit Aging 0 vergisst der Switch jede Adresse sofort und muss alles fluten wie ein Hub. Jeder Host sieht dann fremden Verkehr: schlecht für die Sicherheit und für die Bandbreite. Stelle die Aging-Zeit danach ruhig wieder auf 300.</p>' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Woraus lernt ein Switch, an welchem Port ein Gerät hängt?', options: ['Aus der Ziel-MAC', 'Aus der Quell-MAC', 'Aus der IP-Adresse', 'Aus ARP'], correct: 1, explain: 'Nur die Quell-MAC verrät, wer an diesem Port sendet.' },
        { q: 'Ein Switch erhält einen Frame an eine MAC, die nicht in seiner Tabelle steht. Was tut er?', options: ['Verwerfen', 'Per ARP nachfragen', 'An alle Ports im VLAN ausser dem Eingang senden', 'An den Router schicken'], correct: 2,
          explain: 'Unknown Unicast Flooding. Antwortet das Ziel, lernt der Switch dessen Port, und ab dann geht der Verkehr gezielt.' }] }
    ] },

    { id: 'm1-l5', title: 'ARP: von der IP zur MAC', minutes: 15, steps: [
      { type: 'theory', title: 'So funktioniert ARP', html: `
<p>Eine Anwendung kennt nur die IP-Adresse ihres Ziels, ein Ethernet-Frame braucht aber eine Ziel-MAC. <b>ARP</b> (Address Resolution Protocol) findet sie heraus, und zwar nur für Adressen im <b>eigenen</b> Subnetz.</p>
<pre>pc1 10.0.0.1 möchte an 10.0.0.3 senden, kennt die MAC nicht
1. Request (Broadcast an ff:ff:ff:ff:ff:ff): Wer hat 10.0.0.3? Antwort an 10.0.0.1
2. Reply   (Unicast an pc1):                 10.0.0.3 ist bei aa:c1:ab:…
3. Beide tragen den anderen in die ARP-Tabelle ein, pc3 schon beim Request.</pre>
${bar([['Ethernet', '14', 'eth', 1.4], ['HW/Proto Type', '4', 'arp', 1], ['Längen', '2', 'arp', .7], ['Operation', '2', 'arp', .8], ['Sender MAC/IP', '10', 'arp', 1.6], ['Target MAC/IP', '10', 'arp', 1.6]], 'ARP liegt direkt im Ethernet-Frame (EtherType 0x0806), ohne IP-Header. Die Nachricht hat immer 28 Byte.')}
<p>Linux nennt die ARP-Tabelle <b>Neighbor-Tabelle</b> (<code>ip neigh</code>). Ein Eintrag ist <code>REACHABLE</code>, solange er frisch bestätigt ist, danach <code>STALE</code>. Bleibt eine Anfrage unbeantwortet, wird er <code>FAILED</code>, und der eigene Host meldet <code>Destination Host Unreachable</code>.</p>
${note('Ein <b>Gratuitous ARP</b> kündigt die eigene IP ungefragt an. VRRP, MetalLB und kube-vip nutzen das bei einem Failover: Alle Nachbarn ändern sofort ihre Tabelle.')}
${note('ARP hat <b>keine Authentifizierung</b>. Jedes Gerät im Segment kann Antworten schicken, und die meisten Systeme glauben sie. Schutz bieten Dynamic ARP Inspection auf Switches, kleine Segmente und Verschlüsselung auf höheren Schichten.', true)}` },
      { type: 'lab', title: 'ARP beobachten', topo: switch3, edit: 'config',
        intro: '<p>Tempo ruhig herunterdrehen: So siehst du, wie die Anfrage an alle geht und nur eine Antwort zurückkommt.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.3', 'ip neigh'], pc2: ['ping -c 1 10.0.0.99'] },
        goals: [
          { text: 'Pinge von pc1 aus pc3 (10.0.0.3).', check: pingOk('pc1', '10.0.0.3') },
          { text: 'Klicke im Protokoll auf die ARP-Anfrage (ARP Request) und schau sie dir im Paketinspektor an.', check: inspected(isArpReq) },
          { text: 'Welche Target MAC steht in der Anfrage?', ask: true, expect: () => ['00:00:00:00:00:00'], placeholder: 'xx:xx:xx:xx:xx:xx' },
          { text: 'Pinge von pc2 die Adresse 10.0.0.99, die es nicht gibt. Wer meldet "Destination Host Unreachable"?',
            check: tag('pc2', 'arp-failed', d => d.ip === '10.0.0.99') },
          { text: 'Von welcher IP-Adresse kam die Meldung "Destination Host Unreachable"?', ask: true, expect: () => ['10.0.0.2'] }],
        outro: '<p>Die Meldung kommt nicht von einem Router, sondern von pc2 selbst: Seine drei ARP-Anfragen blieben unbeantwortet.</p>' },
      { type: 'build', title: 'Baue die ARP-Anfrage selbst', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: '<p><b>pc1</b> (10.0.0.1) will <b>pc3</b> (10.0.0.3) erreichen, kennt aber dessen MAC nicht. Baue den Frame, den pc1 als Erstes sendet.</p>',
        addresses: { mac: [[M('pc1'), 'pc1'], [M('pc2'), 'pc2'], [M('pc3'), 'pc3'], [M('sw1'), 'sw1']], ip: [['10.0.0.1', 'pc1'], ['10.0.0.2', 'pc2'], ['10.0.0.3', 'pc3']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('pc1'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('pc1'), spa: '10.0.0.1', tha: '00:00:00:00:00:00', tpa: '10.0.0.3' } }],
        explain: 'Ethernet-Ziel ist Broadcast, damit pc3 die Frage überhaupt bekommt. Im ARP-Teil ist die gesuchte MAC noch unbekannt, also Nullen. Ein IP-Header kommt nicht vor: ARP sitzt direkt im Ethernet-Frame.' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'An welche Ziel-MAC geht eine ARP-Anfrage?', options: ['An die MAC des Gateways', 'An ff:ff:ff:ff:ff:ff', 'An 00:00:00:00:00:00', 'An die MAC des Switches'], correct: 1, explain: 'Die Anfrage ist ein Broadcast, die Antwort ein Unicast.' },
        { q: 'Warum kennt pc3 nach dem Ping die MAC von pc1, obwohl pc3 nie selbst gefragt hat?', options: ['Der Switch hat sie ihm mitgeteilt', 'pc3 hat sie aus der Anfrage gelernt (Sender MAC und IP)', 'Über DHCP', 'Gar nicht'], correct: 1,
          explain: 'Die Anfrage enthält Sender MAC und Sender IP. Wer gefragt wird, trägt den Fragenden gleich ein, denn er wird ihm gleich antworten.' }] }
    ] },

    { id: 'm1-garp', title: 'Gratuitous ARP und Failover', minutes: 20, steps: [
      { type: 'theory', title: 'ARP-Nachrichten, die niemand bestellt hat', html: `
<p>Neben Anfrage und Antwort kennt ARP zwei Sonderformen, die du in jedem Mitschnitt sehen wirst:</p>
<table><tr><th>Nachricht</th><th>Sender-IP</th><th>Ziel-IP</th><th>Zweck</th></tr>
<tr><td><b>Gratuitous ARP</b></td><td>die eigene</td><td>die eigene</td><td>«Diese Adresse ist jetzt bei meiner MAC.» Nachbarn mit einem Eintrag für die Adresse aktualisieren ihn sofort.</td></tr>
<tr><td><b>ARP-Probe</b></td><td>0.0.0.0</td><td>die gewünschte</td><td>«Benutzt jemand diese Adresse schon?» Antwortet jemand, gibt es einen Konflikt (RFC 5227).</td></tr></table>
<p>Beide gehen als Broadcast an alle. Ein Gratuitous ARP ist meist als Request formuliert, manchmal als Reply. Linux aktualisiert damit nur <b>bestehende</b> Einträge und legt keine neuen an.</p>
<h2>Wann ein Gerät einen Gratuitous ARP sendet</h2>
<ul><li>beim Hochfahren einer Schnittstelle, um die eigene Adresse anzukündigen und Konflikte zu bemerken</li>
<li>bei einem <b>Failover</b>: VRRP, keepalived, kube-vip oder MetalLB ziehen eine Dienstadresse auf einen anderen Rechner</li>
<li>nach einer Live-Migration einer VM, damit die Switches die MAC am neuen Port lernen</li></ul>
<h2>Die Neighbor-Zustände unter Linux</h2>
<table><tr><th>Zustand</th><th>Bedeutung</th></tr>
<tr><td>REACHABLE</td><td>vor kurzem bestätigt (rund 30 Sekunden)</td></tr>
<tr><td>STALE</td><td>wird noch benutzt, aber nicht mehr bestätigt</td></tr>
<tr><td>DELAY</td><td>ein Paket ging an einen STALE-Eintrag, 5 Sekunden warten, ob eine Bestätigung kommt</td></tr>
<tr><td>PROBE</td><td>drei Unicast-Anfragen direkt an die gespeicherte MAC</td></tr>
<tr><td>FAILED</td><td>keine Antwort, der Eintrag wird verworfen, das nächste Paket fragt wieder per Broadcast</td></tr></table>
${note('Ohne Gratuitous ARP schickt ein Client nach einem Failover seine Pakete weiter an die <b>alte</b> MAC, bis seine Neighbor-Prüfung scheitert. Das sind schnell 30 bis 40 Sekunden Ausfall. Mit einem Gratuitous ARP ist es nach Millisekunden vorbei.')}
<pre>arping -U -c 3 -I eth0 10.0.0.100   # Gratuitous ARP senden (wie keepalived)
arping -D -I eth0 10.0.0.100        # prüfen, ob die Adresse frei ist</pre>` },
      { type: 'build', title: 'Baue den Gratuitous ARP', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: `<p>Die Dienstadresse <code>10.0.0.100</code> zieht von srvA zu <b>srvB</b> um. Baue die Nachricht, mit der srvB allen Nachbarn mitteilt, dass 10.0.0.100 jetzt bei seiner MAC ist (als Request formuliert).</p>`,
        addresses: { mac: [[M('srvA'), 'srvA'], [M('srvB'), 'srvB'], [M('client'), 'client']], ip: [['10.0.0.100', 'Dienstadresse'], ['10.0.0.12', 'srvB'], ['10.0.0.5', 'client']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('srvB'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('srvB'), spa: '10.0.0.100', tha: ['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff'], tpa: '10.0.0.100' } }],
        explain: 'Sender-IP und Ziel-IP sind gleich, das macht die Nachricht «gratuitous». Niemand muss antworten. Jeder, der 10.0.0.100 in seiner Tabelle hat, ersetzt die alte MAC durch die von srvB.' },
      { type: 'lab', title: 'Failover ohne Gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: `<p>srvA hält die Dienstadresse 10.0.0.100. Starte auf dem client einen langen Ping. Lass srvA dann ausfallen (Kabel trennen) und gib srvB die Adresse 10.0.0.100. Ein Gratuitous ARP wird noch <b>nicht</b> gesendet. Mit dem Tempo-Regler oder dem Vorspulen-Knopf geht das Warten schneller.</p>`,
        presets: { client: ['ping -c 60 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['ip addr add 10.0.0.100/24 dev eth1'] },
        goals: [
          { text: 'Starte den Ping und lass srvA ausfallen, während er läuft.', check: sim => sim.log.some(e => e.tag === 'link-down') && sim.log.some(e => e.dev === 'client' && e.tag === 'arp-learned') },
          { text: 'Gib srvB die Adresse 10.0.0.100.', check: sim => sim.dev('srvB').cfg.ifaces.eth1.ip === '10.0.0.100' },
          { text: 'Warte, bis der client die alte MAC verwirft und neu fragt.', check: tag('client', 'nud-failed', d => d.ip === '10.0.0.100') },
          { text: 'In welchem Zustand schickt der client Unicast-Anfragen an die alte MAC?', ask: true, expect: () => ['probe'] },
          { text: 'srvB beantwortet die Pings.', check: tag('srvB', 'echo-request-received') }],
        hints: ['Die Befehle stehen als Knöpfe in der Konsole der jeweiligen Geräte.', 'Im Protokoll unter «Nur client» siehst du, wie der Eintrag altert und geprüft wird.'],
        outro: '<p>Zähle die verlorenen Pings: Etwa 35 Sekunden lang ging jedes Paket an eine MAC, die es nicht mehr gab. Genau dieses Loch stopft der Gratuitous ARP.</p>' },
      { type: 'lab', title: 'Failover mit Gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: '<p>Dasselbe nochmals, aber diesmal kündigt srvB die Adresse nach der Übernahme mit <code>arping -U</code> an. Prüfe zuerst mit einer ARP-Probe, ob die Adresse wirklich frei ist.</p>',
        presets: { client: ['ping -c 30 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['arping -D -c 2 10.0.0.100', 'ip addr add 10.0.0.100/24 dev eth1', 'arping -U -c 1 10.0.0.100'] },
        goals: [
          { text: 'Prüfe von srvB aus mit arping -D, ob 10.0.0.100 belegt ist, solange srvA noch läuft. Die Probe meldet einen Konflikt.', check: tag('srvB', 'arping-done', d => d.mode === 'dad' && d.replies > 0) },
          { text: 'Starte den Ping, lass srvA ausfallen, gib srvB die Adresse und sende den Gratuitous ARP.', check: tag('client', 'garp-updated', d => d.ip === '10.0.0.100') },
          { text: 'srvB beantwortet die Pings, ohne dass der client neu fragen musste.', check: sim => sim.log.some(e => e.dev === 'srvB' && e.tag === 'echo-request-received') && !sim.log.some(e => e.dev === 'client' && e.tag === 'nud-failed') },
          { text: 'Klicke auf den Gratuitous ARP im Protokoll. Welche Sender-IP trägt er?', ask: true, expect: () => ['10.0.0.100'] }],
        hints: ['Die Reihenfolge zählt: erst die Adresse übernehmen, dann den Gratuitous ARP senden.'],
        outro: '<p>Der client hat seinen Eintrag sofort umgeschrieben. Genau so arbeiten keepalived und kube-vip: Wer die Adresse übernimmt, sendet sofort einen Gratuitous ARP. Die Switches lernen dabei nebenbei, an welchem Port die MAC von srvB hängt.</p>' }
    ] },

    { id: 'm1-l6', title: 'Ein Paket über einen Router', minutes: 18, steps: [
      { type: 'theory', title: 'MAC von Hop zu Hop, IP von Ende zu Ende', html: `
<p>Will ein Host an eine IP-Adresse <b>ausserhalb</b> seines Subnetzes senden, fragt er nicht nach deren MAC, sondern nach der MAC seines <b>Default-Gateways</b>.</p>
<pre>pc1 192.168.10.10/24 → srv1 192.168.20.20
1. Liegt 192.168.20.20 in 192.168.10.0/24?  Nein → an das Gateway 192.168.10.1
2. ARP fragt nach 192.168.10.1, nicht nach 192.168.20.20
3. r1 nimmt den Frame an, liest die Ziel-IP, findet die Route, TTL 64 → 63
4. r1 fragt per ARP auf eth2 nach 192.168.20.20 und baut einen neuen Frame</pre>
<table><tr><th></th><th>Segment LAN A (pc1 → r1)</th><th>Segment LAN B (r1 → srv1)</th></tr>
<tr><td>Quell-MAC</td><td>pc1</td><td>r1 eth2</td></tr><tr><td>Ziel-MAC</td><td>r1 eth1</td><td>srv1</td></tr>
<tr><td>Quell-IP</td><td>192.168.10.10</td><td>192.168.10.10</td></tr><tr><td>Ziel-IP</td><td>192.168.20.20</td><td>192.168.20.20</td></tr>
<tr><td>TTL</td><td>64</td><td><b>63</b></td></tr></table>
${note('<b>Merke:</b> MAC-Adressen gelten von Hop zu Hop und werden von jedem Router neu gesetzt. IP-Adressen gelten von Ende zu Ende und bleiben gleich, solange kein NAT dazwischen ist.')}
<table><tr><th>Symptom</th><th>Typische Ursache</th></tr>
<tr><td>Eigenes Subnetz geht, alles dahinter nicht</td><td>Gateway falsch oder fehlt</td></tr>
<tr><td>Host fragt per ARP nach dem fernen Ziel statt nach dem Gateway</td><td>Netzmaske zu gross, z. B. /16 statt /24</td></tr>
<tr><td>Paket kommt an, Antwort nicht</td><td>Ziel hat kein Gateway, der Rückweg fehlt</td></tr></table>` },
      { type: 'lab', title: 'Weise die Regel selbst nach', topo: routed, edit: 'config',
        intro: '<p>Pinge von pc1 aus srv1. Klicke danach im Protokoll auf die Ping-Pakete, die r1 sendet und empfängt, und lies die Werte im Paketinspektor ab. Die Filterung "Nur r1" hilft.</p>',
        presets: { pc1: ['ping -c 1 192.168.20.20'] },
        goals: [
          { text: 'Pinge von pc1 aus srv1 (192.168.20.20).', check: pingOk('pc1', '192.168.20.20') },
          { text: 'Nach welcher IP-Adresse hat pc1 per ARP gefragt?', ask: true, expect: () => ['192.168.10.1'] },
          { text: 'Welche Ziel-MAC hat der Ping im LAN A?', ask: true, expect: s => [s.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' },
          { text: 'Welche Quell-MAC hat derselbe Ping im LAN B?', ask: true, expect: s => [s.dev('r1').mac('eth2')], placeholder: 'aa:c1:ab:…' },
          { text: 'Welche TTL hat der Ping im LAN B?', ask: true, expect: () => ['63'] },
          { text: 'Stelle bei pc1 das Präfix auf 16 und pinge erneut. Nach welcher Adresse fragt pc1 jetzt per ARP?', ask: true, expect: () => ['192.168.20.20'] }],
        hints: ['Die MAC-Adressen von r1 stehen bei r1 im Reiter Konsole mit dem Befehl ip addr.', 'Ein Ping im LAN B ist ein Frame, den r1 über eth2 sendet.'],
        outro: '<p>Mit /16 glaubt pc1, 192.168.20.20 liege im eigenen Netz, und fragt direkt danach. Niemand antwortet, und pc1 meldet selbst "Destination Host Unreachable". Stelle das Präfix wieder auf 24.</p>' }
    ] }
  ]
};
