
check_system() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  [ -r /etc/os-release ] || die "/etc/os-release is missing, unknown system."
  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" = "debian" ] && { [ "${VERSION_ID:-}" = "12" ] || [ "${VERSION_ID:-}" = "13" ]; }; then
    ok "Detected Debian ${VERSION_ID} (${VERSION_CODENAME:-?})"
  elif [ "$APP_FORCE" = "yes" ]; then
    warn "Untested system (${PRETTY_NAME:-unknown}), continuing anyway because of --force."
  else
    die "Tested on Debian 12 and 13, found: ${PRETTY_NAME:-unknown}. Use --force to install anyway."
  fi
}

port_in_use() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -Hltn "sport = :${APP_PORT}" 2>/dev/null | grep -q .
}

install_packages() {
  local pkgs=()
  command -v nginx >/dev/null 2>&1 || pkgs+=(nginx)
  [ "$APP_TLS" = "yes" ] && ! command -v openssl >/dev/null 2>&1 && pkgs+=(openssl)
  [ -n "$APP_LE_DOMAIN" ] && ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1 && pkgs+=(curl)
  if [ ${#pkgs[@]} -eq 0 ]; then
    ok "All packages are already installed"
  else
    say "Installing ${pkgs[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq "${pkgs[@]}" >/dev/null
    ok "${pkgs[*]} installed"
  fi
}

# Self-signed certificate for this server. An existing certificate is kept so that
# browsers that already accepted it do not warn again; it is only replaced when it
# is missing, broken, expires within 30 days or --new-cert is given.
ensure_cert() {
  [ "$APP_TLS" = "yes" ] || return 0
  if [ "$APP_NEW_CERT" = "no" ] && [ -s "$APP_CERT" ] && [ -s "$APP_KEY" ] \
     && openssl x509 -in "$APP_CERT" -noout -checkend 2592000 >/dev/null 2>&1; then
    ok "Keeping the existing certificate ($(openssl x509 -in "$APP_CERT" -noout -enddate | cut -d= -f2))"
    return 0
  fi
  say "Generating a self-signed certificate"
  local host fqdn san ip
  host="$(hostname -s 2>/dev/null || hostname)"
  fqdn="$(hostname -f 2>/dev/null || true)"
  san="DNS:${host},DNS:localhost"
  [ -n "$fqdn" ] && [ "$fqdn" != "$host" ] && [ "$fqdn" != "localhost" ] && san="${san},DNS:${fqdn}"
  san="${san},IP:127.0.0.1"
  [ -f /proc/net/if_inet6 ] && san="${san},IP:::1"
  for ip in $(hostname -I 2>/dev/null || true); do
    case "$ip" in fe80:*) continue ;; esac
    san="${san},IP:${ip}"
  done
  mkdir -p "$APP_TLS_DIR"
  chmod 700 "$APP_TLS_DIR"
  # 825 days is the longest validity Apple devices accept for TLS server certificates
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 825 \
    -keyout "${APP_KEY}.new" -out "${APP_CERT}.new" \
    -subj "/CN=${host}/O=${APP_NAME}" \
    -addext "subjectAltName=${san}" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1 \
    || die "Could not generate the certificate with openssl."
  chmod 600 "${APP_KEY}.new"
  chmod 644 "${APP_CERT}.new"
  mv "${APP_KEY}.new" "$APP_KEY"
  mv "${APP_CERT}.new" "$APP_CERT"
  ok "Certificate for ${san//,/, } (valid 825 days)"
}

# ------------------------------------------------------------------ Let's Encrypt
# acme.sh (a single shell script) is fetched from a fixed commit and checked, then it
# asks Let's Encrypt for a certificate and proves the domain with a DNS TXT record.
acme() { "${APP_ACME_HOME}/acme.sh" --home "$APP_ACME_HOME" --config-home "${APP_ACME_HOME}/data" --cert-home "${APP_ACME_HOME}/certs" "$@"; }

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi
}

