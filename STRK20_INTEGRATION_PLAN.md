# STRK20 Privacy Integration Plan — APP20

> Historical Mail implementation remains below. The approved 2026-08-25 programme expands APP20 into a bookless invited-maker RFQ venue. A later explicit pre-release namespace reset renamed the active contracts, storage and cryptographic domains, environment variables, runtime paths, and artifacts to APP20; pre-reset data is not silently migrated. APP20 routing, Cloudflare relay, Privy Sepolia support, and Mainnet Ready-only policy remain defined in `docs/APP20_ARCHITECTURE.md`. Never restore browser RPC credentials or the former `VITE_PROVIDER_URL` design from this document.

## Current operative decision: localnet-final

APP20 Mail helpers, escrow, and RFQ are now scoped only to build-gated localnet. Ready STRK20 functionality exposed by the app remains available on live networks (public transfer is unavailable), and Privy remains optional on Sepolia, but neither live rail may configure APP20 Mail/escrow or production RFQ. The one-off Sepolia transactions are denylisted historical proof evidence only. Every later phase, manual live-network instruction, deployment gate, and “next gate” below is **superseded and non-operational** unless a new scope is explicitly approved. See `docs/LOCALNET_SCOPE_DECISION.md`.

### Current local product implementation and dated evidence

`/rfq` is the only executable local RFQ venue and separates New/Active/Activity, quote comparison and explicit final review from funding, the unavailable public-send page, recovery, Mail/Pay coordination, and dry cross-chain review. Local IndexedDB lifecycle rows are account/chain-bound and labelled non-authoritative; they never auto-resubmit. CoinGecko context is opt-in. `/swap/:tokenA/:tokenB` is non-executable, and market planning is proposal-only at `/rfq/markets/:tokenA/:tokenB/proposal`. These local changes do not close production custody, HSM/KMS, contract/audit, deployment, token funding, configured-chain verifier, operator, network, soak, or rollout gates.

M8–M10 local authority is now implemented as a separate server-only fixture: a fixed pinned decoder, two same-devnet reader models, durable finality/reorg journal, browser demotion, coordinator market quarantine, and an exact maker reconciliation pipeline composed into the real localnet runtime. Settlement binding is persisted in the maker WAL; expiry and status convergence never release selected inventory; only an exact authoritative Claim/Timeout lifecycle can drive the authenticated, idempotent terminal maker transition. Startup re-verifies durable authority rows, and journal uncertainty fail-stops new RFQs. The unsigned deterministic harness and live-composition mutation tests cover restart, response loss, disagreement, unknown, reorg, and persistence faults. This fixture never constructs the production configured-chain capability, treats same-devnet agreement as independent RPC evidence, retries an unknown value-moving operation, or enables any public RFQ/value flag.

The M11 local-fixture scope is implemented. The current serial browser suite contains canonical and compatibility routes, desktop/mobile hierarchy, focus and proposal-only navigation, real IndexedDB CAS/tombstones across tabs, both RFQ directions, requote/decline/refusal, maker process restart, claim/refund, authority demotion/reorg behavior, quote-scope invalidation, and blocked-storage guidance without automatic resubmission. The latest complete run is dated evidence that predates later hardening rather than an attestation of the current tree; fixed journey counts and pass claims belong only to dated captures. This is localnet usability coverage, not live-network or production authority.

Wallet integration remains on `starknet@10.5.0`, discovery/wallet-standard `6.0.3`, and Wallet API types `0.10.3`. APP20 uses the existing `WalletAccountV6.strk20Balances` and `strk20InvokeTransaction` paths only during explicit Ready-wallet operations; that path does not request balances for feature detection, call shadow-account methods, or access viewing keys. The separate optional Privy browser-owned SDK derives/holds its viewing key locally under its documented browser trust boundary. The definitive RFQ goals, non-goals, stage definitions, and current gaps are maintained in `docs/GAPS.md`; creating a new privacy venue, AMM, order book, liquidity pool, or pool factory is explicitly outside scope.

## Historical 2026-08-26 bounded Sepolia RFQ candidate — recorded fail-closed decisions

This historical app-code-only wiring slice did not establish audit evidence or make APP20 release-ready. `starknet@10.5.0` is the installed reviewed pin (the historical text below says 10.4.0); keep 10.5.0 and do not adopt 10.7.x or Wallet API 0.10.4 pre-releases in this slice.

Canonical production product names are **App20Mail**, **App20Escrow**, and **App20Claim**. “VNext” is internal migration terminology only. The current localnet `ClaimTicket`, localnet escrow, and `MockErc20` remain historical/test fixtures; none is a Sepolia production artifact and `MockErc20` must never be included in a Sepolia deployment.

