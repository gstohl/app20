# VLT20 architecture

VLT20 unifies two browser-owned privacy surfaces:

- **Privacy Vault** — public and shielded STRK balances, account recovery, shield, private transfer, and unshield.
- **Privacy Mail Vault** — Quietline end-to-end encrypted mail, private-payment memos, invoices, and offers.

The product shell is VLT20. Existing `quietline/*` browser storage keys, mail cryptographic domains, viewing-key derivation domains, Starknet account derivation, and deployed contract names remain unchanged for recovery compatibility.

## Network and wallet policy

| Network | Ready Wallet Standard | Privy browser signer | Development wallet |
| --- | --- | --- | --- |
| Mainnet | Allowed | Blocked | Blocked |
| Sepolia | Allowed | Allowed | Blocked |
| Localnet | Blocked | Blocked | Build-gated only |

This policy is enforced below React before an adapter can sign, discover, prove, or submit. Mainnet Privy bootstrap must also fail server-side. Ready identification uses the Wallet Standard feature identifier rather than a display name, but remains a product-routing policy rather than cryptographic brand attestation.

## Deployment topology

```text
VLT20 browser SPA
  |-- static assets --------------------------> Cloudflare Worker/Assets
  |-- public bootstrap -----------------------> Cloudflare Worker
  |-- restricted Starknet JSON-RPC ----------> Cloudflare Worker --> RPC
  `-- OHTTP ciphertext -----------------------> Cloudflare Worker --> OHTTP gateway --> prover/discovery
```

Cloudflare hosts the reviewed static application, same-origin control plane, blind OHTTP relay, restricted RPC relay, and distributed quota gate. The transaction prover and discovery service require external container infrastructure; they do not run inside a Worker.

The browser receives only same-origin relay URLs, public chain configuration, and independently reviewed public OHTTP HPKE key configurations. The real RPC, prover, and discovery origins and all upstream authorization remain Worker secrets. The encrypted Binary HTTP target uses a non-routable `.invalid` name so the real gateway hostname is not required in browser state.

## Privacy boundaries

| Component | Can observe | Must not receive |
| --- | --- | --- |
| Browser | Wallet metadata, mail key, viewing key, notes, plaintext mail, witnesses | App secrets and upstream credentials |
| Privy | User identity and hashes requested for signing | Quietline plaintext or proving witness from VLT20 |
| VLT20 bootstrap | Authenticated identity and public wallet/quorum metadata | Viewing keys, notes, mail plaintext, witness |
| Cloudflare OHTTP relay | Source metadata, service class, timing, ciphertext length | OHTTP plaintext, viewing key, witness |
| Discovery gateway | Decrypted discovery request | Privy token, cookie, DID, relay pseudonym |
| Prover gateway | Decrypted proving witness and public transaction metadata | Privy token, cookie, DID, relay pseudonym |
| Starknet | Public boundaries, proof, commitments, ciphertext/helper activity | Private-transfer details and mail plaintext |

OHTTP separates the authenticated relay from the final gateway. It does not make the remote prover blind. The final prover sees the plaintext witness after decapsulation, while Quietline message content is separately encrypted end-to-end before it enters that witness. A compromised frontend delivery origin can still replace JavaScript and defeat browser-side privacy.

## Package boundaries

```text
packages/strk20-privy       Browser signer, Starknet account, discovery/proving, Node integrations
packages/privacy-adapters   Canonical intents, fail-closed network policy, Ready/Privy adapters
packages/mail-core          Quietline envelope, crypto, scanning, and legacy storage compatibility
workers/relay               Cloudflare Worker OHTTP/RPC relay and distributed quota gate
```

Browser imports must use explicit browser entry points. Node administration and proxy code must never be reachable from the SPA dependency graph.

## Confidential configuration

The following are runtime secrets, never `VITE_*`, Wrangler plain vars, build arguments, static manifests, source maps, or CI cache keys:

- Privy App Secret and authorization private keys
- real prover and discovery origins
- upstream bearer authorization
- RPC credentials
- OHTTP session-HMAC secret
- OHTTP gateway private key

OHTTP public key configurations, Privy App ID/Client ID, pool addresses, token addresses, account class hashes, and chain IDs are public metadata.

## Release gates

1. Clean-checkout, lockfile-only builds on Node.js 24 or newer.
2. Unit, browser, real-pool harness, Worker integration, and network-policy tests pass.
3. Production bundle contains no localnet wallet sentinel, Node server package, source map, private hostname, credential, or secret canary.
4. Mainnet + Privy and Mainnet + non-Ready Wallet Standard paths fail before any prompt or network request.
5. OHTTP canary reaches the gateway as plaintext while the relay sees ciphertext only; no identity metadata reaches the gateway.
6. Worker quotas remain atomic across isolates, disconnects, errors, and timeouts.
7. Mainnet financial actions require a separate human Ready-wallet release gate. Nothing is pushed or deployed until explicitly approved.
