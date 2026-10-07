# PacketPilot

Understand networks by watching every packet.

PacketPilot is a small learning web app for networking. It simulates hosts, servers, switches, routers and VXLAN VTEPs entirely in the browser. You build networks by drag and drop, send packets in slow motion, follow every hop and take every frame apart layer by layer. A guided course leads you through the concepts step by step, with theory, exercises and lab tasks that are checked automatically.

## Installation

Three ways, all with the same app:

- **Debian 12 or 13**: the installer script below (nginx, HTTPS, Let's Encrypt included).
- **Docker / Docker Compose**: `docker compose up -d` in this repository, or `docker run -p 8080:8080 ghcr.io/santiagotoro2023/packetpilot:latest`.
- **Kubernetes**: a Helm chart (`helm install packetpilot oci://ghcr.io/santiagotoro2023/charts/packetpilot -n packetpilot --create-namespace`) or a single manifest, ready for a small cluster with three nodes.

Docker, Compose, Kubernetes, Helm and moving learners between servers are explained step by step in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

### Debian installer

On Debian 12 or 13, as root or with sudo:

```bash
curl -fsSLO https://raw.githubusercontent.com/santiagotoro2023/packetpilot/main/packetpilot-install.sh
sudo bash packetpilot-install.sh
```

PacketPilot then runs at `https://<server>:8080/`, secured with a self-signed certificate that the installer generates automatically. Your browser warns once because no public authority signed it; the installer prints the certificate's SHA-256 fingerprint so you can compare it before accepting. Plain `http://` requests to the port are sent on to HTTPS. If you'd rather have a certificate that browsers trust right away, see [Let's Encrypt](#lets-encrypt) below.

| Command | Effect |
|---|---|
| `sudo bash packetpilot-install.sh` | installs or updates (HTTPS on port 8080) |
| `sudo bash packetpilot-install.sh --port 443` | different port. With 80, the nginx default site is disabled |
| `sudo bash packetpilot-install.sh --http` | plain HTTP without a certificate (kept on later updates, back with `--https`) |
| `sudo bash packetpilot-install.sh --new-cert` | generates new certificates |
| `--letsencrypt <domain> --dns <provider>` | trusted certificate from Let's Encrypt, see below |
| `--no-letsencrypt` | back to the self-signed certificate only |
| `sudo bash packetpilot-install.sh --update` | fetches the latest version from GitHub |
| `sudo bash packetpilot-install.sh --uninstall` | removes PacketPilot, nginx stays |
| `bash packetpilot-install.sh --extract ./web` | only extracts the web files, no root needed |
| `--force` | also installs on untested systems |
| `--no-move-card` | never show the card "PacketPilot has a new address" (e.g. behind a reverse proxy or when people use the IP on purpose), back with `--move-card` |
| `--moved-to https://new.example.com` | PacketPilot moved elsewhere (e.g. to Kubernetes): every learner gets a one-click move of their progress (`--not-moved` removes it) |

The script installs nginx (and openssl, if missing) from the Debian packages, writes the files to `/opt/packetpilot/www` and creates `/etc/nginx/sites-available/packetpilot`. The certificate and key live in `/opt/packetpilot/tls/`. The certificate covers the hostname, `localhost` and all IP addresses of the server and is valid for 825 days. Updates keep it, so browsers don't warn again; it is only replaced when it expires within 30 days or with `--new-cert`. To use your own certificate, replace `packetpilot.crt` and `packetpilot.key` there and run `systemctl reload nginx`. If `ufw` is active, the port is opened. At runtime PacketPilot loads nothing from the internet, so it also works in isolated lab networks.

All settings (port, HTTP or HTTPS, Let's Encrypt) are saved in `/opt/packetpilot/packetpilot.conf`, and updates keep them. A copy of the installer is kept at `/opt/packetpilot/packetpilot-install.sh`.

### Let's Encrypt

If the server has a domain name, it can get a certificate from Let's Encrypt. The domain is verified with a DNS TXT record, so port 80 doesn't need to be open and the server can sit in a private network, as long as the name points to it in DNS. This works for new installs and existing ones (download the current script as shown above, then run it with the new options):

```bash
# With the API of your DNS provider (here Cloudflare), renews itself
sudo CF_Token=xxxxx CF_Zone_ID=xxxxx bash packetpilot-install.sh --letsencrypt pp.example.com --dns dns_cf

# Without an API: the script shows the TXT record, you create it by hand and press Enter
sudo bash packetpilot-install.sh --letsencrypt pp.example.com --dns manual
```

`--dns` takes the name of any DNS provider that [acme.sh supports](https://github.com/acmesh-official/acme.sh/wiki/dnsapi) (`dns_cf`, `dns_hetzner`, `dns_ionos`, `dns_aws`, `dns_gd`, …). The wiki page lists the environment variables each provider needs. Pass them once, after `sudo` as shown, and acme.sh keeps them for renewals. `--email you@example.com` is optional. The installer fetches acme.sh 3.1.6 from a fixed commit, checks its checksum and keeps it in `/opt/packetpilot/acme`. A daily systemd timer (`packetpilot-renew.timer`) renews the certificate 30 days before it expires and reloads nginx. With `--dns manual` there is no automatic renewal: within the last 30 days, run the installer again and create the new TXT record.

The self-signed certificate keeps serving access by IP address. When someone opens PacketPilot by IP, a small card offers to move their progress to the domain. If you don't want that card (for example because the server sits behind a reverse proxy and the address in the card would be wrong), add `--no-move-card`.

### Your progress is safe

Each browser stores progress, partial answers (including the network you edited in a lab step), troubleshooting and subnetting results, settings and your own networks locally. The server never sees them, and updates don't touch them. Browsers keep this data per address, so PacketPilot carries it along when the address changes:

- **HTTP to HTTPS**: opening the old `http://` address shows a short page that hands the progress saved there to the `https://` address (once, then it just forwards). This is also how progress from versions before 1.2 comes back.
- **IP address to domain**: after setting up Let's Encrypt, a card offers to move the progress to the domain with one click.
- Merging never overwrites anything: lessons done on either side stay done, and when two networks share a name, both are kept.
- **Another server** (e.g. moving to Docker or Kubernetes): with the same address nothing changes for the learners. With a new address, run the old installer with `--moved-to <new address>`, and everyone can move their progress with one click. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#moving-learners-and-their-progress).
- **Backup file**: on the home page, "Your progress and networks" downloads everything as one file (lessons, answers, saved networks, Fix it times and solved variants, subnetting statistics and streaks, settings) and restores it anywhere. Restoring merges and never loses anything.

## Logo

The logo for presentations and marketing is in [`assets/logo`](assets/logo): the icon alone and with the name PacketPilot, each for light and dark backgrounds, transparent or with a background (PNG), plus the icon as SVG.

## What's inside

**Course with fifteen modules and 75 lessons**

| Module | Contents |
|---|---|
| 1. Ethernet, MAC and ARP | Encapsulation, the Ethernet frame byte by byte, MAC addresses (OUI, I/G, U/L), MAC learning and flooding, ARP with neighbor states, gratuitous ARP, ARP probe and failover, a packet across a router |
| 2. Spanning tree | Broadcast storm and MAC flapping, root bridge election, BPDUs, port roles and path costs, port states and PortFast, failure, topology change and convergence, **rapid spanning tree (RSTP)**: proposal and agreement, alternate ports, measuring failover with STP and RSTP, edge ports and classic STP neighbors |
| 3. IP and routing | IPv4 header, longest prefix match, TTL and traceroute, the return path, MTU and Path MTU Discovery, rules and the PMTUD blackhole, control plane and data plane |
| 4. IPv6 | 128-bit addresses and their notation, address kinds (global, link-local, ULA, multicast), no broadcast, the 40-byte header, Neighbor Discovery (NS/NA with solicited-node multicast), duplicate address detection, router advertisements, SLAAC with EUI-64, RDNSS, static IPv6 routes, dual stack with AAAA preference, Happy Eyeballs, NAT64/DNS64 |
| 5. VLAN and VXLAN | 802.1Q tag, access and trunk, router on a stick with subinterfaces, VXLAN encapsulation, VXLAN in the underlay, troubleshooting the overlay, the MTU trap |
| 6. Transport: UDP, TCP and services | Ports and sockets, DNS over UDP, three-way handshake, refused and filtered connections, MSS, path MTU and MSS clamping |
| 7. DNS in depth | The DNS tree (root, TLD, zones), referrals and glue, recursive resolver and stub, iterative queries with RD 0, dig +trace, REFUSED from authoritative servers, caching with TTL, negative caching, moving a record and why the old address lives on |
| 8. DHCP | Discover, Offer, Request, ACK, leases, DORA in the lab, the DHCP relay with giaddr across routers |
| 9. NAT | Private addresses, masquerading (PAT) and the translation table in the lab, port forwarding |
| 10. Dynamic routing with OSPF | How link-state routing works (hellos, LSAs, SPF), turning OSPF on, failover and costs, neighbors that don't get along |
| 11. VRRP | One gateway address shared by two routers, failover in the lab, configuring the second router (priority, preemption) |
| 12. ECMP and BFD | Equal-cost multipath with per-flow hashing (layer 3 and layer 4 hash policy), maximum paths, failover of one path; BFD sessions (Down, Init, Up, discriminators, detection time), BFD for OSPF and static routes, measuring failover through a provider switch |
| 13. BGP | Autonomous systems, path vector and AS_PATH loop protection, TCP 179 and the session states, OPEN/UPDATE/KEEPALIVE/NOTIFICATION, eBGP in the lab, iBGP with loopbacks and update-source, the next hop and next-hop-self, iBGP split horizon and route reflectors, best path selection, local preference for the way out, AS path prepending for the way in, multihoming with two providers |
| 14. EVPN | Why VXLAN needs a control plane, route types 2 and 3, flood lists from BGP, MAC learning over BGP, ARP suppression, spines as route reflectors |
| 15. VPN: WireGuard and IPsec | Tunnels and the packet inside the packet, site-to-site and remote access, what a VPN protects, overhead and the tunnel MTU, WireGuard keys, peers and cryptokey routing, handshake, roaming and keepalives behind NAT, a site-to-site tunnel and allowed IPs in the lab, IPsec with IKEv2, ESP, SAs and SPI, tunnel and transport mode, NAT traversal |

Theory terms are underlined quietly: hovering, focusing or tapping one shows a short explanation from the glossary. Theory pages can be printed or saved as a PDF, one lesson or any selection of modules (print button on a lesson, or **Print theory** on the home page).

Exercise types: theory, quizzes with explanations, labeling headers by drag and drop, putting layers in order, **building frames yourself** (pick the layers and fill in every field, checked against the frame the simulation produces), MAC decoder, longest prefix match trainer and lab tasks with automatically checked goals.

**Fix it: troubleshooting challenges**

Twenty-four broken networks in three levels, each with a symptom, goals, hints and a timer: wrong gateway, missing return route, broadcast storm, slow RSTP failover, VLAN trunk, DHCP relay, NAT, DNS, a broken DNS delegation (six causes), a web server move that nobody sees, PCs without an IPv6 address, IPv6 that stops at the router, a broken dual-stack web site, a WireGuard tunnel that stays dark (six causes), an eBGP partner that stays invisible, a branch without internet over iBGP, traffic leaving through the expensive provider, a new EVPN rack that stays alone, OSPF, an idle ECMP path, BFD that does not speed anything up, VRRP failover, a slow lossy link and the MTU blackhole. Every challenge has several variants with different causes, so it can be played more than once. Your best time is saved.

**Subnets: subnetting trainer**

Endless random questions in five kinds (network and broadcast, prefix and mask, sizing a subnet, same subnet or not, splitting a network) and three levels. Every answer comes with a worked solution in binary, with streaks and a cheat sheet.

**Lab**

- Network diagram editor: PCs, servers, switches, routers and VTEPs by drag and drop, cables with the K key
- **Areas** for organizing: colored, labeled rectangles that can be moved (devices inside move along) and resized
- Simulation of Ethernet, 802.1Q, ARP (including gratuitous ARP, ARP probe and Neighbor Unreachability Detection), MAC learning, **spanning tree (802.1D)** with root election, roles, states, timers, PortFast and topology change, **rapid spanning tree (802.1w)** with proposal/agreement, alternate and backup ports, topology change flooding and fallback to classic STP neighbors, detection of loops and broadcast storms, IPv4 forwarding, static routing, **router subinterfaces**, ICMP, fragmentation and Path MTU Discovery, **UDP, DNS and TCP** (handshake, segmentation by MSS, RST, timeouts, retransmission after PMTUD), rules on routers (allow, drop, reject, with protocol and port), MSS clamping and VXLAN with head-end replication and flood and learn
- **DHCP** server and relay, clients with static or DHCP addresses; **NAT** with masquerading and port forwards; **OSPF** (single area, cost, passive interfaces, fast or standard timers); **VRRP** with priority and preemption; **ECMP** (per-flow hash over layer 3 or layer 4, maximum paths) for OSPF and static routes with several next hops, floating static routes with their own distance; **BFD** for OSPF neighbors and static routes
- **Line quality per cable**: latency in milliseconds and packet loss in percent, with TCP retransmissions (exponential backoff, duplicate ACKs) you can watch
- Services per server (TCP and UDP, freely chosen ports) and DNS records, DNS server per host
- **BGP** on routers and VTEPs (FRR style): sessions over TCP 179 with Idle, Connect, Active, OpenSent, OpenConfirm and Established, OPEN, UPDATE, KEEPALIVE and NOTIFICATION (Bad Peer AS, hold timer), eBGP with TTL 1 and ebgp-multihop, iBGP with update-source and next-hop-self, recursive next hops through OSPF, iBGP split horizon and route reflectors (originator ID, cluster list), network statements with exact match, local preference, MED, AS path prepending, the full best path selection with its reason; show ip bgp (summary, prefix, neighbors advertised/received routes), clear ip bgp
- **EVPN** for VXLAN: type 3 routes build the flood lists, type 2 routes carry MAC and IP, no data plane learning, ARP suppression, the spine as route reflector; show evpn, show bgp l2vpn evpn
- **WireGuard VPN** on PCs, servers and routers: key pairs, peers with endpoints and allowed IPs (cryptokey routing, routes like wg-quick), handshake over UDP, encrypted data packets with the inner packet visible in the inspector, keepalives, roaming endpoints, tunnel MTU, wg show / genkey / pubkey
- **IPv6** next to IPv4: link-local, static and SLAAC addresses with duplicate address detection, Neighbor Discovery with solicited-node multicast and unreachability detection, router advertisements with prefixes and RDNSS, static IPv6 routes, forwarding with hop limit, Packet Too Big and fragmentation by the sender, ping -6 (also to ff02::1), traceroute -6, curl over IPv6, AAAA preferred like getaddrinfo, ip -6 addr/route/neigh, rdisc6
- **DNS in depth**: authoritative zones with A, AAAA, NS and CNAME records and TTLs, delegation with glue, recursive resolvers with root hints and a cache (negative caching too), dig with +trace, +norec, +short and record types, unbound-control dump_cache and flush
- Slow motion with a speed slider (remembered), pause, single step and fast-forward, BPDUs and hellos can be shown or hidden
- Resizable panels: drag the edges of the side panel, the event log and the packet inspector (double-click resets), sizes are remembered
- Packets as envelopes with colored stripes per layer, a click takes them apart in the packet inspector
- STP state right in the diagram: dots on every switch port show role and state
- Event log with plain-language explanations, filter per device, spanning tree only, tracing a single packet across all hops
- Console per device (Ctrl+C or the Stop button ends a running command): `ping`, `traceroute`, `arping [-U|-A|-D]`, `curl`, `nc -zv`, `nc -u`, `dig`, `ss`, `ip addr`, `ip route`, `ip neigh`, `ip link` (create subinterfaces, disconnect ports), `bridge fdb`, `show spanning-tree`, `spanning-tree …` (including `spanning-tree mode stp|rstp`), `show ip route`, `show vxlan`, `dhclient`, `show ip dhcp binding`, `conntrack -L`, `show vrrp`, `show ip ospf neighbor|database|interface`
- Example networks, saving your own networks, export and import as JSON
- **Share links**: the whole network compressed into a link. Whoever opens it gets a copy in their lab; nothing is uploaded

**Frame builder**: stack headers freely, have the order checked and compute sizes, overhead and MTU requirements.

## Development

The sources live in `src/`, with no build step and no dependencies (ES modules, plain HTML, CSS and JavaScript).

```bash
python3 -m http.server -d src 8765     # test locally
node test/engine.test.mjs               # simulation engine
node test/course.test.mjs               # play through every lab lesson with its reference solution
node test/build.test.mjs                # check the frame exercises against the simulation
node test/challenges.test.mjs           # every troubleshooting variant is broken and solvable
node test/subnet.test.mjs               # subnetting questions and answers are consistent
node test/store.test.mjs                # backups: format, old exports, merging
bash build.sh                           # regenerate packetpilot-install.sh
```

`test/ui.test.mjs`, `test/features.test.mjs`, `test/lesson.test.mjs`, `test/persist.test.mjs` and `test/practice.test.mjs` require Playwright with Chromium and the local server from above.

```
src/
  index.html, css/app.css
  migrate.html        moves progress from http:// to https:// (served by nginx for plain HTTP)
  site.json           main address of the server, written by the installer
  js/engine.js        simulation (event queue, L2, STP, L3, TCP/UDP, VXLAN)
  js/services.js      DHCP, NAT, VRRP, OSPF and BFD
  js/ipv6.js          IPv6: addresses, NDP, SLAAC, routing, ICMPv6
  js/dns.js           DNS zones, delegation, recursive resolver and cache
  js/vpn.js           WireGuard
  js/bgp.js           BGP (eBGP, iBGP, route reflection, policy)
  js/evpn.js          EVPN for VXLAN
  js/packets.js       building, describing and dissecting frames
  js/net.js           addresses and sizes
  js/cli.js           device console
  js/lab.js           editor, animation, log, inspector
  js/panels.js        configuration, tables, console
  js/widgets.js       exercises
  js/course/          course content
  js/presets.js       example networks
  js/challenges.js    troubleshooting challenges
  js/subnet.js        subnetting questions
  js/practice.js      the Fix it and Subnets pages
  js/glossary.js      glossary and tooltips
  js/share.js         share links
  js/site.js          main address and moving progress
  js/store.js         storage in the browser
installer/            head and tail of the installer script
build.sh              assembles the installer script (and syncs the version into deploy/)
Dockerfile            container image (nginx unprivileged, port 8080)
docker-compose.yml    quick start with Compose
deploy/               Compose with HTTPS, Kubernetes manifest, Helm chart, container config
docs/DEPLOYMENT.md    Docker, Compose, Kubernetes, Helm, moving learners
.github/workflows/    tests, image (amd64, arm64) and chart to ghcr.io
```

A new lesson is an object in `src/js/course/m*.js`. Lab steps consist of a topology, an introduction and goals. A goal is either a function that checks the state of the simulation, or a question whose correct answer is computed from the simulation.

## Planned

Ideas for later: OSPFv3 and BGP for IPv6, EVPN type 5 (routing between VNIs), DHCPv6, QoS.
