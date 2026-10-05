#!/usr/bin/env bash
# =============================================================================
#  PacketPilot @@VERSION@@
#  Understand networks by watching every packet.
#
#  Installs the learning web app on Debian 12 (Bookworm) or 13 (Trixie):
#  nginx serves the static files, everything else runs in the browser.
#  Nothing is downloaded from the internet except the nginx packages
#  (and, with --update, the latest script from GitHub).
#
#  Usage:
#    sudo bash packetpilot-install.sh                 Install or update (port 8080)
#    sudo bash packetpilot-install.sh --port 80       On a different port
#    sudo bash packetpilot-install.sh --update        Fetch the latest version from GitHub
#    sudo bash packetpilot-install.sh --uninstall     Remove
#    bash packetpilot-install.sh --extract ./web      Only extract the web files (no root)
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
PP_REPO="santiagotoro2023/packetpilot"
PP_SCRIPT_URL="https://raw.githubusercontent.com/${PP_REPO}/main/packetpilot-install.sh"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓ \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! \033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m ✗ \033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port)      PP_PORT="${2:-}"; PP_PORT_SET="yes"; shift 2 ;;
    --port=*)    PP_PORT="${1#*=}"; PP_PORT_SET="yes"; shift ;;
    --update)    PP_ACTION="update"; shift ;;
    --uninstall) PP_ACTION="uninstall"; shift ;;
    --extract)   PP_ACTION="extract"; PP_EXTRACT_DIR="${2:-}"; shift 2 ;;
    --force)     PP_FORCE="yes"; shift ;;
    -h|--help)   usage ;;
    *) die "Unknown option: $1 (help with --help)" ;;
  esac
done

case "$PP_PORT" in
  ''|*[!0-9]*) die "Invalid port: ${PP_PORT}" ;;
esac
[ "$PP_PORT" -ge 1 ] && [ "$PP_PORT" -le 65535 ] || die "Port must be between 1 and 65535."