install_acme() {
  local dir="$APP_ACME_HOME" tmp
  mkdir -p "${dir}/dnsapi" "${dir}/data" "${dir}/certs"
  chmod 700 "$dir"
  if ! echo "${APP_ACME_SHA256}  ${dir}/acme.sh" | sha256sum -c --status 2>/dev/null; then
    say "Fetching acme.sh"
    tmp="$(mktemp)"
    fetch "${APP_ACME_URL}/acme.sh" "$tmp" || die "Download failed: ${APP_ACME_URL}/acme.sh"
    echo "${APP_ACME_SHA256}  ${tmp}" | sha256sum -c --status || { rm -f "$tmp"; die "acme.sh does not match the expected checksum, aborting."; }
    install -m 700 "$tmp" "${dir}/acme.sh"
    rm -f "$tmp"
    ok "acme.sh installed in ${dir}"
  fi
  if [ "$APP_LE_DNS" != "manual" ] && [ ! -s "${dir}/dnsapi/${APP_LE_DNS}.sh" ]; then
    tmp="$(mktemp)"
    fetch "${APP_ACME_URL}/dnsapi/${APP_LE_DNS}.sh" "$tmp" 2>/dev/null \
      || { rm -f "$tmp"; die "Unknown DNS provider '${APP_LE_DNS}'. The names are listed at https://github.com/acmesh-official/acme.sh/wiki/dnsapi"; }
    install -m 600 "$tmp" "${dir}/dnsapi/${APP_LE_DNS}.sh"
    rm -f "$tmp"
  fi
}

# Is there a certificate for the domain that acme.sh can renew and that is valid for 30 more days?
le_cert_ok() {
  [ -s "$APP_LE_CERT" ] && [ -s "$APP_LE_KEY" ] || return 1
  local conf want="$APP_LE_DNS"
  conf="$(ls "${APP_ACME_HOME}/certs/${APP_LE_DOMAIN}"*/"${APP_LE_DOMAIN}.conf" 2>/dev/null | head -1)"
  [ -n "$conf" ] || return 1
  # Renewals use the DNS provider of the last issue: a new provider needs a new certificate
  [ "$want" = "manual" ] && want="dns"
  grep -q "^Le_Webroot='\{0,1\}${want}'\{0,1\}\$" "$conf" || return 1
  openssl x509 -in "$APP_LE_CERT" -noout -checkend 2592000 >/dev/null 2>&1 || return 1
  openssl x509 -in "$APP_LE_CERT" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:${APP_LE_DOMAIN}\(,\|\$\)"
}

le_check_options() {
  [ -n "$APP_LE_DOMAIN" ] || return 0
  printf '%s' "$APP_LE_DOMAIN" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$' \
    || die "Not a domain name: ${APP_LE_DOMAIN} (an IP address cannot get a Let's Encrypt certificate this way)"
  APP_LE_DOMAIN="$(printf '%s' "$APP_LE_DOMAIN" | tr 'A-Z' 'a-z')"
  [ -n "$APP_LE_DNS" ] || die "Which DNS provider? Add --dns <name> (e.g. dns_cf) or --dns manual."
  case "$APP_LE_DNS" in manual) ;; dns_*) ;; *) APP_LE_DNS="dns_${APP_LE_DNS}" ;; esac
  printf '%s' "$APP_LE_DNS" | grep -Eq '^(manual|dns_[a-z0-9_]+)$' || die "Invalid DNS provider name: ${APP_LE_DNS}"
  [ -z "$APP_LE_EMAIL" ] || printf '%s' "$APP_LE_EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "Invalid e-mail address: ${APP_LE_EMAIL}"
  if [ "$APP_TLS" = "no" ]; then
    if [ "$APP_TLS_SET" = "yes" ]; then
      [ "$APP_LE_SET" = "yes" ] && die "--letsencrypt needs HTTPS, it cannot be combined with --http."
      die "Let's Encrypt is set up for ${APP_LE_DOMAIN} and needs HTTPS. For plain HTTP add --no-letsencrypt."
    fi
    APP_TLS="yes"
    ok "Switching to HTTPS for the Let's Encrypt certificate"
  fi
}

