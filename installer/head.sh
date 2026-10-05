#!/usr/bin/env bash
# =============================================================================
#  PacketPilot @@VERSION@@
#  Netzwerke verstehen, indem du jedem Paket zuschaust.
#
#  Installiert die Lern-Webapp auf Debian 12 (Bookworm) oder 13 (Trixie):
#  nginx liefert die statischen Dateien aus, alles Weitere läuft im Browser.
#  Es werden keine Dateien aus dem Internet nachgeladen, ausser den nginx-Paketen
#  (und bei --update das neueste Skript von GitHub).
#
#  Aufruf:
#    sudo bash packetpilot-install.sh                 Installieren oder aktualisieren (Port 8080)
#    sudo bash packetpilot-install.sh --port 80       Auf einem anderen Port
#    sudo bash packetpilot-install.sh --update        Neueste Version von GitHub holen
#    sudo bash packetpilot-install.sh --uninstall     Entfernen
#    bash packetpilot-install.sh --extract ./web      Nur die Webdateien entpacken (ohne root)
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
    *) die "Unbekannte Option: $1 (Hilfe mit --help)" ;;
  esac
done

case "$PP_PORT" in
  ''|*[!0-9]*) die "Ungültiger Port: ${PP_PORT}" ;;
esac
[ "$PP_PORT" -ge 1 ] && [ "$PP_PORT" -le 65535 ] || die "Port muss zwischen 1 und 65535 liegen."