| Decision | Recorded conservative result |
| --- | --- |
| Milestone/network | Historical bounded Sepolia candidate, superseded by localnet-final; `releaseReady` remains false and private RFQ is denied on every live network |
| App20Claim | Replace historical/localnet ClaimTicket with a new canonical production App20Claim Cairo-team/audit handoff; do not reuse or deploy the localnet class |
| App20Escrow | App-side internal-migration commitment and typed null-selector ABI/event expectations only; canonical production Cairo is not implemented |
| HPKE | Pinned `@hpke/core@1.9.0`, RFC 9180 Base one-shot P-256/HKDF-SHA256/AES-256-GCM, canonical AAD, fixed buckets; maker opener is a Node-only export |
| Directory | Pinned public authority roots, signed genesis, predecessor/epoch/registry/window/revocation checks; no client-selected delivery URL |
| Relay | Authenticated poll topology with opaque ciphertext and per-maker SQLite Durable Object replay/idempotency; no maker endpoint fetch/SSRF |
| Maker durability/custody | Localnet WAL remains single-host; production repository, custody, signer, auth and reconciler ports fail closed without independent adapters |
| Receipts | `finalized` means `ACCEPTED_ON_L1`; block hash, selector, address, class, ABI decoder, RPC 0.10.2 and at least two independent origins are required; no configured RPC adapter/evidence means unavailable |
| Manifest/RFQ | Production RFQ and publication are unconditionally disabled until the complete lifecycle exists; manifest validation separately pins directory public roots/checkpoint; USDC remains unconfigured; no public fallback |
| Quotes | Localnet v1 remains localnet-only; v2 binds an acyclic pre-quote settlement-context digest; the final VNext commitment binds the selected signed quote digest |
| Wallet gap | Claim/timeout still require destination-bound `${openNoteIds[n]}`; production claim remains unavailable (§10.1) |
| Parallel lanes | Mail, negotiation, checkout, webhooks and receipts remain non-authoritative; live submission remains false |

### Wiring phase log (implemented versus blocked)

1. **Decisions/docs:** recorded here; release gate stays closed. **Blocked:** approval/audit/deployment evidence.
2. **Production App20Escrow/App20Claim app specification:** canonical commitment, digest, typed calldata/event expectations and internal migration handoff added; historical localnet classes refused. **Blocked:** canonical Cairo selectors, ABI, implementation and audit.
3. **Quote v2:** acyclic pre-quote/final transcript, strict decimal wire codec, async replay, directory-key verification and exact-bigint ranking added; v1 remains localnet. **Blocked:** production maker v2 signer/custody.
4. **HPKE:** real reviewed-library seal/open, context binding and padding added with adversarial tests. **Blocked:** external protocol review and HSM key handle.
5. **Replay:** async conflict/idempotency contract and memory test adapter added; maker consumes after open. **Blocked:** production retention/restore approval.
6. **Directory:** signed publication and pinned monotonic acceptance added. **Blocked:** real authority operators/keys and published epoch.
7. **Relay:** dormant RFQ directory/ingress/poll/quote/select primitives and SQLite DO code exist. **Disabled:** Worker `/api/rfq/*` routing is immutable-off before configuration is read; checked-in manifests record the false policy.
8. **Maker ports:** repository/CAS fence, custody, signer, admin auth, reconciliation and HPKE ingress seams added; unavailable adapters fail closed. **Blocked:** replicated independently administered persistence and HSM/KMS.
9. **Receipts:** raw receipt binding plus pure exact-origin, canonical block-number membership, and transcript validators added; the self-issuable verifier was removed and configured-chain authority is unconditionally unavailable. **Blocked:** a server-only runtime-provenanced adapter/generated decoder, approved RPC members, deployed identity, and durable reorg state.
10. **Manifest/network:** immutable disabled Sepolia manifest and Mainnet hard deny added. Historical proof deployments are recorded separately and denylisted; no canonical production address, review, quorum, or USDC evidence is configured.
11. **Desk:** localnet mounts only on build-gated localnet; production Desk/publication are unconditionally disabled and network-specific unavailable states are rendered. **Blocked:** complete v2 maker/Desk/resume/confirmation/wallet/receipt/custody lifecycle.
12. **Parallel lanes:** async webhook replay port added; live submission remains false. **Blocked:** durable production adapter.
13. **Validation/docs:** adversarial suites and leak sentinels updated; exact run results are captured in the implementation handoff. P3–P6 remain blocked.

**External blockers (not fabricated):** any reopened production scope would still require independent operators/HSM custody, audited canonical App20Escrow and App20Claim Cairo, approved canonical deployment/ABI evidence, an independent RPC quorum/finality policy, a funded two-maker soak, independent reviews, Mainnet approval, and verified release evidence.

### Superseded Sepolia spike and localnet-final decision

The one-off Sepolia spike demonstrated that App20Mail and the historical/localnet App20Escrow/ClaimTicket fixture were deployable at that checkpoint. It did **not** deliver a reusable deployment pipeline, audit, canonical production escrow/claim, custody handoff, independent reproduction, or release approval. The proof records are denylisted under `docs/evidence/historical-sepolia-proofs/`; the separate production template remains deliberately blocked with `releaseReady: false`, `null`/`0x0` evidence, and no configured USDC.

Operational deployer/funding/deployment scripts were removed for localnet-final. Only offline validators for the blocked template and historical proof index remain. See `docs/LOCALNET_SCOPE_DECISION.md` for closure of #142, #143, #148, and #152–#156.

## 2026-08-25 approved maximal implementation programme

The developer approved implementation of every compatible app-code capability. This approval does **not** authorize Cairo changes, contract deployment, a commit or push, Mainnet value movement, live cross-chain funding, production TEE authority, or cap increases. Those remain separate human and independent-review gates.

### Product and privacy boundary

APP20 is a bookless private RFQ venue using the existing STRK20 privacy pool. It does not create or deploy a new privacy venue, AMM, order book, liquidity pool, or pool factory. Only invited makers receive exact pre-trade terms; no public RFQ book is created, losing quotes are not published, and a refusal never triggers public fallback. Invited makers still learn the exact pair, direction, amount, floor, and expiry. First-version settlement terms, amounts, deadlines, lifecycle timing, helper activity, and public hedges remain observable. APP20 does not claim anonymity, unlinkability, untraceability, or a synthetic privacy score.

