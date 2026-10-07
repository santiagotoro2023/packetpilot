# PacketPilot as a container: nginx without root serves the static web app.
# Everything users do is stored in their own browser, so the container is
# stateless: any number of replicas, no volume, no database.
#
#   docker build -t packetpilot .
#   docker run -d -p 8080:8080 packetpilot          then open http://localhost:8080
#
# Settings (environment variables):
#   PACKETPILOT_CANONICAL   the public address, e.g. https://packetpilot.example.com.
#                           Share links point there, and if users open PacketPilot
#                           under another address they are offered to move their data.
FROM nginxinc/nginx-unprivileged:1.27-alpine

ARG VERSION=dev
LABEL org.opencontainers.image.title="PacketPilot" \
      org.opencontainers.image.description="A network course with a packet-level lab simulator: build networks, send packets in slow motion and take every frame apart." \
      org.opencontainers.image.source="https://github.com/santiagotoro2023/packetpilot" \
      org.opencontainers.image.version="${VERSION}"

ENV PACKETPILOT_VERSION="${VERSION}" \
    PACKETPILOT_CANONICAL=""

USER root
COPY src/ /usr/share/nginx/html/
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 deploy/docker/40-packetpilot-site.sh /docker-entrypoint.d/40-packetpilot-site.sh
RUN rm -f /usr/share/nginx/html/site.json /usr/share/nginx/html/package.json \
 && chmod -R a+rX /usr/share/nginx/html
USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
