# APP20 architecture

APP20's architecture separates three domains:

1. a browser-owned shielded wallet anchored to the STRK20 pool on Starknet;
2. a bounded cross-chain design through NEAR Intents;
3. a remotely attested workflow/policy design.

The current allowed live-network surface is the Ready STRK20 functionality exposed by the app, plus the optional Privy wallet rail on Sepolia; public transfer is not implemented. APP20 Mail helpers, escrow, and Private Desk settlement are available only as build-gated localnet fixtures, and historical Sepolia proofs are runtime-ineligible. Cross-chain intents and TEE workflows remain **review-only** and must not expose a deposit address, submit a signed intent, or claim attested enforcement until a newly approved release scope passes its gates.

## Honest product claim

The exposed Ready/Privy wallet rails can provide shielded activity inside the Starknet pool, while the build-gated localnet fixture can encrypt Mail content. Neither establishes that activity is unlinkable across chains.

- Shield and unshield boundaries are public.
- A cross-chain deposit and destination settlement are public and may correlate by amount, asset, and timing.
- A NEAR Intents provider and selected solver learn the fields needed to quote and execute the route.
- Cloudflare sees source metadata and timing. OHTTP hides request plaintext from the relay, not from the final gateway.
- The final remote prover sees the decrypted witness.
- A TEE protects only the inputs explicitly sent to an approved measurement. Attestation does not make its policy, host, data, or output inherently correct.
- A delivered-frontend compromise defeats browser-owned privacy.

APP20 must say **harder to correlate**, never **untraceable**, **unlinkable**, **blind prover**, or **TEE-controlled**, unless a reviewed implementation establishes that exact property.

## Network and authorization policy

| Network          | Ready Wallet Standard | Privy browser signer | Development wallet | NEAR Intents                            |
| ---------------- | --------------------- | -------------------- | ------------------ | --------------------------------------- |
| Starknet Mainnet | Allowed               | Blocked              | Blocked            | Review-only until explicit live release |
| Starknet Sepolia | Allowed               | Allowed              | Blocked            | No live Intents testnet exists          |
| Localnet         | Blocked               | Blocked              | Build-gated only   | Fixtures and mocks only                 |

Mainnet Ready identification uses a reviewed Wallet Standard feature identifier rather than a display name. This is product routing, not cryptographic wallet-brand attestation. Policy runs below React immediately before every build and submission.

## Topology

```text
APP20 browser
  |-- account registry and explicit capability model
  |-- browser-owned Mail keys; optional Privy viewing keys, notes and witnesses
  |-- workflow journal without secret material
  |-- Starknet / STRK20 adapters
  |-- NEAR Intents dry-only model
  `-- attestation and policy-receipt verifier
         |
         |-- Cloudflare Worker topology (configured, no deployment evidence)
         |     |-- reviewed SPA assets
         |     |-- authenticated bootstrap
         |     |-- restricted public RPC
         |     `-- blind OHTTP relay and distributed quotas
         |
         |-- configured OHTTP discovery/prover gateway
         |-- future dry-only Intents transport to provider/solvers
         `-- future attested policy service (no deployable exists)
```

Cloudflare Workers are not the TEE and cannot host the official prover. If this topology is deployed, real RPC, prover, discovery, and future credentialed Intents origins must remain runtime secrets; browser assets receive only public metadata and same-origin paths. Repository configuration is not deployment evidence.

## Localnet RFQ v3 plane

RFQ v3 is additive and localnet-only. Its contracts, protocol, maker, service, browser, invoice, and Mail/backup flows are mounted in the build-gated desk; legacy v1 records retain separate recovery actions. Public-network transport and settlement remain immutable-off.

```text
browser exact size + floor
  -> fixed ladder bucket + ephemeral Stark authorization key
  -> local coordinator (account/chain/RFQ journal)
  -> invited maker processes (pair, direction, bucket, expiry)
  -> confirmed App20Escrow collateral locks + signed schedules
  -> browser get_lock/signature verification and local selection
  -> fair-loss transcript
  -> one atomic Take across 1..4 locks
  -> aggregate OPEN output note
  -> maker expiry worker pulls proceeds and unused collateral
