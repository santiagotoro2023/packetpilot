
check_system() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  [ -r /etc/os-release ] || die "/etc/os-release is missing, unknown system."
  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" = "debian" ] && { [ "${VERSION_ID:-}" = "12" ] || [ "${VERSION_ID:-}" = "13" ]; }; then
    ok "Detected Debian ${VERSION_ID} (${VERSION_CODENAME:-?})"
  elif [ "$PP_FORCE" = "yes" ]; then
    warn "Untested system (${PRETTY_NAME:-unknown}), continuing anyway because of --force."
  else
    die "Tested on Debian 12 and 13, found: ${PRETTY_NAME:-unknown}. Use --force to install anyway."
  fi
}

port_in_use() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -Hltn "sport = :${PP_PORT}" 2>/dev/null | grep -q .
}

install_nginx() {
  local pkgs=()
  command -v nginx >/dev/null 2>&1 || pkgs+=(nginx)
  [ "$PP_TLS" = "yes" ] && ! command -v openssl >/dev/null 2>&1 && pkgs+=(openssl)
  [ -n "$PP_LE_DOMAIN" ] && ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1 && pkgs+=(curl)
  if [ ${#pkgs[@]} -eq 0 ]; then
    ok "nginx is already installed"
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
  [ "$PP_TLS" = "yes" ] || return 0
  if [ "$PP_NEW_CERT" = "no" ] && [ -s "$PP_CERT" ] && [ -s "$PP_KEY" ] \
     && openssl x509 -in "$PP_CERT" -noout -checkend 2592000 >/dev/null 2>&1; then
    ok "Keeping the existing certificate ($(openssl x509 -in "$PP_CERT" -noout -enddate | cut -d= -f2))"
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
  mkdir -p "$PP_TLS_DIR"
  chmod 700 "$PP_TLS_DIR"
  # 825 days is the longest validity Apple devices accept for TLS server certificates
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 825 \
    -keyout "${PP_KEY}.new" -out "${PP_CERT}.new" \
    -subj "/CN=${host}/O=PacketPilot" \
    -addext "subjectAltName=${san}" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1 \
    || die "Could not generate the certificate with openssl."
  chmod 600 "${PP_KEY}.new"
  chmod 644 "${PP_CERT}.new"
  mv "${PP_KEY}.new" "$PP_KEY"
  mv "${PP_CERT}.new" "$PP_CERT"
  ok "Certificate for ${san//,/, } (valid 825 days)"
}

# ------------------------------------------------------------------ Let's Encrypt
# acme.sh (a single shell script) is fetched from a fixed commit and checked, then it
# asks Let's Encrypt for a certificate and proves the domain with a DNS TXT record.
acme() { "${PP_ACME_HOME}/acme.sh" --home "$PP_ACME_HOME" --config-home "${PP_ACME_HOME}/data" --cert-home "${PP_ACME_HOME}/certs" "$@"; }

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi
}

install_acme() {
  local dir="$PP_ACME_HOME" tmp
  mkdir -p "${dir}/dnsapi" "${dir}/data" "${dir}/certs"
  chmod 700 "$dir"
  if ! echo "${PP_ACME_SHA256}  ${dir}/acme.sh" | sha256sum -c --status 2>/dev/null; then
    say "Fetching acme.sh"
    tmp="$(mktemp)"
    fetch "${PP_ACME_URL}/acme.sh" "$tmp" || die "Download failed: ${PP_ACME_URL}/acme.sh"
    echo "${PP_ACME_SHA256}  ${tmp}" | sha256sum -c --status || { rm -f "$tmp"; die "acme.sh does not match the expected checksum, aborting."; }
    install -m 700 "$tmp" "${dir}/acme.sh"
    rm -f "$tmp"
    ok "acme.sh installed in ${dir}"
  fi
  if [ "$PP_LE_DNS" != "manual" ] && [ ! -s "${dir}/dnsapi/${PP_LE_DNS}.sh" ]; then
    tmp="$(mktemp)"
    fetch "${PP_ACME_URL}/dnsapi/${PP_LE_DNS}.sh" "$tmp" 2>/dev/null \
      || { rm -f "$tmp"; die "Unknown DNS provider '${PP_LE_DNS}'. The names are listed at https://github.com/acmesh-official/acme.sh/wiki/dnsapi"; }
    install -m 600 "$tmp" "${dir}/dnsapi/${PP_LE_DNS}.sh"
    rm -f "$tmp"
  fi
}

# Is there a certificate for the domain that acme.sh can renew and that is valid for 30 more days?
le_cert_ok() {
  [ -s "$PP_LE_CERT" ] && [ -s "$PP_LE_KEY" ] || return 1
  local conf want="$PP_LE_DNS"
  conf="$(ls "${PP_ACME_HOME}/certs/${PP_LE_DOMAIN}"*/"${PP_LE_DOMAIN}.conf" 2>/dev/null | head -1)"
  [ -n "$conf" ] || return 1
  # Renewals use the DNS provider of the last issue: a new provider needs a new certificate
  [ "$want" = "manual" ] && want="dns"
  grep -q "^Le_Webroot='\{0,1\}${want}'\{0,1\}\$" "$conf" || return 1
  openssl x509 -in "$PP_LE_CERT" -noout -checkend 2592000 >/dev/null 2>&1 || return 1
  openssl x509 -in "$PP_LE_CERT" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:${PP_LE_DOMAIN}\(,\|\$\)"
}

le_check_options() {
  [ -n "$PP_LE_DOMAIN" ] || return 0
  printf '%s' "$PP_LE_DOMAIN" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$' \
    || die "Not a domain name: ${PP_LE_DOMAIN} (an IP address cannot get a Let's Encrypt certificate this way)"
  PP_LE_DOMAIN="$(printf '%s' "$PP_LE_DOMAIN" | tr 'A-Z' 'a-z')"
  [ -n "$PP_LE_DNS" ] || die "Which DNS provider? Add --dns <name> (e.g. dns_cf) or --dns manual."
  case "$PP_LE_DNS" in manual) ;; dns_*) ;; *) PP_LE_DNS="dns_${PP_LE_DNS}" ;; esac
  printf '%s' "$PP_LE_DNS" | grep -Eq '^(manual|dns_[a-z0-9_]+)$' || die "Invalid DNS provider name: ${PP_LE_DNS}"
  [ -z "$PP_LE_EMAIL" ] || printf '%s' "$PP_LE_EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "Invalid e-mail address: ${PP_LE_EMAIL}"
  if [ "$PP_TLS" = "no" ]; then
    if [ "$PP_TLS_SET" = "yes" ]; then
      [ "$PP_LE_SET" = "yes" ] && die "--letsencrypt needs HTTPS, it cannot be combined with --http."
      die "Let's Encrypt is set up for ${PP_LE_DOMAIN} and needs HTTPS. For plain HTTP add --no-letsencrypt."
    fi
    PP_TLS="yes"
    ok "Switching to HTTPS for the Let's Encrypt certificate"
  fi
}

