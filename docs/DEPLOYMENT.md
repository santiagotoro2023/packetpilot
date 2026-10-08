# Deploying PacketPilot

<!-- Written by the blueprint (1.1.1) from project.conf: do not edit, run build.sh. -->

PacketPilot is a static web app: nginx serves HTML, CSS and JavaScript, and everything
else runs in the browser. **Nothing is stored on the server.** Every user's data lives in
their own browser. That makes every deployment simple: no database, no volume, any number
of replicas.

| Way | Good for | Where |
|---|---|---|
| Installer script | One Debian 12/13 server, HTTPS and Let's Encrypt included | [`packetpilot-install.sh`](../packetpilot-install.sh), see the README |
| Docker | One host with Docker | [Docker](#docker) |
| Docker Compose | One host, with or without automatic HTTPS | [`docker-compose.yml`](../docker-compose.yml), [`deploy/compose/https`](../deploy/compose/https) |
| Kubernetes manifests | A cluster, one `kubectl apply` | [`deploy/kubernetes/packetpilot.yaml`](../deploy/kubernetes/packetpilot.yaml) |
| Helm chart | A cluster, configurable, easy upgrades | [`deploy/helm/packetpilot`](../deploy/helm/packetpilot) |

Before you move users from one server to another, read
[Moving users and their data](#moving-users-and-their-data).

---

## The image

```
ghcr.io/santiagotoro2023/packetpilot:3.0.0      a fixed version (recommended)
ghcr.io/santiagotoro2023/packetpilot:latest     the newest version from main
```

- Built for **linux/amd64 and linux/arm64** (Raspberry Pi 4/5, Ampere, Apple Silicon hosts).
- Based on `nginxinc/nginx-unprivileged` (Alpine): runs as **user 101, not root**, listens
  on **port 8080**, works with a **read-only root file system** (it only writes to `/tmp`).
- `GET /healthz` answers `ok` for health checks.
- The GitHub workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml)
  tests everything and builds and publishes the image and the Helm chart for every push to `main`.

> **First time only:** packages on GitHub start out private. Make the image public under
> *GitHub → your profile → Packages → packetpilot → Package settings → Change visibility*,
> and the same for `charts/packetpilot`. Or keep it private and give the cluster an
> `imagePullSecret` (see [Troubleshooting](#troubleshooting)).

Build it yourself instead:

```bash
docker build -t packetpilot --build-arg VERSION=$(cat VERSION) .
# for both architectures and straight into your registry:
docker buildx build --platform linux/amd64,linux/arm64 --build-arg VERSION=$(cat VERSION) \
  -t registry.example.com/packetpilot:$(cat VERSION) --push .
```

### Settings

| Environment variable | Meaning |
|---|---|
| `PACKETPILOT_CANONICAL` | The public address, e.g. `https://packetpilot.example.com` (no path). Share links point there. A browser that opens PacketPilot under a **different** address gets a card offering to move its data there. Leave empty when there is only one address. |
| `PACKETPILOT_PORT` | Port inside the container, default `8080`. |

---

## Docker

```bash
docker run -d --name packetpilot --restart unless-stopped \
  -p 8080:8080 \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  ghcr.io/santiagotoro2023/packetpilot:3.0.0
```

Open `http://<host>:8080`. The container speaks plain HTTP; put a reverse proxy with TLS in
front for anything beyond a lab network (see the Compose example with Caddy).

---

## Docker Compose

**Quick start** (in the repository root):

```bash
docker compose up -d            # pulls the image
docker compose up -d --build    # or builds it from this checkout
```

**With HTTPS and a domain name** (Caddy gets and renews the Let's Encrypt certificate):

```bash
cd deploy/compose/https
cp .env.example .env            # set PACKETPILOT_DOMAIN=packetpilot.example.com
docker compose up -d
```

Needs a DNS record pointing to the host, and ports 80 and 443 reachable from the internet.

---

## Kubernetes

Tested shape: a small cluster with **three nodes** (k3s, kubeadm, RKE2, managed clusters).
PacketPilot runs **3 replicas, one per node** (topology spread), with a
**PodDisruptionBudget** so that draining a node or upgrading never takes it offline, and
**rolling updates without downtime** (`maxUnavailable: 0`).

What you need:

- An **ingress controller**. k3s ships with Traefik (`ingressClassName: traefik`), many
  other clusters use ingress-nginx (`ingressClassName: nginx`).
- For HTTPS, optionally **cert-manager** with a `ClusterIssuer` (here called `letsencrypt`).
  Or a TLS secret you create yourself.
- A DNS name pointing at the ingress (or at your nodes / load balancer).

### Option 1: one manifest

```bash
# edit host name, ingressClassName and PACKETPILOT_CANONICAL in the file first
kubectl apply -f deploy/kubernetes/packetpilot.yaml
kubectl -n packetpilot get pods -o wide        # three pods on three nodes
```

Without an ingress, try it with `kubectl -n packetpilot port-forward svc/packetpilot 8080:80`.

### Option 2: Helm (recommended)

Install straight from the registry:

```bash
helm install packetpilot oci://ghcr.io/santiagotoro2023/charts/packetpilot \
  --version 3.0.0 --namespace packetpilot --create-namespace \
  -f my-values.yaml
```

or from this repository: `helm install packetpilot deploy/helm/packetpilot -n packetpilot --create-namespace -f my-values.yaml`.

Example `my-values.yaml` for **k3s with Traefik and cert-manager**:

```yaml
ingress:
  enabled: true
  className: traefik
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  hosts:
    - host: packetpilot.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: packetpilot-tls
      hosts: [packetpilot.example.com]
# canonicalUrl is taken from the first host (https because of tls); set it to override
```

Without an ingress, reachable on every node at port 30080:

```yaml
service:
  type: NodePort
  nodePort: 30080
```

With MetalLB or a cloud load balancer: `service.type: LoadBalancer`.

Check it:

```bash
kubectl -n packetpilot get pods -o wide
helm test packetpilot -n packetpilot          # calls /healthz and /site.json through the service
```

Important values (all of them are in [`values.yaml`](../deploy/helm/packetpilot/values.yaml)):

| Value | Default | Meaning |
|---|---|---|
| `replicaCount` | `3` | Pods (ignored with autoscaling) |
| `image.repository` / `image.tag` | ghcr.io/santiagotoro2023/packetpilot / chart version | Image |
| `canonicalUrl` | from the ingress | Public address (see `PACKETPILOT_CANONICAL`) |
| `ingress.*` | off | Host, class, TLS, annotations |
| `service.type` / `service.nodePort` | `ClusterIP` | NodePort or LoadBalancer without an ingress |
| `podDisruptionBudget.maxUnavailable` | `1` | At most one pod down during maintenance |
| `topologySpread.enabled` | `true` | Spread pods over nodes and zones |
| `autoscaling.enabled` | `false` | HPA between `minReplicas` and `maxReplicas` |
| `networkPolicy.enabled` | `false` | Only the ingress namespace may connect, no egress |
| `resources` | see values.yaml | Requests and limits |

### Updating

```bash
helm upgrade packetpilot oci://ghcr.io/santiagotoro2023/charts/packetpilot --version <new> -n packetpilot -f my-values.yaml
# or with the manifest: change the image tag and kubectl apply again
```

Pods are replaced one at a time; the site stays up.
**Updates never touch the users' data**: it is in their browsers, and every version of
PacketPilot reads what older versions saved (the storage format only ever grows).

---

## Moving users and their data

Browsers keep data **per address**: `https://packetpilot.example.com` and
`http://10.0.0.5:8080` are two different places for a browser, even if they show the same
app. That decides what you have to do.

### Same address before and after: nothing to do

If the users keep using the same address, for example you move
`https://packetpilot.example.com` from the old server to the cluster by changing the DNS
record (scheme, host and port stay the same), **everyone keeps everything automatically**.
This is the easiest way, and the recommended one.

### A new address: one click per user

Keep the old server running for a while and tell it the new address:

```bash
# on the old server (Debian installer)
sudo bash packetpilot-install.sh --moved-to https://packetpilot.example.com
```

From then on, everyone who opens the old address sees a card **"PacketPilot has a new
address"** with the button **"Move my data there"**. One click takes them to the new
address with everything they have: the data travels compressed inside the link (after
the `#`, so no server ever sees it) and is merged into whatever they already have there.
Clicking twice does no harm. `--not-moved` removes the card again.

If the old server is a container, set `PACKETPILOT_CANONICAL` on it to the new address
instead; the effect is the same.

### Backup file: works always, also between browsers and computers

On the **home page**, in the box about the user's data:

1. **Download backup** at the old address. The file contains everything this browser
   keeps for PacketPilot.
2. **Restore backup** at the new address. Restoring **merges**: nothing that is already
   there gets lost. Restoring twice changes nothing.

### A message you can send to your users

> PacketPilot is moving to **https://packetpilot.example.com**. Your data is stored in
> your browser. When you open the old address, click **"Move my data there"** in the
> card at the bottom, and everything comes along. If you use another browser or computer,
> download a backup on the home page first and restore it at the new address.

---

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `ImagePullBackOff` | The package on GitHub is still private. Make it public, or create a pull secret: `kubectl -n packetpilot create secret docker-registry ghcr --docker-server=ghcr.io --docker-username=<user> --docker-password=<token with read:packages>` and set `imagePullSecrets: [{name: ghcr}]`. |
| Ingress answers 404 | Wrong `ingressClassName` (k3s: `traefik`, ingress-nginx: `nginx`). `kubectl get ingressclass` lists them. |
| Pods not spread over the nodes | The spread is a preference (`ScheduleAnyway`). With fewer schedulable nodes than replicas some share a node. Set `topologySpread.whenUnsatisfiable: DoNotSchedule` to enforce it. |
| The card "PacketPilot has a new address" appears unexpectedly | `PACKETPILOT_CANONICAL` / `canonicalUrl` is not the address you open. Set it to the real public address, or leave it empty. On the installer: `--no-move-card`. |
| The pod crashes with "Read-only file system" | `/tmp` needs to be writable: the chart and the manifest mount an `emptyDir` there; keep it when you write your own manifests. |
| IPv6-only or IPv4-only cluster | Nothing to do: the container listens on IPv6 only where the kernel has it. |

---

## Security notes

- The container runs as an unprivileged user without capabilities, read-only, without a
  service account token, and the pod meets the Kubernetes `restricted` Pod Security level.
- nginx sends a strict Content Security Policy (`default-src 'self'`), `nosniff`,
  `X-Frame-Options` and no referrer.
- The app never sends user data anywhere: share links and data transfers carry
  the data in the part of the URL after `#`, which browsers do not send to servers.
