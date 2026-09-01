#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${APP20_DEVNET_CONTAINER:-app20-devnet}"
IMAGE="${APP20_DEVNET_IMAGE:-docker.io/shardlabs/starknet-devnet-rs@sha256:2733f463816b4028a77e33cea2f55fbbdeb36dcacb4331d886d921361bd07bcf}"
PORT="${APP20_DEVNET_PORT:-5050}"
RPC_URL="http://127.0.0.1:${PORT}"
STARTED_CONTAINER=false

cleanup_failed_start() {
  local status=$?
  if [[ ${status} -ne 0 && "${STARTED_CONTAINER}" == "true" ]]; then
    docker rm --force "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_failed_start EXIT

rpc_ready() {
  curl --fail --silent --show-error \
    --header "content-type: application/json" \
    --data '{"jsonrpc":"2.0","id":1,"method":"starknet_chainId","params":[]}' \
    "${RPC_URL}/rpc" | grep --quiet '"result"'
}

stop_devnet() {
  if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
    docker stop --time 10 "${CONTAINER_NAME}" >/dev/null || true
    docker rm "${CONTAINER_NAME}" >/dev/null || true
    echo "APP20 devnet stopped."
  else
    echo "APP20 devnet is not running."
  fi
}

if [[ "${1:-start}" == "stop" ]]; then
  stop_devnet
  exit 0
fi

if [[ "${1:-start}" != "start" ]]; then
  echo "Usage: $0 [start|stop]" >&2
  exit 2
fi

if rpc_ready 2>/dev/null; then
  echo "Devnet already ready at ${RPC_URL}."
  exit 0
fi

if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  docker rm --force "${CONTAINER_NAME}" >/dev/null
fi

echo "Starting ${IMAGE} on ${RPC_URL}..."
docker run --detach \
  --name "${CONTAINER_NAME}" \
  --publish "127.0.0.1:${PORT}:5050" \
  "${IMAGE}" \
  --port 5050 \
  --seed 0 >/dev/null
STARTED_CONTAINER=true

for _attempt in $(seq 1 60); do
  if rpc_ready 2>/dev/null; then
    STARTED_CONTAINER=false
    echo "APP20 devnet ready at ${RPC_URL}."
    exit 0
  fi
  if ! docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
    echo "Devnet container exited during startup." >&2
    exit 1
  fi
  sleep 1
done

echo "Devnet did not become ready within 60 seconds." >&2
docker logs "${CONTAINER_NAME}" >&2 || true
exit 1