Private RFQ, STRK20 funding, informational public context, and any future separately approved public execution remain distinct rails; no public-execution action is implemented now. Mail is correspondence and evidence only. Within the localnet fixture, Cairo and finalized pool state are value authority; production configured-chain authority remains unavailable. The Ready Wallet API path never requests or hosts a user's viewing key, derives encryption from Ready signatures, or places solver private keys in browser code. The optional Privy browser-owned SDK separately derives/holds its viewing key locally and must never upload or log it.

### Upstream re-verification — 2026-08-25

- `starknet@10.5.0` is the reviewed installed route for the current `WalletAccountV6` integration; the current guide documents `strk20Balances`, `strk20InvokeTransaction`, `strk20PrepareInvoke`, `executeWithProof`, and `strk20ShadowAccountCommitment`.
- Wallet API stable remains `0.10.3`; `0.10.4-rc.1` is pre-release and is not adopted.
- `@starknet-io/get-starknet-discovery` moved from `6.0.3` to `6.0.4` and wallet-standard from `6.0.3` to `6.0.5`. APP20 keeps its reviewed `6.0.3` pins until a dedicated compatibility upgrade passes all wallet tests.
- Upstream renamed its sub-account anonymizer package to a shadow-account anonymizer package. Neither is a current APP20 repository path, and APP20 will not infer production capability from the rename; Wallet API shadow-account work stays proof-gated.
- The live WalletAccount guide now states Ready and Xverse support the STRK20 Wallet API. APP20 still requires capability checks rather than wallet display names.

### Delivery ladder

1. **P0 baseline:** freeze the current dirty worktree, record drift and evidence, and rerun validation without committing.
2. **P1 pure models:** privacy preflight, receipts/selective disclosure, versioned RFQ/directory/transport/reservation schemas, negotiation, risk, and policy models.
3. **P2 production-shaped localnet:** independent maker processes and custody configuration, durable fenced reservations, encrypted maker-specific fanout, app integration, restart recovery, and no raw inventory exposure.
4. **P3 adversarial localnet:** replay, expiry, equivocation, concurrency, crash/restart, stale keys, relay/RPC failure, privacy sentinels, multi-tab/device, and recovery tests.
5. **P4 independent review:** protocol/transport/service/browser review plus the team-owned Cairo audit. No audit claim is inherited from older reports.
6. **Historical P5 Sepolia (superseded):** manual Ready/Privy validation was proposed only after relevant infrastructure and reviewed helper deployments existed; it is not an active gate.
7. **P6 tiny approved Mainnet evidence:** separately approved Mail/STRK first; RFQ only after audited nonzero settlement addresses, reviewed tokens, independent makers, hard caps, and recovery drills.
8. **P7 capped production:** Swap first, then Block/Desk, negotiation/channels, integrations, crossing, recurring settlement, cross-chain warehousing, and cryptographically constrained automation. Each promotion requires its own evidence and approval.

### Execution status — 2026-08-25

- **P0 complete:** the pre-existing dirty worktree was inventoried without reverting or committing it; application/package tests, typechecks, production build, browser-leak scan, and fresh localnet UI journeys passed.
- **P1 privacy/receipt slice complete:** `src/lib/privacy-preflight.ts` now reports evidence-labelled facts, warnings, unavailable inputs, and fail-closed blocks without a synthetic score; the Desk requires informed acknowledgement before request-scoped signed local quote requests. Canonical exact-unit settlement receipts separate local from supplied chain evidence, bind lifecycle coordinates and finality, and support user-selected disclosure packages with sensitive structures excluded by default.
- **Receipt boundary:** a receipt digest binds supplied evidence but is not authorization or proof that chain data is true. Trusted chain integration must reconstruct and verify events before treating a receipt as authoritative.
- **P1 maker-protocol slice complete:** `@app20/private-intents` now freezes canonical RFQ v1, predecessor-bound signed directory epochs with historical P-256 key windows, maker-specific RFC 9180 HPKE envelope metadata/replay/padding validation, and monotonic fenced reservation transitions. The package validates envelopes but does not yet encrypt/decrypt them, and its memory replay store is not durable.
- **P1 negotiation/channel slice complete:** `src/lib/negotiation.ts` now freezes strict offer/counter/accept/cancel documents, exact-unit terms, full-document Mail signatures, attachment manifests, and predecessor-bound transcript states. `src/lib/relationship-channel.ts` adds externally verified SNIP-12 wallet-to-Mail binding certificates, opaque invitation capabilities, quotas, replay-safe sequences, and predecessor-bound key-epoch metadata. These artifacts are correspondence protocols only and never authorize settlement. The required Double Ratchet suite is schema metadata; audited ratchet encryption, relay delivery, recovery, and production channel storage are not implemented.
- **P1 operations/integration slice complete:** `packages/private-intents/src/operations.ts` adds independently approved risk manifests, fail-closed exposure checks, dual-approved exceptions, finalized independent-fill netting, denomination/dwell/venue restock controls, drain-only incident state, and browser-safe capacity bands without raw balances. `src/lib/merchant-integration.ts` adds unsigned checkout requests, verified signed webhooks with replay/idempotency semantics, dry maker-warehouse reviews, release evidence gates, and strictly advisory automation. Atomic crossing, inventory proofs, live cross-chain funding, value-authorizing agents, durable webhook storage, and production key custody remain unimplemented and separately gated.
- **P1 pure-model programme complete:** privacy/preflight, receipts/disclosure, RFQ/directory/transport/reservations, negotiation/channels, risk/operations, and integration-release models now have strict versioned schemas and focused acceptance tests. This does not advance P2 transport, Cairo, deployment, or release gates.
- **P2 custody/WAL slice complete:** localnet now runs two authenticated loopback maker services with distinct devnet settlement accounts, quote keys, private-note inventories, auth scopes, and `0600` hash-chain WALs. Signing follows fsync; reservation fences include a persisted begin-fill state; unknown outcomes quarantine; Playwright SIGKILLs the selected maker, observes automatic restart, and then completes settlement from the recovered reservation.
- **P2 remaining:** production wiring of maker-specific HPKE delivery, split ingress/egress, production secret/HSM custody, replicated linearizable storage, production reconciliation, and quote-bound audited Cairo. Local HPKE primitives and loopback maker transport do not close those boundaries. P3 and later gates remain blocked.
- **Internal adversarial round complete:** a read-only security review reproduced mutable/forgeable verified-object boundaries, role impersonation, unsigned channel epochs, self-asserted receipt authority, metadata-only RFQ acceptance, future/missing preflight evidence, disclosure substitution, incorrect RFQ reservation binding, and checkout/webhook replay gaps. App-code remediations now require immutable runtime provenance, externally verified chain receipts, externally opened/authenticated HPKE plaintext before replay consumption, wallet-bound roles, dual-signed channel epochs, full canonical RFQ digests, receipt-bound disclosures, fresh evidence, and pinned webhook context. `docs/APP20_ADVERSARIAL_VALIDATION.md` records the matrix. This is not an independent audit and does not open P3, Sepolia, deployment, or Mainnet gates.
- **Gated release evidence prepared:** `docs/APP20_RELEASE_GATES.md` and `docs/evidence/app20-release-evidence-2026-08-26.json` record the then-current dirty-source, validation, contract, version-drift, and human-approval state. The verdict is localnet-demo/dry-review only and `releaseReady: false`; empty `strk20.json`, zero live helper addresses, missing immutable source, real HPKE, configured-chain receipts, independent audits, Sepolia soak, and explicit Mainnet approval remain blocking.

