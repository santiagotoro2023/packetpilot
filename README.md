# PacketPilot

Netzwerke verstehen, indem du jedem Paket zuschaust.

PacketPilot ist eine kleine Lern-Webapp für Netzwerktechnik. Sie simuliert Hosts, Server, Switches, Router und VXLAN-VTEPs vollständig im Browser. Du baust Netze per Drag and Drop, sendest Pakete im Zeitraffer, verfolgst jeden Hop und zerlegst jeden Frame Schicht für Schicht. Ein geführter Kurs leitet Schritt für Schritt durch die Konzepte, mit Theorie, Übungen und Laboraufgaben, die automatisch geprüft werden.

## Installation

Auf Debian 12 oder 13, als root oder mit sudo:

```bash
curl -fsSLO https://raw.githubusercontent.com/santiagotoro2023/packetpilot/main/packetpilot-install.sh
sudo bash packetpilot-install.sh
```

Danach läuft PacketPilot unter `http://<server>:8080/`.

| Aufruf | Wirkung |
|---|---|
| `sudo bash packetpilot-install.sh` | installiert oder aktualisiert (Port 8080) |
| `sudo bash packetpilot-install.sh --port 80` | anderer Port. Bei 80 wird die nginx-Standardseite deaktiviert |
| `sudo bash packetpilot-install.sh --uninstall` | entfernt PacketPilot, nginx bleibt |
| `bash packetpilot-install.sh --extract ./web` | entpackt nur die Webdateien, ohne root |
| `--force` | installiert auch auf nicht getesteten Systemen |

Das Skript installiert nginx aus den Debian-Paketen, schreibt die Dateien nach `/opt/packetpilot/www` und legt `/etc/nginx/sites-available/packetpilot` an. Ist `ufw` aktiv, wird der Port freigegeben. Zur Laufzeit lädt PacketPilot nichts aus dem Internet nach, es funktioniert also auch in abgeschotteten Lab-Netzen.

Fortschritt, Einstellungen und eigene Netze speichert jeder Browser lokal. Über die Startseite lassen sie sich als JSON exportieren und importieren.

## Was drin ist

**Kurs mit fünf Modulen und 32 Lektionen**

| Modul | Inhalte |
|---|---|
| 1. Ethernet, MAC und ARP | Kapselung, Ethernet-Frame Byte für Byte, MAC-Adressen (OUI, I/G, U/L), MAC-Learning und Flooding, ARP mit Neighbor-Zuständen, Gratuitous ARP, ARP-Probe und Failover, ein Paket über einen Router |
| 2. Spanning Tree | Broadcast-Sturm und MAC-Flapping, Wahl der Root Bridge, BPDUs, Port-Rollen und Pfadkosten, Port-Zustände und PortFast, Ausfall, Topologieänderung und Konvergenz |
| 3. IP und Routing | IPv4-Header, Longest Prefix Match, TTL und traceroute, der Rückweg, MTU und Path MTU Discovery, Regeln und das PMTUD-Blackhole, Control Plane und Data Plane |
| 4. VLAN und VXLAN | 802.1Q-Tag, Access und Trunk, Router-on-a-Stick mit Subinterfaces, VXLAN-Kapselung, VXLAN im Underlay, Fehlersuche im Overlay, die MTU-Falle |
| 5. Transport: UDP, TCP und Dienste | Ports und Sockets, DNS über UDP, Drei-Wege-Handshake, abgelehnte und gefilterte Verbindungen, MSS, Path MTU und MSS Clamping |

Übungstypen: Theorie, Quiz mit Erklärungen, Header beschriften per Drag and Drop, Schichten in Reihenfolge bringen, **Frames selbst konstruieren** (Schichten wählen und jedes Feld ausfüllen, geprüft gegen den Frame, den die Simulation erzeugt), MAC-Decoder, Longest-Prefix-Match-Trainer und Laboraufgaben mit automatisch geprüften Zielen.

**Labor**