ensure_le() {
  if [ -z "$PP_LE_DOMAIN" ]; then
    [ "$PP_LE_SET" = "off" ] && remove_le
    return 0
  fi
  install_acme
  # Another domain before: stop renewing it, both would write the same certificate files
  local dir old
  for dir in "${PP_ACME_HOME}"/certs/*/; do
    [ -d "$dir" ] || continue
    old="$(basename "$dir")"; old="${old%_ecc}"
    if [ "$old" != "$PP_LE_DOMAIN" ]; then
      acme --remove -d "$old" --ecc >/dev/null 2>&1 || true
      rm -rf "${PP_ACME_HOME}/certs/${old}" "${PP_ACME_HOME}/certs/${old}_ecc"
      ok "No longer renewing the certificate for ${old}"
    fi
  done
  if [ "$PP_NEW_CERT" = "no" ] && le_cert_ok; then
    ok "Keeping the Let's Encrypt certificate for ${PP_LE_DOMAIN} (until $(openssl x509 -in "$PP_LE_CERT" -noout -enddate | cut -d= -f2))"
    ensure_renewal
    return 0
  fi
  say "Requesting a Let's Encrypt certificate for ${PP_LE_DOMAIN} (DNS challenge)"
  # Extra acme.sh arguments for tests against a local test CA, e.g. "--insecure --dnssleep 1"
  # shellcheck disable=SC2206
  local extra=(${PP_ACME_ARGS:-}) rc=0
  if [ -n "$PP_LE_EMAIL" ]; then
    acme --register-account --server "$PP_ACME_SERVER" -m "$PP_LE_EMAIL" "${extra[@]}" >/dev/null 2>&1 || warn "Could not register ${PP_LE_EMAIL} with Let's Encrypt, continuing without."
  fi
  local args=(--issue --server "$PP_ACME_SERVER" -d "$PP_LE_DOMAIN" --keylength ec-256)
  [ "$PP_NEW_CERT" = "yes" ] && args+=(--force)
  # acme.sh talks a lot: its messages go to a log and are shown when something fails
  local log="${PP_ACME_HOME}/last-run.log"
  if [ "$PP_LE_DNS" = "manual" ]; then
    [ -t 0 ] || die "--dns manual waits for you to create a DNS record, run it in an interactive terminal."
    acme "${args[@]}" --dns --yes-I-know-dns-manual-mode-enough-go-ahead-please "${extra[@]}" > "$log" 2>&1 || rc=$?
    if [ "$rc" -eq 3 ]; then
      echo
      say "Create this TXT record at your DNS provider:"
      sed -n "s/.*Domain: *'\([^']*\)'.*/      Name:  \1/p; s/.*TXT value: *'\([^']*\)'.*/      Value: \1/p" "$log"
      echo "    Check that it is visible, e.g.: dig +short TXT _acme-challenge.${PP_LE_DOMAIN}"
      read -r -p "    Press Enter when the record is published ... " _
      rc=0
      acme --renew -d "$PP_LE_DOMAIN" --ecc --yes-I-know-dns-manual-mode-enough-go-ahead-please "${extra[@]}" > "$log" 2>&1 || rc=$?
    fi
  else
    acme "${args[@]}" --dns "$PP_LE_DNS" "${extra[@]}" > "$log" 2>&1 || rc=$?
  fi
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
    sed 's/^/    /' "$log" | grep -v -e '-----' -e '^    [A-Za-z0-9+/=]\{40,\}$' | tail -n 20 >&2
    if grep -qi "credentials\|api key\|token\|You don't specify" "$log"; then
      warn "The DNS provider needs its credentials as environment variables, see"
      warn "https://github.com/acmesh-official/acme.sh/wiki/dnsapi (sudo keeps them only when given after sudo)."
    fi
  fi
  # 2: nothing to do, the certificate is still fresh
  [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ] || die "Let's Encrypt did not issue a certificate (full log: ${log}). Nothing was changed, PacketPilot keeps its current certificate."
  mkdir -p "$PP_TLS_DIR"
  acme --install-cert -d "$PP_LE_DOMAIN" --ecc --key-file "$PP_LE_KEY" --fullchain-file "$PP_LE_CERT" \
    --reloadcmd "systemctl reload nginx" >/dev/null 2>&1 || true
  [ -s "$PP_LE_CERT" ] && [ -s "$PP_LE_KEY" ] || die "acme.sh did not store the certificate in ${PP_TLS_DIR}."
  chmod 600 "$PP_LE_KEY"
  ok "Let's Encrypt certificate for ${PP_LE_DOMAIN} (until $(openssl x509 -in "$PP_LE_CERT" -noout -enddate | cut -d= -f2))"
  ensure_renewal
}