### App-code workstreams

- Extend `packages/private-intents` with canonical protocol objects, historical directory verification, deterministic ranking, and reservation state machines.
- Add pure preflight and receipt/selective-disclosure models under `src/lib/`, with exact bigint units and evidence provenance.
- Replace synthetic localnet maker behavior with separately configured maker nodes and durable crash-recoverable reservations; private keys and raw balances stay server-side.
- Add wallet-bound Mail identity, canonical offer/counter/accept/cancel documents, attachment commitments, key rotation, and explicit recovery migrations without granting Mail value authority.
- Add inventory exposure, crossing, netting, restocking, incident, checkout/webhook, dry cross-chain, and advisory-agent models behind fail-closed release gates.
- Integrate Instant RFQ and Block RFQ progressively while preserving complete tooling on `/rfq`, terminal refusal, winner-only settlement, and no automatic public fallback. No public-execution route is implemented.

### Contract boundary

This skill execution is app code only. The team must specify, implement, review, audit, deploy, and maintain any quote-bound escrow successor, recurring/milestone contract, atomic crossing contract, or hidden-term proof system. APP20 app code may define canonical commitments, calldata expectations, receipt verification, readiness evidence, and disabled integration seams, but it must not fabricate a deployed or audited contract.

Generated 2026-08-14 by the strk20-privacy-integration skill. Pivoted from Feltproof / RFP-03 the same day. Statuses current at generation; re-verify pins with `python3 .agents/skills/strk20-privacy-integration/scripts/check_freshness.py` before building.

Public repo: <https://github.com/gstohl/app20>
Sprint: STRK20 Private Sprint, 14–31 Aug 2026
Inspired by RFP-01: <https://strk20.starknet.io/rfp/private-messaging>

This plan was approved and Phase 2 was implemented on 2026-08-14. At that checkpoint, the client migrated from Next.js to a Vite + React + TanStack Router SPA (no SSR) and had no server routes. The current Cloudflare Worker/API topology in `docs/APP20_ARCHITECTURE.md` supersedes that historical topology. The message helper remains the team’s own Cairo to review, audit, deploy, and maintain; code-complete does not mean deployed or production-audited.

## 0. Decided interview answers

These are closed. Do not re-interview. Poker decisions are void.

| Skill question | Decided answer |
| --- | --- |
| Builder type | Normal dapp: users connect Ready. The team also owns one helper, `App20Mail`. |
| Privacy goal | Hide who mailed whom and the message body. Optional payment memo rides a private transfer. |
| Not building | Poker, tables, chips-as-cards, trusted dealer, any gambling UI. |
| Environment | `SN_MAIN` for scoring. Sepolia for day-to-day. Alchemy key in an env var, never committed. |
| Wallets | Ready. Xverse dapp-facing Wallet API is in progress — degrade, do not depend on it. |
| Paymaster | Rely on Ready’s existing private-tx / relayer submission. Custom paymaster is stretch. |
| Session keys | Stretch. One wallet popup per private action is acceptable. |
| Scope | One complete send → discover → decrypt loop by 31 Aug 2026, plus an optional memo-on-transfer. |
| Route | Privacy Wallet API via starknet.js for shield / unshield / private transfer, plus `privacy_invoke` to append encrypted payloads to per-channel storage. |
| Sub-accounts | Do **not** use Wallet API sub-accounts (pending). |
| Viewing keys | Ready Wallet API: never requested by the dapp. Optional Privy SDK: browser-owned local derivation/custody under the documented trust boundary. Neither path uploads `k`. |
| Day-0 token | **STRK**. |

