#!/usr/bin/env bash
# Start / stop the content-addressed trust store.
#
# The store is UOR-Foundation/kappa-registry, an OCI-style /v2/ registry with
# verify-on-write blobs and signed namespace roots. It listens on
# 127.0.0.1:8080 and stores under ./trust-store/data.
#
# Bring-up, in order of preference:
#   1. an already-built release binary (instant);
#   2. a local cargo build from source (needs Rust);
#   3. a self-contained Docker image built from trust-store/Dockerfile.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${ROOT}/trust-store/data"
SRC="${ROOT}/trust-store/kappa-registry"
BIN="${SRC}/target/release/kappa-registry"
URL="http://127.0.0.1:8080"
REPO="https://github.com/UOR-Foundation/kappa-registry"
PIDFILE="${ROOT}/trust-store/store.pid"

# Make a rustup-installed cargo visible under non-login shells (CI, hooks).
[ -f "${HOME}/.cargo/env" ] && . "${HOME}/.cargo/env"
export PATH="${HOME}/.cargo/bin:${PATH}"

ready() { curl -fs -o /dev/null "${URL}/v2/_health/ready" 2>/dev/null; }
wait_ready() { for _ in $(seq 1 90); do ready && return 0; sleep 1; done; return 1; }

run_binary() {
  echo "launching trust store..."
  mkdir -p "${DATA}"
  ( cd "${ROOT}/trust-store" \
    && KAPPA_STORE_ROOT="${DATA}" KAPPA_LISTEN_ADDR=127.0.0.1:8080 \
       "${BIN}" >"${ROOT}/trust-store/store.log" 2>&1 & echo $! >"${PIDFILE}" )
}

build_from_source() {
  if [ ! -d "${SRC}" ]; then
    echo "cloning kappa-registry..."
    git clone --depth 1 "${REPO}" "${SRC}"
  fi
  echo "building trust store from source (first run compiles; then it is cached)..."
  ( cd "${SRC}" && cargo build --release >/dev/null 2>&1 )
}

start() {
  if ready; then echo "trust store already up at ${URL}"; return 0; fi

  if [ -x "${BIN}" ]; then
    run_binary
  elif command -v cargo >/dev/null 2>&1; then
    build_from_source
    run_binary
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "no Rust toolchain; building a self-contained Docker image..."
    docker rm -f pin-trust-store >/dev/null 2>&1 || true
    docker build -t pin-trust-store "${ROOT}/trust-store"
    mkdir -p "${DATA}"
    docker run -d --name pin-trust-store \
      -p 127.0.0.1:8080:8080 \
      -e KAPPA_STORE_ROOT=/data -e KAPPA_LISTEN_ADDR=0.0.0.0:8080 \
      -v "${DATA}:/data" pin-trust-store >/dev/null
  else
    echo "need a Rust toolchain (cargo) or Docker to run the trust store." >&2
    exit 1
  fi

  wait_ready && echo "trust store ready at ${URL}" || { echo "trust store did not become ready"; exit 1; }
}

stop() {
  docker rm -f pin-trust-store >/dev/null 2>&1 || true
  if [ -f "${PIDFILE}" ]; then kill "$(cat "${PIDFILE}")" 2>/dev/null || true; rm -f "${PIDFILE}"; fi
  echo "trust store stopped"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  ready) ready && echo up || { echo down; exit 1; } ;;
  *) echo "usage: trust-store.sh [start|stop|ready]"; exit 2 ;;
esac
