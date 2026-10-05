import { bar, note, tag, inspected, isTcpSyn, isDns } from './helpers.js';
import { servicesTopo, tcpPathTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const ADDR = {
  mac: [[M('client'), 'client'], [M('r1'), 'r1 eth1 (Gateway)'], [M('web'), 'web'], [M('dns'), 'dns']],
  ip: [['10.10.0.10', 'client'], ['10.10.0.1', 'r1 eth1'], ['10.20.0.80', 'web'], ['10.20.0.53', 'dns']],
  name: ['web.lab', 'dns.lab', 'client.lab']
};
const EPHEMERAL = { range: [1024, 65535] };
const tcpDoneAfter = (evTag, port) => sim => {
  const ev = sim.log.find(e => e.tag === evTag);
  return !!ev && sim.log.some(e => e.seq > ev.seq && e.tag === 'tcp-done' && e.data.ok && (!port || e.data.port === port));
};

export default {
  id: 'm5', title: 'Transport: UDP, TCP und Dienste', bands: ['ip', 'udp', 'tcp'],
  text: 'Ports und Sockets, DNS über UDP, der Drei-Wege-Handshake, abgelehnte und gefilterte Verbindungen, MSS und die Path MTU aus Sicht von TCP.',
  lessons: [
    { id: 'm5-l1', title: 'Ports, Sockets und UDP', minutes: 10, steps: [
      { type: 'theory', title: 'Wer bekommt das Paket?', html: `
<p>Die IP-Adresse bringt ein Paket zum richtigen Host. Auf dem Host laufen aber viele Programme gleichzeitig. Welches die Daten bekommt, entscheidet die Transportschicht mit <b>Ports</b>: 16-Bit-Nummern von 0 bis 65535.</p>
<table><tr><th>Bereich</th><th>Name</th><th>Beispiele</th></tr>
<tr><td>0 bis 1023</td><td>Well-Known Ports, unter Linux nur mit root-Rechten</td><td>22 SSH, 53 DNS, 80 HTTP, 443 HTTPS</td></tr>
<tr><td>1024 bis 49151</td><td>registrierte Ports</td><td>3306 MySQL, 5432 PostgreSQL, 4789 VXLAN</td></tr>
<tr><td>49152 bis 65535</td><td>dynamische Ports für Clients (IANA)</td><td>Linux nimmt standardmässig 32768 bis 60999</td></tr></table>
<p>Ein Server <b>lauscht</b> auf einem festen Port. Ein Client bekommt vom Betriebssystem einen zufälligen <b>Quell-Port</b>. Die Kombination aus Protokoll, Quell-IP, Quell-Port, Ziel-IP und Ziel-Port (das <b>5-Tupel</b>) bestimmt eindeutig, zu welcher Verbindung ein Paket gehört. Deshalb kann ein Browser zehn Verbindungen zum selben Webserver offen haben.</p>
<h2>UDP: einfach und schnell</h2>
${bar([['Quell-Port', '2', 'udp', 1], ['Ziel-Port', '2', 'udp', 1], ['Länge', '2', 'udp', 1], ['Prüfsumme', '2', 'udp', 1], ['Daten', 'beliebig', 'data', 2.6]], 'Der UDP-Header hat nur 8 Byte.')}
<p>UDP liefert Datagramme ohne Verbindung, ohne Bestätigung, ohne Neuübertragung und ohne Reihenfolge. Was verloren geht, ist weg, ausser die Anwendung kümmert sich selbst darum. Das ist gewollt: DNS, DHCP, NTP, Syslog, VoIP, VXLAN, WireGuard und QUIC (HTTP/3) nutzen UDP, weil sie schnell sein wollen oder die Zuverlässigkeit selbst regeln.</p>
${note('Kommt ein UDP-Datagramm an einem Port an, auf dem nichts lauscht, antwortet der Host mit ICMP <b>Port Unreachable</b> (Typ 3, Code 3). <code>ss -tuln</code> zeigt, welche Ports auf einem Linux-Host offen sind.')}` },
      { type: 'label', title: 'Beschrifte den UDP-Header', distractors: ['TTL', 'Sequenznummer', 'Flags'],
        slots: [{ label: 'Quell-Port', size: '16 Bit', kind: 'udp', w: 130 }, { label: 'Ziel-Port', size: '16 Bit', kind: 'udp', w: 130 }, { label: 'Länge', size: '16 Bit', kind: 'udp', w: 130 }, { label: 'Prüfsumme', size: '16 Bit', kind: 'udp', w: 130 }] },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Ein Client fragt einen DNS-Server. Welcher Port ist auf dem Hinweg der Ziel-Port?', options: ['Ein zufälliger hoher Port', '53', '80', '67'], correct: 1, explain: 'Auf der Antwort sind die Ports vertauscht: Quelle 53, Ziel der zufällige Port des Clients.' },
        { q: 'Was passiert, wenn ein UDP-Datagramm unterwegs verloren geht?', options: ['UDP sendet es nach einem Timeout neu', 'Nichts, ausser die Anwendung fragt erneut', 'Der Router schickt es nochmals', 'Der Empfänger fordert es an'], correct: 1 },
        { q: 'Wie lang ist der UDP-Header?', input: ['8'], unit: 'Byte' }] }
    ] },

    { id: 'm5-l2', title: 'DNS über UDP', minutes: 15, steps: [
      { type: 'theory', title: 'Eine Frage, eine Antwort', html: `
<p>DNS übersetzt Namen in Adressen. Eine Abfrage passt fast immer in ein einziges UDP-Datagramm, die Antwort auch. Kommt keine Antwort, fragt der Client nach ein paar Sekunden einfach nochmals.</p>
<pre>client  →  dns   UDP 51234 → 53   Anfrage: A-Record für web.lab?
dns     →  client UDP 53 → 51234  Antwort: web.lab A 10.20.0.80</pre>
<table><tr><th>Antwortcode</th><th>Bedeutung</th></tr>
<tr><td>NOERROR</td><td>Name gefunden, Adresse in der Answer Section</td></tr>
<tr><td>NXDOMAIN</td><td>den Namen gibt es nicht</td></tr>
<tr><td>SERVFAIL</td><td>der Server konnte die Frage nicht beantworten</td></tr></table>
<p><code>dig @10.20.0.53 web.lab</code> fragt einen bestimmten Server. Ohne <code>@</code> nimmt dig den eingetragenen DNS-Server (unter Linux aus <code>/etc/resolv.conf</code>). Programme wie <code>curl</code> oder <code>ping</code> lösen einen Namen zuerst auf und senden erst dann das eigentliche Paket.</p>
${note('Antworten über 512 Byte (z. B. mit DNSSEC) wechseln auf TCP Port 53. Eine Firewall, die nur UDP 53 erlaubt, verursacht deshalb manchmal seltsame Fehler.')}` },
      { type: 'build', title: 'Baue die DNS-Anfrage', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'dns'],
        task: '<p>Der <b>client</b> (10.10.0.10, Gateway 10.10.0.1) fragt den DNS-Server <b>dns</b> (10.20.0.53) nach <code>web.lab</code>. Der DNS-Server steht in einem anderen Subnetz. Baue den Frame, so wie er das Kabel des Clients verlässt.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.53', proto: '17', ttl: '64' } },
          { block: 'udp', fields: { sport: EPHEMERAL, dport: '53' } },
          { block: 'dns', fields: { qr: '0', name: 'web.lab' } }],
        explain: 'Die Ziel-MAC ist die des Gateways, weil der DNS-Server in einem anderen Netz liegt. Die IP-Adressen gelten von Ende zu Ende. Der Quell-Port ist ein beliebiger hoher Port, den das Betriebssystem wählt.' },
      { type: 'lab', title: 'Namen auflösen', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>Der client fragt den Server dns. Öffne die Konsole des clients und schau dir Anfrage und Antwort im Paketinspektor an.</p>',
        presets: { client: ['dig @10.20.0.53 web.lab', 'dig @10.20.0.53 gibtsnicht.lab', 'nc -u 10.20.0.53 5353'], dns: ['ss -tuln'] },
        goals: [
          { text: 'Frage mit dig den Server 10.20.0.53 nach web.lab.', check: tag('client', 'dns-done', d => d.ok && d.name === 'web.lab') },
          { text: 'Klicke im Protokoll auf die DNS-Anfrage und klappe sie im Paketinspektor auf.', check: inspected(isDns) },
          { text: 'Welchen Quell-Port hat die Anfrage des clients?', ask: true,
            expect: sim => sim.log.filter(e => e.dev === 'client' && e.kind === 'send' && e.frame && isDns(e.frame) && !e.frame.payload.l4.payload.qr).map(e => String(e.frame.payload.l4.sport)) },
          { text: 'Frage nach einem Namen, den es nicht gibt. Welchen Status meldet dig?', ask: true, expect: () => ['nxdomain'] },
          { text: 'Sende mit nc -u ein UDP-Datagramm an einen Port, auf dem dns nicht lauscht.', check: tag('dns', 'port-unreachable-sent') }],
        hints: ['Der Status steht in der Zeile ->>HEADER<<- der Ausgabe von dig.'],
        outro: '<p>Auf den geschlossenen Port antwortet dns mit ICMP Port Unreachable. Der Client erfährt so, dass dort niemand lauscht. Ohne diese Meldung, zum Beispiel weil eine Firewall sie verwirft, sieht ein geschlossener UDP-Port genau gleich aus wie ein verlorenes Paket.</p>' }
    ] },

    { id: 'm5-l3', title: 'TCP: der Drei-Wege-Handshake', minutes: 18, steps: [
      { type: 'theory', title: 'Zuverlässig über ein unzuverlässiges Netz', html: `
<p>TCP macht aus einzelnen IP-Paketen einen zuverlässigen <b>Bytestrom</b>: Jedes Byte wird nummeriert, der Empfänger bestätigt, was er bekommen hat, und Fehlendes wird neu gesendet. Bevor Daten fliessen, einigen sich beide Seiten auf ihre Startnummern.</p>
${bar([['Ports', '4', 'tcp', 1], ['Sequenznummer', '4', 'tcp', 1.2], ['Bestätigung', '4', 'tcp', 1.2], ['Länge, Flags', '2', 'tcp', 1], ['Fenster', '2', 'tcp', .8], ['Prüfsumme, Urgent', '4', 'tcp', 1.1], ['Optionen', '0 bis 40', 'tcp', 1], ['Daten', '', 'data', 1.6]], 'Mindestens 20 Byte Header, mit Optionen bis 60 Byte.')}
<table><tr><th>Flag</th><th>Bedeutung</th></tr>
<tr><td>SYN</td><td>Verbindung aufbauen, Startnummer festlegen</td></tr>
<tr><td>ACK</td><td>Das Bestätigungsfeld ist gültig. Ab dem zweiten Segment immer gesetzt.</td></tr>
<tr><td>PSH</td><td>Daten sofort an die Anwendung geben</td></tr>
<tr><td>FIN</td><td>Ich sende nichts mehr, sauberes Ende</td></tr>
<tr><td>RST</td><td>Abbruch: Port geschlossen oder Verbindung unbekannt</td></tr></table>
<h2>Auf- und Abbau</h2>
<pre>client                                 web:80
  SYN       seq=1000          MSS 1460  →          LISTEN
            ←  SYN, ACK  seq=5000 ack=1001  MSS 1460
  ACK       seq=1001 ack=5001           →          ESTABLISHED
  PSH, ACK  GET / HTTP/1.1 (78 Byte)    →
            ←  ACK, Daten: HTTP/1.1 200 OK …
  FIN, ACK                              →
            ←  FIN, ACK
  ACK                                   →          geschlossen</pre>
<p>SYN und FIN zählen wie ein Byte, deshalb bestätigt der Server die 1000 mit 1001. Die Startnummern sind zufällig, damit niemand fremde Segmente in eine Verbindung einschleusen kann. Im SYN steht auch die <b>MSS</b> (Maximum Segment Size): wie viele Byte Daten ein Segment höchstens tragen darf, normalerweise MTU minus 40.</p>
${note('Ein Router liest von all dem nichts. Für ihn ist ein TCP-Segment ein IP-Paket wie jedes andere. Nur Firewalls mit Zustandsverfolgung und Load Balancer schauen auf Ports und Flags.')}` },
      { type: 'label', title: 'Beschrifte den TCP-Header', distractors: ['TTL', 'VNI', 'Länge (UDP)'],
        rows: [[{ label: 'Quell-Port', size: '16 Bit', kind: 'tcp', w: 200 }, { label: 'Ziel-Port', size: '16 Bit', kind: 'tcp', w: 200 }],
          [{ label: 'Sequenznummer', size: '32 Bit', kind: 'tcp', w: 406 }],
          [{ label: 'Bestätigungsnummer', size: '32 Bit', kind: 'tcp', w: 406 }],
          [{ label: 'Header-Länge', size: '4 Bit', kind: 'tcp', w: 100 }, { label: 'Flags', size: '12 Bit', kind: 'tcp', w: 96 }, { label: 'Fenster', size: '16 Bit', kind: 'tcp', w: 200 }],
          [{ label: 'Prüfsumme', size: '16 Bit', kind: 'tcp', w: 200 }, { label: 'Urgent Pointer', size: '16 Bit', kind: 'tcp', w: 200 }]],
        explain: 'Das Fenster sagt, wie viele Byte der Empfänger noch aufnehmen kann. Damit bremst er einen zu schnellen Sender (Flusskontrolle).' },
      { type: 'stack', title: 'Bringe die Segmente in die richtige Reihenfolge', hint: 'Oben steht das erste Segment einer kurzen HTTP-Verbindung.',
        items: [{ name: 'client → web: SYN', kind: 'tcp' }, { name: 'web → client: SYN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' },
          { name: 'client → web: PSH, ACK mit GET /', kind: 'data' }, { name: 'web → client: ACK mit HTTP/1.1 200 OK', kind: 'data' },
          { name: 'client → web: FIN, ACK', kind: 'tcp' }, { name: 'web → client: FIN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' }] },
      { type: 'build', title: 'Baue das erste Segment', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'http'],
        task: '<p>Der <b>client</b> (10.10.0.10) öffnet eine Verbindung zum Webserver <b>web</b> (10.20.0.80, Port 80) in einem anderen Subnetz. Baue den ersten Frame dieser Verbindung, wie er das Kabel des Clients verlässt.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.80', proto: '6', ttl: '64' } },
          { block: 'tcp', fields: { sport: EPHEMERAL, dport: '80', flags: 'SYN' } }],
        explain: 'Das erste Segment trägt nur das SYN-Flag und noch keine Daten. Die HTTP-Anfrage folgt erst nach dem Handshake.' }
    ] },

    { id: 'm5-l4', title: 'TCP im Lab', minutes: 15, steps: [
      { type: 'lab', title: 'Eine Webseite abrufen', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>Rufe vom client aus die Seite <code>http://web.lab/</code> ab. curl löst dabei zuerst den Namen über DNS auf und baut dann die TCP-Verbindung auf. Dreh das Tempo herunter und verfolge die Segmente.</p>',
        presets: { client: ['curl http://web.lab/', 'curl http://10.20.0.80/'], web: ['ss -tuln', 'ss -tan'] },
        goals: [
          { text: 'Rufe http://web.lab/ ab.', check: tag('client', 'tcp-done', d => d.ok && d.mode === 'http') },
          { text: 'Klicke auf das erste SYN-Segment und schau dir die Optionen an.', check: inspected(isTcpSyn) },
          { text: 'Welche MSS kündigt der client im SYN an?', ask: true, expect: () => ['1460'] },
          { text: 'In wie vielen Segmenten schickt web die Antwort?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-response').map(e => String(e.data.segments)) },
          { text: 'Welche Flags hat das zweite Segment des Handshakes?', ask: true, expect: () => ['syn, ack', 'syn,ack', 'syn ack', 'syn/ack', 'synack', 'syn-ack', 'ack, syn', 'ack,syn'] }],
        hints: ['Im Protokoll heissen die Segmente SYN, SYN/ACK und so weiter. Filtere auf «Nur client».', 'Die Antwort ist 3000 Byte gross. Rechne mit der MSS.'],
        outro: '<p>Die Antwort von 3000 Byte passt nicht in ein Segment: web teilt sie nach der MSS auf. Der client bestätigt jedes Segment. In echten Netzen bestätigt er oft nur jedes zweite (Delayed ACK), und der Sender schickt mehrere Segmente, ohne auf Bestätigungen zu warten (Fenster).</p>' }
    ] },

    { id: 'm5-l5', title: 'Abgelehnt, gefiltert, verboten', minutes: 15, steps: [
      { type: 'theory', title: 'Drei Arten, wie eine Verbindung scheitert', html: `
<table><tr><th>Was du siehst</th><th>Was passiert ist</th><th>Typische Ursache</th></tr>
<tr><td><code>Connection refused</code> sofort</td><td>Auf das SYN kam ein RST zurück</td><td>Auf dem Port lauscht nichts, oder eine Firewall lehnt mit RST ab</td></tr>
<tr><td><code>timed out</code> nach Sekunden</td><td>Auf das SYN kam gar nichts zurück, der Client wiederholt es mehrmals</td><td>Eine Firewall verwirft still (DROP), oder der Host ist weg</td></tr>
<tr><td><code>No route to host</code> oder <code>prohibited</code></td><td>Ein ICMP-Fehler kam zurück</td><td>Kein ARP für das Ziel, oder eine Firewall lehnt mit ICMP ab</td></tr></table>
<p><code>nc -zv host port</code> testet nur den Verbindungsaufbau und eignet sich gut, um diese Fälle zu unterscheiden.</p>
${note('Eine Firewall, die mit RST ablehnt, setzt als Absender die Adresse des Servers ein. Für den Client sieht ein abgelehnter Port deshalb genau gleich aus wie ein geschlossener. Erst das Protokoll der Firewall oder ein Mitschnitt auf beiden Seiten zeigt den Unterschied.')}
${note('DROP oder REJECT? DROP verrät weniger, lässt aber jeden Client bis zum Timeout warten. Für interne Netze ist REJECT oft freundlicher, an der Grenze zum Internet verwendet man meist DROP.')}` },
      { type: 'lab', title: 'Finde heraus, was die Verbindung stoppt', topo: () => servicesTopo({ acl: [
        { action: 'drop', proto: 'tcp', port: 80, src: 'any', dst: '10.20.0.80/32' },
        { action: 'reject', proto: 'tcp', port: 443, src: 'any', dst: '10.20.0.80/32' }] }), edit: 'config',
        intro: '<p>Ein Kollege meldet: «web.lab geht nicht». Auf web laufen HTTP (80) und HTTPS (443), SSH (22) ist nicht installiert. Untersuche vom client aus die drei Ports.</p>',
        presets: { client: ['nc -zv 10.20.0.80 22', 'nc -zv 10.20.0.80 80', 'nc -zv 10.20.0.80 443', 'curl http://web.lab/'], web: ['ss -tuln'] },
        goals: [
          { text: 'Teste Port 22. Die Verbindung wird sofort abgelehnt.', check: tag('client', 'tcp-refused', d => d.port === 22) },
          { text: 'Teste Port 80. Diesmal läuft die Verbindung in einen Timeout.', check: tag('client', 'tcp-timeout', d => d.port === 80) },
          { text: 'Teste Port 443. Auch hier: refused, obwohl der Dienst läuft.', check: tag('client', 'tcp-refused', d => d.port === 443) },
          { text: 'Welches Gerät hat das RST für Port 443 tatsächlich gesendet?', ask: true, expect: () => ['r1'] },
          { text: 'Ändere die Regeln auf r1 so, dass HTTP zu web erlaubt ist, und rufe http://web.lab/ ab.', check: tag('client', 'tcp-done', d => d.ok && d.port === 80 && d.mode === 'http') }],
        hints: ['Wie oft hat der client bei Port 80 sein SYN gesendet? Das Protokoll zeigt es.', 'Bei r1 unter Konfiguration findest du die Regeln. Die erste passende gilt.'],
        outro: '<p>Port 22 und Port 443 sahen für den client gleich aus, die Ursache war aber eine ganz andere: einmal kein Dienst, einmal eine Regel auf r1. Das Protokoll von r1 verrät es mit «Regel 2 (ablehnen) trifft».</p>' }
    ] },

    { id: 'm5-l6', title: 'Segmente, MSS und die Path MTU', minutes: 18, steps: [
      { type: 'theory', title: 'TCP fragmentiert nicht, TCP segmentiert', html: `
<p>TCP setzt in jedem Paket das DF-Bit. Statt IP-Fragmenten verwendet es kleinere Segmente. Wie gross sie sein dürfen, handeln beide Seiten im Handshake mit der MSS aus: Jede Seite kündigt MTU ihrer Schnittstelle minus 40 an (20 IP, 20 TCP). Beide kennen aber nur ihre eigene Leitung.</p>
<pre>client ── r1 ══ MTU 1400 ══ r2 ── fw ── web
MSS im Handshake: 1460 und 1460 → web sendet Segmente mit 1500 Byte
r2 kann sie nicht weiterleiten (DF gesetzt) → ICMP Fragmentation Needed, MTU 1400 an web
web merkt sich die Path MTU und sendet die Daten erneut, jetzt mit 1360 Byte pro Segment</pre>
<p>Das ist <b>Path MTU Discovery</b> (Modul IP und Routing) aus Sicht von TCP. Kommt die ICMP-Meldung nicht an, entsteht das berüchtigte <b>PMTUD-Blackhole</b>:</p>
<table><tr><th>Symptom</th><th>Erklärung</th></tr>
<tr><td>Verbindung baut sich auf, dann hängt sie</td><td>SYN, SYN/ACK und ACK sind klein und passen, die vollen Datensegmente nicht</td></tr>
<tr><td>SSH-Login klappt, beim ersten <code>ls</code> in einem grossen Verzeichnis friert es ein</td><td>kleine Pakete gehen, grosse nicht</td></tr>
<tr><td>Webseiten laden halb</td><td>der Anfang passt in kleine Segmente, der Rest nicht</td></tr></table>
<h2>Abhilfe</h2>
<p>Die saubere Lösung: ICMP Typ 3 Code 4 nicht filtern. Wo man das nicht in der Hand hat, hilft <b>MSS Clamping</b> auf dem Router vor der engen Stelle. Er schreibt die MSS in jedem weitergeleiteten SYN herunter, dann senden beide Seiten von Anfang an kleine Segmente:</p>
<pre>iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \\
         -j TCPMSS --set-mss 1360</pre>
${note('Typische Stellen dafür sind VPN-Tunnel, PPPoE (MTU 1492) und VXLAN ohne Jumbo Frames im Underlay.')}` },
      { type: 'lab', title: 'Path MTU Discovery mit TCP', topo: () => tcpPathTopo(), edit: 'config',
        intro: '<p>Zwischen r1 und r2 liegt eine Strecke mit MTU 1400. Die Antwort von web ist 6000 Byte gross. Rufe sie ab und beobachte, wie web seine Segmente anpasst.</p>',
        presets: { client: ['curl http://10.0.2.80/'], web: ['ip route get 10.0.1.10'] },
        goals: [
          { text: 'Rufe http://10.0.2.80/ vom client aus ab.', check: tag('client', 'tcp-done', d => d.ok) },
          { text: 'Welcher Router hat ICMP Fragmentation Needed gesendet?', ask: true, expect: sim => sim.log.filter(e => e.tag === 'frag-needed-sent').map(e => e.dev) },
          { text: 'Mit welcher MSS sendet web die Daten erneut?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-retransmit').map(e => String(e.data.mss)) }],
        outro: '<p>web hat in der Konsole mit <code>ip route get 10.0.1.10</code> nun auch einen Eintrag <code>cache mtu 1400</code>. So merkt sich Linux die Path MTU pro Ziel.</p>' },
      { type: 'lab', title: 'Das Blackhole und MSS Clamping', topo: () => tcpPathTopo({ fwAcl: [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }), edit: 'config',
        intro: '<p>Jemand hat auf fw sämtliches ICMP gesperrt. Rufe die Seite erneut ab und vergleiche. Behebe das Problem danach, ohne die Regel auf fw anzufassen.</p>',
        presets: { client: ['curl http://10.0.2.80/'], r1: ['show ip route'] },
        goals: [
          { text: 'Rufe http://10.0.2.80/ ab. Die Verbindung steht, aber die Daten kommen nicht an.', check: tag('client', 'tcp-stalled') },
          { text: 'Wurde der Drei-Wege-Handshake abgeschlossen? (ja oder nein)', ask: true, expect: () => ['ja'] },
          { text: 'Stelle auf r1 MSS Clamping ein, sodass die Segmente durch die enge Stelle passen, und rufe die Seite erneut ab.', check: tcpDoneAfter('tcp-stalled') }],
        hints: ['MSS Clamping findest du bei r1 unter Konfiguration, unter IP-Forwarding.', 'MTU 1400 minus 40 Byte für IP und TCP.'],
        outro: '<p>Mit MSS Clamping kündigt der client im SYN nur noch 1360 an, und auch das SYN/ACK von web wird auf dem Rückweg angepasst. Keine Seite sendet mehr ein zu grosses Segment, ICMP wird gar nicht gebraucht.</p>' }
    ] }
  ]
};