## 1. Project snapshot

- Stack: Vite 8 · React 19 · TanStack Router · TypeScript · zustand · `starknet@10.4.0` · get-starknet `6.0.3` · `@starknet-io/types-js@0.10.3`. Client deployment is a static SPA. Helper (later): Scarb edition `2024_07`, `starknet = "2.18.0"`.
- Landed plug-in points:
  - `src/app/components/client/WalletHandle/SelectWallet.tsx`
  - `src/app/components/Wallet/walletContext.ts`
  - `src/app/components/client/provider/providerContext.ts`
  - `src/utils/constants.ts`
  - `src/app/components/client/WalletHandle/Strk20CapabilityDiagnostic.tsx`
  - `src/lib/strk20.ts`, `src/lib/addresses.ts`
- Phase 2 landed:
  - `src/app/inbox/page.tsx`, `src/components/mail/*`
  - `src/lib/mail.ts`, `src/lib/mail-actions.ts`
  - Team-written helper: `cairo/src/lib.cairo`
- Privacy goal: hide sender, recipient, and content; keep the fact+timing of a pool interaction public.
- Environment: Sepolia daily; `SN_MAIN` against pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` for three scoring txs.

## 2. Historical chosen route: Privacy Wallet API via starknet.js + `App20Mail` helper

APP20 is a normal dapp. User-facing privacy goes through `WalletAccountV6`. Shield, unshield, and private transfers need no custom contract. Storing an encrypted payload on the existing ECDH channel needs our own helper. The pool already supplies key agreement, persistent channels, and sender anonymity via `InvokeExternal` (the pool is `msg.sender`).

**The Ready-path rule:** this app never touches Ready-wallet viewing keys — the user’s wallet acts on its behalf via starknet.js. The optional Privy browser-owned SDK is an explicit exception with local derivation/custody; any upload, logging, or backend handling of `k` is forbidden.

RFP-01 also names an off-chain discovery indexer and SDK methods `sendMessage` / `discoverMessages`. Sprint reading: ship send via Wallet API + helper first; discovery is local scan or a user-run indexer that receives a viewing key **only in the user’s process**. Do not stand up a hosted indexer that holds `k`.

## 3. What this delivers — hidden vs visible

Adapted from <https://strk20-by-example.org/what-is-strk20> and RFP-01.

| Not directly encoded in the helper record | Public or still correlatable |
| --- | --- |
| Sender wallet address (the pool is caller) | Pool/helper use, transaction timing, and surrounding wallet activity |
| Recipient wallet address (ciphertext uses channel material) | Public key registration, open-channel existence, access metadata, and small-set inference |
| Message plaintext | Helper storage occupancy and ciphertext size |
| Private-transfer amount and counterparties inside the pool | Shield/unshield amounts and those ERC-20 legs |

Honest limits: the helper ciphertext omits direct sender/recipient fields and encrypts the message body, but APP20 does not establish that correspondents are unlinkable. Timing, access, registration, amount, and small-set correlation remain real—especially in a two-person demo.

## 4. Historical prerequisites and versions

These were the landed scaffold pins at the 2026-08-14 checkpoint. Current pins are stated at the top of this plan; do not use this table as an upgrade instruction.

| Package / tool | Pin |
| --- | --- |
| `starknet` | `10.4.0` |
| `@starknet-io/get-starknet-discovery` | `6.0.3` |
| `@starknet-io/get-starknet-wallet-standard` | `6.0.3` |
| `@starknet-io/types-js` | `0.10.3` |
| Vite / TanStack Router / React | `vite@^8.2.1`, `@tanstack/react-router@^1.170.28`, `react@19.2.1` |
| Test wallet | Ready extension |
| Pool (mainnet) | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Token | STRK `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |

Live APP20 helper/escrow constants are hard-coded to `0x0`; only the build-gated localnet harness injects ephemeral helper addresses. RPC is same-origin and real provider origins/credentials are Worker secrets. Any `VITE_*` value ships in the browser bundle and must be treated as public.

## 5. Phase 1 — first shielded flow · retargeted 2026-08-14

Historical status: code complete for wallet plumbing; poker branding and DEMO echo were removed in the pivot commit. The former plan listed manual Ready checks on Sepolia, but those live-network instructions are superseded by localnet-final and are not an active test or authorization. Do not deploy a helper, touch `strk20.json`, or perform public-network value actions without a newly approved scope.

## 6. Phase 2 — compose + `App20Mail` invoke wiring ✅ code complete 2026-08-14

Historical status at that checkpoint: code-complete locally, with no helper deployment or live STRK20 transaction then recorded. Later one-off Sepolia proof deployments are denylisted separately and do not reopen this gate.

### 6.1 Landed dapp files

