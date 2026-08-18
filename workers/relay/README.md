# Cloudflare relay Worker

A standalone Web-Standards relay for two fixed OHTTP services and fixed Starknet Sepolia/Mainnet RPC destinations. It is deliberately not a general proxy.

## Bindings

Set `PROVER_UPSTREAM_URL`, `DISCOVERY_UPSTREAM_URL`, `STARKNET_SEPOLIA_RPC_URL`, `STARKNET_MAINNET_RPC_URL`, and `OHTTP_SESSION_SECRET` as Worker secrets. Optional `*_AUTHORIZATION` secrets are the only authorization headers sent upstream. Bind `RELAY_GATE` to `RelayGateDurableObject` as shown in `wrangler.example.jsonc`. The production session secret must contain at least 32 UTF-8 bytes.

Production requires HTTPS upstreams and an exact `Origin` header. Local HTTP/no-Origin behavior requires all of `ENVIRONMENT=development`, `ALLOW_LOCAL_DEVELOPMENT=true`, a loopback request/upstream hostname, and (for HTTP upstreams) `ALLOW_LOOPBACK_HTTP=true`.

Forwarded headers are ignored by default. `TRUST_FORWARDED_ORIGIN=true` explicitly makes `x-forwarded-proto` and `x-forwarded-host` authoritative; only enable it behind infrastructure that removes client-supplied values. `TRUST_CLIENT_IP_HEADERS=true` similarly uses Cloudflare's `cf-connecting-ip` for RPC session quotas. Do not enable either mode behind an untrusted proxy.

`issueOhttpSession` is intentionally only a primitive for a future authenticated bootstrap route. This package does not verify Privy credentials.

Use `spaSecurityHeaders` when the parent app serves SPA assets. Its Privy frame/connect origin arrays reject wildcard and non-HTTPS entries and must be populated from reviewed public origin configuration.