ensure_le() {
  if [ -z "$APP_LE_DOMAIN" ]; then
    [ "$APP_LE_SET" = "off" ] && remove_le
    return 0
  fi
  install_acme
  # Another domain before: stop renewing it, both would write the same certificate files
  local dir old
  for dir in "${APP_ACME_HOME}"/certs/*/; do
    [ -d "$dir" ] || continue
    old="$(basename "$dir")"; old="${old%_ecc}"
    if [ "$old" != "$APP_LE_DOMAIN" ]; then
      acme --remove -d "$old" --ecc >/dev/null 2>&1 || true
      rm -rf "${APP_ACME_HOME}/certs/${old}" "${APP_ACME_HOME}/certs/${old}_ecc"
      ok "No longer renewing the certificate for ${old}"
    fi
  done
  if [ "$APP_NEW_CERT" = "no" ] && le_cert_ok; then
    ok "Keeping the Let's Encrypt certificate for ${APP_LE_DOMAIN} (until $(openssl x509 -in "$APP_LE_CERT" -noout -enddate | cut -d= -f2))"
    ensure_renewal
    return 0
  fi
  say "Requesting a Let's Encrypt certificate for ${APP_LE_DOMAIN} (DNS challenge)"
  # Extra acme.sh arguments for tests against a local test CA, e.g. "--insecure --dnssleep 1"
  # shellcheck disable=SC2206
  local extra=(${APP_ACME_ARGS:-${PP_ACME_ARGS:-}}) rc=0
  if [ -n "$APP_LE_EMAIL" ]; then
    acme --register-account --server "$APP_ACME_SERVER" -m "$APP_LE_EMAIL" "${extra[@]}" >/dev/null 2>&1 || warn "Could not register ${APP_LE_EMAIL} with Let's Encrypt, continuing without."
  fi
  local args=(--issue --server "$APP_ACME_SERVER" -d "$APP_LE_DOMAIN" --keylength ec-256)
  [ "$APP_NEW_CERT" = "yes" ] && args+=(--force)
  # acme.sh talks a lot: its messages go to a log and are shown when something fails
  local log="${APP_ACME_HOME}/last-run.log"
  if [ "$APP_LE_DNS" = "manual" ]; then
    [ -t 0 ] || die "--dns manual waits for you to create a DNS record, run it in an interactive terminal."
    acme "${args[@]}" --dns --yes-I-know-dns-manual-mode-enough-go-ahead-please "${extra[@]}" > "$log" 2>&1 || rc=$?
    if [ "$rc" -eq 3 ]; then
      echo
      say "Create this TXT record at your DNS provider:"
      sed -n "s/.*Domain: *'\([^']*\)'.*/      Name:  \1/p; s/.*TXT value: *'\([^']*\)'.*/      Value: \1/p" "$log"
      echo "    Check that it is visible, e.g.: dig +short TXT _acme-challenge.${APP_LE_DOMAIN}"
      read -r -p "    Press Enter when the record is published ... " _
      rc=0
      acme --renew -d "$APP_LE_DOMAIN" --ecc --yes-I-know-dns-manual-mode-enough-go-ahead-please "${extra[@]}" > "$log" 2>&1 || rc=$?
    fi
  else
    acme "${args[@]}" --dns "$APP_LE_DNS" "${extra[@]}" > "$log" 2>&1 || rc=$?
  fi
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
    sed 's/^/    /' "$log" | grep -v -e '-----' -e '^    [A-Za-z0-9+/=]\{40,\}$' | tail -n 20 >&2
    if grep -qi "credentials\|api key\|token\|You don't specify" "$log"; then
      warn "The DNS provider needs its credentials as environment variables, see"
      warn "https://github.com/acmesh-official/acme.sh/wiki/dnsapi (sudo keeps them only when given after sudo)."
    fi
  fi
  # 2: nothing to do, the certificate is still fresh
  [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ] || die "Let's Encrypt did not issue a certificate (full log: ${log}). Nothing was changed, ${APP_NAME} keeps its current certificate."
  mkdir -p "$APP_TLS_DIR"
  acme --install-cert -d "$APP_LE_DOMAIN" --ecc --key-file "$APP_LE_KEY" --fullchain-file "$APP_LE_CERT" \
    --reloadcmd "systemctl reload nginx" >/dev/null 2>&1 || true
  [ -s "$APP_LE_CERT" ] && [ -s "$APP_LE_KEY" ] || die "acme.sh did not store the certificate in ${APP_TLS_DIR}."
  chmod 600 "$APP_LE_KEY"
  ok "Let's Encrypt certificate for ${APP_LE_DOMAIN} (until $(openssl x509 -in "$APP_LE_CERT" -noout -enddate | cut -d= -f2))"
  ensure_renewal
}

