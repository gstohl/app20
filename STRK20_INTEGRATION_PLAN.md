# STRK20 Privacy Integration Plan — Quietline

Generated 2026-08-14 by the strk20-privacy-integration skill. Pivoted from Feltproof / RFP-03 the same day. Statuses current at generation; re-verify pins with `python3 .agents/skills/strk20-privacy-integration/scripts/check_freshness.py` before building.

Public repo: <https://github.com/gstohl/feltproof> (product name Quietline; URL not renamed this sprint)
Sprint: STRK20 Private Sprint, 14–31 Aug 2026
Inspired by RFP-01: <https://strk20.starknet.io/rfp/private-messaging>

Nothing in the inbox or helper changes until this plan is approved. After approval, execution is app code only, one phase at a time. The message helper is the team’s own Cairo to write, review, audit, deploy, and maintain — this skill never generates it.

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
- Planned after this pivot:
  - `src/app/inbox/page.tsx`, `src/components/mail/*`
  - Team-written helper: `cairo/src/quietline_mail.cairo`
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

## 6. Phase 2 — compose + `QuietlineMail` invoke wiring

Status: not started. Depends on Phase 1 manual pass.

### 6.1 Dapp files

| File | Change |
| --- | --- |
| `src/app/page.tsx` | Quietline lobby: connect, shield, open inbox |
| `src/app/inbox/page.tsx` | Thread list + compose |
| `src/components/mail/Compose.tsx` | Recipient (registered address), body, optional attach-payment |
| `src/components/mail/Thread.tsx` | Locally decrypted messages only |
| `src/lib/mail.ts` | Client encode/decode of helper payloads; no viewing key |
| `src/lib/strk20.ts` | `invokeMail` using withdraw/transfer/`invoke` as needed |
| `cairo/src/quietline_mail.cairo` | **Team** writes this. Skill does not generate Cairo. |

### 6.2 Helper — interface only

Study: starter echo helper, RFP-01 write-up. Mandatory `privacy_invoke`, caller must be the **configured** pool (immutable constructor address — do not trust calldata `pool_address`).

- `privacy_invoke(op, channel_hint, payload_hash, extra) -> Span<OpenNoteDeposit>`
  - `op`: `Send`, `SendWithPayment`
  - `Send` may return an empty span (payload only).
  - `SendWithPayment` pairs a private transfer with the memo; open-note return only if value must come back.
- Public events indexed by a **channel id / commitment**, never a wallet: `MessagePosted`.
- Payload: ciphertext bytes felt-packed in helper storage or an event. Encryption uses the same ECDH channel derivation the pool uses for notes **inside the wallet**, or a sit-down published pubkey. The dapp must not ask for `k`.

Atomicity tests: only the pool can call; garbage payload reverts or is ignored; payment+memo rolls back together; helper ERC-20 balance returns to ~0 after a payment op.

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

**Headless:** `npm ci` · `npm run typecheck` · `npm run build`. Helper: `scarb test` / `snforge`.

**Manual — Phase 1:** Ready connect, degrade, Sepolia shield / transfer / unshield.

**Manual — Phase 2–3:** post a message; second wallet decrypts; memo+payment atomic; Voyager sender is a relayer.

**Manual — Phase 4:** tiny mainnet amounts; three hashes in `strk20.json`.

## 10. Compliance & security notes

- Deposit screening is protocol-enforced. Never present Quietline as a workaround.
- Selective disclosure exists. It is not automatic compliance.
- The team owns review, audit, deploy, and maintenance of `QuietlineMail`.
- No viewing keys, spending keys, or Alchemy keys in git.
- Do not build a hosted inbox that accepts users’ viewing keys.

## 11. Open items to re-verify at build time

- Freshness script / WalletAccount guide.
- How a Wallet-API dapp discovers helper-stored ciphertexts without `k`.
- Whether Ready already relayer-submits every `strk20InvokeTransaction`.
- Pool fee via `get_fee_amount`.
- Rotate the current `NEXT_PUBLIC` Alchemy key; it has been in a client bundle.

## 12. Links

- RFP-01: <https://strk20.starknet.io/rfp/private-messaging>
- Hackathon: <https://github.com/starkience/strk20-hackathon>
- Day 0: <https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md>
- Repo: <https://github.com/gstohl/feltproof>
- What STRK20 is: <https://strk20-by-example.org/what-is-strk20>
- Channels: <https://strk20-by-example.org/channels-and-subchannels>
- Viewing keys: <https://strk20-by-example.org/viewing-keys>
- Wallet API: <https://strk20-by-example.org/starknet-wallet-api/overview>
- `privacy_invoke`: <https://strk20-by-example.org/helpers/privacy-invoke>
- Wallet test dapp: <https://starknet-wallet-account.vercel.app/>
- Ready: <https://www.ready.co/>

After this file is approved, execute Phase 2 only. Do not generate Cairo. Do not revive poker scope.