# A daily check renews the certificate 30 days before it expires and reloads nginx
ensure_renewal() {
  if [ "$PP_LE_DNS" = "manual" ]; then
    remove_renewal
    warn "Manual DNS: the certificate does not renew itself. Within 30 days before"
    warn "$(openssl x509 -in "$PP_LE_CERT" -noout -enddate | cut -d= -f2) run again: sudo bash ${PP_SELF}"
    return 0
  fi
  local cmd="${PP_ACME_HOME}/acme.sh --cron --home ${PP_ACME_HOME} --config-home ${PP_ACME_HOME}/data --cert-home ${PP_ACME_HOME}/certs"
  if [ -d /run/systemd/system ]; then
    cat > "/etc/systemd/system/${PP_RENEW}.service" <<UNIT
[Unit]
Description=Renew the Let's Encrypt certificate of PacketPilot
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=${cmd}
UNIT
    cat > "/etc/systemd/system/${PP_RENEW}.timer" <<UNIT
[Unit]
Description=Daily renewal check for the PacketPilot certificate

[Timer]
OnCalendar=daily
RandomizedDelaySec=6h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload
    systemctl enable --now "${PP_RENEW}.timer" >/dev/null 2>&1 || warn "Could not enable ${PP_RENEW}.timer"
    ok "Automatic renewal: systemd timer ${PP_RENEW}.timer"
  else
    printf '# PacketPilot: renew the Let'"'"'s Encrypt certificate\n%s %s * * * root %s >/dev/null 2>&1\n' \
      "$((RANDOM % 60))" "$((RANDOM % 24))" "$cmd" > "/etc/cron.d/${PP_RENEW}"
    ok "Automatic renewal: /etc/cron.d/${PP_RENEW}"
  fi
}

