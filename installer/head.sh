#!/usr/bin/env bash
# =============================================================================
#  PacketPilot @@VERSION@@
#  Understand networks by watching every packet.
#
#  Installs the learning web app on Debian 12 (Bookworm) or 13 (Trixie):
#  nginx serves the static files over HTTPS with a self-signed certificate,
#  everything else runs in the browser.
#  Nothing is downloaded from the internet except the nginx packages, with
#  --letsencrypt the acme.sh client and with --update the latest script.
#
#  Usage:
#    sudo bash packetpilot-install.sh                 Install or update (HTTPS on port 8080)
#    sudo bash packetpilot-install.sh --port 443      On a different port
#    sudo bash packetpilot-install.sh --http          Plain HTTP instead of HTTPS
#    sudo bash packetpilot-install.sh --new-cert      Generate new certificates
#    sudo bash packetpilot-install.sh --update        Fetch the latest version from GitHub
#    sudo bash packetpilot-install.sh --uninstall     Remove
#    bash packetpilot-install.sh --extract ./web      Only extract the web files (no root)
#
#  Let's Encrypt certificate for a domain, checked with a DNS TXT record, so the
#  server needs no open port 80 and may sit in a private network. Works for new and
#  existing installs, updates keep it and it renews itself:
#    sudo CF_Token=... bash packetpilot-install.sh --letsencrypt pp.example.com --dns dns_cf
#      --dns is the acme.sh name of your DNS provider, its credentials are passed as
#      environment variables once: https://github.com/acmesh-official/acme.sh/wiki/dnsapi
#    sudo bash packetpilot-install.sh --letsencrypt pp.example.com --dns manual
#      Without an API: you create the TXT record by hand (renewal by hand, too)
#    --email you@example.com                        Optional contact for Let's Encrypt
#    sudo bash packetpilot-install.sh --no-letsencrypt   Back to the self-signed certificate
# =============================================================================
set -euo pipefail

PP_VERSION="@@VERSION@@"
PP_PORT="8080"
PP_ROOT="/opt/packetpilot"
PP_WWW="${PP_ROOT}/www"
PP_SITE="/etc/nginx/sites-available/packetpilot"
PP_LINK="/etc/nginx/sites-enabled/packetpilot"
PP_ACTION="install"
PP_EXTRACT_DIR=""
PP_FORCE="no"
PP_PORT_SET="no"
PP_TLS="yes"
PP_TLS_SET="no"
PP_NEW_CERT="no"
PP_TLS_DIR="${PP_ROOT}/tls"
PP_CERT="${PP_TLS_DIR}/packetpilot.crt"
PP_KEY="${PP_TLS_DIR}/packetpilot.key"
PP_CONF="${PP_ROOT}/packetpilot.conf"
PP_SELF="${PP_ROOT}/packetpilot-install.sh"
PP_LE_DOMAIN=""
PP_LE_DNS=""
PP_LE_EMAIL=""
PP_LE_SET="no"
PP_LE_CERT="${PP_TLS_DIR}/letsencrypt.crt"
PP_LE_KEY="${PP_TLS_DIR}/letsencrypt.key"
PP_ACME_HOME="${PP_ROOT}/acme"
PP_ACME_COMMIT="807da6498377ee5e0cf43a78091f46f12dc59a89"   # acme.sh 3.1.6
PP_ACME_SHA256="c7d68b021cfd6380ea83a82962abde5b484779fee0b97d38681dfa1396bbc8d7"
PP_ACME_URL="${PP_ACME_URL:-https://raw.githubusercontent.com/acmesh-official/acme.sh/${PP_ACME_COMMIT}}"
PP_ACME_SERVER="${PP_ACME_SERVER:-letsencrypt}"
PP_RENEW="packetpilot-renew"
PP_REPO="santiagotoro2023/packetpilot"
PP_SCRIPT_URL="https://raw.githubusercontent.com/${PP_REPO}/main/packetpilot-install.sh"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓ \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! \033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m ✗ \033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  awk 'NR > 2 && /^# =====/ { exit } NR > 2' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}
need() { [ -n "${2:-}" ] || die "$1 needs a value (help with --help)"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --port)      need "$1" "${2:-}"; PP_PORT="$2"; PP_PORT_SET="yes"; shift 2 ;;
    --port=*)    PP_PORT="${1#*=}"; PP_PORT_SET="yes"; shift ;;
    --http)      PP_TLS="no"; PP_TLS_SET="yes"; shift ;;
    --https)     PP_TLS="yes"; PP_TLS_SET="yes"; shift ;;
    --new-cert)  PP_NEW_CERT="yes"; shift ;;
    --letsencrypt)   need "$1" "${2:-}"; PP_LE_DOMAIN="$2"; PP_LE_SET="yes"; shift 2 ;;
    --letsencrypt=*) PP_LE_DOMAIN="${1#*=}"; PP_LE_SET="yes"; shift ;;
    --dns)           need "$1" "${2:-}"; PP_LE_DNS="$2"; shift 2 ;;
    --dns=*)         PP_LE_DNS="${1#*=}"; shift ;;
    --email)         need "$1" "${2:-}"; PP_LE_EMAIL="$2"; shift 2 ;;
    --email=*)       PP_LE_EMAIL="${1#*=}"; shift ;;
    --no-letsencrypt) PP_LE_DOMAIN=""; PP_LE_SET="off"; shift ;;
    --update)    PP_ACTION="update"; shift ;;
    --uninstall) PP_ACTION="uninstall"; shift ;;
    --extract)   need "$1" "${2:-}"; PP_ACTION="extract"; PP_EXTRACT_DIR="$2"; shift 2 ;;
    --force)     PP_FORCE="yes"; shift ;;
    -h|--help)   usage ;;
    *) die "Unknown option: $1 (help with --help)" ;;
  esac
done

case "$PP_PORT" in
  ''|*[!0-9]*) die "Invalid port: ${PP_PORT}" ;;
esac
[ "$PP_PORT" -ge 1 ] && [ "$PP_PORT" -le 65535 ] || die "Port must be between 1 and 65535."

