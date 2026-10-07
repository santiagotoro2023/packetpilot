# @@APP_NAME@@ as a container: the app server (Node.js) serves the web app and the API
# and keeps all data in PostgreSQL. The container itself holds no data: any number
# of replicas, no volume.
#
#   docker build -t @@APP_ID@@ .
#   docker compose up -d          the app with a PostgreSQL database, see docker-compose.yml
#
# Settings (environment variables):
#   @@APP_ENV@@_DATABASE_URL   postgres://user:password@host:5432/@@APP_ID@@ (required)
#   @@APP_ENV@@_CANONICAL      the public address, e.g. https://@@APP_ID@@.example.com
#   @@APP_ENV@@_PORT           port inside the container, default 8080
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.title="@@APP_NAME@@" \
      org.opencontainers.image.description="@@APP_DESCRIPTION@@" \
      org.opencontainers.image.source="https://github.com/@@APP_REPO@@" \
      org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production \
    @@APP_ENV@@_VERSION="${VERSION}" \
    @@APP_ENV@@_PORT=8080 \
    @@APP_ENV@@_WEB_DIR=/app/web \
    @@APP_ENV@@_CANONICAL=""

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY src/ ./web/
RUN rm -f web/site.json web/package.json && chmod -R a+rX /app
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server/main.mjs"]