remove_renewal() {
  if [ -f "/etc/systemd/system/${PP_RENEW}.timer" ]; then
    systemctl disable --now "${PP_RENEW}.timer" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${PP_RENEW}.timer" "/etc/systemd/system/${PP_RENEW}.service"
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f "/etc/cron.d/${PP_RENEW}"
}

remove_le() {
  remove_renewal
  [ -d "$PP_ACME_HOME" ] || [ -f "$PP_LE_CERT" ] || return 0
  rm -rf "$PP_ACME_HOME"
  rm -f "$PP_LE_CERT" "$PP_LE_KEY"
  ok "Let's Encrypt removed, back to the self-signed certificate"
}

# One server block per certificate: the self-signed one answers for IP addresses and
# other names, the Let's Encrypt one for its domain. Both serve the same files.
server_block() {
  local name="$1" cert="$2" key="$3" listen4="$4" listen6="$5" tls=""
  if [ -n "$cert" ]; then
    tls="
    ssl_certificate     ${cert};
    ssl_certificate_key ${key};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:PacketPilot:1m;
    ssl_session_timeout 1d;
    # Plain HTTP on the HTTPS port: a small page that moves to HTTPS and takes the
    # progress saved under the old http:// address along (it lives in the browser)
    error_page 497 =200 /migrate.html;
"
  fi
  cat <<NGINX
server {
${listen4}
${listen6}
    server_name ${name};
${tls}
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
    location ~* \.(js|css|json|html)\$ {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'" always;
    }
}
NGINX
}