```

The request omits exact size and floor. A maker locks token B equal to the maximum schedule payout before signing, so the quoted inventory cannot default. Selection evaluates schedules at the exact local size, applies the local floor, and either uses one covering lock or at most four deterministic fills. `Take` is atomic; unlike legacy v1 it has no funded wait, maker fill, taker claim ticket, or taker timeout/refund. Each maker's supply-two `LockTicket` authorizes separate proceeds and collateral pulls after expiry.

The privacy boundary changes at selection. The full transcript contains winner allocations and reaches every invited maker, so summing `amountA` entries can reveal exact size even though no dedicated exact-size field or floor is sent. `takerCommitment` is the ephemeral taker Stark public key. Chain observers see complete `LockCreated` schedules/public key, exact `LockTaken` fills, exact `DealTaken` totals/ordered `fillsDigest`, and the Take signature/ordered fills. The private signing key is not calldata. The signed message cannot bind output-note ownership through the current pool API, leaving a copy-sniping race for a relayer or sequencer with the signed Take. The coordinator sees the account, chain, market, RFQ identifiers, invited cohort, quotes/refusals, full transcript and expected exact Take fills/totals; its durable record keeps plans, digest, and Take orchestration state. Maker lock/WAL and coordinator state are durable only on their local hosts.

Maker nodes publish short-lived P-256-signed indicative mids. The coordinator verifies fixture key bindings and caches them for five seconds; browser operations verifies them again and computes median/dispersion. CoinGecko remains opt-in and independent. Note maturity is only a bounded estimate from public pool `Deposit` and `OpenNoteDeposited` events; it does not reveal notes received by private transfer.

Mail can create account/chain-scoped USDC invoice handoffs and complete a recorded payment after the Take output note reaches `takeBlock + 10`. It can also post authenticated contacts or RFQ-history backups as self-addressed encrypted Mail. RFQ payload v2 carries portable authenticated deletion tombstones; restore authenticates before ranking, rejects rollback/equivocation, strips signing keys, and durably preserves verify-only `restoredFromBackup` provenance. Oversized snapshots are AES-GCM encrypted and padded to 4,096-byte buckets, addressed by CIDv1 raw sha2-256, and represented on chain by an encrypted pointer. The localnet IPFS emulator is loopback-only and in-memory. Production blob storage is unavailable unless both browser IPFS origins and matching relay CSP origins are configured. The relay does not proxy IPFS; a configured RPC/gateway observes source metadata, timing, CID, and padded ciphertext size.

## Account model

A profile is not an account. Every action binds an explicit chain-scoped account.

```ts
type AccountRef = {
  id: string;
  chainId: string;
  address: string;
  signer: "ready" | "privy" | "near" | "injected" | "hardware";
  custody: "user" | "embedded" | "shared";
  capabilities: string[];
  policyMode: "none" | "advisory" | "backend-gated" | "cryptographic";
};

type AssetRef = {
  chainId: string;
  assetId: string;
  decimals: number;
};
```

Required invariants:

- Privy identity may discover Privy accounts but cannot authorize a Ready account.
- Shielded state is keyed by chain, account, pool/version, and viewing-key derivation version.
- A Starknet address is never inferred to be the destination address on another chain.
- Quotes bind source/destination accounts, assets, integer amounts, fee and slippage bounds, deadline, and refund target.
- Aggregate balances retain chain, custody, and finality provenance.
- Mail and the RFQ workspace must not silently switch authorization rail when navigating between routes.

## Canonical intent

Every APP20 operation uses a versioned logical intent and a separate submission attempt.

```text
IntentV1
  intentId          unpredictable 128/256-bit identifier
  revision          incremented when user-visible terms change
  kind              public, shielded, correspondence, cross-chain, workflow
  principal         explicit account references
  inputs/outputs     chain-scoped assets and integer base units
  constraints       recipient, slippage, deadline, fee ceiling, privacy mode
  disclosure        who may receive each sensitive field
  createdAt/expiresAt
