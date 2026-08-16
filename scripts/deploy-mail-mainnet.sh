#!/usr/bin/env bash
# Declare and deploy QuietlineMail to Starknet mainnet.
# Default is a dry run. Real txs require --broadcast and I_UNDERSTAND_MAINNET=1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAIRO="$ROOT/cairo"
POOL="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
RPC="${QUIETLINE_MAINNET_RPC:-https://rpc.starknet.lava.build}"
ACCOUNT="${SNCAST_ACCOUNT:-quietline-deployer}"
CONTRACT_NAME="QuietlineMail"
BROADCAST=0
RUN_TESTS=0

usage() {
  cat <<EOF
Deploy QuietlineMail to SN_MAIN.

Usage:
  npm run deploy:helper:mainnet -- [options]
  bash scripts/deploy-mail-mainnet.sh [options]

Options:
  --account NAME     sncast account (default: $ACCOUNT, or SNCAST_ACCOUNT)
  --broadcast        send the declare + deploy txs (otherwise dry-run only)
  --test             run snforge test before declaring
  -h, --help         show this help

Environment:
  I_UNDERSTAND_MAINNET=1   required with --broadcast
  QUIETLINE_MAINNET_RPC    RPC URL (default: $RPC)
  SNCAST_ACCOUNT           account name override

This never deploys QuietlineEscrow. Constructor calldata is locked to the
canonical mainnet STRK20 pool and cannot be changed from the CLI.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account)
      ACCOUNT="${2:?--account needs a name}"
      shift 2
      ;;
    --broadcast)
      BROADCAST=1
      shift
      ;;
    --test)
      RUN_TESTS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

sncast_json() {
  # sncast prints warnings on stdout; keep only the JSON object.
  local out
  out="$(sncast --json --account "$ACCOUNT" --url "$RPC" "$@" 2>&1)" || {
    printf '%s\n' "$out" >&2
    return 1
  }
  printf '%s\n' "$out" | python3 -c '
import json, re, sys
text = sys.stdin.read()
match = re.search(r"\{.*\}", text, re.S)
if not match:
    sys.stderr.write(text)
    sys.exit(1)
print(match.group(0))
'
}

extract() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1],""))' "$1"
}

felt_eq() {
  python3 -c 'import sys; sys.exit(0 if int(sys.argv[1],0)==int(sys.argv[2],0) else 1)' "$1" "$2"
}

write_env_helper() {
  local helper="$1"
  local env_file="$ROOT/.env.local"
  if [[ ! -f "$env_file" ]]; then
    cp "$ROOT/.env.example" "$env_file"
  fi
  python3 - "$env_file" "$helper" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
helper = sys.argv[2]
text = path.read_text() if path.exists() else ""
lines = text.splitlines()
found = False
out = []
for line in lines:
    if line.startswith("VITE_MAIL_HELPER_MAINNET="):
        out.append(f"VITE_MAIL_HELPER_MAINNET={helper}")
        found = True
    else:
        out.append(line)
if not found:
    if out and out[-1] != "":
        out.append("")
    out.append(f"VITE_MAIL_HELPER_MAINNET={helper}")
path.write_text("\n".join(out) + "\n")
PY
}

need sncast
need scarb
need python3

echo "QuietlineMail mainnet deploy"
echo "  network     SN_MAIN"
echo "  pool        $POOL"
echo "  rpc         $RPC"
echo "  account     $ACCOUNT"
echo "  contract    $CONTRACT_NAME"
echo "  mode        $([[ $BROADCAST -eq 1 ]] && echo BROADCAST || echo DRY-RUN)"
echo

if [[ $BROADCAST -eq 1 && "${I_UNDERSTAND_MAINNET:-}" != "1" ]]; then
  echo "Refusing --broadcast without I_UNDERSTAND_MAINNET=1." >&2
  echo "This spends public STRK on mainnet declare + deploy." >&2
  exit 1
fi

echo "==> Building Cairo artifacts"
(cd "$CAIRO" && scarb build)

