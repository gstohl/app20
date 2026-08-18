# STRK20 prover API contract

`@app20/privy` connects to the same JSON-RPC surface expected by the official Starknet Privacy SDK. A future self-hosted Sepolia prover can replace the mock without changing application calls.

## Transport

- HTTP `POST` to the configured base URL
- `Content-Type: application/json`
- JSON-RPC 2.0
- Protect the endpoint at a private gateway (mTLS, VPN, or authenticated reverse proxy)
- Do not expose an unrestricted prover directly to the public internet

The SDK also supports OHTTP when configured through `serviceProver({ ohttp: ... })`.

## `starknet_specVersion`

Health/capability request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "starknet_specVersion",
  "params": []
}
```

Successful response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0.10.1"
}
```

## `starknet_proveTransaction`

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "starknet_proveTransaction",
  "params": {
    "block_id": { "block_number": 123456 },
    "transaction": {
      "type": "INVOKE",
      "version": "0x3",
      "sender_address": "0x...",
      "calldata": [],
      "signature": [],
      "nonce": "0x...",
      "resource_bounds": {},
      "tip": "0x0",
      "paymaster_data": [],
      "account_deployment_data": [],
      "nonce_data_availability_mode": "L1",
      "fee_data_availability_mode": "L1"
    }
  }
}
```

The exact transaction fields are generated and signed by the official Privacy SDK. The application must forward them without rewriting their felt values.

Successful response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "proof": "<base64 Stwo proof>",
    "proof_facts": ["0x..."],
    "l2_to_l1_messages": [
      {
        "from_address": "0x<privacy-pool>",
        "to_address": "0x0",
        "payload": ["0x<pool-class-hash>", "0x<serialized-action>"]
      }
    ]
  }
}
```

For a screened deposit, the response can additionally contain:

```json
{
  "additional_data": {
    "signature": {
      "issued_at": 1730000000,
      "sig_r": "0x...",
      "sig_s": "0x..."
    }
  }
}
```

The first matching L2-to-L1 payload element is the pool class hash. The Privacy SDK removes it and uses the rest to construct the pool's `apply_actions` call.

## Error responses

Return normal JSON-RPC errors:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32005,
    "message": "Service busy",
    "data": "retry later"
  }
}
```

Codes currently recognized by the official SDK include:

| Code | Meaning |
| ---: | --- |
| `24` | block not found |
| `55` | account validation failed |
| `61` | unsupported transaction version |
| `1000` | invalid transaction input |
| `-32005` | service busy; retryable |
| `-32603` | internal prover error |
| `10000` | interceptor/screening rejection |

HTTP `503` is also treated as transient and retried by the plain HTTP transport.

## Required proof implementation

A service intended for public Sepolia or Mainnet submission must run the official STRK20 transaction-prover/Stwo path compatible with Starknet's `VIRTUAL_SNOS` verification. Returning fabricated proof facts or a placeholder proof is not sufficient.

Current official image family:

```text
ghcr.io/starkware-libs/starknet-privacy/transaction-prover:<matching privacy release>
```

Pin the prover, SDK, pool contract, and discovery service to mutually compatible releases. Do not silently use `latest` in production.

## Safe mock policy

A mock endpoint can implement the same response shape for request/response integration tests, but configure it as:

```ts
serviceProver({
  url: "http://127.0.0.1:8787",
  submittable: false,
});
```

This makes every result build-only. Never label a mock endpoint as submittable, even when it returns realistic proof facts.

## Readiness checklist

Before changing from `mockProver()` to a testnet service:

1. Confirm `starknet_specVersion` succeeds.
2. Confirm the prover release matches the SDK and Sepolia pool.
3. Confirm it uses the intended Starknet RPC and chain ID.
4. Confirm proof requests use a base block at least ten blocks behind the tip.
5. Confirm screening is available for deposits.
6. Put authentication, request limits, timeouts, and concurrency limits in front of it.
7. Run a tiny Sepolia register/shield transaction and independently verify the receipt.
8. Only then mark the source `submittable: true`.
