#!/usr/bin/env bash
# Start / stop an S3-compatible object store (MinIO) for the storage-substrate
# act. Prefers Docker; falls back to a local MinIO binary (no root needed).
# Creates the bucket the act writes to. Credentials default to minioadmin.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
BUCKET="${S3_BUCKET:-kappa-blobs}"
USER="${S3_ACCESS_KEY:-minioadmin}"
PASS="${S3_SECRET_KEY:-minioadmin}"
DATA="${ROOT}/trust-store/s3data"
PIDFILE="${ROOT}/trust-store/minio.pid"
MC="${ROOT}/trust-store/bin/mc"

up() { curl -fs -o /dev/null "${ENDPOINT}/minio/health/ready" 2>/dev/null; }
wait_up() { for _ in $(seq 1 40); do up && return 0; sleep 0.5; done; return 1; }

find_bin() {
  for cand in "$1" "${ROOT}/trust-store/bin/$1" "${HOME}/$1" "$(command -v "$1" 2>/dev/null || true)"; do
    [ -n "${cand:-}" ] && [ -x "$cand" ] && { echo "$cand"; return 0; }
  done
  return 1
}

ensure_mc() {
  MC="$(find_bin mc || true)"
  if [ -z "${MC:-}" ]; then
    mkdir -p "${ROOT}/trust-store/bin"
    curl -sSL -o "${ROOT}/trust-store/bin/mc" https://dl.min.io/client/mc/release/linux-amd64/mc
    chmod +x "${ROOT}/trust-store/bin/mc"; MC="${ROOT}/trust-store/bin/mc"
  fi
  "$MC" alias set pin "${ENDPOINT}" "${USER}" "${PASS}" >/dev/null 2>&1
  "$MC" mb -p "pin/${BUCKET}" >/dev/null 2>&1 || true
}

start() {
  if up; then echo "s3 store already up at ${ENDPOINT}"; ensure_mc; return 0; fi
  mkdir -p "${DATA}"

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "starting MinIO via Docker..."
    docker rm -f pin-s3 >/dev/null 2>&1 || true
    docker run -d --name pin-s3 -p 127.0.0.1:9000:9000 \
      -e MINIO_ROOT_USER="${USER}" -e MINIO_ROOT_PASSWORD="${PASS}" \
      -v "${DATA}:/data" minio/minio server /data >/dev/null
  else
    local bin; bin="$(find_bin minio || true)"
    if [ -z "${bin:-}" ]; then
      echo "no Docker and no MinIO binary; downloading MinIO..."
      mkdir -p "${ROOT}/trust-store/bin"
      curl -sSL -o "${ROOT}/trust-store/bin/minio" https://dl.min.io/server/minio/release/linux-amd64/minio
      chmod +x "${ROOT}/trust-store/bin/minio"; bin="${ROOT}/trust-store/bin/minio"
    fi
    echo "starting MinIO binary..."
    MINIO_ROOT_USER="${USER}" MINIO_ROOT_PASSWORD="${PASS}" \
      "$bin" server "${DATA}" --address 127.0.0.1:9000 >"${ROOT}/trust-store/minio.log" 2>&1 &
    echo $! >"${PIDFILE}"
  fi

  wait_up || { echo "MinIO did not become ready"; exit 1; }
  ensure_mc
  echo "s3 store ready at ${ENDPOINT} (bucket ${BUCKET})"
}

stop() {
  docker rm -f pin-s3 >/dev/null 2>&1 || true
  if [ -f "${PIDFILE}" ]; then kill "$(cat "${PIDFILE}")" 2>/dev/null || true; rm -f "${PIDFILE}"; fi
  echo "s3 store stopped"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  ready) up && echo up || { echo down; exit 1; } ;;
  *) echo "usage: s3-store.sh [start|stop|ready]"; exit 2 ;;
esac
