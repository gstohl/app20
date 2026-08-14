# STRK20 Privacy Integration Plan — Quietline

Generated 2026-08-14 by the strk20-privacy-integration skill. Pivoted from Feltproof / RFP-03 the same day. Statuses current at generation; re-verify pins with `python3 .agents/skills/strk20-privacy-integration/scripts/check_freshness.py` before building.

Public repo: <https://github.com/gstohl/quietline>
Sprint: STRK20 Private Sprint, 14–31 Aug 2026
Inspired by RFP-01: <https://strk20.starknet.io/rfp/private-messaging>

This plan was approved and Phase 2 was implemented on 2026-08-14. The message helper remains the team’s own Cairo to review, audit, deploy, and maintain; code-complete does not mean deployed or production-audited.

## 0. Decided interview answers

These are closed. Do not re-interview. Poker decisions are void.

| Skill question | Decided answer |
| --- | --- |
| Builder type | Normal dapp: users connect Ready. The team also owns one helper, `QuietlineMail`. |
| Privacy goal | Hide who mailed whom and the message body. Optional payment memo rides a private transfer. |
| Not building | Poker, tables, chips-as-cards, trusted dealer, any gambling UI. |
| Environment | `SN_MAIN` for scoring. Sepolia for day-to-day. Alchemy key in an env var, never committed. |
| Wallets | Ready. Xverse dapp-facing Wallet API is in progress — degrade, do not depend on it. |
| Paymaster | Rely on Ready’s existing private-tx / relayer submission. Custom paymaster is stretch. |
| Session keys | Stretch. One wallet popup per private action is acceptable. |
| Scope | One complete send → discover → decrypt loop by 31 Aug 2026, plus an optional memo-on-transfer. |
| Route | Privacy Wallet API via starknet.js for shield / unshield / private transfer, plus `privacy_invoke` to append encrypted payloads to per-channel storage. |
| Sub-accounts | Do **not** use Wallet API sub-accounts (pending). |
| Viewing keys | Never in the dapp. Discovery that needs `k` stays in the wallet or a local, user-held scan — never uploaded. |
| Day-0 token | **STRK**. |

## 1. Project snapshot

- Stack: Next.js 16 · React 19 · TypeScript · zustand · `starknet@10.4.0` · get-starknet `6.0.3` · `@starknet-io/types-js@0.10.3`. Helper (later): Scarb edition `2024_07`, `starknet = "2.18.0"`.
- Landed plug-in points:
  - `src/app/components/client/WalletHandle/SelectWallet.tsx`
  - `src/app/components/Wallet/walletContext.ts`
  - `src/app/components/client/provider/providerContext.ts`
  - `src/utils/constants.ts`
  - `src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx`
  - `src/lib/strk20.ts`, `src/lib/addresses.ts`
- Phase 2 landed:
  - `src/app/inbox/page.tsx`, `src/components/mail/*`
  - `src/lib/mail.ts`, `src/lib/mail-actions.ts`
  - Team-written helper: `cairo/src/lib.cairo`
- Privacy goal: hide sender, recipient, and content; keep the fact+timing of a pool interaction public.
- Environment: Sepolia daily; `SN_MAIN` against pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` for three scoring txs.

## 2. Chosen route: Privacy Wallet API via starknet.js + `QuietlineMail` anonymizer

Quietline is a normal dapp. User-facing privacy goes through `WalletAccountV6`. Shield, unshield, and private transfers need no custom contract. Storing an encrypted payload on the existing ECDH channel needs our own helper. The pool already supplies key agreement, persistent channels, and sender anonymity via `InvokeExternal` (the pool is `msg.sender`).

**The rule this follows:** this app never touches viewing keys — the user’s wallet acts on its behalf via starknet.js. If a step would need `k` in the dapp, the route is wrong.

RFP-01 also names an off-chain discovery indexer and SDK methods `sendMessage` / `discoverMessages`. Sprint reading: ship send via Wallet API + helper first; discovery is local scan or a user-run indexer that receives a viewing key **only in the user’s process**. Do not stand up a hosted indexer that holds `k`.

## 3. What this delivers — hidden vs visible

Adapted from <https://strk20-by-example.org/what-is-strk20> and RFP-01.

| Private | Public |
| --- | --- |
| Sender identity (pool is caller) | That a pool transaction occurred, and its timestamp |
| Recipient identity (channel key) | Open-channel *existence* on first contact, not who |
| Message body | Helper storage occupancy / that *some* payload was appended |
| Private-transfer amount and counterparties | Shield / unshield amounts and those ERC-20 legs |

Honest limits: **Quietline hides who wrote whom and what they said. It does not hide that someone used the pool at that time.** Timing correlation on a two-person demo is real — say so in the README.

## 4. Prerequisites & versions

Same pins as the landed scaffold. Do not unpin.

| Package / tool | Pin |
| --- | --- |
| `starknet` | `10.4.0` |
| `@starknet-io/get-starknet-discovery` | `6.0.3` |
| `@starknet-io/get-starknet-wallet-standard` | `6.0.3` |
| `@starknet-io/types-js` | `0.10.3` |
| Next / React | `next@^16.0.8`, `react@19.2.1` |
| Test wallet | Ready extension |
| Pool (mainnet) | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Token | STRK `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |

