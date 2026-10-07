#!/bin/sh
# Runs before nginx starts: writes site.json (version and public address) into /tmp,
# so the image works with a read-only root file system.
set -eu
dir=/tmp/packetpilot
mkdir -p "$dir"
port="${PACKETPILOT_PORT:-8080}"
echo "listen ${port};" > "$dir/listen.conf"
# IPv6 only where the kernel has it: some clusters and Docker networks do not
if [ -f /proc/net/if_inet6 ] && [ -s /proc/net/if_inet6 ]; then echo "listen [::]:${port};" >> "$dir/listen.conf"; fi
canonical="${PACKETPILOT_CANONICAL:-}"
canonical="${canonical%/}"
if [ -n "$canonical" ] && ! printf '%s' "$canonical" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
  echo "packetpilot: ignoring PACKETPILOT_CANONICAL='$canonical' (expected e.g. https://packetpilot.example.com, without a path)" >&2
  canonical=""
fi
if [ -n "$canonical" ]; then
  printf '{ "version": "%s", "canonical": "%s" }\n' "${PACKETPILOT_VERSION:-dev}" "$canonical" > "$dir/site.json"
else
  printf '{ "version": "%s" }\n' "${PACKETPILOT_VERSION:-dev}" > "$dir/site.json"
fi
echo "packetpilot: version ${PACKETPILOT_VERSION:-dev}${canonical:+, public address $canonical}"
