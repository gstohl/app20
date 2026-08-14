#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${QUIETLINE_DEVNET_CONTAINER:-quietline-devnet}"
IMAGE="${QUIETLINE_DEVNET_IMAGE:-docker.io/shardlabs/starknet-devnet-rs:latest}"
PORT="${QUIETLINE_DEVNET_PORT:-5050}"
RPC_URL="http://127.0.0.1:${PORT}"

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
    echo "Quietline devnet stopped."
  else
    echo "Quietline devnet is not running."
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
  --publish "${PORT}:5050" \
  "${IMAGE}" \
  --port 5050 \
  --seed 0 >/dev/null

for _attempt in $(seq 1 60); do
  if rpc_ready 2>/dev/null; then
    echo "Quietline devnet ready at ${RPC_URL}."
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