# A daily systemd timer (or cron job without systemd) that runs a command as root
daily_job() {
  local unit="$1" what="$2" cmd="$3"
  if [ -d /run/systemd/system ]; then
    cat > "/etc/systemd/system/${unit}.service" <<UNIT
[Unit]
Description=${what}
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=${cmd}
UNIT
    cat > "/etc/systemd/system/${unit}.timer" <<UNIT
[Unit]
Description=${what} (daily)

[Timer]
OnCalendar=daily
RandomizedDelaySec=6h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload
    systemctl enable --now "${unit}.timer" >/dev/null 2>&1 || warn "Could not enable ${unit}.timer"
    ok "${what}: systemd timer ${unit}.timer"
  else
    printf '# %s: %s\n%s %s * * * root %s >/dev/null 2>&1\n' "$APP_NAME" "$what" \
      "$((RANDOM % 60))" "$((RANDOM % 24))" "$cmd" > "/etc/cron.d/${unit}"
    ok "${what}: /etc/cron.d/${unit}"
  fi
}

remove_daily_job() {
  local unit="$1"
  if [ -f "/etc/systemd/system/${unit}.timer" ]; then
    systemctl disable --now "${unit}.timer" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${unit}.timer" "/etc/systemd/system/${unit}.service"
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f "/etc/cron.d/${unit}"
}

# A daily check renews the certificate 30 days before it expires and reloads nginx
ensure_renewal() {
  if [ "$APP_LE_DNS" = "manual" ]; then
    remove_renewal
    warn "Manual DNS: the certificate does not renew itself. Within 30 days before"
    warn "$(openssl x509 -in "$APP_LE_CERT" -noout -enddate | cut -d= -f2) run again: sudo bash ${APP_SELF}"
    return 0
  fi
  daily_job "$APP_RENEW" "Renew the Let's Encrypt certificate of ${APP_NAME}" \
    "${APP_ACME_HOME}/acme.sh --cron --home ${APP_ACME_HOME} --config-home ${APP_ACME_HOME}/data --cert-home ${APP_ACME_HOME}/certs"
}

remove_renewal() { remove_daily_job "$APP_RENEW"; }

remove_le() {
  remove_renewal
  [ -d "$APP_ACME_HOME" ] || [ -f "$APP_LE_CERT" ] || return 0
  rm -rf "$APP_ACME_HOME"
  rm -f "$APP_LE_CERT" "$APP_LE_KEY"
  ok "Let's Encrypt removed, back to the self-signed certificate"
}

# One server block per certificate: the self-signed one answers for IP addresses and
# other names, the Let's Encrypt one for its domain. Both serve the same app.
server_block() {
  local name="$1" cert="$2" key="$3" listen4="$4" listen6="$5" tls=""
  if [ -n "$cert" ]; then
    tls="
    ssl_certificate     ${cert};
    ssl_certificate_key ${key};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:${APP_ID}:1m;
    ssl_session_timeout 1d;
    # Plain HTTP on the HTTPS port: a small page that moves to HTTPS and takes the
    # data saved under the old http:// address along (it lives in the browser)
    error_page 497 =200 /migrate.html;
"
  fi
  cat <<NGINX
server {
${listen4}
${listen6}
    server_name ${name};
${tls}
    root ${APP_WWW};
    index index.html;
    charset utf-8;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'" always;

    location = /healthz {
        access_log off;
        default_type text/plain;
        return 200 "ok\n";
    }
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location ~* \.(js|css|json|html)\$ {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'" always;
    }
}
NGINX
}

