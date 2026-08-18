# Browser-owned privacy architecture

The demo's active privacy path is browser-owned. The application backend must not receive plaintext viewing keys, discovered notes, private transfer inputs, witnesses, or proving requests.

## Components and trust boundaries

| Component | May observe | Must not receive |
| --- | --- | --- |
| Browser | Privy wallet metadata, viewing key, notes, private inputs, witness, proof response, public RPC data | App secrets, backend authorization keys, upstream credentials |
| Privy | User/wallet identity and hashes requested for signing | STRK20 notes or witnesses from this application |
| Auth/bootstrap endpoint | Privy user identity, app-scoped wallet/quorum metadata, network, OHTTP initialization time | Viewing key, notes, amounts, recipients, witness, proof request |
| Blind OHTTP relay | Pseudonymous short-lived session, destination class (prover or discovery), timing, ciphertext length | OHTTP plaintext, viewing key, notes, private inputs, witness |
| Discovery gateway | Decrypted discovery request, including viewing key and account address | Privy access token or application user identity |
| Proving gateway | Decrypted witness/proving request | Privy access token or application user identity |
| Starknet RPC relay | Public chain reads and submitted public transaction data | Privy access token, viewing key, notes, witness |
| Starknet | Public shield/unshield boundary data, account activity, proof and encrypted/private-transfer call data | Private-transfer amount and recipient |

A remote prover necessarily receives the plaintext witness after OHTTP decapsulation. Hiding the witness from the prover requires local proving or a separately trusted execution environment. OHTTP provides knowledge separation between the authenticated application relay and the final gateway; it does not make the prover blind.

## Browser signing

The dashboard indexes every Starknet wallet attributed to the authenticated user under the configured Privy App ID. It exposes only quorum counts and capability flags, then enables browser actions when the current user signature can satisfy the threshold. Browser code uses `useSignRawHash` from `@privy-io/react-auth/extended-chains` with `chainType: "starknet"`. The returned 64-byte signature is verified against the wallet public key and split into `r` and `s` for `starknet.js`.

The shared backend P-256 key is never used by this path and must not reach the browser. A legacy threshold-1 user/server wallet can be selected for user-authorized recovery, but the dashboard warns that its old application key may still sign independently. Funds should be recovered before that key is revoked.

The deterministic viewing key is derived through the browser signer and held only in browser memory. Private scans are explicit and per account; the dashboard does not automatically sign for or decrypt every indexed wallet. Privy, as the wallet custodian performing the raw signature, remains in the trust model and may be able to reproduce or infer deterministic signature-derived material.

Wallet discovery is App-ID scoped. The dashboard can replace a failed frontend for the same Privy application, but true app-independent recovery requires a previously exported key or a supported cross-app arrangement. Privy's isolated export modal does not disclose the exported key to this application.

## OHTTP flow

1. The browser authenticates once to the bootstrap endpoint with its Privy access token.
2. The backend verifies the token, returns non-key public runtime configuration, and issues a short-lived HttpOnly, SameSite session cookie scoped to `/api/ohttp`. OHTTP public-key configurations are obtained independently and pinned into the reviewed browser build.
3. The browser privacy SDK encapsulates discovery and proving HTTP messages locally.
4. `/api/ohttp/discovery` and `/api/ohttp/prover` validate the short-lived cookie, enforce opaque request limits, and forward the `message/ohttp-req` body byte-for-byte.
5. The relay returns the `message/ohttp-res` body byte-for-byte. Decryption happens in the browser.

The session cookie contains a service-local pseudonym and expiry protected by an HMAC. It does not contain a Privy token or DID. Production replicas require a shared/distributed quota store; the demo's process-local limiter is not a cross-replica control.

Build-time key pinning prevents the ordinary runtime relay from substituting an HPKE key. It cannot defend against an application server that can replace the JavaScript bundle itself. Stronger protection requires independently verifiable/signed static artifacts or a separately trusted delivery origin.

## Public RPC flow

The browser uses a same-origin Starknet RPC relay so the Alchemy credential remains server-only. This relay is not authenticated with the Privy access token and receives only already-public chain reads and submissions. It can still correlate source IP, timing, account address, and public shield/unshield transactions. A production deployment can instead use a browser-restricted public RPC key or an independently operated RPC endpoint to reduce application-backend correlation.

## Browser security requirements

Browser ownership makes XSS and compromised dependencies critical: malicious JavaScript can read private state before OHTTP encryption and can request signatures through the active Privy session. Production deployment should use a restrictive CSP, no inline/eval scripts, dependency pinning and integrity review, Trusted Types where practical, short-lived in-memory private state, explicit transaction confirmation, and user-presence/MFA policy in Privy.

No endpoint should log request bodies, authorization headers, cookies, user DIDs, wallet IDs, OHTTP ciphertext correlation identifiers, or upstream URLs containing credentials.
