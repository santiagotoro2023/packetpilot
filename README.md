# PacketPilot

Understand networks by watching every packet.

PacketPilot is a small learning web app for networking. It simulates hosts, servers, switches, routers and VXLAN VTEPs entirely in the browser. You build networks by drag and drop, send packets in slow motion, follow every hop and take every frame apart layer by layer. A guided course leads you through the concepts step by step, with theory, exercises and lab tasks that are checked automatically.

## Installation

On Debian 12 or 13, as root or with sudo:

```bash
curl -fsSLO https://raw.githubusercontent.com/santiagotoro2023/packetpilot/main/packetpilot-install.sh
sudo bash packetpilot-install.sh
```

PacketPilot then runs at `https://<server>:8080/`, secured with a self-signed certificate that the installer generates automatically. Your browser warns once because no public authority signed it; the installer prints the certificate's SHA-256 fingerprint so you can compare it before accepting. Plain `http://` requests to the port are redirected to HTTPS.

| Command | Effect |
|---|---|
| `sudo bash packetpilot-install.sh` | installs or updates (HTTPS on port 8080) |
| `sudo bash packetpilot-install.sh --port 443` | different port. With 80, the nginx default site is disabled |
| `sudo bash packetpilot-install.sh --http` | plain HTTP without a certificate (kept on later updates, back with `--https`) |
| `sudo bash packetpilot-install.sh --new-cert` | generates a new self-signed certificate |
| `sudo bash packetpilot-install.sh --update` | fetches the latest version from GitHub |
| `sudo bash packetpilot-install.sh --uninstall` | removes PacketPilot, nginx stays |
| `bash packetpilot-install.sh --extract ./web` | only extracts the web files, no root needed |
| `--force` | also installs on untested systems |

The script installs nginx (and openssl, if missing) from the Debian packages, writes the files to `/opt/packetpilot/www` and creates `/etc/nginx/sites-available/packetpilot`. The certificate and key live in `/opt/packetpilot/tls/`. The certificate covers the hostname, `localhost` and all IP addresses of the server and is valid for 825 days. Updates keep it, so browsers don't warn again; it is only replaced when it expires within 30 days or with `--new-cert`. To use your own certificate, replace `packetpilot.crt` and `packetpilot.key` there and run `systemctl reload nginx`. If `ufw` is active, the port is opened. At runtime PacketPilot loads nothing from the internet, so it also works in isolated lab networks.

Each browser stores progress, settings and your own networks locally. They can be exported and imported as JSON from the home page.

## What's inside

**Course with five modules and 32 lessons**

| Module | Contents |
|---|---|
| 1. Ethernet, MAC and ARP | Encapsulation, the Ethernet frame byte by byte, MAC addresses (OUI, I/G, U/L), MAC learning and flooding, ARP with neighbor states, gratuitous ARP, ARP probe and failover, a packet across a router |
| 2. Spanning tree | Broadcast storm and MAC flapping, root bridge election, BPDUs, port roles and path costs, port states and PortFast, failure, topology change and convergence |
| 3. IP and routing | IPv4 header, longest prefix match, TTL and traceroute, the return path, MTU and Path MTU Discovery, rules and the PMTUD blackhole, control plane and data plane |
| 4. VLAN and VXLAN | 802.1Q tag, access and trunk, router on a stick with subinterfaces, VXLAN encapsulation, VXLAN in the underlay, troubleshooting the overlay, the MTU trap |
| 5. Transport: UDP, TCP and services | Ports and sockets, DNS over UDP, three-way handshake, refused and filtered connections, MSS, path MTU and MSS clamping |

Exercise types: theory, quizzes with explanations, labeling headers by drag and drop, putting layers in order, **building frames yourself** (pick the layers and fill in every field, checked against the frame the simulation produces), MAC decoder, longest prefix match trainer and lab tasks with automatically checked goals.

**Lab**

- Network diagram editor: PCs, servers, switches, routers and VTEPs by drag and drop, cables with the K key
- **Areas** for organizing: colored, labeled rectangles that can be moved (devices inside move along) and resized
- Simulation of Ethernet, 802.1Q, ARP (including gratuitous ARP, ARP probe and Neighbor Unreachability Detection), MAC learning, **spanning tree (802.1D)** with root election, roles, states, timers, PortFast and topology change, detection of loops and broadcast storms, IPv4 forwarding, static routing, **router subinterfaces**, ICMP, fragmentation and Path MTU Discovery, **UDP, DNS and TCP** (handshake, segmentation by MSS, RST, timeouts, retransmission after PMTUD), rules on routers (allow, drop, reject, with protocol and port), MSS clamping and VXLAN with head-end replication and flood and learn
- Services per server (TCP and UDP, freely chosen ports) and DNS records, DNS server per host
- Slow motion with a speed slider, pause, single step and fast-forward, BPDUs can be shown or hidden
- Packets as envelopes with colored stripes per layer, a click takes them apart in the packet inspector
- STP state right in the diagram: dots on every switch port show role and state
- Event log with plain-language explanations, filter per device, spanning tree only, tracing a single packet across all hops
- Console per device: `ping`, `traceroute`, `arping [-U|-A|-D]`, `curl`, `nc -zv`, `nc -u`, `dig`, `ss`, `ip addr`, `ip route`, `ip neigh`, `ip link` (create subinterfaces, disconnect ports), `bridge fdb`, `show spanning-tree`, `spanning-tree …`, `show ip route`, `show vxlan`
- Example networks, saving your own networks, export and import as JSON

**Frame builder**: stack headers freely, have the order checked and compute sizes, overhead and MTU requirements.

## Development

The sources live in `src/`, with no build step and no dependencies (ES modules, plain HTML, CSS and JavaScript).

```bash
python3 -m http.server -d src 8765     # test locally
node test/engine.test.mjs               # simulation engine
node test/course.test.mjs               # play through every lab lesson with its reference solution
node test/build.test.mjs                # check the frame exercises against the simulation
bash build.sh                           # regenerate packetpilot-install.sh
```

`test/ui.test.mjs`, `test/features.test.mjs` and `test/lesson.test.mjs` require Playwright with Chromium.

```
src/
  index.html, css/app.css
  js/engine.js        simulation (event queue, L2, STP, L3, TCP/UDP, VXLAN)
  js/packets.js       building, describing and dissecting frames
  js/net.js           addresses and sizes
  js/cli.js           device console
  js/lab.js           editor, animation, log, inspector
  js/panels.js        configuration, tables, console
  js/widgets.js       exercises
  js/course/          course content
  js/presets.js       example networks
installer/            head and tail of the installer script
build.sh              assembles the installer script
```

A new lesson is an object in `src/js/course/m*.js`. Lab steps consist of a topology, an introduction and goals. A goal is either a function that checks the state of the simulation, or a question whose correct answer is computed from the simulation.

## Planned

Static routing with ECMP, OSPF and BFD, VRRP, DHCP with relay and the DNS hierarchy, VPN (WireGuard, IPsec), BGP and EVPN, then IPv6 as an extension.