write_site() {
  say "Writing nginx configuration for port ${PP_PORT}"
  local listen6="    listen [::]:${PP_PORT};" listen4="    listen ${PP_PORT};" note=" (--http)"
  if [ ! -f /proc/net/if_inet6 ]; then
    listen6="    # IPv6 is not available on this system"
    warn "No IPv6 available, PacketPilot only listens on IPv4."
  fi
  if [ "$PP_TLS" = "yes" ]; then
    note=""
    listen4="${listen4/;/ ssl;}"
    listen6="${listen6/:${PP_PORT};/:${PP_PORT} ssl;}"
  fi
  {
    echo "# PacketPilot ${PP_VERSION}, generated by packetpilot-install.sh${note}"
    echo "# Settings: ${PP_CONF}"
    if [ "$PP_TLS" = "yes" ]; then
      server_block "_" "$PP_CERT" "$PP_KEY" "$listen4" "$listen6"
      if [ -n "$PP_LE_DOMAIN" ]; then
        echo
        server_block "$PP_LE_DOMAIN" "$PP_LE_CERT" "$PP_LE_KEY" "$listen4" "$listen6"
      fi
    else
      server_block "_" "" "" "$listen4" "$listen6"
    fi
  } > "$PP_SITE"
  ln -sf "$PP_SITE" "$PP_LINK"
  if [ "$PP_PORT" = "80" ] && [ -L /etc/nginx/sites-enabled/default ]; then
    warn "Port 80: the nginx default site is disabled (only the link in sites-enabled, the file stays)."
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx configuration is invalid, see above."; }
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl reload nginx
  ok "nginx reloaded"
}

# The address learners should use. The web app offers to move progress there when it
# is opened under another address (progress is stored per address in the browser).
main_url() {
  local scheme="http" port=""
  [ "$PP_TLS" = "yes" ] && scheme="https"
  { [ "$scheme" = "https" ] && [ "$PP_PORT" = "443" ]; } || { [ "$scheme" = "http" ] && [ "$PP_PORT" = "80" ]; } || port=":${PP_PORT}"
  [ -n "$PP_LE_DOMAIN" ] && echo "${scheme}://${PP_LE_DOMAIN}${port}/"
  return 0
}

write_site_json() {
  local url
  url="$(main_url)"
  # --no-move-card: no main address, so no browser is ever told to move (share links
  # then use whatever address the learner opened)
  [ "$PP_MOVE_CARD" = "no" ] && url=""
  # A new home elsewhere (--moved-to) is an explicit wish: it always shows the card
  [ -n "$PP_MOVED_TO" ] && url="$PP_MOVED_TO"
  if [ -n "$url" ]; then
    printf '{ "version": "%s", "canonical": "%s" }\n' "$PP_VERSION" "${url%/}" > "${PP_WWW}/site.json"
  else
    printf '{ "version": "%s" }\n' "$PP_VERSION" > "${PP_WWW}/site.json"
  fi
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${PP_PORT}/tcp" >/dev/null && ok "ufw: port ${PP_PORT}/tcp opened"
  fi
}

# Settings of the last install, so updates and reinstalls change nothing by surprise.
# Options on the command line win.
save_settings() {
  mkdir -p "$PP_ROOT"
  cat > "$PP_CONF" <<CONF
# PacketPilot settings, written by packetpilot-install.sh and kept across updates.
# Change them with the options of the script (see --help), not here.
PORT=${PP_PORT}
TLS=${PP_TLS}
LE_DOMAIN=${PP_LE_DOMAIN}
LE_DNS=${PP_LE_DNS}
LE_EMAIL=${PP_LE_EMAIL}
MOVED_TO=${PP_MOVED_TO}
MOVE_CARD=${PP_MOVE_CARD}
CONF
  chmod 644 "$PP_CONF"
}

