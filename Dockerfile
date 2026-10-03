# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS web
WORKDIR /src/apps/desktop
COPY apps/desktop/package.json apps/desktop/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY apps/desktop/index.html apps/desktop/tsconfig.json apps/desktop/tsconfig.node.json apps/desktop/vite.config.ts ./
COPY apps/desktop/plugins/ plugins/
COPY LICENSE UPSTREAM.md /src/
COPY apps/desktop/src/ src/
RUN npm run build

FROM rust:1-bookworm AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY server/ server/
COPY apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.toml
COPY apps/desktop/src-tauri/build.rs apps/desktop/src-tauri/build.rs
COPY apps/desktop/src-tauri/src/ apps/desktop/src-tauri/src/
COPY apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/capabilities/
COPY apps/desktop/src-tauri/icons/ apps/desktop/src-tauri/icons/
COPY apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/tauri.conf.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --package workbuddy-server --bin workbuddy-server && \
    cp target/release/workbuddy-server /tmp/workbuddy-server

FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* && \
    useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin workbuddy-byok && \
    mkdir -p /app/console /data && \
    chown workbuddy-byok:workbuddy-byok /data

COPY --from=server /tmp/workbuddy-server /usr/local/bin/workbuddy-server
COPY --from=web /src/apps/desktop/dist/ /app/console/

ENV WORKBUDDY_LISTEN_ADDR=0.0.0.0:3721 \
    WORKBUDDY_DATA_DIR=/data \
    WORKBUDDY_DATABASE_URL=sqlite:///data/workbuddy-byok.db \
    WORKBUDDY_MODELS_PATH=/data/workbuddy/models.json \
    WORKBUDDY_CONSOLE_DIR=/app/console \
    RUST_LOG=workbuddy_server=info

USER workbuddy-byok
EXPOSE 3721
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
    CMD curl --fail --silent http://127.0.0.1:3721/__byok-api__/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/workbuddy-server"]
