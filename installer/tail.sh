
check_system() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo oder als root ausführen."
  [ -r /etc/os-release ] || die "/etc/os-release fehlt, unbekanntes System."
  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" = "debian" ] && { [ "${VERSION_ID:-}" = "12" ] || [ "${VERSION_ID:-}" = "13" ]; }; then
    ok "Debian ${VERSION_ID} (${VERSION_CODENAME:-?}) erkannt"
  elif [ "$PP_FORCE" = "yes" ]; then
    warn "Nicht getestetes System (${PRETTY_NAME:-unbekannt}), fahre wegen --force trotzdem fort."
  else
    die "Getestet für Debian 12 und 13, gefunden: ${PRETTY_NAME:-unbekannt}. Mit --force trotzdem installieren."
  fi
}

port_in_use() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -Hltn "sport = :${PP_PORT}" 2>/dev/null | grep -q .
}

install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    ok "nginx ist bereits installiert"
  else
    say "Installiere nginx"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq nginx >/dev/null
    ok "nginx installiert"
  fi
}

write_site() {
  say "Schreibe nginx-Konfiguration für Port ${PP_PORT}"
  local listen6="    listen [::]:${PP_PORT};"
  if [ ! -f /proc/net/if_inet6 ]; then
    listen6="    # IPv6 ist auf diesem System nicht verfügbar"
    warn "Kein IPv6 verfügbar, PacketPilot lauscht nur auf IPv4."
  fi
  cat > "$PP_SITE" <<NGINX
# PacketPilot ${PP_VERSION}, erzeugt von packetpilot-install.sh
server {
    listen ${PP_PORT};
${listen6}
    server_name _;

    root ${PP_WWW};
    index index.html;
    charset utf-8;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'" always;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location ~* \.(js|css)\$ {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}
NGINX
  ln -sf "$PP_SITE" "$PP_LINK"
  if [ "$PP_PORT" = "80" ] && [ -L /etc/nginx/sites-enabled/default ]; then
    warn "Port 80: Die nginx-Standardseite wird deaktiviert (nur der Link in sites-enabled, die Datei bleibt)."
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx-Konfiguration fehlerhaft, siehe oben."; }
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl reload nginx
  ok "nginx neu geladen"
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${PP_PORT}/tcp" >/dev/null && ok "ufw: Port ${PP_PORT}/tcp freigegeben"
  fi
}

# Bei einer erneuten Installation den bisherigen Port beibehalten
keep_port() {
  if [ "$PP_PORT_SET" = "no" ] && [ -f "$PP_SITE" ]; then
    local old
    old="$(awk '/^[[:space:]]*listen[[:space:]]+[0-9]+;/ { gsub(";", "", $2); print $2; exit }' "$PP_SITE")"
    if [ -n "$old" ] && [ "$old" != "$PP_PORT" ]; then
      PP_PORT="$old"
      ok "Bisheriger Port ${PP_PORT} wird beibehalten (ändern mit --port)"
    fi
  fi
}

do_install() {
  check_system
  keep_port
  if port_in_use && [ ! -f "$PP_SITE" ]; then
    warn "Port ${PP_PORT} wird bereits verwendet. Wähle bei Problemen einen anderen mit --port."
  fi
  install_nginx
  say "Schreibe Webdateien nach ${PP_WWW}"
  local tmp
  tmp="$(mktemp -d)"
  write_files "$tmp"
  mkdir -p "$PP_ROOT"
  rm -rf "${PP_WWW}.new"
  mv "$tmp" "${PP_WWW}.new"
  rm -rf "$PP_WWW"
  mv "${PP_WWW}.new" "$PP_WWW"
  echo "$PP_VERSION" > "${PP_ROOT}/VERSION"
  chown -R root:root "$PP_ROOT"
  find "$PP_WWW" -type d -exec chmod 755 {} +
  find "$PP_WWW" -type f -exec chmod 644 {} +
  ok "$(find "$PP_WWW" -type f | wc -l) Dateien installiert"
  write_site
  open_firewall
  local ips
  ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -3 || true)"
  echo
  say "PacketPilot ${PP_VERSION} ist bereit:"
  if [ -n "$ips" ]; then
    for ip in $ips; do echo "      http://${ip}:${PP_PORT}/"; done
  else
    echo "      http://<IP-dieses-Servers>:${PP_PORT}/"
  fi
  echo
  echo "    Fortschritt und eigene Netze speichert jeder Browser für sich."
  echo "    Aktualisieren: sudo bash packetpilot-install.sh --update. Entfernen: --uninstall"
}

do_update() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo oder als root ausführen."
  local tmp new
  tmp="$(mktemp)"
  say "Lade die neueste Version von github.com/${PP_REPO}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$PP_SCRIPT_URL" -o "$tmp" || die "Download fehlgeschlagen: ${PP_SCRIPT_URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$PP_SCRIPT_URL" || die "Download fehlgeschlagen: ${PP_SCRIPT_URL}"
  else
    die "Weder curl noch wget gefunden. Installieren mit: apt install curl"
  fi
  bash -n "$tmp" || die "Das heruntergeladene Skript ist fehlerhaft, Abbruch."
  new="$(sed -n 's/^PP_VERSION="\(.*\)"$/\1/p' "$tmp" | head -1)"
  [ -n "$new" ] || die "Das heruntergeladene Skript sieht nicht nach PacketPilot aus."
  say "Installiert: $(cat "${PP_ROOT}/VERSION" 2>/dev/null || echo keine), verfügbar: ${new}"
  local args=()
  [ "$PP_PORT_SET" = "yes" ] && args+=(--port "$PP_PORT")
  [ "$PP_FORCE" = "yes" ] && args+=(--force)
  exec bash "$tmp" "${args[@]}"
}

do_uninstall() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo oder als root ausführen."
  say "Entferne PacketPilot"
  rm -f "$PP_LINK" "$PP_SITE"
  rm -rf "$PP_ROOT"
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then systemctl reload nginx || true; fi
  ok "PacketPilot entfernt. nginx selbst bleibt installiert (entfernen mit: apt purge nginx)."
}

do_extract() {
  [ -n "$PP_EXTRACT_DIR" ] || die "Zielordner angeben: --extract ./web"
  mkdir -p "$PP_EXTRACT_DIR"
  write_files "$PP_EXTRACT_DIR"
  ok "Webdateien nach ${PP_EXTRACT_DIR} entpackt. Testen z. B. mit: python3 -m http.server -d ${PP_EXTRACT_DIR} 8080"
}

case "$PP_ACTION" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  extract)   do_extract ;;
esac