```

Canonical serialization uses deterministic field ordering and string-encoded integers under the `app20/intent/v1` domain. It must not rely on ordinary `JSON.stringify()` semantics. The cross-chain form explicitly binds source, destination, and refund accounts; both chain-scoped assets; provider, swap, funding, delivery, refund, and privacy modes; amount, minimum output, fee ceiling, slippage, deadline, revision expiry, and the complete disclosure set. Unknown fields, hostile enum values, malformed identifiers/timestamps, duplicate set entries, and chain mismatches fail closed.

Each submission has a new `attemptId`; an unknown submission is reconciled before another attempt is allowed. Lifecycle state is bound to the intent id, revision, canonical digest, and expiry. Changed or expired revisions cannot quote, build, sign, submit, or retry.

### Lifecycle

```text
DRAFT
  -> VALIDATING
  -> PREFLIGHT_POLICY
  -> QUOTING
  -> AWAITING_REVIEW
  -> BUILDING
  -> AWAITING_FINAL_POLICY
  -> AWAITING_SIGNATURE
  -> SUBMITTING
  -> SUBMITTED
  -> SOURCE_CONFIRMING
  -> SOURCE_FINALIZED
  -> SETTLEMENT_PENDING
  -> DESTINATION_CONFIRMING
  -> COMPLETED
```

Only `PREFLIGHT_POLICY` may enter `QUOTING`. Requoting and retryable failures return through validation and preflight. Side states include `AWAITING_PREREQUISITE`, `BLOCKED`, `MANUAL_REVIEW`, `EXPIRED`, `CANCELLED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `SUBMISSION_UNKNOWN`, `REFUND_PENDING`, `REFUNDED`, and `REORGED`. `SUBMISSION_UNKNOWN` has no direct retry edge; it must be reconciled to submitted, manual review, or final failure.

The journal may store public transaction hashes, provider IDs, state transitions, redacted policy receipts, and commitments. It must never store viewing keys, notes, witnesses, raw wallet signatures, mail plaintext, bearer tokens, or private workflow inputs.

## NEAR Intents connector

The supported integration surface is the 1Click API. Official documentation states there is no Intents testnet. Consequently the default connector is `dry-only`.

Safe prototype behavior:

- fetch the public token catalog;
- map one validated canonical intent to the pinned 1Click dry-request shape;
- complete injected policy preflight before quote transport;
- request only `dry: true` quotes from an immutable reviewed-request snapshot;
- accept only allowlisted response, echoed-request, and quote fields;
- reject unknown or funding-shaped fields such as `deposit_address`, `memo`, or nested `funding` before signature verification;
- verify the exact echoed request and require structured signature provenance (algorithm, key id, and signed-payload digest), not a bare boolean;
- use injected transports so partner credentials never enter browser code;
- expose no submit or funding method and never auto-submit or auto-resubmit.

Live behavior requires a separate human release and tiny-value Mainnet validation. A live quote must bind `refundTo`, refund type, recipient, destination asset, minimum output, all fees, deadline, and quote signature. UI must distinguish source accepted, source finalized, solver processing, destination finalized, failed, refund pending, and refunded.

1Click temporarily transfers assets to a trusted swapping agent. Confidential Intents may hide parts of the source route, but destination settlement remains public. APP20 does not treat it as equivalent to the Starknet shielded pool.

Official references:

- <https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api>
- <https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request>
- <https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature>
- <https://docs.near-intents.org/resources/faqs>

## TEE workflow policy

Policy is evaluated twice:

1. **Preflight** over the normalized user intent before quote/build side effects.
2. **Final authorization** over exact execution bytes, quote digest, fees, account, chain, expiry, and attempt nonce.

