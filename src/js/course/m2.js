import { bar, note, pingOk, pingFailed, tag } from './helpers.js';
import { PRESETS, chainTopo, topo, host, server, router, link } from '../presets.js';

const mtuTopo = () => PRESETS.find(p => p.id === 'mtu').make();
const brokenReturn = () => { const t = chainTopo(); t.name = 'Fehlender Rückweg'; t.devices.find(d => d.id === 'r2').routes = [{ dst: '10.0.4.0/24', via: '10.0.23.3' }]; return t; };
const blackhole = () => topo('PMTUD-Blackhole', [
  host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'),
  router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']], {
    acl: [{ action: 'allow', proto: 'icmp', icmpType: 8, src: 'any', dst: 'any' }, { action: 'allow', proto: 'icmp', icmpType: 0, src: 'any', dst: 'any' },
      { action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }),
  router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]),
  server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
[link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'srv1', 'eth1', 1400)]);

export default {
  id: 'm2', title: 'IP und Routing', bands: ['ip', 'icmp', 'udp'],
  text: 'Der IPv4-Header, wie Router entscheiden, TTL und traceroute, der Rückweg, MTU mit Path MTU Discovery und Regeln auf Routern.',
  lessons: [
    { id: 'm2-l1', title: 'Der IPv4-Header', minutes: 12, steps: [
      { type: 'theory', title: 'Was in jedem IP-Paket steht', html: `
<p>Jedes IPv4-Paket beginnt mit mindestens 20 Byte Header. Jeder Router liest ihn, zwei Felder ändert er sogar.</p>
<table><tr><th>Feld</th><th>Bit</th><th>Zweck</th></tr>
<tr><td>Version, IHL</td><td>4 + 4</td><td>4 und Headerlänge in 32-Bit-Wörtern (meist 5 = 20 Byte)</td></tr>
<tr><td>TOS (DSCP, ECN)</td><td>8</td><td>Priorität für QoS und Staumeldung</td></tr>
<tr><td>Total Length</td><td>16</td><td>Länge mit Header, höchstens 65 535</td></tr>
<tr><td>Identification, Flags, Offset</td><td>16 + 3 + 13</td><td>Fragmentierung. Flag <b>DF</b> verbietet das Zerlegen</td></tr>
<tr><td><b>TTL</b></td><td>8</td><td>Jeder Router zieht 1 ab, bei 0 wird verworfen</td></tr>
<tr><td>Protocol</td><td>8</td><td>1 ICMP, 6 TCP, 17 UDP, 50 ESP, 89 OSPF</td></tr>
<tr><td><b>Header Checksum</b></td><td>16</td><td>Nur über den Header. Wegen der TTL bei jedem Hop neu berechnet</td></tr>
<tr><td>Quell-IP, Ziel-IP</td><td>32 + 32</td><td>Bleiben von Ende zu Ende gleich (ohne NAT)</td></tr></table>
${note('Das Feld <b>Protocol</b> spielt dieselbe Rolle wie der EtherType im Ethernet-Frame: Es sagt, wie die Nutzlast zu lesen ist. OSPF läuft direkt auf IP mit Protocol 89, BGP dagegen über TCP-Port 179.')}` },
      { type: 'label', title: 'Beschrifte den IPv4-Header', distractors: ['Ziel-MAC', 'Port', 'VNI'],
        rows: [
          [{ label: 'Version', size: '4 Bit', kind: 'ip', w: 70 }, { label: 'IHL', size: '4 Bit', kind: 'ip', w: 70 }, { label: 'TOS', size: '8 Bit', kind: 'ip', w: 130 }, { label: 'Total Length', size: '16 Bit', kind: 'ip', w: 250 }],
          [{ label: 'Identification', size: '16 Bit', kind: 'ip', w: 250 }, { label: 'Flags', size: '3 Bit', kind: 'ip', w: 70 }, { label: 'Fragment Offset', size: '13 Bit', kind: 'ip', w: 198 }],
          [{ label: 'TTL', size: '8 Bit', kind: 'ip', w: 130 }, { label: 'Protocol', size: '8 Bit', kind: 'ip', w: 136 }, { label: 'Header Checksum', size: '16 Bit', kind: 'ip', w: 256 }],
          [{ label: 'Quell-IP', size: '32 Bit', kind: 'ip', w: 530 }],
          [{ label: 'Ziel-IP', size: '32 Bit', kind: 'ip', w: 530 }]],
        explain: 'Jede Zeile hat 32 Bit. Die ersten fünf Zeilen sind die 20 Byte des Standard-Headers.' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Welche Protocol-Nummer hat UDP?', input: ['17'], explain: '1 ICMP, 6 TCP, 17 UDP.' },
        { q: 'Warum muss ein Router die Header Checksum bei jedem Paket neu berechnen?', options: ['Weil sich die Ziel-IP ändert', 'Weil er die TTL ändert und die Prüfsumme den Header abdeckt', 'Weil Ethernet es verlangt', 'Muss er nicht'], correct: 1,
          explain: 'Die TTL gehört zum Header. Ändert sie sich, stimmt die alte Prüfsumme nicht mehr.' }] }
    ] },

    { id: 'm2-l2', title: 'Die Routing-Entscheidung', minutes: 12, steps: [
      { type: 'theory', title: 'Routing-Tabelle und Longest Prefix Match', html: `
<p>Host und Router entscheiden mit demselben Verfahren. Ein Router leitet nur zusätzlich Pakete weiter, die nicht an ihn selbst gehen.</p>
<pre>$ ip route
default via 192.168.10.1 dev eth1                         ← Default Route
10.20.0.0/16 via 192.168.10.254 dev eth1                  ← statische Route
192.168.10.0/24 dev eth1 proto kernel scope link          ← Connected Route</pre>
<table><tr><th>Eintrag</th><th>ARP fragt nach</th></tr>
<tr><td>Connected Route (direkt angeschlossen)</td><td>dem <b>Ziel</b> selbst</td></tr>
<tr><td>Route mit <code>via</code></td><td>dem <b>Next Hop</b></td></tr></table>
${note('<b>Longest Prefix Match:</b> Passen mehrere Einträge, gewinnt der spezifischste, also der mit dem längsten Präfix. Die Reihenfolge in der Tabelle spielt keine Rolle. Bei gleich langem Präfix entscheidet die Herkunft: Connected vor statisch.')}
<p>Unter Linux zeigt <code>ip route get &lt;ziel&gt;</code> die Entscheidung für ein Ziel an, ohne ein Paket zu senden. Das kannst du auch in jeder Konsole im Labor ausprobieren.</p>` },
      { type: 'lpm', title: 'Wohin geht das Paket?', table: [['10.0.0.0/8', 'A'], ['10.1.0.0/16', 'B'], ['10.1.2.0/24', 'C'], ['10.1.2.64/26', 'D'], ['0.0.0.0/0', 'E']],
        dests: ['10.1.2.77', '10.1.2.200', '10.9.9.9', '10.1.3.1', '172.16.5.5'] },
      { type: 'lpm', title: 'Und ohne Default Route?', table: [['192.168.0.0/16', 'R1'], ['192.168.10.0/24', 'R2'], ['192.168.10.128/25', 'R3']],
        dests: ['192.168.10.130', '192.168.10.5', '192.168.11.5', '8.8.8.8'] }
    ] },

    { id: 'm2-l3', title: 'TTL und traceroute', minutes: 12, steps: [
      { type: 'theory', title: 'Wie traceroute die Router verrät', html: `
<p>Die TTL verhindert, dass ein Paket bei einem Routing-Fehler ewig kreist. Der Router, der sie auf 0 setzt, verwirft das Paket und sendet <b>ICMP Time Exceeded</b> an den Absender.</p>
<p><code>traceroute</code> nutzt das: Es sendet Pakete mit TTL 1, 2, 3 … Jeder Router auf dem Weg verrät sich mit seiner Time-Exceeded-Meldung. Linux sendet dafür UDP an hohe Ports (ab 33434), das Ziel antwortet am Ende mit <b>Port Unreachable</b>.</p>
<pre> 1  10.0.1.1    0.4 ms     ← TTL 1 bei r1 abgelaufen
 2  10.0.12.2   0.6 ms     ← TTL 2 bei r2 abgelaufen
 3  10.0.23.3   0.8 ms
 4  10.0.4.10   1.0 ms     ← Ziel: Port Unreachable</pre>
${note('Ein <code>*</code> heisst nur, dass von diesem Hop keine Antwort kam. Viele Router drosseln Time Exceeded, leiten aber problemlos weiter. Die Start-TTL verrät oft das System: Linux 64, Windows 128, viele Netzwerkgeräte 255.')}` },
      { type: 'lab', title: 'Verfolge den Weg', topo: chainTopo, edit: 'view',
        intro: '<p>pc1 erreicht srv1 über drei Router. Starte auf pc1 ein traceroute und beobachte, bei welchem Router jedes Paket stirbt.</p>',
        presets: { pc1: ['traceroute 10.0.4.10', 'ping -c 1 -t 2 10.0.4.10'] },
        goals: [
          { text: 'Starte auf pc1 traceroute 10.0.4.10.', check: tag('pc1', 'trace-done', d => d.reached) },
          { text: 'Welche Adresse antwortet beim zweiten Hop?', ask: true, expect: () => ['10.0.12.2'] },
          { text: 'Sende einen Ping mit TTL 2 (ping -c 1 -t 2 10.0.4.10). Welcher Router meldet Time Exceeded?', ask: true, expect: () => ['r2', '10.0.12.2'] },
          { text: 'Mit welcher TTL kommt die Antwort von srv1 bei einem normalen Ping an?', ask: true, expect: () => ['61'] }],
        outro: '<p>Drei Router, also 64 - 3 = 61. Die Antwort beim zweiten Hop kommt von der Adresse des Interfaces, über das r2 die Meldung an pc1 zurückschickt.</p>' }
    ] },

    { id: 'm2-l4', title: 'Der Rückweg zählt genauso', minutes: 15, steps: [
      { type: 'theory', title: 'Routing gilt immer nur in eine Richtung', html: `
<p>Jeder Router auf dem Weg braucht eine Route zum Ziel, und jeder Router auf dem Rückweg braucht eine Route zur <b>Quelle</b>. Fehlt der Rückweg, kommt der Ping beim Ziel an, aber die Antwort nie zurück. Das ist der häufigste Fehler beim statischen Routing.</p>
${note('Vorgehen bei der Fehlersuche: <b>1.</b> Kommt das Paket beim Ziel an? <b>2.</b> Hat das Ziel eine Route zurück? <b>3.</b> Hat jeder Router auf dem Rückweg eine Route zur Quelle? Prüfe mit <code>ip route get</code> auf jedem Gerät.')}
<p>Nehmen Hin- und Rückweg verschiedene Pfade, heisst das <b>asymmetrisches Routing</b>. Erlaubt ist das, aber zustandsbehaftete Firewalls verwerfen solche Verbindungen, weil sie nur eine Richtung sehen.</p>` },
      { type: 'lab', title: 'Finde den fehlenden Rückweg', topo: brokenReturn, edit: 'config',
        intro: '<p>pc1 erreicht srv1 nicht. Finde heraus, wo das Problem liegt, und behebe es mit einer statischen Route.</p>',
        presets: { pc1: ['ping -c 2 10.0.4.10'], r2: ['ip route', 'ip route get 10.0.1.10'] },
        goals: [
          { text: 'Pinge von pc1 aus srv1 und stelle fest: Der Ping scheitert.', check: pingFailed('pc1', '10.0.4.10') },
          { text: 'Weise nach, dass der Echo Request bei srv1 trotzdem ankommt (Protokoll filtern: Nur srv1).', check: tag('srv1', 'echo-request-received') },
          { text: 'Welcher Router hat keine Route zurück zu 10.0.1.0/24?', ask: true, expect: () => ['r2'] },
          { text: 'Ergänze die fehlende Route und pinge erneut, bis es klappt.', check: pingOk('pc1', '10.0.4.10') }],
        hints: ['Schau bei r2 unter Tabellen nach, welche Netze er kennt.', 'Auf r2 fehlt: Ziel 10.0.1.0/24 via 10.0.12.1. In der Konsole: ip route add 10.0.1.0/24 via 10.0.12.1'] }
    ] },

    { id: 'm2-l5', title: 'MTU und Path MTU Discovery', minutes: 15, steps: [
      { type: 'theory', title: 'Zu gross für den Weg', html: `
<p>Ist ein Paket grösser als die MTU des nächsten Links, hat ein Router zwei Möglichkeiten:</p>
<table><tr><th>DF-Flag</th><th>Was der Router tut</th></tr>
<tr><td>nicht gesetzt</td><td>Zerlegt das Paket in <b>Fragmente</b>. Erst das Ziel setzt sie zusammen. Geht ein Fragment verloren, ist alles verloren.</td></tr>
<tr><td>gesetzt</td><td>Verwirft das Paket und sendet <b>ICMP Fragmentation Needed</b> mit der passenden MTU zurück. Der Absender merkt sich die MTU und sendet kleiner. Das ist <b>Path MTU Discovery</b>.</td></tr></table>
<pre>ping -M do -s 1472 ziel     1472 + 8 (ICMP) + 20 (IP) = 1500 Byte, DF gesetzt
ping -M dont -s 1472 ziel   gleich gross, Fragmentierung erlaubt</pre>
${note('Nach einer Fragmentation-Needed-Meldung lehnt Linux zu grosse Pakete schon lokal ab: <code>ping: local error: message too long, mtu=1400</code>. Mit <code>ip route get</code> siehst du die gelernte MTU.')}` },
      { type: 'lab', title: 'Der Engpass', topo: mtuTopo, edit: 'view',
        intro: '<p>Der Link zwischen r1 und r2 hat nur MTU 1400. Teste es von pc1 aus.</p>',
        presets: { pc1: ['ping -c 2 -M do -s 1472 10.0.2.20', 'ping -c 1 -M dont -s 1472 10.0.2.20', 'ip route get 10.0.2.20'] },
        goals: [
          { text: 'Sende einen Ping mit 1472 Byte und DF (-M do). Welche MTU meldet r1 zurück?', ask: true, expect: () => ['1400'] },
          { text: 'pc1 merkt sich die MTU des Weges.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Sende denselben Ping ohne DF (-M dont). r1 zerlegt das Paket, und der Ping kommt an.', check: pingOk('pc1', '10.0.2.20', { size: 1472, df: false }) },
          { text: 'In wie viele Fragmente hat r1 das Paket zerlegt?', ask: true, expect: () => ['2'] },
          { text: 'Mit welchem grössten Wert für -s klappt der Ping mit -M do?', ask: true, expect: () => ['1372'] }],
        outro: '<p>1372 + 8 + 20 = 1400. Genau so gross darf ein IP-Paket über den engsten Link sein.</p>' }
    ] },

    { id: 'm2-l6', title: 'Regeln und das PMTUD-Blackhole', minutes: 15, steps: [
      { type: 'theory', title: 'Regeln auf Routern', html: `
<p>Router und Firewalls filtern Pakete mit <b>Regeln</b>. Die Regeln werden von oben nach unten geprüft, die <b>erste passende</b> gilt. Typische Aktionen sind erlauben, verwerfen (still) und ablehnen (mit ICMP-Meldung).</p>
<p>Ein häufiger Fehler: ICMP wird bis auf Ping komplett blockiert, weil es "unsicher" sei. Damit verschwindet auch <b>Fragmentation Needed</b> (ICMP Typ 3). Kleine Pakete gehen, grosse verschwinden spurlos: SSH klappt, grosse Downloads hängen. Das heisst <b>PMTUD-Blackhole</b>.</p>
<table><tr><th>ICMP-Typ</th><th>Bedeutung</th><th>Blockieren?</th></tr>
<tr><td>8 / 0</td><td>Echo Request / Reply</td><td>von aussen drosseln ist vertretbar</td></tr>
<tr><td>3</td><td>Destination Unreachable, inkl. Fragmentation Needed</td><td><b>nie</b></td></tr>
<tr><td>11</td><td>Time Exceeded</td><td>besser nicht, sonst geht traceroute nicht</td></tr></table>` },
      { type: 'lab', title: 'Repariere das Blackhole', topo: blackhole, edit: 'config',
        intro: '<p>r1 erlaubt nur Ping (Typ 8 und 0) und verwirft jedes andere ICMP. Zwischen r2 und srv1 ist die MTU 1400.</p>',
        presets: { pc1: ['ping -c 1 10.0.2.20', 'ping -c 1 -M do -s 1472 10.0.2.20', 'ping -c 1 -M do -s 1372 10.0.2.20'] },
        goals: [
          { text: 'Ein normaler Ping von pc1 an srv1 funktioniert.', check: pingOk('pc1', '10.0.2.20') },
          { text: 'Ein Ping mit -M do -s 1472 verschwindet ohne jede Meldung. Finde im Protokoll, wo die ICMP-Meldung von r2 bleibt.', check: tag('r1', 'acl-drop') },
          { text: 'Ergänze auf r1 eine Regel, die ICMP Typ 3 erlaubt, und setze sie über die Regel zum Verwerfen. Jetzt lernt pc1 die MTU.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Sende einen Ping mit -M do -s 1372.', check: pingOk('pc1', '10.0.2.20', { size: 1372, df: true }) }],
        hints: ['Bei r1 unter Konfiguration findest du die Regeln. Neue Regel: erlauben, ICMP, Typ 3, dann mit dem Pfeil nach oben schieben.'] }
    ] },

    { id: 'm2-l7', title: 'Control Plane und Data Plane', minutes: 6, steps: [
      { type: 'theory', title: 'Wer entscheidet, wer leitet weiter?', html: `
<table><tr><th></th><th>Control Plane</th><th>Data Plane</th></tr>
<tr><td>Aufgabe</td><td>Herausfinden, welche Wege es gibt</td><td>Jedes Paket weiterleiten</td></tr>
<tr><td>Wie oft</td><td>bei Änderungen im Netz</td><td>Millionen Mal pro Sekunde</td></tr>
<tr><td>Linux mit FRR</td><td>FRR: ospfd, bgpd, zebra</td><td>der Kernel</td></tr>
<tr><td>Ergebnis</td><td>Einträge in der Routing-Tabelle</td><td>Pakete auf dem richtigen Interface</td></tr></table>
<p>Kennt der Router dieselbe Route aus mehreren Quellen, gewinnt die kleinste <b>administrative Distanz</b>: Connected 0, statisch 1, eBGP 20, OSPF 110, iBGP 200.</p>
${note('Hängt die Control Plane, leitet die Data Plane mit den vorhandenen Routen weiter. Sie reagiert nur nicht mehr auf Änderungen. Dasselbe Prinzip kennst du aus Kubernetes: API-Server und Scheduler entscheiden, kubelet und kube-proxy setzen um.')}` },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Eine Route zu 10.0.0.0/24 ist statisch und gleichzeitig über OSPF bekannt. Welche gewinnt?', options: ['OSPF, weil dynamisch', 'Die statische, Distanz 1 statt 110', 'Die mit der kleineren Metrik', 'Beide abwechselnd'], correct: 1, explain: 'Bei gleichem Präfix entscheidet die administrative Distanz.' },
        { q: 'Welche Distanz hat eine OSPF-Route in FRR?', input: ['110'] }] }
    ] }
  ]
};
