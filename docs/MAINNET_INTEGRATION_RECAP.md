# Mainnet proving, Privy and agent SDK recap

September 8 update: the Chat helper is deployed and an [operator-controlled mainnet message](../deployments/mainnet/chat-message-2026-09-08.json) is verified, including decryption, replay protection and unchanged private balance. Ready extension and recipient-payment acceptance remain unverified. The current `/rfq` is confidential-only; new execution of the earlier public-term maker protocol is disabled. The sections below retain the September 7 release history and its checks, not current activation instructions.

Published to https://app20.io as Worker version `cda4f8a7-7360-490e-bcea-40ce128d7d00`.

## Delivered

- Authenticated Starkscan asynchronous proving relay. Provider credentials stay in Cloudflare secret storage. Agent tokens are separate, and job capabilities prevent polling another caller's result. Per-caller idempotency and request/concurrency gates are enforced.
- Official STRK20 SDK adapter with complete proof-result persistence, screening-data preservation and uncertain-delivery fencing.
- Privy mainnet configuration, public app/client IDs, explicit wallet transitions, direct contract discovery and corrected privacy disclosures. Browser proof journals are encrypted in IndexedDB.
- Installable Node SDK with maker operations, encrypted RFQs and `createPrivacyWallet` for registration, shielding, transfers, withdrawals and an APP20 settlement executor. Local journals and gas caps protect against duplicate/uncertain submissions.
- Rewritten README, updated agent guidance and machine-readable capabilities.
- New `[20]` SVG favicon. Original swap layout and records remain together; maker onboarding remains a separate page.
- Corrected Chat's stale blanket live-network restriction message and prepared a fresh mainnet Chat deployment candidate.

## Accepted proving limitation

This route is HTTPS JSON, not OHTTP. APP20/Cloudflare and Starkscan/the proving operator can access proving payloads. Signing/viewing secrets stay with wallets, but proving witnesses can reveal transaction details. No OHTTP gateway was advertised in the authenticated capabilities, full docs or OpenAPI checked on 2026-09-07. Existing OHTTP code is separate and does not downgrade requests silently.

## Verification

- Application tests: 996 passed.
- Privy tests: 96 passed.
- Worker tests: 60 passed.
- Node SDK tests: 6 passed.
- Production build, type checks, bundle budgets and credential-leak scan passed.
- SDK installed outside the repository; TypeScript declarations compiled and its read-only client verified mainnet deployment pins.
- Desktop browser checks verified Privy mainnet wording, explicit Ready/Privy transition and the favicon.
- Live Worker probes: unauthenticated proof request → 401; authenticated invalid request → 400; unauthorized job polling → 403. No proof job was created by those probes.

## Still required

1. Set `PRIVY_APP_SECRET` directly in Cloudflare. It was not provided; authenticated Privy wallet lookup is not verified. The public app and client IDs are configured. Privy project/domain and signing settings also need to match the live app.
2. Ready/Privy browser wallet acceptance, plus standalone private transfer and unshield verification. The Node SDK has now completed real mainnet registration/shield and three private fills; see the execution update below.
3. Declare/deploy/configure the separate Chat helper. The candidate is in `artifacts/mainnet-preparation/candidate.json`; registration is still unavailable until this is done. Proving access does not create the Chat deployment.
4. The browser RFQ remains on Ready. Privy is a separate wallet screen; the Node library supplies its own private executor.

## RFQ comparison implementation (2026-09-07)

Published to https://app20.io as Worker version `b032f598-396f-44b2-939c-02d81409b8f3`; live browser verified automatic default, required minimum, Advanced fixed requests and the Chat link.

Implemented after the release above: automatic bounded preliminary comparison; visible required minimum receive; one selected funded reservation; explicit review of changed prices; direct maker requests under Advanced; collapsed preliminary request history; and a link to bilateral Chat negotiation. No contract change is needed. Updated makers now answer preliminary requests without locking inventory and only reserve when a request includes a settlement commitment.

Operator defaults limit active tracked reservations to 20, repeated preliminary requests to one per account per 60 seconds, and new requests after a funded response to one per account per 1200 seconds. A preliminary response may be followed immediately by a funded request. Existing persistent gas budgets and per-run response limits remain. Account limits cannot prevent Sybils; makers still bear gas costs and bounded price risk.

Browser tests use three encrypted maker replies, reject one below-minimum reply, choose the best valid price, reserve only that maker, require review of changed funded terms, and recover a submitted settlement across reload. Minimums are validated again before acceptance. Browser wallet acceptance and Chat deployment remain separate from the completed Node mainnet fills below.

Additional verification: 997 application tests and 139 maker tests passed; production build/type checks/leak scan passed; desktop fixtures cover direct fixed requests and concurrent reservation fencing. The local real-pool test confirms preliminary requests leave inventory unchanged, followed by funded settlement, replay rejection, proceeds withdrawal and expiry release using simulated devnet proof facts.

## Real mainnet execution (2026-09-07)

The Node SDK completed STRK20 registration/shield and three swaps with actual hosted proofs. Each sold 0.01 shielded STRK for 0.001 shielded native USDC. The same operator controlled maker and taker. Successful receipts, quote-fill events, pool/APP20 traces and class hashes are verified; local note discovery found 0.003 shielded USDC. The test maker's proceeds were withdrawn and it was deactivated with zero remaining inventory.

The three qualifying hashes are saved in `strk20.json` and [public execution evidence](../deployments/mainnet/smoke-test-2026-09-07.json). Demo fees were 35.863877034965690848 STRK; deployment plus demo remained within 65 STRK. Starkscan supplied proofs through the authenticated Worker; Lava supplied proof-compatible transaction submission and traces. The final video URL remains pending; existing browser/localnet recordings are still labelled rehearsals.