A policy receipt's domain-separated signed bytes bind at least:

```text
workflowId, workflowEpoch,
intentDigest, revision, executionDigest, quoteDigest, constraintDigest,
policyVersion, decision,
attestationVendor, attestationChallenge, attestationEvidenceDigest,
enclaveMeasurement, attestedEphemeralKey,
nonce, monotonicCounter, issuedAt, expiresAt
```

Verification requires an injected atomic replay guard that checks and consumes the workflow/key/nonce/signature while rejecting reused values, counter rollback, and workflow-epoch rollback. Verification reports approval evidence only; it does not accept or confer a caller-selected enforcement level.

Enforcement levels are shown per action:

1. **Advisory** — the browser consults policy but the signer can bypass it.
2. **Backend-gated** — APP20 infrastructure requires a receipt, but alternate infrastructure can bypass it.
3. **Cryptographic** — account contract, signer quorum, or mandatory authorization key requires policy approval.

Current Ready and threshold-1 Privy accounts are advisory or, at most, backend-gated. The TEE does not control every action until a bypass test proves level 3.

The policy client must verify the vendor root, production/debug mode, approved code/config measurement, current security level and revocation data, freshness challenge, workflow-bound ephemeral key, policy version, chain, and expiry. Unknown, stale, revoked, rollbacked, or mismatched evidence fails closed.

The standalone Shade Agent framework is deprecated and not formally audited. APP20 therefore keeps the policy protocol vendor-neutral and does not select Shade as a production custody boundary. Any local Shade experiment uses throwaway testnet keys and cannot authorize value.

## Trust boundaries

| Component               | Can observe                                                                                                                                                               | Must not receive / cannot guarantee                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Browser                 | Mail plaintext/keys; exact RFQ size/floor, quote schedules/fills and ephemeral taker signing key; optional Privy viewing keys, notes, and witnesses                       | Protection from XSS or replaced assets                                                          |
| Localnet coordinator    | Account, chain, RFQ/market/cohort, bucket request, quote/refusal plans, full transcript, expected exact Take fills/totals, and orchestration                              | Exact size/floor in the invitation itself; raw maker inventory; replicated production authority |
| Invited maker           | Pair, direction, bucket, expiry, RFQ/commitment, own lock/quote, full selection transcript                                                                                | Floor; exact size during invitation (winner allocations may reveal it later)                    |
| IPFS RPC/gateway        | Source metadata, timing, CID, padded encrypted blob bytes/size                                                                                                            | Backup plaintext or mailbox seed absent browser compromise                                      |
| Ready                   | Connected account and requested actions                                                                                                                                   | TEE enforcement when it can submit independently                                                |
| Privy                   | Identity, wallet metadata, signature hashes                                                                                                                               | Mail plaintext or proving witness                                                               |
| APP20 bootstrap         | Privy identity and public quorum metadata                                                                                                                                 | Viewing keys, notes, witness, mail plaintext                                                    |
| RPC relay               | IP/timing and public reads/submissions                                                                                                                                    | Unlinkability                                                                                   |
| OHTTP relay             | Session pseudonym, service class, timing, ciphertext length                                                                                                               | OHTTP plaintext                                                                                 |
| Discovery gateway       | Decrypted discovery request                                                                                                                                               | Privy identity/token                                                                            |
| Prover gateway          | Full witness and public transaction metadata                                                                                                                              | Blind proving                                                                                   |
| Intents provider/solver | Quote, deposit, destination, amount, timing                                                                                                                               | Private cross-chain execution                                                                   |
| TEE enclave             | Inputs marked `SENT TO ENCLAVE` and policy history                                                                                                                        | Protection from policy bugs or side channels                                                    |
| Public chains           | Public boundaries; Mail ciphertext; lock schedules/collateral and taker public key; Take signature/ordered fills; exact fills/totals/digest; legacy fills/refunds; timing | Relationship unlinkability, output-note ownership binding, or deletion                          |