write_site() {
  say "Writing nginx configuration for port ${APP_PORT}"
  local listen6="    listen [::]:${APP_PORT};" listen4="    listen ${APP_PORT};" note=" (--http)"
  if [ ! -f /proc/net/if_inet6 ]; then
    listen6="    # IPv6 is not available on this system"
    warn "No IPv6 available, ${APP_NAME} only listens on IPv4."
  fi
  if [ "$APP_TLS" = "yes" ]; then
    note=""
    listen4="${listen4/;/ ssl;}"
    listen6="${listen6/:${APP_PORT};/:${APP_PORT} ssl;}"
  fi
  {
    echo "# ${APP_NAME} ${APP_VERSION}, generated by ${APP_ID}-install.sh${note}"
    echo "# Settings: ${APP_CONF}"
    if [ "$APP_TLS" = "yes" ]; then
      server_block "_" "$APP_CERT" "$APP_KEY" "$listen4" "$listen6"
      if [ -n "$APP_LE_DOMAIN" ]; then
        echo
        server_block "$APP_LE_DOMAIN" "$APP_LE_CERT" "$APP_LE_KEY" "$listen4" "$listen6"
      fi
    else
      server_block "_" "" "" "$listen4" "$listen6"
    fi
  } > "$APP_SITE"
  ln -sf "$APP_SITE" "$APP_LINK"
  if [ "$APP_PORT" = "80" ] && [ -L /etc/nginx/sites-enabled/default ]; then
    warn "Port 80: the nginx default site is disabled (only the link in sites-enabled, the file stays)."
    rm -f /etc/nginx/sites-enabled/default
  fi
  # Without IPv6 the Debian default site (listen [::]:80) stops nginx from starting at all
  if [ ! -f /proc/net/if_inet6 ] && [ -L /etc/nginx/sites-enabled/default ] && grep -q 'listen \[::\]' /etc/nginx/sites-enabled/default; then
    warn "No IPv6: the nginx default site, which listens on [::]:80, is disabled (only the link in sites-enabled, the file stays)."
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx configuration is invalid, see above."; }
  systemctl enable --now nginx >/dev/null 2>&1 || true
  local old_workers; old_workers="$(nginx_workers)"
  systemctl reload nginx
  # The reload only signals nginx: wait until the old workers are gone, so the new
  # settings (HTTP or HTTPS, port, certificate) are what answers when this script ends
  local i w left
  for i in $(seq 1 50); do
    left=""
    for w in $old_workers; do [ -d "/proc/$w" ] && left=1; done
    [ -z "$left" ] && break
    sleep 0.2
  done
  ok "nginx reloaded"
}

# The worker processes of the running nginx (nothing when it does not run)
nginx_workers() {
  local master; master="$(cat /run/nginx.pid 2>/dev/null || true)"
  [ -n "$master" ] && [ -d "/proc/$master" ] || return 0
  if command -v pgrep >/dev/null 2>&1; then pgrep -P "$master" || true
  else cat "/proc/$master/task/$master/children" 2>/dev/null || true; fi
}

# The address users should use. The web app offers to move their data there when it
# is opened under another address (browser data is stored per address).
main_url() {
  local scheme="http" port=""
  [ "$APP_TLS" = "yes" ] && scheme="https"
  { [ "$scheme" = "https" ] && [ "$APP_PORT" = "443" ]; } || { [ "$scheme" = "http" ] && [ "$APP_PORT" = "80" ]; } || port=":${APP_PORT}"
  [ -n "$APP_LE_DOMAIN" ] && echo "${scheme}://${APP_LE_DOMAIN}${port}/"
  return 0
}