Env:

```
NEXT_PUBLIC_PROVIDER_URL=your_alchemy_key_here
NEXT_PUBLIC_MAIL_HELPER_SEPOLIA=0x0
NEXT_PUBLIC_MAIL_HELPER_MAINNET=0x0
```

`NEXT_PUBLIC_*` Alchemy keys ship in the browser bundle. Treat as public or move RPC behind a server before claiming RPC-operator privacy.

## 5. Phase 1 — first shielded flow · retargeted 2026-08-14

Status: code complete for wallet plumbing; poker branding and DEMO echo removed in the pivot commit. Remaining manual Ready checks on Sepolia:

- Connect Ready; privacy tabs appear.
- Non-STRK20 wallet degrades without a balance probe.
- Shield a small Sepolia STRK (approve + deposit).
- Private self-transfer, balances, unshield.
- Cross-check <https://starknet-wallet-account.vercel.app/>.

Do not deploy a helper. Do not touch `strk20.json`. Do not enable mainnet financial actions until Phase 4.

## 6. Phase 2 — compose + `QuietlineMail` invoke wiring ✅ code complete 2026-08-14

Status: code-complete locally. No Sepolia or mainnet helper was deployed, no live STRK20 transaction was sent, and the manual Ready gate remains open.

### 6.1 Landed dapp files

| File | Landed behavior |
| --- | --- |
| `src/app/page.tsx` | Links the existing wallet-action lobby to `/inbox` |
| `src/app/inbox/page.tsx` | Network-aware onboarding, compose, public-event scan, and newest-first local plaintext list |
| `src/components/mail/Onboard.tsx` | Locally persisted random device seed, one-time backup display, and public `register_pubkey` transaction |
| `src/components/mail/Compose.tsx` | Recipient directory lookup, local encryption, optional private STRK attachment, and STRK20 submission |
| `src/components/mail/Thread.tsx` | Displays successful local decryptions only; no plaintext persistence |
| `src/lib/mail.ts` | x25519 + HKDF-SHA256 + AES-256-GCM, bounded felt packing, authenticated binary retention, and view-tag scan |
| `src/lib/mail-actions.ts` | Builds optional numeric `transfer`, recovery open note, and final `invoke`; preserves `${poolAddress}` and `${openNoteIds[0]}` as wallet literals |
| `cairo/src/lib.cairo` | Team-written helper and public-key directory |

The Phase 2 mail private key is an app-specific x25519 key, not the STRK20 viewing key `k`. The UI generates 32 random bytes once per chain and address, persists them under `quietline/mailseed/v1/<chainId>/<address>` in the browser profile, and shows a backup only when first created. It does not derive mail keys from wallet signatures.

### 6.2 Landed helper

`QuietlineMail` pins the authorized pool address in constructor storage and never trusts the calldata `pool_address` placeholder for authorization.

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
| Next / React / TypeScript / Vitest | `16.3.1` / `19.2.1` / `5.9.3` / `4.1.10` |
| starknet.js / Wallet API types | `10.4.0` / `0.10.3` |
| Scarb / Cairo | `2.18.0` / `2.18.0` |
| Starknet Foundry | `snforge 0.63.0` |
| Docker | `29.2.1` |
| Starknet Devnet | `0.9.2` |

