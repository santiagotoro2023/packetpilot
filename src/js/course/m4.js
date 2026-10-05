import { bar, note, pingOk, tag, pingOkAfter, linkBetween } from './helpers.js';
import { stpTriangle, stpSquare } from '../presets.js';
import { macFor } from '../net.js';

// Bridge-IDs wie in der Engine: Priorität plus MAC der Bridge
const bmac = id => macFor(id + '/bridge');
const bidOf = (sim, id) => `${sim.dev(id).cfg.stp.priority}.${bmac(id)}`;
const lowestBid = (sim, ids) => ids.map(id => ({ id, prio: Number(sim.dev(id).cfg.stp.priority), mac: bmac(id) }))
  .sort((a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac))[0].id;
const TRI = ['sw1', 'sw2', 'sw3'];
// Der Switch mit der höchsten MAC wird bei gleicher Priorität sicher nicht Root
const NOT_ROOT = [...TRI].sort((a, b) => bmac(b).localeCompare(bmac(a)))[0];
const blockedPorts = (sim, ids) => ids.flatMap(id => (sim.dev(id).bridge.stpTable()?.ports || []).filter(p => p.role === 'alternate').map(p => [id, p.port]));
const portAnswers = list => list.flatMap(([d, p]) => [`${d} ${p}`, `${d}:${p}`, `${d}/${p}`, `${d}-${p}`]);
const stpOn = ids => sim => ids.every(id => sim.dev(id)?.bridge?.stp);