- Netzplan-Editor: PCs, Server, Switches, Router und VTEPs per Drag and Drop, Kabel mit Taste K
- **Bereiche** zum Ordnen: farbige, beschriftete Rechtecke, verschiebbar (Geräte darin wandern mit) und in der Grösse veränderbar
- Simulation von Ethernet, 802.1Q, ARP (inklusive Gratuitous ARP, ARP-Probe und Neighbor Unreachability Detection), MAC-Learning, **Spanning Tree (802.1D)** mit Root-Wahl, Rollen, Zuständen, Timern, PortFast und Topologieänderung, Erkennung von Schleifen und Broadcast-Stürmen, IPv4-Forwarding, statischem Routing, **Router-Subinterfaces**, ICMP, Fragmentierung und Path MTU Discovery, **UDP, DNS und TCP** (Handshake, Segmentierung nach MSS, RST, Timeouts, Neuübertragung nach PMTUD), Regeln auf Routern (erlauben, verwerfen, ablehnen, mit Protokoll und Port), MSS Clamping und VXLAN mit Head-End Replication und Flood and Learn
- Dienste pro Server (TCP und UDP, frei wählbare Ports) und DNS-Einträge, DNS-Server pro Host
- Zeitraffer mit Tempo-Regler, Pause, Einzelschritt und Vorspulen, BPDUs ein- und ausblendbar
- Pakete als Umschläge mit farbigen Streifen pro Schicht, Klick zerlegt sie im Paketinspektor
- STP-Zustand direkt im Plan: Punkte an jedem Switch-Port zeigen Rolle und Zustand
- Ereignisprotokoll mit Erklärungen in Klartext, Filter pro Gerät, nur Spanning Tree, Verfolgung eines einzelnen Pakets über alle Hops
- Konsole pro Gerät: `ping`, `traceroute`, `arping [-U|-A|-D]`, `curl`, `nc -zv`, `nc -u`, `dig`, `ss`, `ip addr`, `ip route`, `ip neigh`, `ip link` (Subinterfaces anlegen, Ports trennen), `bridge fdb`, `show spanning-tree`, `spanning-tree …`, `show ip route`, `show vxlan`
- Beispielnetze, eigene Netze speichern, Export und Import als JSON

**Frame-Baukasten**: Header frei stapeln, die Reihenfolge prüfen lassen und Grössen, Overhead und MTU-Bedarf berechnen.

## Entwicklung

Die Quellen liegen in `src/`, ohne Build-Schritt und ohne Abhängigkeiten (ES-Module, reines HTML, CSS und JavaScript).

```bash
python3 -m http.server -d src 8765     # lokal testen
node test/engine.test.mjs               # Simulations-Engine
node test/course.test.mjs               # jede Laborlektion mit Musterlösung durchspielen
node test/build.test.mjs                # Frame-Aufgaben gegen die Simulation prüfen
bash build.sh                           # packetpilot-install.sh neu erzeugen
```

Für `test/ui.test.mjs`, `test/features.test.mjs` und `test/lesson.test.mjs` wird Playwright mit Chromium benötigt.

```
src/
  index.html, css/app.css
  js/engine.js        Simulation (Ereigniswarteschlange, L2, STP, L3, TCP/UDP, VXLAN)
  js/packets.js       Frames bauen, beschreiben, zerlegen
  js/net.js           Adressen und Grössen
  js/cli.js           Gerätekonsole
  js/lab.js           Editor, Animation, Protokoll, Inspektor
  js/panels.js        Konfiguration, Tabellen, Konsole
  js/widgets.js       Übungen
  js/course/          Kursinhalte
  js/presets.js       Beispielnetze
installer/            Kopf und Ende des Installationsskripts
build.sh              setzt das Installationsskript zusammen
```

Eine neue Lektion ist ein Objekt in `src/js/course/m*.js`. Laborschritte bestehen aus einer Topologie, einer Einleitung und Zielen. Ein Ziel ist entweder eine Funktion, die den Zustand der Simulation prüft, oder eine Frage, deren richtige Antwort aus der Simulation berechnet wird.

## Geplant

Statisches Routing mit ECMP, OSPF und BFD, VRRP, DHCP mit Relay und DNS-Hierarchie, VPN (WireGuard, IPsec), BGP und EVPN, danach IPv6 als Erweiterung.