# The public address the web app is told about (site.json), empty for none
canonical_url() {
  local url
  url="$(main_url)"
  # --no-move-card: no main address, so no browser is ever told to move (share links
  # then use whatever address the user opened)
  [ "$APP_MOVE_CARD" = "no" ] && url=""
  # A new home elsewhere (--moved-to) is an explicit wish: it always shows the card
  [ -n "$APP_MOVED_TO" ] && url="$APP_MOVED_TO"
  printf '%s' "${url%/}"
}

write_site_json() {
  local url
  url="$(canonical_url)"
  if [ -n "$url" ]; then
    printf '{ "version": "%s", "canonical": "%s" }\n' "$APP_VERSION" "$url" > "${APP_WWW}/site.json"
  else
    printf '{ "version": "%s" }\n' "$APP_VERSION" > "${APP_WWW}/site.json"
  fi
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${APP_PORT}/tcp" >/dev/null && ok "ufw: port ${APP_PORT}/tcp opened"
  fi
}

# Settings of the last install, so updates and reinstalls change nothing by surprise.
# Options on the command line win.
save_settings() {
  mkdir -p "$APP_ROOT"
  cat > "$APP_CONF" <<CONF
# ${APP_NAME} settings, written by ${APP_ID}-install.sh and kept across updates.
# Change them with the options of the script (see --help), not here.
PORT=${APP_PORT}
TLS=${APP_TLS}
LE_DOMAIN=${APP_LE_DOMAIN}
LE_DNS=${APP_LE_DNS}
LE_EMAIL=${APP_LE_EMAIL}
MOVED_TO=${APP_MOVED_TO}
MOVE_CARD=${APP_MOVE_CARD}
CONF
  chmod 644 "$APP_CONF"
}

keep_settings() {
  local k v c_port="" c_tls="" c_domain="" c_dns="" c_email="" c_moved="" c_card=""
  if [ -f "$APP_CONF" ]; then
    while IFS='=' read -r k v; do
      case "$k" in
        PORT) c_port="$v" ;; TLS) c_tls="$v" ;; LE_DOMAIN) c_domain="$v" ;; LE_DNS) c_dns="$v" ;; LE_EMAIL) c_email="$v" ;; MOVED_TO) c_moved="$v" ;; MOVE_CARD) c_card="$v" ;;
      esac
    done < "$APP_CONF"
  elif [ -f "$APP_SITE" ]; then
    # Installed by a very old version without a settings file: read the nginx site
    c_port="$(awk '/^[[:space:]]*listen[[:space:]]+[0-9]+[[:space:];]/ { gsub(";", "", $2); print $2; exit }' "$APP_SITE")"
    c_tls="yes"
    grep -q "^# ${APP_NAME}.*--http" "$APP_SITE" && c_tls="no"
  fi
  if [ "$APP_PORT_SET" = "no" ] && [ -n "$c_port" ] && [ "$c_port" != "$APP_PORT" ]; then
    case "$c_port" in *[!0-9]*) ;; *) APP_PORT="$c_port"; ok "Keeping previous port ${APP_PORT} (change with --port)" ;; esac
  fi
  if [ "$APP_TLS_SET" = "no" ] && [ "$c_tls" = "no" ]; then
    APP_TLS="no"
    ok "Keeping plain HTTP (switch with --https)"
  fi
  if [ "$APP_MOVE_CARD_SET" = "no" ] && [ "$c_card" = "no" ]; then APP_MOVE_CARD="no"; ok "Keeping: no card about another address (show it again with --move-card)"; fi
  if [ "$APP_MOVED_SET" = "no" ] && [ -n "$c_moved" ]; then APP_MOVED_TO="$c_moved"; ok "Keeping the new address ${APP_MOVED_TO} (remove with --not-moved)"; fi
  case "$APP_LE_SET" in
    no)
      if [ -n "$c_domain" ]; then
        APP_LE_DOMAIN="$c_domain"; APP_LE_DNS="$c_dns"; APP_LE_EMAIL="$c_email"
        ok "Keeping Let's Encrypt for ${APP_LE_DOMAIN} (remove with --no-letsencrypt)"
      fi ;;
    yes)
      # Same domain again: the DNS provider and e-mail may be left out
      if [ "$APP_LE_DOMAIN" = "$c_domain" ]; then
        [ -n "$APP_LE_DNS" ] || APP_LE_DNS="$c_dns"
        [ -n "$APP_LE_EMAIL" ] || APP_LE_EMAIL="$c_email"
      fi ;;
  esac
  return 0
}