| File | Landed behavior |
| --- | --- |
| `src/app/routes.ts` | Defines the current canonical `/mail/inbox` route and legacy redirects |
| `src/app/inbox/page.tsx` | Network-aware onboarding, compose, public-event scan, and newest-first local plaintext list |
| `src/components/mail/Onboard.tsx` | Locally persisted random device seed, one-time backup display, and public `register_pubkey` transaction |
| `src/components/mail/Compose.tsx` | Recipient directory lookup, local encryption, optional private STRK attachment, and STRK20 submission |
| `src/components/mail/Thread.tsx` | Displays successful local decryptions only; no plaintext persistence |
| `src/lib/mail.ts` | x25519 + HKDF-SHA256 + AES-256-GCM, bounded felt packing, authenticated binary retention, and view-tag scan |
| `src/lib/mail-actions.ts` | Builds optional numeric `transfer`, recovery open note, and final `invoke`; preserves `${poolAddress}` and `${openNoteIds[0]}` as wallet literals |
| `cairo/src/lib.cairo` | Team-written helper and public-key directory |

The Phase 2 mail private key is an app-specific x25519 key, not the STRK20 viewing key `k`. The UI generates 32 random bytes once per chain and address, persists them under `app20/mailseed/v1/<chainId>/<address>` in the browser profile, and shows a backup only when first created. It does not derive mail keys from wallet signatures.

### 6.2 Landed helper

`App20Mail` pins the authorized pool address in constructor storage and never trusts the calldata `pool_address` placeholder for authorization.

- `privacy_invoke(token, pool_address, note_id, eph_pk, view_tag, nonce, ct) -> Span<OpenNoteDeposit>`
  - Only the configured pool caller succeeds.
  - Rejects ciphertext above `MAX_CT_FELTS = 140` before storing the count or emitting.
  - Emits `MessagePosted(index, eph_pk, view_tag, nonce, ct)` without a wallet address.
  - Returns an empty span at zero helper balance.
  - Approves and echoes any helper token dust into the supplied open note so funds are not stranded.
- `register_pubkey` / `get_pubkey` provide the public address-to-mail-key directory.
- `message_count` supplies the monotonic public event index.

The Cairo suite covers caller authorization, the ciphertext cap, exact event payload, zero balance, dust approval/echo, and caller-isolated directory entries. Payment plus memo is assembled as one wallet action batch, but real atomicity still needs Ready against Sepolia.

### 6.3 Completion record

| Tool | Verified version |
| --- | --- |
| Node / npm | `v24.12.0` / `11.19.0` |
| Vite / React / TypeScript / Vitest | `8.2.1` / `19.2.1` / `5.9.3` / `4.1.10` |
| starknet.js / Wallet API types | `10.4.0` / `0.10.3` |
| Scarb / Cairo | `2.18.0` / `2.18.0` |
| Starknet Foundry | `snforge 0.63.0` |
| Docker | `29.2.1` |
| Starknet Devnet | `0.9.2` |

Devnet 0.9.2 image pin: `docker.io/shardlabs/starknet-devnet-rs@sha256:2733f463816b4028a77e33cea2f55fbbdeb36dcacb4331d886d921361bd07bcf`. The default port is bound to `127.0.0.1` only.

The local e2e deploys the helper, registers a recipient key, encrypts an exact plaintext, posts as the configured **mock pool caller**, scans and decrypts the event, confirms a wrong key sees zero messages, and checks that the 0.001 STRK dust balance is approved, echoed, and pulled back. It does **not** run the real STRK20 pool, Ready Wallet API action assembly, `${poolAddress}` / `${openNoteIds[0]}` resolution, SNIP-36 proving, relayer submission, note maturity/discovery, screening, pool fees, or two-wallet Sepolia behavior.

### 6.4 Phase 2 hardening — local real-pool harness

The optional `pool-harness/` tier pins upstream `PRIVACY-0.14.3-RC.5`, builds it
with a repository-local Scarb 2.17.0, and uses native Starknet Devnet
0.8.0-rc.3. `npm run test:e2e:pool` deploys the actual `privacy_Privacy`
contract and retains the upstream lifecycle: Bob registration, Alice's screened
100-unit STRK deposit plus 50-unit private transfer, direct contract discovery,
and Bob's 50-unit withdrawal.

A second test now deploys the team-written `App20Mail` with that real pool
as its constructor authority, compiles the production `src/lib/mail.ts` and
`src/lib/strk20.ts`, and submits `buildMailInvokeActions` through the vendored
client's proving adapter. Localnet therefore exercises the same
`${poolAddress}` and `${openNoteIds[0]}` substitution path, including the
required preceding `transfer(..., amount: "OPEN")`, that the client integration
would use. The harness checks the following through the genuine pool contract:

- the pool invokes `App20Mail` and the helper emits `MessagePosted` from its
  deployed address;
- Bob decrypts the exact plaintext while an unrelated key discovers nothing;
- replaying the same non-zero `action_id` produces an on-chain
  `ACTION_ID_USED` revert and does not increment `message_count`;
- two submissions with `action_id = 0` both succeed; and
- helper dust is approved, pulled by the pool, emitted as
  `OpenNoteDeposited`, and discovered in Alice's credited recovery open note.

APP20 later replaced the harness-only pre-funding step with a production-shaped
local action sequence that atomically withdraws 7 STRK base units to the helper before the
OPEN note and invoke. The real pool still enforces `UNDEPOSITED_OPEN_NOTES`, but
there is no shared helper balance or separate race-prone funding transaction.

This hardening tier still uses upstream's simulated proof provider and the
canonical public **test-only** screening key `0xCAFEBABE`. Devnet does not
implement `starknet_getStorageProof`; a real STARK proof requires hosted proving
services and a storage-proof-capable node such as Pathfinder. The remaining
Ready gate is now specifically Ready's own action assembly/extension UI and its
proof + relayer submission path, not whether APP20's production-shaped local
batch can execute against the real pool.