if [[ $RUN_TESTS -eq 1 ]]; then
  echo "==> Running snforge test"
  (cd "$CAIRO" && snforge test)
fi

SIERRA="$CAIRO/target/dev/quietline_mail_QuietlineMail.contract_class.json"
CASM="$CAIRO/target/dev/quietline_mail_QuietlineMail.compiled_contract_class.json"
[[ -f "$SIERRA" && -f "$CASM" ]] || {
  echo "Missing built artifacts:" >&2
  echo "  $SIERRA" >&2
  echo "  $CASM" >&2
  exit 1
}

if [[ $BROADCAST -eq 0 ]]; then
  echo "==> Dry-run declare"
  sncast --account "$ACCOUNT" --url "$RPC" declare \
    --contract-name "$CONTRACT_NAME" --dry-run
  echo
  echo "==> Dry-run deploy"
  sncast --account "$ACCOUNT" --url "$RPC" deploy \
    --contract-name "$CONTRACT_NAME" \
    --constructor-calldata "$POOL" \
    --dry-run
  echo
  echo "Dry run finished. No mainnet transaction was sent."
  echo "To broadcast:"
  echo "  I_UNDERSTAND_MAINNET=1 npm run deploy:helper:mainnet -- --account $ACCOUNT --broadcast"
  exit 0
fi

echo "==> Declaring $CONTRACT_NAME"
declare_json="$(sncast_json declare --contract-name "$CONTRACT_NAME")" || {
  echo "Declare failed. If sncast said the class already exists, re-run with the printed class hash via:" >&2
  echo "  sncast --account $ACCOUNT --url $RPC deploy --class-hash <HASH> --constructor-calldata $POOL" >&2
  exit 1
}
echo "$declare_json"
class_hash="$(printf '%s' "$declare_json" | extract class_hash)"
declare_hash="$(printf '%s' "$declare_json" | extract transaction_hash)"
if [[ -z "$class_hash" ]]; then
  class_hash="$(printf '%s' "$declare_json" | extract classHash)"
fi
if [[ -z "$class_hash" ]]; then
  echo "Could not read class_hash from declare output." >&2
  echo "$declare_json" >&2
  exit 1
fi

echo "==> Deploying with locked pool constructor"
deploy_json="$(sncast_json deploy \
  --class-hash "$class_hash" \
  --constructor-calldata "$POOL")" || exit 1
echo "$deploy_json"
helper="$(printf '%s' "$deploy_json" | extract contract_address)"
deploy_hash="$(printf '%s' "$deploy_json" | extract transaction_hash)"
if [[ -z "$helper" ]]; then
  helper="$(printf '%s' "$deploy_json" | extract address)"
fi
if [[ -z "$helper" ]]; then
  echo "Could not read contract address from deploy output." >&2
  echo "$deploy_json" >&2
  exit 1
fi

echo "==> Verifying message_count"
count_json="$(sncast --json --url "$RPC" call \
  --contract-address "$helper" \
  --function message_count 2>&1)" || {
  echo "$count_json" >&2
  echo "Deployed, but the read-back failed. Check Voyager before using the address." >&2
  exit 1
}
echo "$count_json"

write_env_helper "$helper"

cat <<EOF

Deployed QuietlineMail
  class hash     $class_hash
  declare tx     ${declare_hash:-unknown}
  helper         $helper
  deploy tx      ${deploy_hash:-unknown}
  voyager class  https://voyager.online/class/$class_hash
  voyager helper https://voyager.online/contract/$helper
  ${declare_hash:+voyager declare https://voyager.online/tx/$declare_hash}
  ${deploy_hash:+voyager deploy  https://voyager.online/tx/$deploy_hash}

Wrote VITE_MAIL_HELPER_MAINNET=$helper into .env.local (gitignored).
Restart npm run dev so Vite picks it up.

Confirm on Voyager that the deploy constructor argument equals:
  $POOL
Do not call privacy_invoke from this deployer. It will revert BAD_POOL.
EOF