do_install() {
  check_system
  keep_settings
  le_check_options
  if port_in_use && [ ! -f "$APP_SITE" ]; then
    warn "Port ${APP_PORT} is already in use. If you run into problems, choose another one with --port."
  fi
  install_packages
  ensure_cert
  ensure_le
  say "Writing web files to ${APP_WWW}"
  local tmp
  tmp="$(mktemp -d)"
  write_files "$tmp"
  mkdir -p "$APP_ROOT"
  rm -rf "${APP_WWW}.new"
  mv "$tmp" "${APP_WWW}.new"
  rm -rf "$APP_WWW"
  mv "${APP_WWW}.new" "$APP_WWW"
  echo "$APP_VERSION" > "${APP_ROOT}/VERSION"
  write_site_json
  # A copy of this script for later runs (renewal by hand, changing options, backups)
  if [ -f "$0" ] && [ "$(readlink -f "$0")" != "$APP_SELF" ]; then install -m 755 "$0" "$APP_SELF"; fi
  chown -R root:root "$APP_ROOT"
  find "$APP_WWW" -type d -exec chmod 755 {} +
  find "$APP_WWW" -type f -exec chmod 644 {} +
  ok "$(find "$APP_WWW" -type f | wc -l) files installed"
  write_site
  save_settings
  open_firewall
  type app_after_install >/dev/null 2>&1 && app_after_install
  local ips main
  ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -3 || true)"
  main="$(main_url)"
  echo
  local scheme="http"
  [ "$APP_TLS" = "yes" ] && scheme="https"
  say "${APP_NAME} ${APP_VERSION} is ready:"
  if [ -n "$main" ]; then
    echo "      ${main}"
    echo "    Also reachable by IP address (self-signed certificate there):"
  fi
  if [ -n "$ips" ]; then
    for ip in $ips; do echo "      ${scheme}://${ip}:${APP_PORT}/"; done
  else
    echo "      ${scheme}://<IP-of-this-server>:${APP_PORT}/"
  fi
  echo
  if [ "$APP_TLS" = "yes" ]; then
    if [ -n "$main" ]; then
      echo "    ${APP_LE_DOMAIN} has a certificate from Let's Encrypt, browsers trust it without a"
      echo "    warning. The domain must point to this server in DNS. Opened by IP address, the"
      echo "    app offers to move the data saved there to ${APP_LE_DOMAIN}."
    else
      echo "    The certificate is self-signed, so the browser warns once. Compare the fingerprint"
      echo "    before you accept it:"
      echo "      $(openssl x509 -in "$APP_CERT" -noout -fingerprint -sha256 | cut -d= -f2)"
      echo "    Certificate: ${APP_CERT}"
      echo "    A trusted certificate for a domain: --letsencrypt <domain> --dns <provider> (see --help)"
    fi
    echo
  fi
  echo "    Progress and own networks are stored in each browser and survive updates."
  [ "$APP_TLS" = "yes" ] && echo "    Opened with http://, the old address hands its data over to https:// once."
  echo "    Update: sudo bash ${APP_SELF} --update. Remove: --uninstall"
}