### 6.4.1 Browser-viewable real-pool localnet · complete 2026-08-15

`npm run dev:localnet` turns the harness boundary into a filmable product demo.
It checks the pinned vendor install, boots native Devnet, deploys the genuine
`privacy_Privacy` class and `App20Mail`, starts a localhost wallet API, and
serves Vite. The generated `.env.localnet.local` and process state are ignored
and removed by `npm run localnet:stop`.

The browser wallet is labeled **Localnet (dev)** and registers through Wallet
Standard, so discovery, `SelectWallet`, `WalletAccountV6.connect`, account
permissions, chain selection, public key registration, STRK20 capability
checks, invocation, and balance reads all use the production seams. Its dev bar
switches one connected session between deterministic prefunded Alice and Bob
through a standard account-change event. This makes the following click path
local and extension-free:

- shield Alice and Bob through the real pool;
- register both app-specific x25519 mail keys with the real helper;
- encrypt as Alice, submit the production-shaped recovery-note + invoke action array,
  switch to Bob, scan public events, and decrypt locally;
- inspect the public chain-evidence panel;
- send and accept a typed OTC offer, including its private STRK transfer and
  one-sided receipt; and
- send and pay a STRK invoice.

The backend uses `CorePrivateTransfersProver`, direct contract discovery,
`ScreeningCallMockProofProvider`, and outside execution. The vendored client
still performs `${poolAddress}` / `${openNoteIds[0]}` resolution. The local
adapter supplies the SDK builder's self-surplus recipient for numeric transfer
change (the same upstream `surplusTo(user)` pattern used by simple private
transfers). The production-shaped local action array supplies the 7-base-unit
helper funding as an explicit in-transaction withdrawal before every recovery OPEN
note. It rejects unresolved placeholders and any mock proof-fact vector that is
not nine felts before broadcasting.

The local chain has a distinct dapp-facing chain id and is admitted only when
the build-time `VITE_E2E_WALLET` boolean is true. Production keeps the original
SN_MAIN/SN_SEPOLIA allowlist. The wallet is a gated dynamic import; a normal
`npm run build` emits no dev-wallet chunk and a grep for
`APP20_LOCALNET_DEV_WALLET_SENTINEL_7C91E2` in `dist/` is empty.

**Demonstrated locally now:** real pool/helper Cairo, production browser action
assembly, vendored placeholder compilation, real note/channel discovery and
settlement, helper authorization/events/recovery, two app identities, local
mail crypto/scanning, and the OTC/invoice UI.

**Still Ready-only:** a real SNIP-36 STARK proof (rather than empty Devnet proof
bytes), Ready's own approval screens and action assembler, its viewing-key
custody, proof/relayer/paymaster submission, hosted indexer/prover behavior, and
live Sepolia/mainnet screening. Localnet does not claim those facts.

### 6.5 Why there is no programmatic Sepolia test

We investigated running a Node e2e against the real Sepolia pool and concluded
it is not available to us. Recorded here so the gap is not mistaken for an
oversight.

- **Hosted proving and discovery URLs are unpublished.** The SDK requires
  caller-supplied `PROVING_SERVICE_URL` and `INDEXER_URL`; every public example
  is `localhost` or a placeholder, and upstream's mainnet template ships literal
  `TODO_MAINNET_PROVER_URL` / `TODO_MAINNET_INDEXER_URL` values. Upstream's own
  e2e README instructs contributors to fill real values "from the shared team
  document", so these endpoints are circulated privately rather than published.
- **Self-hosting cannot complete a deposit.** The prover and discovery service
  are open source and could run locally against a storage-proof-capable Sepolia
  RPC, but the live pool was deployed with StarkWare's screener key and every
  deposit must carry an FPI screening signature relayed by the hosted prover.
  No public screening endpoint or third-party credential exists, so a locally
  proved deposit is rejected on-chain. Devnet only works because a self-deployed
  pool uses the public test screener key.
- **Non-deposit actions are not screened.** If the hosted endpoints ever become
  available, a hybrid harness is viable: shield once through the wallet, then
  prove and submit private transfers and `privacy_invoke` mail locally.

Consequence: localnet demonstrates APP20's production-shaped action layout,
placeholder semantics, helper authorization/event/decryption path, recovery
open-note settlement, and action-ID nullifier against the genuine pool Cairo.
What remains Ready-only is a real STARK proof against hosted infrastructure,
Ready's own action assembly and extension UI, Ready/paymaster relayer
submission, and live Sepolia/mainnet screening (especially the mainnet screener
key rather than `0xCAFEBABE`). Ready plus a human is still the only route to
those live-network facts, but it is no longer needed to establish that the
APP20 batch itself reaches the helper or rejects a duplicate action ID.

## 7. Historical Phase 3 — discover + decrypt + memo

**Superseded; not an active live-network plan.** The former phase proposed two-wallet Sepolia Mail validation after a reviewed helper deployment. Localnet now supplies development evidence, while any public helper, wallet transaction, hosted discovery design, or manual Sepolia exercise requires a new approved scope.

## 8. Historical Phase 4 — Mainnet scoring artifacts

**Cancelled by the localnet-final decision.** No Mainnet helper deployment, scoring transaction, `strk20.json` population, or value action is authorized. The former sprint deadline and transaction checklist are archival context only.

## 8.1 Phase 5 — typed envelopes and OTC-in-chat · code complete locally 2026-08-14