export default {
  id: 'm4', title: 'Spanning Tree', bands: ['eth', 'stp'],
  text: 'Redundante Verkabelung ohne Broadcast-Sturm: Wie Switches eine Root Bridge wählen, Ports blockieren und nach einem Ausfall umschalten.',
  lessons: [
    { id: 'm4-l1', title: 'Warum Schleifen ein Netz lahmlegen', minutes: 12, steps: [
      { type: 'theory', title: 'Redundanz ohne Schutz', html: `
<p>Ein einzelnes Kabel zwischen zwei Switches ist ein Single Point of Failure. Also verkabelt man redundant: Fällt ein Weg aus, gibt es einen zweiten. Damit entsteht aber eine <b>Schleife</b>, und Ethernet ist dafür nicht gebaut.</p>
<table><tr><th>IP-Paket</th><th>Ethernet-Frame</th></tr>
<tr><td>hat eine TTL, jeder Router zieht 1 ab, bei 0 ist Schluss</td><td>hat <b>kein</b> solches Feld, ein Frame kann ewig kreisen</td></tr></table>
<p>Was in einem Dreieck aus drei Switches passiert, wenn pc1 eine einzige ARP-Anfrage sendet:</p>
<pre>1. sw2 flutet den Broadcast an sw1 und an sw3
2. sw1 flutet ihn weiter an sw3, sw3 flutet ihn weiter an sw1
3. Beide Kopien kommen wieder bei sw2 an, der flutet sie erneut
4. Jede Runde erzeugt neue Kopien, keine verschwindet</pre>
<p>Die Folgen nennt man <b>Broadcast-Sturm</b>: Die Links laufen voll, jeder Host muss jeden Broadcast verarbeiten, und die MAC-Tabellen springen ständig hin und her (<b>MAC-Flapping</b>), weil dieselbe Quell-MAC abwechselnd an verschiedenen Ports auftaucht. In Sekunden steht das ganze Segment.</p>
${note('Die Lösung ist das <b>Spanning Tree Protocol</b> (STP, IEEE 802.1D). Die Switches tauschen kleine Nachrichten aus, die <b>BPDUs</b>, und berechnen daraus einen Baum ohne Schleifen. Überzählige Ports werden blockiert. Fällt ein aktiver Weg aus, gibt STP einen blockierten Port wieder frei.')}
${note('Ein Kabel, das versehentlich zwei Wanddosen im selben Büro verbindet, reicht für eine Schleife. Deshalb ist STP auf Switches im Normalfall eingeschaltet, auch dort, wo niemand absichtlich redundant verkabelt hat.', true)}` },
      { type: 'lab', title: 'Ein Ping legt das Netz lahm', topo: () => stpTriangle({ enabled: false }), edit: 'config',
        intro: '<p>Drei Switches im Dreieck, Spanning Tree ist überall aus. Pinge von pc1 aus pc2 und schau zu, was mit der ARP-Anfrage passiert. Die Simulation hält an, sobald ein Switch denselben Frame zu oft gesehen hat.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2'], sw2: ['bridge fdb', 'show spanning-tree'] },
        goals: [
          { text: 'Pinge von pc1 aus pc2 (10.0.0.2) und löse den Sturm aus.', check: tag(null, 'storm') },
          { text: 'Welche Art von Frame kreist in der Schleife?', ask: true, expect: () => ['arp', 'arp request', 'arp-anfrage', 'arp-request', 'broadcast', 'arp broadcast'], placeholder: 'z. B. ICMP' },
          { text: 'Setze den Zustand zurück und schalte bei sw1, sw2 und sw3 unter Konfiguration Spanning Tree ein.', check: stpOn(TRI) },
          { text: 'Warte, bis die Punkte an den Ports grün oder rot sind, und pinge erneut. Jetzt kommt die Antwort an.', check: pingOk('pc1', '10.0.0.2') }],
        hints: ['Der Knopf mit dem Kreispfeil oben links setzt den Zustand zurück.', 'Die Timer sind auf «schnell» gestellt: Ein Port braucht 8 Sekunden bis Forwarding. Mit dem Vorspulen-Knopf geht es sofort.'],
        outro: '<p>Ein roter Punkt zeigt einen blockierten Port. Er empfängt weiterhin BPDUs, leitet aber keinen einzigen Frame weiter. So bleibt das Kabel als Reserve gesteckt, ohne eine Schleife zu bilden.</p>' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Warum kreist ein Ethernet-Frame in einer Schleife unbegrenzt, ein IP-Paket aber nicht?', options: ['Ethernet ist schneller', 'Der Ethernet-Header hat kein TTL-Feld', 'Switches löschen keine Frames', 'IP-Pakete sind kleiner'], correct: 1,
          explain: 'Router senken die TTL und verwerfen das Paket bei 0. Ein Switch verändert den Frame nicht und kann eine Schleife nicht erkennen.' },
        { q: 'Was bedeutet MAC-Flapping?', options: ['Eine MAC-Adresse ändert sich zufällig', 'Dieselbe Quell-MAC taucht abwechselnd an verschiedenen Ports auf', 'Der Switch vergisst alle Adressen', 'Zwei Hosts haben dieselbe IP'], correct: 1,
          explain: 'In einer Schleife kommt der Frame von pc1 über mehrere Wege an. Der Switch trägt pc1 jedes Mal an einem anderen Port ein. Viele Switches melden das im Log, ein gutes Indiz für eine Schleife.' }] }
    ] },

    { id: 'm4-l2', title: 'Die Wahl der Root Bridge', minutes: 15, steps: [
      { type: 'theory', title: 'Bridge-ID und BPDUs', html: `
<p>Spanning Tree baut den Baum von einer Wurzel aus, der <b>Root Bridge</b>. Gewählt wird der Switch mit der kleinsten <b>Bridge-ID</b>:</p>
${bar([['Priorität', '4 Bit', 'stp', 1], ['System-ID (VLAN)', '12 Bit', 'stp', 1.6], ['MAC-Adresse der Bridge', '48 Bit', 'eth', 3]], 'Zusammen 8 Byte. Zuerst zählt die Priorität, bei Gleichstand die MAC.')}
<p>Die Priorität ist standardmässig <b>32768</b> und lässt sich nur in Schritten von <b>4096</b> ändern, weil die unteren 12 Bit für die VLAN-Nummer reserviert sind. Haben alle Switches dieselbe Priorität, gewinnt die kleinste MAC-Adresse, oft der älteste Switch im Netz. Deshalb legt man die Root bewusst fest, meist auf einen zentralen Switch mit Priorität 4096 oder 0.</p>
<h2>So läuft die Wahl</h2>
<pre>1. Jeder Switch startet und hält sich selbst für die Root
2. Er sendet alle 2 Sekunden BPDUs an 01:80:c2:00:00:00
3. Hört er eine BPDU mit kleinerer Root-ID, übernimmt er diese Root
4. Am Ende sendet nur noch die Root eigene BPDUs, die anderen geben sie weiter</pre>
<table><tr><th>Feld in der BPDU</th><th>Bedeutung</th></tr>
<tr><td>Root-ID</td><td>wen der Absender für die Root hält</td></tr>
<tr><td>Root-Pfadkosten</td><td>wie teuer der Weg des Absenders zur Root ist</td></tr>
<tr><td>Bridge-ID, Port-ID</td><td>wer sendet, über welchen Port</td></tr>
<tr><td>Hello, Max Age, Forward Delay</td><td>Timer, die die Root für alle vorgibt (2, 20, 15 Sekunden)</td></tr>
<tr><td>Flags</td><td>u. a. Topology Change</td></tr></table>
${note('BPDUs sind keine Ethernet-II-Frames. Sie verwenden das ältere 802.3-Format mit einem Längenfeld statt EtherType und einem LLC-Header (DSAP und SSAP 0x42). Im Paketinspektor siehst du das.')}` },
      { type: 'quiz', title: 'Wer gewinnt?', questions: [
        { q: 'Drei Switches: A <code>32768.00:1a:2b:00:00:01</code>, B <code>4096.00:1a:2b:ff:ff:ff</code>, C <code>32768.00:00:00:00:00:02</code>. Wer wird Root?', options: ['A', 'B', 'C'], correct: 1,
          explain: 'Zuerst zählt die Priorität. 4096 ist kleiner als 32768, die MAC spielt dann keine Rolle mehr.' },
        { q: 'A und C bleiben übrig. Wer von beiden hätte die kleinere Bridge-ID?', options: ['A', 'C'], correct: 1, explain: 'Gleiche Priorität, also entscheidet die MAC: 00:00:00:… ist kleiner als 00:1a:2b:….' },
        { q: 'Welche Priorität kannst du nicht einstellen?', options: ['0', '4096', '20000', '61440'], correct: 2, explain: '20000 ist kein Vielfaches von 4096.' }] },
      { type: 'build', title: 'Baue eine BPDU der Root', blocks: ['eth', 'vlan', 'arp', 'stp', 'ip', 'udp', 'data'],
        task: `<p><b>sw1</b> ist Root Bridge mit der Bridge-ID <code>4096.${bmac('sw1')}</code>. Baue die BPDU, die sw1 über seinen Port eth1 sendet (MAC von eth1: <code>${macFor('sw1/eth1')}</code>).</p>`,
        addresses: { mac: [[macFor('sw1/eth1'), 'sw1 eth1'], [macFor('sw2/eth1'), 'sw2 eth1']], bid: [[`4096.${bmac('sw1')}`, 'sw1'], [`32768.${bmac('sw2')}`, 'sw2'], [`32768.${bmac('sw3')}`, 'sw3']] },
        expected: [
          { block: 'eth', fields: { dst: '01:80:c2:00:00:00', src: macFor('sw1/eth1'), type: 'len' } },
          { block: 'stp', fields: { root: `4096.${bmac('sw1')}`, cost: '0', bridge: `4096.${bmac('sw1')}` } }],
        explain: 'Die Root hat zu sich selbst die Kosten 0 und ist zugleich Absender. Die Ziel-MAC ist die reservierte Multicast-Adresse für Bridges, die kein Switch weiterleitet. Statt EtherType steht die Länge der Nutzlast im Header (802.3), danach folgt der LLC-Header.' },
      { type: 'lab', title: 'Root finden und neu bestimmen', topo: () => stpTriangle({ enabled: true }), edit: 'config',
        intro: `<p>Alle drei Switches haben die Standardpriorität 32768. Finde heraus, wer Root geworden ist, und bestimme dann selbst eine neue Root. Mit <code>show spanning-tree</code> in der Konsole eines Switches oder unter Tabellen siehst du den Zustand.</p>`,
        presets: { sw1: ['show spanning-tree'], sw2: ['show spanning-tree'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Welcher Switch ist Root Bridge?', ask: true, expect: sim => [lowestBid(sim, TRI)], placeholder: 'z. B. sw2' },
          { text: 'Warum er? Welche MAC-Adresse hat seine Bridge-ID?', ask: true, expect: sim => [bmac(lowestBid(sim, TRI))], placeholder: 'aa:c1:ab:…' },
          { text: `Mache <b>${NOT_ROOT}</b> zur Root Bridge, indem du seine Priorität senkst. Alle Switches müssen ihn als Root anerkennen.`,
            check: sim => TRI.every(id => sim.dev(id).bridge.stpTable()?.root === bidOf(sim, NOT_ROOT)) }],
        hints: ['Die Priorität stellst du unter Konfiguration beim Switch ein, Abschnitt Spanning Tree.', 'In der Konsole geht es auch: spanning-tree priority 4096'],
        outro: '<p>Die neue Root setzt sich sofort durch: Sobald die anderen ihre bessere BPDU hören, übernehmen sie die Root-ID und berechnen ihre Ports neu.</p>' }
    ] },

    { id: 'm4-l3', title: 'Port-Rollen und Pfadkosten', minutes: 18, steps: [
      { type: 'theory', title: 'Root-Port, Designated, Alternate', html: `
<p>Steht die Root fest, verteilt jeder Switch Rollen an seine Ports. Alle Entscheidungen folgen derselben Kette von Vergleichen: kleinere Kosten, dann kleinere Bridge-ID des Absenders, dann kleinere Port-ID.</p>
<table><tr><th>Rolle</th><th>Regel</th><th>Zustand</th></tr>
<tr><td><b>Root-Port</b></td><td>Jeder Switch ausser der Root hat genau einen: den Port mit dem günstigsten Weg zur Root.</td><td>Forwarding</td></tr>
<tr><td><b>Designated Port</b></td><td>Jedes Kabelsegment hat genau einen: am Switch, der dort den günstigsten Weg zur Root anbietet. Alle Ports der Root sind Designated.</td><td>Forwarding</td></tr>
<tr><td><b>Alternate</b></td><td>Alles, was übrig bleibt. Ein Reserveweg zur Root.</td><td>Blocking</td></tr></table>
<h2>Kosten</h2>
<p>Die Root-Pfadkosten sind die Summe der Portkosten auf dem Weg zur Root, jeweils am <b>empfangenden</b> Port gezählt. Schnellere Links kosten weniger:</p>
<table><tr><th>Geschwindigkeit</th><th>802.1D (kurz)</th><th>802.1t (lang)</th></tr>
<tr><td>10 Mbit/s</td><td>100</td><td>2 000 000</td></tr><tr><td>100 Mbit/s</td><td>19</td><td>200 000</td></tr>
<tr><td>1 Gbit/s</td><td>4</td><td>20 000</td></tr><tr><td>10 Gbit/s</td><td>2</td><td>2 000</td></tr></table>
<h2>Durchgerechnet am Ring</h2>
<pre>Ring: sw1 (Root) – sw2 – sw3 – sw4 – sw1, alle Links Kosten 4
sw2: Root-Port zu sw1, Kosten 4
sw4: Root-Port zu sw1, Kosten 4
sw3: zwei Wege mit Kosten 8, über sw2 oder über sw4
     Gleichstand → der Nachbar mit der kleineren Bridge-ID gewinnt
Segment sw2–sw3: sw2 bietet 4, sw3 bietet 8 → sw2 ist Designated
Segment sw3–sw4: genauso, sw4 ist Designated
→ Der Port von sw3 zum «Verlierer» bleibt übrig: Alternate, Blocking</pre>
${note('Die Rollen sagen dir, wo der Verkehr fliesst. Ein Frame von einem Ende des Rings zum anderen nimmt immer den Weg über die Root, auch wenn ein kürzerer Weg existiert, der gerade blockiert ist.')}` },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Wie viele Root-Ports hat die Root Bridge?', input: ['0', 'keinen', 'null'], explain: 'Die Root braucht keinen Weg zu sich selbst. Alle ihre Ports sind Designated.' },
        { q: 'Ein Switch erreicht die Root über einen 100-Mbit-Link direkt (Kosten 19) oder über zwei Gigabit-Hops (4 + 4). Welcher Weg wird Root-Port?', options: ['Der direkte 100-Mbit-Link', 'Der Weg über zwei Gigabit-Hops', 'Beide, STP verteilt die Last'], correct: 1,
          explain: '4 + 4 = 8 ist kleiner als 19. STP zählt Kosten, nicht Hops. Und STP verteilt nie Last auf zwei Wege, dafür bräuchte es mehrere Instanzen (MSTP) oder Layer-3-Routing mit ECMP.' },
        { q: 'Auf einem Segment bieten beide Switches dieselben Kosten zur Root. Wer bekommt den Designated Port?', options: ['Der mit der kleineren Bridge-ID', 'Der mit der grösseren MAC', 'Beide', 'Keiner'], correct: 0 }] },
      { type: 'lab', title: 'Den blockierten Port vorhersagen und verschieben', topo: stpSquare, edit: 'config',
        intro: '<p>Vier Switches im Ring, sw1 ist Root (Priorität 4096). Lass das Netz kurz konvergieren und vergleiche dann die Punkte an den Ports mit deiner Rechnung. Ein R steht für Root-Port, D für Designated, A für Alternate.</p>',
        presets: { sw3: ['show spanning-tree', 'spanning-tree cost eth2 19'], sw2: ['show spanning-tree'], sw4: ['show spanning-tree'], pc1: ['ping -c 2 10.0.0.3'] },
        goals: [
          { text: 'Welcher Port blockiert? Antworte mit Switch und Port, z. B. sw2 eth1.', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Über welchen Nachbarn erreicht sw3 die Root?', ask: true, expect: sim => { const t = sim.dev('sw3').bridge.stpTable(); const l = sim.linkAt('sw3', t?.rootPort || ''); return l ? [l.a.dev === 'sw3' ? l.b.dev : l.a.dev] : []; } },
          { text: 'Erhöhe eine Portkosten bei sw3 so, dass sw3 die Root über <b>sw2</b> erreicht.', check: sim => sim.dev('sw3').bridge.stpTable()?.rootPort === 'eth1' },
          { text: 'Welcher Port blockiert jetzt?', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Pinge von pc1 aus pc3 (10.0.0.3). Der Weg führt über sw2.', check: pingOk('pc1', '10.0.0.3') }],
        hints: ['sw3 eth1 führt zu sw2, sw3 eth2 zu sw4.', 'Die Kosten zählen am empfangenden Port. Mache den Weg über sw4 teurer: Kosten von sw3 eth2 auf 19.'],
        outro: '<p>Mit Portkosten steuerst du, welcher Link Reserve ist. In der Praxis lässt man die Kosten meist auf dem Standard und wählt nur die Root bewusst. Die Kosten passt man an, wenn Links unterschiedlich schnell sind oder ein bestimmter Link bevorzugt werden soll.</p>' }
    ] },

    { id: 'm4-l4', title: 'Port-Zustände, Timer und PortFast', minutes: 15, steps: [
      { type: 'theory', title: 'Warum ein neuer Port 30 Sekunden braucht', html: `
<p>Ein Port, der aktiv wird, darf nicht sofort weiterleiten: Er könnte eine Schleife schliessen, bevor alle Switches die neue Lage kennen. Deshalb durchläuft er mehrere Zustände:</p>
<table><tr><th>Zustand</th><th>Dauer</th><th>BPDUs</th><th>lernt MACs</th><th>leitet weiter</th></tr>
<tr><td>Blocking</td><td>bis zu 20 s (Max Age)</td><td>empfängt</td><td>nein</td><td>nein</td></tr>
<tr><td>Listening</td><td>15 s (Forward Delay)</td><td>sendet und empfängt</td><td>nein</td><td>nein</td></tr>
<tr><td>Learning</td><td>15 s (Forward Delay)</td><td>sendet und empfängt</td><td><b>ja</b></td><td>nein</td></tr>
<tr><td>Forwarding</td><td>dauerhaft</td><td>sendet und empfängt</td><td>ja</td><td><b>ja</b></td></tr></table>
<p>Learning gibt es, damit der Switch seine MAC-Tabelle schon füllt, bevor er weiterleitet. Sonst müsste er anfangs jeden Frame fluten.</p>
${note('Das Problem in der Praxis: Ein PC wird eingesteckt, und 30 Sekunden geht gar nichts. DHCP läuft in einen Timeout, ein PXE-Boot scheitert. Die Lösung heisst <b>PortFast</b> (Cisco) oder <b>Edge-Port</b> (Standard): Ports zu Endgeräten gehen sofort auf Forwarding.')}
<p>Kommt an einem Edge-Port trotzdem eine BPDU an, hängt dort offensichtlich ein Switch. Der Port verliert dann den Edge-Status und nimmt normal an STP teil. Mit <b>BPDU Guard</b> wird ein solcher Port sogar abgeschaltet, ein guter Schutz gegen mitgebrachte Switches.</p>
${note('<b>RSTP</b> (802.1w, heute Standard) handelt neue Ports in Sekundenbruchteilen aus, statt Timer abzuwarten. Die Rollen und die Root-Wahl funktionieren gleich wie hier. Eine Linux-Bridge spricht nur das klassische STP, für RSTP braucht es den Dienst <code>mstpd</code>.')}` },
      { type: 'lab', title: 'Zustände beobachten und PortFast einschalten', topo: () => stpTriangle({ enabled: true, rootPrio: 4096, timers: 'standard' }), edit: 'config',
        intro: '<p>Diesmal laufen die Standard-Timer. Beobachte die Punkte an den Ports: gelb heisst Listening oder Learning. Das Protokoll lässt sich auf «Nur Spanning Tree» filtern. Mit dem Vorspulen-Knopf überspringst du Wartezeit.</p>',
        presets: { sw2: ['show spanning-tree'], sw3: ['show spanning-tree', 'spanning-tree portfast eth5 on'], pc1: ['ping -c 1 10.0.0.2'] },
        goals: [
          { text: 'Warte, bis der Port von pc1 (sw2 eth5) weiterleitet.', check: tag('sw2', 'stp-state', d => d.port === 'eth5' && d.state === 'forwarding') },
          { text: 'Nach wie vielen Sekunden Simulationszeit war das? (ganze Zahl)', ask: true,
            expect: sim => { const e = sim.log.find(x => x.dev === 'sw2' && x.tag === 'stp-state' && x.data?.port === 'eth5' && x.data.state === 'forwarding'); return e ? [String(Math.round(e.t / 1000)), '30'] : ['30']; } },
          { text: 'Schalte bei sw3 PortFast für eth5 ein. Trenne danach das Kabel von pc2 kurz und verbinde es wieder: Der Port leitet sofort weiter.', check: tag('sw3', 'stp-state', d => d.port === 'eth5' && d.edge) },
          { text: 'In welchem Zustand lernt ein Port MAC-Adressen, leitet aber noch nichts weiter?', ask: true, expect: () => ['learning'] }],
        hints: ['Ein Kabel trennst du, indem du es anklickst und «Link aktiv» ausschaltest.'],
        outro: '<p>Edge-Ports gehören an jeden Port zu einem Endgerät. Zwischen Switches bleiben sie aus, sonst könnte beim Einstecken kurz eine Schleife entstehen.</p>' }
    ] },

    { id: 'm4-l5', title: 'Ausfall und Konvergenz', minutes: 15, steps: [
      { type: 'theory', title: 'Wenn ein Weg wegfällt', html: `
<p>Spanning Tree muss zwei Arten von Ausfällen unterscheiden:</p>
<table><tr><th>Ausfall</th><th>Wie der Switch es merkt</th><th>Dauer bei 802.1D</th></tr>
<tr><td>direkt: der eigene Root-Port verliert den Link</td><td>sofort</td><td>30 s (Listening + Learning)</td></tr>
<tr><td>indirekt: irgendwo anders bricht der Weg</td><td>BPDUs bleiben aus, nach Max Age verfällt die Information</td><td>bis 50 s (20 + 15 + 15)</td></tr></table>
<h2>Topologieänderung</h2>
<p>Nach dem Umschalten stimmen die MAC-Tabellen nicht mehr: Sie zeigen noch auf den alten Weg. Ohne Gegenmassnahme liefen Frames bis zum Aging (300 s) ins Leere. Deshalb meldet ein Switch eine <b>Topology Change</b> (TC) Richtung Root, die Root setzt das TC-Flag in ihren BPDUs, und alle Switches leeren daraufhin ihre MAC-Tabellen schnell. Danach wird über den neuen Weg neu gelernt.</p>
${note('Eine TC entsteht auch, wenn ein gewöhnlicher Port eines Endgeräts auf Forwarding geht. Ohne PortFast löst also jeder eingeschaltete PC kurz ein Leeren der MAC-Tabellen im ganzen Netz aus. Noch ein Grund für Edge-Ports.')}` },
      { type: 'lab', title: 'Ziehe ein Kabel', topo: () => stpTriangle({ enabled: true, rootPrio: 4096 }), edit: 'config',
        intro: '<p>sw1 ist Root. Lass das Netz konvergieren und prüfe mit einem Ping, dass alles läuft. Dann unterbrichst du das Kabel zwischen sw1 und sw2 und schaust zu, wie STP den Reserveweg freigibt.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2', 'ping -c 12 10.0.0.2'], sw2: ['show spanning-tree', 'ip link set eth1 down'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Pinge von pc1 aus pc2, sobald alle Ports grün oder rot sind.', check: pingOk('pc1', '10.0.0.2') },
          { text: 'Welcher Switch hat den blockierten Port?', ask: true, expect: sim => {
            const cut = sim.log.find(x => x.tag === 'link-down');
            const ev = sim.log.filter(x => x.tag === 'stp-state' && x.data?.state === 'blocking' && (!cut || x.seq < cut.seq));
            return ev.length ? [ev[ev.length - 1].dev] : blockedPorts(sim, TRI).map(([d]) => d);
          } },
          { text: 'Unterbrich das Kabel zwischen sw1 und sw2.', check: sim => linkBetween(sim, 'sw1', 'sw2')?.up === false },
          { text: 'Welcher Port von sw2 ist jetzt Root-Port?', ask: true, expect: sim => [sim.dev('sw2').bridge.stpTable()?.rootPort || ''] },
          { text: 'Pinge erneut, bis wieder Antworten kommen.', check: pingOkAfter('pc1', '10.0.0.2', e => e.tag === 'link-down') }],
        hints: ['Ein laufender ping -c 12 zeigt schön, wie lange die Unterbrechung dauert.', 'Im Protokoll siehst du unter «Nur Spanning Tree» die Topologieänderung und das Leeren der MAC-Tabellen.'],
        outro: '<p>Mit den schnellen Labor-Timern dauert das Umschalten 8 Sekunden, mit Standard-Timern 30. Rapid Spanning Tree schafft es meist unter einer Sekunde. Wo noch schneller umgeschaltet werden muss, setzt man auf Layer 3 mit Routing statt auf grosse Layer-2-Domänen.</p>' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Warum leeren Switches nach einer Topologieänderung ihre MAC-Tabellen?', options: ['Um Speicher zu sparen', 'Weil die Einträge noch auf den alten Weg zeigen', 'Damit STP neu startet', 'Das tun sie nicht'], correct: 1 },
        { q: 'Ein Switch hört auf seinem Root-Port keine BPDUs mehr, der Link ist aber noch aktiv. Wie lange wartet er (802.1D), bevor er die Information verwirft?', input: ['20'], unit: 'Sekunden', explain: 'Das ist Max Age. Danach folgen noch Listening und Learning mit je 15 Sekunden.' },
        { q: 'Welche Massnahme verkürzt das Umschalten am stärksten?', options: ['Hello-Timer auf 1 Sekunde', 'Rapid Spanning Tree (802.1w)', 'Höhere Root-Priorität', 'Mehr redundante Kabel'], correct: 1 }] }
    ] }
  ]
};