do_update() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  local tmp new
  tmp="$(mktemp)"
  say "Downloading the latest version from github.com/${APP_REPO}"
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "Neither curl nor wget found. Install with: apt install curl"
  fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL -H "$2" "$1" -o "$3"; else wget -q --header="$2" -O "$3" "$1"; fi; }
  # raw.githubusercontent.com caches main/ for minutes: ask for the newest commit and load
  # the script of exactly that commit, which is never stale
  local sha url="$APP_SCRIPT_URL"
  if fetch "https://api.github.com/repos/${APP_REPO}/commits/main" "Accept: application/vnd.github.sha" "$tmp" 2>/dev/null; then
    sha="$(head -c 40 "$tmp")"
    case "$sha" in *[!0-9a-f]*|"") ;; *) url="https://raw.githubusercontent.com/${APP_REPO}/${sha}/${APP_ID}-install.sh" ;; esac
  fi
  fetch "$url" "Cache-Control: no-cache" "$tmp" || die "Download failed: ${url}"
  bash -n "$tmp" || die "The downloaded script is broken, aborting."
  grep -q "^APP_ID=\"${APP_ID}\"\$" "$tmp" || die "The downloaded script is not the installer of ${APP_NAME}, aborting."
  new="$(sed -n 's/^APP_VERSION="\(.*\)"$/\1/p' "$tmp" | head -1)"
  [ -n "$new" ] || die "The downloaded script has no version, aborting."
  say "Installed: $(cat "${APP_ROOT}/VERSION" 2>/dev/null || echo none), available: ${new}"
  # Never go back to an older version than the one running right now
  if [ "$new" != "$APP_VERSION" ] && [ "$(printf '%s\n%s\n' "$new" "$APP_VERSION" | sort -V | tail -1)" = "$APP_VERSION" ]; then
    warn "GitHub offers ${new}, this script is ${APP_VERSION}: installing ${APP_VERSION} instead"
    cp "$0" "$tmp" 2>/dev/null || die "Cannot reuse this script, download it again"
  fi
  local args=()
  [ "$APP_PORT_SET" = "yes" ] && args+=(--port "$APP_PORT")
  [ "$APP_FORCE" = "yes" ] && args+=(--force)
  [ "$APP_TLS_SET" = "yes" ] && { [ "$APP_TLS" = "yes" ] && args+=(--https) || args+=(--http); }
  [ "$APP_NEW_CERT" = "yes" ] && args+=(--new-cert)
  [ "$APP_LE_SET" = "yes" ] && args+=(--letsencrypt "$APP_LE_DOMAIN")
  [ "$APP_LE_SET" = "off" ] && args+=(--no-letsencrypt)
  [ -n "$APP_LE_DNS" ] && args+=(--dns "$APP_LE_DNS")
  [ -n "$APP_LE_EMAIL" ] && args+=(--email "$APP_LE_EMAIL")
  # Every option given together with --update goes to the new script as well
  [ "$APP_MOVE_CARD_SET" = "yes" ] && { [ "$APP_MOVE_CARD" = "no" ] && args+=(--no-move-card) || args+=(--move-card); }
  [ "$APP_MOVED_SET" = "yes" ] && args+=(--moved-to "$APP_MOVED_TO")
  [ "$APP_MOVED_SET" = "off" ] && args+=(--not-moved)
  exec bash "$tmp" "${args[@]}"
}

do_uninstall() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  say "Removing ${APP_NAME}"
  remove_renewal
  rm -f "$APP_LINK" "$APP_SITE"
  rm -rf "$APP_ROOT"
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then systemctl reload nginx || true; fi
  ok "${APP_NAME} removed. nginx itself stays installed (remove with: apt purge nginx)."
}

do_extract() {
  [ -n "$APP_EXTRACT_DIR" ] || die "Specify a target folder: --extract ./web"
  mkdir -p "$APP_EXTRACT_DIR"
  write_files "$APP_EXTRACT_DIR"
  ok "Web files extracted to ${APP_EXTRACT_DIR}. Test e.g. with: python3 -m http.server -d ${APP_EXTRACT_DIR} 8080"
}

case "$APP_ACTION" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  extract)   do_extract ;;
esac