Envelope v1, legacy text decoding, one-sided OTC state, invoke-only mail,
transfer-plus-accept batches, mixed inbox cards, local aliases, and STRK payment
requests are implemented. No Cairo changed. The former Sepolia two-wallet
validation requirement is superseded; any future live validation needs a new
scope. Code-complete does not establish sender authentication or atomic
settlement of the quoted token leg.

Payload deviation approved during implementation: `payment_request` adds the
claimed `requester` address and uses a random `requestId`, because the unbound
`MessagePosted` event has no sender address from which a payer could build the
private transfer. The card always discloses that raw, unauthenticated address.

## 8.2 Standalone payment links · code complete locally 2026-08-17

`/pay` without a fragment now creates an unsigned request without a mail send,
helper call, or pool fee. The mailbox exposes it through **Request**. The `app20p2`
fragment binds canonical STRK fields, a random request ID, expiry, requester,
and Mainnet/Sepolia; malformed, legacy unscoped, and wrong-network links fail
closed. QR/copy creation sends no fragment in HTTP and invokes no wallet action.

Opening a link remains review-only. The payer explicitly hands it into the
mailbox, where the existing payer-owned attempt nonce, live fee/balance guard,
wallet approval, submitted/confirmed transaction lifecycle, and local duplicate
protection apply. Paid status is not global: another browser/profile can approve
the same unsigned link again, so the UI requires honest replay warnings and
defaults creation to a 72-hour expiry. The real-pool localnet browser suite now
covers standalone create → QR → fresh-context review with zero privacy action at
creation. No live Ready payment validation is authorized in the current scope.

## 9. Testing

**Headless app:** `npm ci` · `npm test` · `npm run typecheck` · `npm run build`.

**Cairo (from `cairo/`):** `scarb build` · `snforge test`.

**Local integration:** `npm run devnet` · `npm run test:e2e` covers the mock-pool scope in §6.3. After the one-time `npm run pool:setup`, `npm run test:e2e:pool` covers the §6.4 real-pool/simulated-proof tier, while `npm run dev:localnet` / `npm run localnet:stop` serves the two-identity browser path in §6.4.1. None is a real STARK proof.

**Historical manual phases (superseded):** the former plan proposed Ready Sepolia checks, an audited helper, encrypted Mail validation, memo/payment checks, and tiny Mainnet scoring transactions. None is an active instruction. Current validation is local/offline unless a new live-network scope is explicitly approved.

## 10. Compliance & security notes

- Deposit screening is protocol-enforced. Never present APP20 as a workaround.
- Selective disclosure exists. It is not automatic compliance.
- The team owns review, audit, deploy, and maintenance of `App20Mail`.
- No viewing keys, spending keys, or Alchemy keys in git.
- Do not build a hosted inbox that accepts users’ viewing keys.

## 10.1 Finding — destination-bound escrow payouts and Wallet API

App20Escrow deliberately includes the payout `note_id` in Claim and Timeout
signatures. That binding prevents a calldata observer from copying a valid
signature and winning the race with a different destination note; replay
protection alone cannot stop the copied transaction from being the first use.
The current Wallet API assembles `${openNoteIds[0]}` inside the wallet, but does
not expose that id before assembly and has no signing placeholder that can sign
over assembled note ids. Historical app-side builders can express Fund and Fill
shapes, but no public-network RFQ route is wired or authorized. Production
Claim and Timeout remain unavailable, and APP20 must not create production
escrow funds while their destination-bound path is unresolved.

The ecosystem seam needed is either (a) a pre-assembly open-note id returned to
the dapp without exposing note secrets, or (b) a wallet-resolved signing
callback/placeholder over the assembled note id. APP20 does not weaken the
contract's destination binding to hide this gap. The gated localnet wallet uses
the vendored compiler's `args.openNotes` callback to assemble the id and sign in
one local compiler pass, demonstrating Fund → Fill → Claim without changing the
production contract or Wallet API claims.

No Mainnet escrow or scoring path exists or is authorized.

## 11. Open items to re-verify at build time

- Freshness script / WalletAccount guide.
- Ready acceptance of the three-action payment batch and literal wallet placeholder resolution.
- Backup import/recovery and stronger at-rest protection for the device mail seed.
- Sepolia event-scan start block or a user-held discovery index for a durable inbox.
- Whether Ready already relayer-submits every `strk20InvokeTransaction`.
- Pool fee via `get_fee_amount`.
- Rotate any historical browser-bundled RPC key and keep replacements in Cloudflare Worker Secrets only.

## 12. Links

- RFP-01: <https://strk20.starknet.io/rfp/private-messaging>
- Hackathon: <https://github.com/starkience/strk20-hackathon>
- Day 0: <https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md>
- Repo: <https://github.com/gstohl/app20>
- What STRK20 is: <https://strk20-by-example.org/what-is-strk20>
- Channels: <https://strk20-by-example.org/channels-and-subchannels>
- Viewing keys: <https://strk20-by-example.org/viewing-keys>
- Wallet API: <https://strk20-by-example.org/starknet-wallet-api/overview>
- `privacy_invoke`: <https://strk20-by-example.org/helpers/privacy-invoke>
- Wallet test dapp: <https://starknet-wallet-account.vercel.app/>
- Ready: <https://www.ready.co/>

Historical Phase 2 implementation remains source context only. The operative scope is localnet-final: there is no live APP20 Mail/escrow/RFQ execution gate on Sepolia or Mainnet until a new scope receives explicit approval.