keep_settings() {
  local k v c_port="" c_tls="" c_domain="" c_dns="" c_email="" c_moved="" c_card=""
  if [ -f "$PP_CONF" ]; then
    while IFS='=' read -r k v; do
      case "$k" in
        PORT) c_port="$v" ;; TLS) c_tls="$v" ;; LE_DOMAIN) c_domain="$v" ;; LE_DNS) c_dns="$v" ;; LE_EMAIL) c_email="$v" ;; MOVED_TO) c_moved="$v" ;; MOVE_CARD) c_card="$v" ;;
      esac
    done < "$PP_CONF"
  elif [ -f "$PP_SITE" ]; then
    # Installed by a version before 2.0.0: read the nginx site
    c_port="$(awk '/^[[:space:]]*listen[[:space:]]+[0-9]+[[:space:];]/ { gsub(";", "", $2); print $2; exit }' "$PP_SITE")"
    # Sites written by versions before 1.2.0 never had TLS: those switch to HTTPS now
    c_tls="yes"
    grep -q "^# PacketPilot.*--http" "$PP_SITE" && c_tls="no"
  fi
  if [ "$PP_PORT_SET" = "no" ] && [ -n "$c_port" ] && [ "$c_port" != "$PP_PORT" ]; then
    case "$c_port" in *[!0-9]*) ;; *) PP_PORT="$c_port"; ok "Keeping previous port ${PP_PORT} (change with --port)" ;; esac
  fi
  if [ "$PP_TLS_SET" = "no" ] && [ "$c_tls" = "no" ]; then
    PP_TLS="no"
    ok "Keeping plain HTTP (switch with --https)"
  fi
  if [ "$PP_MOVE_CARD_SET" = "no" ] && [ "$c_card" = "no" ]; then PP_MOVE_CARD="no"; ok "Keeping: no card about another address (show it again with --move-card)"; fi
  if [ "$PP_MOVED_SET" = "no" ] && [ -n "$c_moved" ]; then PP_MOVED_TO="$c_moved"; ok "Keeping the new address ${PP_MOVED_TO} (remove with --not-moved)"; fi
  case "$PP_LE_SET" in
    no)
      if [ -n "$c_domain" ]; then
        PP_LE_DOMAIN="$c_domain"; PP_LE_DNS="$c_dns"; PP_LE_EMAIL="$c_email"
        ok "Keeping Let's Encrypt for ${PP_LE_DOMAIN} (remove with --no-letsencrypt)"
      fi ;;
    yes)
      # Same domain again: the DNS provider and e-mail may be left out
      if [ "$PP_LE_DOMAIN" = "$c_domain" ]; then
        [ -n "$PP_LE_DNS" ] || PP_LE_DNS="$c_dns"
        [ -n "$PP_LE_EMAIL" ] || PP_LE_EMAIL="$c_email"
      fi ;;
  esac
  return 0
}

do_install() {
  check_system
  keep_settings
  le_check_options
  if port_in_use && [ ! -f "$PP_SITE" ]; then
    warn "Port ${PP_PORT} is already in use. If you run into problems, choose another one with --port."
  fi
  install_nginx
  ensure_cert
  ensure_le
  say "Writing web files to ${PP_WWW}"
  local tmp
  tmp="$(mktemp -d)"
  write_files "$tmp"
  mkdir -p "$PP_ROOT"
  rm -rf "${PP_WWW}.new"
  mv "$tmp" "${PP_WWW}.new"
  rm -rf "$PP_WWW"
  mv "${PP_WWW}.new" "$PP_WWW"
  echo "$PP_VERSION" > "${PP_ROOT}/VERSION"
  write_site_json
  # A copy of this script for later runs (renewal by hand, changing options)
  if [ -f "$0" ] && [ "$(readlink -f "$0")" != "$PP_SELF" ]; then install -m 755 "$0" "$PP_SELF"; fi
  chown -R root:root "$PP_ROOT"
  find "$PP_WWW" -type d -exec chmod 755 {} +
  find "$PP_WWW" -type f -exec chmod 644 {} +
  ok "$(find "$PP_WWW" -type f | wc -l) files installed"
  write_site
  save_settings
  open_firewall
  local ips main
  ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -3 || true)"
  main="$(main_url)"
  echo
  local scheme="http"
  [ "$PP_TLS" = "yes" ] && scheme="https"
  say "PacketPilot ${PP_VERSION} is ready:"
  if [ -n "$main" ]; then
    echo "      ${main}"
    echo "    Also reachable by IP address (self-signed certificate there):"
  fi
  if [ -n "$ips" ]; then
    for ip in $ips; do echo "      ${scheme}://${ip}:${PP_PORT}/"; done
  else
    echo "      ${scheme}://<IP-of-this-server>:${PP_PORT}/"
  fi
  echo
  if [ "$PP_TLS" = "yes" ]; then
    if [ -n "$main" ]; then
      echo "    ${PP_LE_DOMAIN} has a certificate from Let's Encrypt, browsers trust it without a"
      echo "    warning. The domain must point to this server in DNS. Opened by IP address, the"
      echo "    app offers to move the progress saved there to ${PP_LE_DOMAIN}."
    else
      echo "    The certificate is self-signed, so the browser warns once. Compare the fingerprint"
      echo "    before you accept it:"
      echo "      $(openssl x509 -in "$PP_CERT" -noout -fingerprint -sha256 | cut -d= -f2)"
      echo "    Certificate: ${PP_CERT}"
      echo "    A trusted certificate for a domain: --letsencrypt <domain> --dns <provider> (see --help)"
    fi
    echo
  fi
  echo "    Progress and own networks are stored in each browser and survive updates."
  [ "$PP_TLS" = "yes" ] && echo "    Opened with http://, the old address hands its progress over to https:// once."
  echo "    Update: sudo bash ${PP_SELF} --update. Remove: --uninstall"
}