Devnet 0.9.2 image pin: `docker.io/shardlabs/starknet-devnet-rs@sha256:2733f463816b4028a77e33cea2f55fbbdeb36dcacb4331d886d921361bd07bcf`. The default port is bound to `127.0.0.1` only.

The local e2e deploys the helper, registers a recipient key, encrypts an exact plaintext, posts as the configured **mock pool caller**, scans and decrypts the event, confirms a wrong key sees zero messages, and proves the 0.001 STRK dust balance is approved, echoed, and pulled back. It does **not** run the real STRK20 pool, Ready Wallet API action assembly, `${poolAddress}` / `${openNoteIds[0]}` resolution, SNIP-36 proving, relayer submission, note maturity/discovery, screening, pool fees, or two-wallet Sepolia behavior.

## 7. Phase 3 — discover + decrypt + memo

Status: not started.

Entry criterion: helper on Sepolia, Ready can post one encrypted payload without revert.

1. Two Ready wallets shield STRK and wait ~10 blocks.
2. Alice `privacy_invoke` Send to Bob.
3. Bob’s client discovers the payload (wallet-mediated or local scan) and decrypts on device.
4. Optional: Alice SendWithPayment — 1 STRK private transfer + memo.
5. UI never prints Alice or Bob’s addresses next to the thread if we can show handles instead.

Out of this phase: hosted viewing-key indexer, Xverse as supported, Wallet API sub-accounts, custom paymaster.

## 8. Phase 4 — mainnet scoring artifacts

Status: not started.

1. Deploy `QuietlineMail` to `SN_MAIN`. Addresses in `strk20.json` `contracts`.
2. Three successful mainnet pool-touching txs: shield, private send or memo-transfer, unshield or second private action.
3. Demo URL + 3-minute video of send → discover.
4. README stays honest about §3.

Deadline: **31 Aug 2026, 23:59 UTC**.

## 9. Testing

**Headless app:** `npm ci` · `npm test` · `npm run typecheck` · `npm run build`.

**Cairo (from `cairo/`):** `scarb build` · `snforge test`.

**Local integration:** `npm run devnet` · `npm run test:e2e`; this is the mock-pool scope recorded in §6.3, not a real STRK20 proof.

**Manual — Phase 1:** Ready connect, degrade, Sepolia shield / transfer / unshield.

**Manual — Phase 2–3:** deploy the audited helper on Sepolia; register two durable keys; post a message; second wallet decrypts; memo+payment is atomic; Voyager sender is a relayer.

**Manual — Phase 4:** tiny mainnet amounts; three hashes in `strk20.json`.

## 10. Compliance & security notes

- Deposit screening is protocol-enforced. Never present Quietline as a workaround.
- Selective disclosure exists. It is not automatic compliance.
- The team owns review, audit, deploy, and maintenance of `QuietlineMail`.
- No viewing keys, spending keys, or Alchemy keys in git.
- Do not build a hosted inbox that accepts users’ viewing keys.

## 11. Open items to re-verify at build time

- Freshness script / WalletAccount guide.
- Ready acceptance of the three-action payment batch and literal wallet placeholder resolution.
- Backup import/recovery and stronger at-rest protection for the device mail seed.
- Sepolia event-scan start block or a user-held discovery index for a durable inbox.
- Whether Ready already relayer-submits every `strk20InvokeTransaction`.
- Pool fee via `get_fee_amount`.
- Rotate the current `NEXT_PUBLIC` Alchemy key; it has been in a client bundle.

## 12. Links

- RFP-01: <https://strk20.starknet.io/rfp/private-messaging>
- Hackathon: <https://github.com/starkience/strk20-hackathon>
- Day 0: <https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md>
- Repo: <https://github.com/gstohl/quietline>
- What STRK20 is: <https://strk20-by-example.org/what-is-strk20>
- Channels: <https://strk20-by-example.org/channels-and-subchannels>
- Viewing keys: <https://strk20-by-example.org/viewing-keys>
- Wallet API: <https://strk20-by-example.org/starknet-wallet-api/overview>
- `privacy_invoke`: <https://strk20-by-example.org/helpers/privacy-invoke>
- Wallet test dapp: <https://starknet-wallet-account.vercel.app/>
- Ready: <https://www.ready.co/>

Phase 2 is code-complete only. The next gate is helper review/audit plus Ready validation on Sepolia; do not revive poker scope or enable mainnet sends early.
