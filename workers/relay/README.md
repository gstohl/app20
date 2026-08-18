# `@app20/relay`

Cloudflare Worker control plane for APP20. It serves the reviewed SPA, verifies Privy access tokens for the **Sepolia-only** browser vault, forwards opaque OHTTP messages to fixed destinations, and exposes restricted Starknet RPC relays. It is deliberately not a general proxy.

## Routes

| Route | Purpose |
| --- | --- |
| `POST /api/privacy/bootstrap` | Verify a Privy token, enumerate that user's Starknet wallet/quorum metadata, issue a pseudonymous OHTTP cookie, and return Sepolia public configuration |
| `POST /api/ohttp/prover` | Forward bounded `message/ohttp-req` bytes to the fixed prover gateway |
| `POST /api/ohttp/discovery` | Forward bounded `message/ohttp-req` bytes to the fixed discovery gateway |
| `POST /api/starknet/sepolia` | Restricted, quota-controlled Sepolia JSON-RPC |
| `POST /api/starknet/mainnet` | Restricted, quota-controlled Mainnet JSON-RPC for the Ready rail |
| everything else | Serve the SPA through the `ASSETS` binding with strict security headers |

The Privy bootstrap is hard-coded to return `network: "sepolia"`; it cannot issue Mainnet Privy configuration. The browser receives non-routable `.invalid` OHTTP target names and same-origin relay paths, never the real gateway origins.

## Worker secrets

Configure these with `wrangler secret put NAME`; never place values in `wrangler.jsonc`, `VITE_*`, build arguments, CI cache keys, or static manifests:

```text
PRIVY_APP_ID
PRIVY_APP_SECRET
OHTTP_SESSION_SECRET
PROVER_UPSTREAM_URL
PROVER_UPSTREAM_AUTHORIZATION          # optional
DISCOVERY_UPSTREAM_URL
DISCOVERY_UPSTREAM_AUTHORIZATION       # optional
STARKNET_SEPOLIA_RPC_URL
STARKNET_SEPOLIA_AUTHORIZATION         # optional
STARKNET_MAINNET_RPC_URL
STARKNET_MAINNET_AUTHORIZATION         # optional
```

`OHTTP_SESSION_SECRET` must contain at least 32 UTF-8 bytes in production. Production upstreams must use HTTPS. Optional authorization headers are the only credentials sent upstream; all browser headers are discarded.

Public chain constants, reviewed Privy frame/connect origins, and the build-only/live Sepolia flag are ordinary Wrangler vars. Privy App ID and Client ID are also public metadata in the Vite build, but the App Secret is Worker-only.

## Distributed gate

Bind `RELAY_GATE` to `RelayGateDurableObject`. One named object serializes global/session/service rate windows and concurrency leases across isolates. Every success, error, timeout, and client disconnect releases its lease; alarms expire abandoned leases.

`TRUST_CLIENT_IP_HEADERS=true` is safe only at the direct Cloudflare edge, where `cf-connecting-ip` is overwritten by Cloudflare. Forwarded-origin headers remain disabled. The gate retains only HMAC user pseudonyms or hashed source identifiers in rate/lease dimensions, normally until two rate windows or lease expiry; do not export those dimensions to analytics.

## Local development

Local HTTP/no-Origin behavior requires all of:

```text
ENVIRONMENT=development
ALLOW_LOCAL_DEVELOPMENT=true
ALLOW_LOOPBACK_HTTP=true
```

and loopback request/upstream hostnames. Do not carry those flags into a deployed environment.

## Security properties

- fixed egress destinations only; no client-selectable URL
- strict same-origin POST checks
- bounded declared and streamed request/response bodies
- `redirect: "error"`, abort timeouts, generic no-store errors
- no request-body, token, cookie, DID, wallet ID, witness, or origin logging
- WebCrypto HMAC cookie containing only a service pseudonym and expiry
- reviewed CSP origins without wildcards
- production source-map upload disabled

OHTTP prevents this relay from reading the witness. The final gateway decrypts it and therefore remains trusted for confidentiality. Cloudflare and the relay can still observe source metadata, timing, service class, and ciphertext size.

## Validation

```bash
npm run typecheck --workspace @app20/relay
npm test --workspace @app20/relay
npm run build
npx wrangler deploy --dry-run --outdir /tmp/app20-worker-dryrun
```

Deployment is intentionally separate from validation. Nothing should be pushed or deployed until the user approves the reviewed branch and secret configuration.