do_update() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  local tmp new
  tmp="$(mktemp)"
  say "Downloading the latest version from github.com/${PP_REPO}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$PP_SCRIPT_URL" -o "$tmp" || die "Download failed: ${PP_SCRIPT_URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$PP_SCRIPT_URL" || die "Download failed: ${PP_SCRIPT_URL}"
  else
    die "Neither curl nor wget found. Install with: apt install curl"
  fi
  bash -n "$tmp" || die "The downloaded script is broken, aborting."
  new="$(sed -n 's/^PP_VERSION="\(.*\)"$/\1/p' "$tmp" | head -1)"
  [ -n "$new" ] || die "The downloaded script does not look like PacketPilot."
  say "Installed: $(cat "${PP_ROOT}/VERSION" 2>/dev/null || echo none), available: ${new}"
  local args=()
  [ "$PP_PORT_SET" = "yes" ] && args+=(--port "$PP_PORT")
  [ "$PP_FORCE" = "yes" ] && args+=(--force)
  [ "$PP_TLS_SET" = "yes" ] && { [ "$PP_TLS" = "yes" ] && args+=(--https) || args+=(--http); }
  [ "$PP_NEW_CERT" = "yes" ] && args+=(--new-cert)
  [ "$PP_LE_SET" = "yes" ] && args+=(--letsencrypt "$PP_LE_DOMAIN")
  [ "$PP_LE_SET" = "off" ] && args+=(--no-letsencrypt)
  [ -n "$PP_LE_DNS" ] && args+=(--dns "$PP_LE_DNS")
  [ -n "$PP_LE_EMAIL" ] && args+=(--email "$PP_LE_EMAIL")
  exec bash "$tmp" "${args[@]}"
}

do_uninstall() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  say "Removing PacketPilot"
  remove_renewal
  rm -f "$PP_LINK" "$PP_SITE"
  rm -rf "$PP_ROOT"
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then systemctl reload nginx || true; fi
  ok "PacketPilot removed. nginx itself stays installed (remove with: apt purge nginx)."
}

do_extract() {
  [ -n "$PP_EXTRACT_DIR" ] || die "Specify a target folder: --extract ./web"
  mkdir -p "$PP_EXTRACT_DIR"
  write_files "$PP_EXTRACT_DIR"
  ok "Web files extracted to ${PP_EXTRACT_DIR}. Test e.g. with: python3 -m http.server -d ${PP_EXTRACT_DIR} 8080"
}

case "$PP_ACTION" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  extract)   do_extract ;;
esac