## Package boundaries

```text
@app20/domain                Pure account, asset, intent and lifecycle model
@app20/near-intents          Vendor-isolated dry-first connector
@app20/policy-client         Attestation and policy-receipt contracts
@app20/privacy-adapters      Existing Starknet network and wallet policy
@app20/private-intents       Legacy protocol plus v3 buckets/schedules/quotes/selection/transcripts/mids
@app20/maker-node            Single-host WAL-backed reservations, collateral locks and settlement
@app20/privy                 Generic browser/Node STRK20 integration
src/app/rfq                  Mounted localnet v3 desk plus additive legacy lifecycle recovery
src/lib/mail*, backup-*      Mail compatibility plus authenticated encrypted backup/blob primitives
workers/relay                Cloudflare edge and optional IPFS CSP origins; no blob proxy/private state
future policy-enclave service  Separately scoped; no repository path or deployable exists
```

The `@app20/privy` package is the product wrapper. The viewing-key typed-data domain remains `strk20-privy`. STRK20 protocol names, pool methods, and Starknet constants must not be mechanically renamed.

## APP20 namespace freeze

The pre-release APP20 reset intentionally changed the previous contract names,
storage keys, cryptographic labels, environment variables, runtime paths, and
artifact names. No silent migration is provided. From this reset onward, never
rename or silently migrate:

- `app20/*` storage keys;
- APP20 cryptographic labels and envelope versions;
- `app20p2` payment-link format;
- APP20 contract names, ABI, calldata, storage, class hashes, or deployed addresses;
- STRK20 viewing-key typed-data domain;
- Ready/Argent class hash, constructor, or account derivation;
- existing chain/address normalization.

New workflow records use `app20/.../v1`. Pre-reset records, ciphertext, payment
links, and contract artifacts are not accepted as APP20 records.

Changing origins does not move origin-scoped browser storage or wallet
permissions. A deployed migration needs user-mediated export/restore or a
separately reviewed strict-origin transfer. Do not retire an active origin until
users can recover mailbox and shielded state on the new one.

## Delivery phases

1. **Rename and freeze** — APP20 product/package namespace, frozen compatibility vectors, credential rotation, canonical monorepo provenance.
2. **Domain and accounts** — explicit account registry, canonical intent, persistent non-secret journal.
3. **Policy shadow mode** — local verification of advisory attestation receipts with no signing authority.
4. **NEAR dry mode** — signed dry quotes, lifecycle and refund fixtures, no deposit address.
5. **Constrained live Intents** — separately approved tiny-value Mainnet tests with server-held partner credentials.
6. **Backend-gated policy** — exact receipt required by APP20 infrastructure, labeled honestly.
7. **Cryptographic policy** — opt-in account/quorum that cannot bypass a valid policy receipt.
8. **Privacy experiments** — only after measured amount/timing correlation and external review.

## Release gates

- Post-reset APP20 storage, crypto, Cairo, and payment-link vectors remain byte-for-byte stable.
- No Node/proxy entry point enters the browser bundle.
- No secret, private origin, witness, viewing key, note, mail plaintext, raw signature, or recipient leaks through logs/assets.
- Dry Intents mode rejects every funding target and cannot submit.
- Every semantic field changes the canonical intent/execution digest.
- Wrong chain, account, recipient, asset, fee, quote, revision, expiry, measurement, or nonce fails closed.
- Refresh, multiple tabs/devices, timeouts, unknown submission, refunds, and reorgs cannot create a duplicate execution.
- TEE evidence negative tests cover debug, stale, revoked, wrong-measurement, wrong-key, replay, and rollback.
- UI shows policy enforcement level and exact disclosure recipients for every action.
- Production assets are reproducible and independently verifiable.
- No live cross-chain value, TEE custody, push, deployment, or Mainnet transaction occurs without explicit human approval.
