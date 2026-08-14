# STRK20 Privacy Integration Plan — Feltproof

Generated 2026-08-14 by the strk20-privacy-integration skill. Statuses were current at generation time (skill pins last re-verified 2026-07-29). Re-verify “coming soon” items and run `python3 .agents/skills/strk20-privacy-integration/scripts/check_freshness.py` before building.

Public repo: <https://github.com/gstohl/feltproof>
Sprint: STRK20 Private Sprint, 14–31 Aug 2026
Inspired by RFP-03: <https://strk20.starknet.io/rfp/private-poker>

Nothing in the app changes until this plan is reviewed and approved. After approval, execution is app code only, one phase at a time. The `PokerGame` anonymizer is the team’s own Cairo to write, review, audit, deploy, and maintain — this skill never generates it.

## 0. Decided interview answers

These are closed. Do not re-interview.

| Skill question | Decided answer |
| --- | --- |
| Builder type | Normal dapp: players connect Ready. The team also owns one helper, `PokerGame`. |
| Privacy goal | Hide player identities, hole cards, and stacks / session PnL. Bet sizes, board, fold, and showdown stay public. |
| Cards vs notes | Native STRK20 notes are `(owner, token, amount)` UTXOs — **chips, not cards**. Hole cards are helper-stored ciphertexts plus on-chain commitments. |
| Hole-card keys | Wallet API never gives the dapp `k` or channel keys. Encrypt hole cards to a per-hand key from wallet `signMessage`. Never persist a viewing key. |
| Dealer | Trusted dealer V1: commit `H(seed)` on-chain, Fisher-Yates from the seed, reveal after deal. A STARK of `perm = shuffle(seed)` is stretch. Mental poker is out of sprint. |
| Environment | `SN_MAIN` for scoring. Sepolia for day-to-day. Alchemy key in an env var, never committed. |
| Wallets | Ready. Xverse dapp-facing Wallet API is in progress — degrade, do not depend on it. |
| Paymaster | Rely on Ready’s existing private-tx / relayer submission. A custom paymaster is stretch. |
| Session keys | Stretch. One wallet popup per private action is acceptable. |
| Scope | One complete heads-up NLHE cash-game hand by 31 Aug 2026. |
| Route | Privacy Wallet API via starknet.js for shield / unshield / private transfer, plus `privacy_invoke` for buy-in / deal / bet / fold / reveal / settle. |
| Sub-accounts | Do **not** use Wallet API sub-accounts (pending). |
| Day-0 token | **STRK** (starter kit + Day-0). USDC later if time. |

## 1. Project snapshot

- Stack today: **greenfield**. No `package.json`, no Scarb package, no Cairo, no wallet connect.
  - `README.md` — product intent and hidden-vs-visible table
  - `strk20.json` — empty scoring fields
  - `LICENSE` — MIT
  - `skills-lock.json` + `.agents/skills/strk20-privacy-integration/`
- Target stack (starter-kit based): Next.js 16 · React 19 · TypeScript · zustand · `starknet@10.4.0` · get-starknet `6.0.3` · `@starknet-io/types-js@0.10.3`. Helper: Scarb edition `2024_07`, `starknet = "2.18.0"`, Starknet Foundry. Package manager: **npm**.
- Planned plug-in points after scaffold:
  - `src/app/components/client/WalletHandle/SelectWallet.tsx`
  - `src/app/components/Wallet/walletContext.ts`
  - `src/app/components/client/provider/providerContext.ts`
  - `src/utils/constants.ts`
  - `src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx`
  - `src/lib/strk20.ts`
  - `src/app/page.tsx`, `src/app/table/page.tsx`, `src/components/table/Table.tsx`
  - Team-written helper (interface only here): `cairo/src/poker_game.cairo`
- Privacy goal: hide who is sitting, their hole cards, and their stacks / session PnL; keep poker-visible action public.
- Environment: Sepolia daily; `SN_MAIN` against pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` for the three scoring txs.

## 2. Chosen route: Privacy Wallet API via starknet.js + `PokerGame` anonymizer

Feltproof is a normal dapp. User-facing privacy goes through `WalletAccountV6`. Shield, unshield, and private chip transfers need no custom contract. Deal / bet / fold / reveal / settle need our own anonymizer. No first-party poker helper exists.

**The rule this follows:** this app never touches viewing keys — the user’s wallet acts on its behalf via starknet.js. If a step would need keys, notes, or proofs in the dapp, the route is wrong.

- Anonymizer hides the **user address** behind game actions. Bet sizes stay public.
- Ready’s privacy relayer is expected to be the tx sender. Do not add a parallel public `account.execute` path for bets.
- Wallet API sub-accounts are **not** in this sprint.

## 3. What this delivers — hidden vs visible

Adapted from <https://strk20-by-example.org/what-is-strk20>, RFP-03, and this repo’s README.

| Private | Public |
| --- | --- |
| Who is sitting. Relayer / paymaster is the tx sender | That a hand happened, and its timing |
| Hole cards — helper ciphertexts + commitments; only the holder’s session key decrypts | Bet sizes and the running pot |
| Stacks and session PnL (encrypted STRK notes) | Board, street, fold, showdown |
| Sender / receiver / amount / token of a private chip transfer; which notes were spent | Shield / unshield amounts and the public ERC-20 legs |
| Owner of an open note created by settle | Open-note **amount** (plaintext). Do not claim the pot size is private |

Honest limits: **`PokerGame` hides who acted. It does not hide that a heads-up hand is being played, how large the bets are, or what the board is.**

Further honesty the UI must not paper over:

- Shielding is not private. `Deposit` names the depositor and amount. Buy-in is **two transactions**: shield, wait ~10 blocks, then `privacy_invoke` buy-in.
- Native notes cannot store rank/suit. Do not encode cards as token amounts. Do not invent a Card ERC-20 in this sprint.
- The dapp cannot decrypt pool notes. Hole-card UI uses the `signMessage`-derived session key, labeled as such.
- Trusted dealer **knows the deck**. V1 fairness is commit-reveal + public recompute, not “dealer cannot peek.”
- History must not use `tx.sender`. Attribute shields from the pool `Deposit` event. Game events key by `table_id` / seat, never wallet.
- One `invoke` per pool tx. A hand is many txs. Proofs are slow — spinner, do not spam.

## 4. Prerequisites & versions

Pin explicitly. Unpinned `starknet` resolves to 10.0.x and has no `WalletAccountV6`. The starter kit ships get-starknet `6.0.2` — **upgrade on copy**.

| Package / tool | Pin | Notes |
| --- | --- | --- |
| `starknet` | `10.4.0` (floor ≥ 10.4.0) | npm `next` tag |
| `@starknet-io/get-starknet-discovery` | `6.0.3` | npm `next` |
| `@starknet-io/get-starknet-wallet-standard` | `6.0.3` | Import `WalletWithStarknetFeatures` from `…/features` |
| `@starknet-io/types-js` | `0.10.3` | Wallet API spec v0.10.3 |
| Next / React | `next@^16.0.8`, `react@19.2.1` | Starter kit |
| `zustand` | `^5.0.9` | Wallet store |
| Test wallet | Ready extension | Only privacy-enabled wallet to test against today |
| Pool (mainnet) | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | |
| Chain IDs | `SN_MAIN` / `SN_SEPOLIA` | Provider index 0 / 2 |
| Scarb / Cairo | edition `2024_07`, `starknet = "2.18.0"` | Team helper |
| Token | STRK `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | Day-0 scoring |

Env (placeholders only):

```
# .env.example  (create; copy to .env.local locally)
NEXT_PUBLIC_PROVIDER_URL=your_alchemy_key_here
NEXT_PUBLIC_POKER_HELPER_SEPOLIA=0x0
NEXT_PUBLIC_POKER_HELPER_MAINNET=0x0
```

Alchemy prefixes stay in `src/utils/constants.ts`; the env var is the key only:

- Mainnet: `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/` + key
- Sepolia: `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/` + key

Day-0 also lists `https://rpc.starknet.lava.build`. Do not guess discovery / proving URLs — wallets own those on this route.

## 5. Phase 1 — first shielded flow (buildable now) · Days 1–3 (14–16 Aug) — ✅ done-for-code 2026-08-14

Status: code complete; headless typecheck/build passed 2026-08-14. Remaining manual Ready checks on Sepolia:

- Connect Ready through get-starknet v6 and confirm the privacy tabs appear.
- Confirm a non-STRK20 wallet degrades to the Ready prompt without a balance probe.
- Shield a small amount of Sepolia STRK (approve + deposit prompts) and verify screening declines render as protocol state.
- Run a private self-transfer, query balances, and unshield back to the connected account.
- Cross-check the flow against <https://starknet-wallet-account.vercel.app/>.

Goal: Feltproof-branded Next.js app that connects Ready, detects STRK20, and completes shield / private transfer / unshield on Sepolia. No helper required.

1. Scaffold from <https://github.com/Akashneelesh/strk20-starter-kit> into this repo. Keep existing `README.md`, `LICENSE`, `strk20.json`.
   - Create `package.json`, `tsconfig.json`, `next.config.js`, `.env.example`, `src/app/*`
   - Create `SelectWallet.tsx`, `WalletAccountV6Tag.tsx`, `walletContext.ts`, `providerContext.ts`, `src/utils/constants.ts`
   - Create `src/lib/strk20.ts` (capability check, `submitActions`, timeout around `waitForTransaction`)
   - Create `src/lib/addresses.ts` (`BigInt(a) === BigInt(b)`; never string-eq felts)
   - Do **not** ship the echo helper as product code. Study `cairo/src/lib.cairo` only.
2. Install pinned versions (not the starter’s 6.0.2):

   ```sh
   npm install @starknet-io/get-starknet-discovery@6.0.3 \
               @starknet-io/get-starknet-wallet-standard@6.0.3 \
               @starknet-io/types-js@0.10.3 \
               starknet@10.4.0
   ```

3. Connect in `SelectWallet.tsx` via `createStore({ eip1193Adapters: [] })` and `WalletAccountV6.connect`. Fetch the WalletAccount guide before writing this file: <https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6>
   Fix the starter’s hardcoded Sepolia connect. Use the provider that matches `requestChainId` (`SN_MAIN` → 0, else 2).
4. Capability detection: `walletV6.supportedWalletApi` / `supportedSpecs` ≥ 0.10. Never probe `strk20Balances` to feature-detect.
5. Wire shield / self-transfer / unshield with `strk20InvokeTransaction`:
   - `{ type: "deposit", token, amount }` — UI must say this is **two wallet prompts** (approve, then deposit)
   - `{ type: "transfer", token, amount, recipient }`
   - `{ type: "withdraw", token, amount, recipient }`
6. Graceful degradation: hide privacy actions if the wallet is not STRK20-capable; prompt for Ready.
7. Headless: clean install, typecheck, `next build`.
8. Manual verify: §9 Phase 1 checklist.

Do not deploy a helper. Do not touch `strk20.json`.

## 6. Phase 2 — table UX + `PokerGame` invoke wiring · Days 4–8 (17–21 Aug)

Status: not started. Depends on Phase 1 manual pass.

### 6.1 Dapp files

| File | Change |
| --- | --- |
| `src/app/page.tsx` | Lobby: connect, shield STRK, open table |
| `src/app/table/page.tsx` | Heads-up table |
| `src/components/table/Table.tsx` | Board, pot, seats, public action log |
| `src/components/table/ActionBar.tsx` | Fold / call / bet / raise / showdown |
| `src/components/table/BuyIn.tsx` | Shielded buy-in; wait-for-maturity copy |
| `src/components/table/HoleCards.tsx` | Decrypt with the `signMessage` session key only |
| `src/lib/poker.ts` | Client hand state. Reads helper events + public storage, not `tx.sender` |
| `src/lib/strk20.ts` | `invokePoker` using the withdraw + `OPEN` + `invoke` triple |
| `src/utils/constants.ts` | `PokerHelperAddress` / Sepolia / class hash placeholders |
| `cairo/Scarb.toml`, `cairo/src/poker_game.cairo`, `cairo/tests/` | **Team** creates these. This skill does not write Cairo. |

### 6.2 Wallet API invoke shape

Placeholders are **literal strings**. Never `num.toHex` them.

```
[
  { type: "withdraw", token, amount, recipient: pokerHelper },
  { type: "transfer", token, amount: "OPEN", recipient: playerOrSelf },
  { type: "invoke", contract: pokerHelper, calldata: [/* action + args */, "${poolAddress}", "${openNoteIds[0]}"] }
]
```

Buy-in that only parks chips may omit the `OPEN` transfer and return an empty `Span<OpenNoteDeposit>`.

### 6.3 `PokerGame` helper — interface only (team writes the Cairo)

Study, do not paste: starter `cairo/src/lib.cairo`, `packages/vesu_lending_anonymizer`, `packages/ekubo_swap_anonymizer`.

Mandatory entrypoint: `privacy_invoke`, called only by the pool. Sandwich: withdraw to helper → mutate hand → approve pool → return `Span<OpenNoteDeposit>`. Any revert rolls the whole private transaction back.

**Trait `IPokerGame` (no bodies):**

- `privacy_invoke(action, table_id, token, pool_address, note_id, extra) -> Span<OpenNoteDeposit>`
  - `action`: `BuyIn`, `Deal`, `Bet`, `Fold`, `Reveal`, `Settle`, `CashOut`
  - `pool_address` must equal `get_caller_address()`
  - `note_id` is `${openNoteIds[0]}` when an open note is used
  - `extra`: buy-in amount, bet size, seed commitment, ciphertext / reveal payload
- Public views: `get_hand(table_id)`, `get_seed_commitment`, `get_seed_reveal`
- Public events, indexed by `table_id` and **seat id**, never a wallet: `HandOpened`, `BoughtIn`, `Dealt`, `BetPosted`, `Folded`, `BoardDealt`, `Revealed`, `Settled`

**Mapping (do not reopen):**

| Game object | Where it lives |
| --- | --- |
| Buy-in / stack / pot payout | STRK20 notes. Settle uses `OpenNoteDeposit` |
| Player↔table | Channels opened by the first private payment into the helper |
| Pot / street / whose turn / bet sizes | Public helper storage + events |
| Deal fairness | `commit_seed(H(seed))` then reveal; anyone recomputes the 52-card perm |
| Hole cards | Ciphertexts + Poseidon commitments in helper storage, encrypted to `signMessage("${chainId}:${pool}:${handId}:${seat}")` |
| Board | Public after each street, derived from the same seed |
| Fold / showdown | Public actions; showdown reveals card material |

**Atomicity tests the team must write (`snforge`):**

- Buy-in parks chips; helper balance matches; empty or matching open-note return.
- Illegal action reverts; no tokens stranded.
- `pool_address != caller` reverts.
- Settle approves pot to pool and fills the winner’s open note.

**Audit:** non-negotiable before mainnet helper use. Owner: Feltproof team. Record the reviewer in this file when chosen.

## 7. Phase 3 — one complete heads-up hand · Days 9–14 (22–27 Aug)

Status: not started.

Entry criterion: Phase 2 helper deployed on Sepolia (`NEXT_PUBLIC_POKER_HELPER_SEPOLIA` ≠ `0x0`) and Ready can `privacy_invoke` buy-in without revert.

The scoring loop:

1. Two Ready wallets shield STRK (separate txs; wait ~10 blocks).
2. Each `privacy_invoke` buy-in. Seats are session handles, not published addresses.
3. Dealer commits seed; helper writes hole-card commitments/ciphertexts and posts blinds as public bet events.
4. Minimum viable hand: preflop only. Fold → other seat wins. Showdown → compare two hole cards (optional: deal five board cards from the same seed).
5. `Settle` credits the pot as an `OpenNoteDeposit` to the winner.
6. Winner unshields later.

**Paymaster / session keys.** Stay on `strk20InvokeTransaction`. Do not invent session-key method names. If Ready session keys are usable at build time, add them; otherwise keep per-action popups and leave the gap in Open items.

**Out of this phase:** Wallet API sub-accounts, mental poker, multi-table, Xverse as a supported wallet, custom STARK shuffle circuit.

## 8. Phase 4 — mainnet scoring artifacts · Days 15–18 (28–31 Aug)

Status: not started.

Entry criterion: one complete HU hand on Sepolia, helper tests green, team sign-off that the helper may touch mainnet.

1. Deploy `PokerGame` to `SN_MAIN`. Put the address in `strk20.json` `contracts` and in `NEXT_PUBLIC_POKER_HELPER_MAINNET`.
2. Three successful mainnet txs that touched the pool, listed in `strk20.json` `transactions`. Suggested: (1) shield STRK, (2) buy-in or settle `privacy_invoke`, (3) unshield. Eligibility is checked against pool events, not `tx.sender`.
3. Public demo URL (Vercel / Website field). `demo_url` only if those do not find it.
4. 3-minute demo video in `demo_video`.
5. README stays honest about §3. Overclaiming costs judging points.

Deadline: **31 Aug 2026, 23:59 UTC**.

## 9. Testing

**Headless (every phase):** clean install · typecheck · `next build`. Helper: `scarb test` / `snforge`.

**Manual — Phase 1:**

- [ ] Connect Ready via get-starknet v6.
- [ ] Privacy actions appear with Ready; a non-privacy wallet degrades.
- [ ] Sepolia shield of a small STRK. Surface a screening decline as protocol state, not a crash.
- [ ] Private self-transfer.
- [ ] Unshield.
- [ ] Cross-check at <https://starknet-wallet-account.vercel.app/>

**Manual — Phase 2–3:**

- [ ] Shield and wait ~10 blocks before buy-in.
- [ ] `privacy_invoke` buy-in; Voyager shows pool + helper; sender is a relayer.
- [ ] Bet sizes visible; player addresses not in helper events.
- [ ] Fold path and showdown path both settle; helper ERC-20 balance returns to ~0.
- [ ] `waitForTransaction` has a ceiling; UI shows explorer link rather than hanging.

**Manual — Phase 4:** same loop on `SN_MAIN` with tiny amounts; paste three pool-touching hashes into `strk20.json`.

Pure local devnet does not exercise Ready + hosted proving. Do not promise a Katana privacy loop.

## 10. Compliance & security notes

- Deposit screening is enforced onchain from v0.14.3. Never present Feltproof as a screening workaround.
- Selective disclosure exists for legitimate requests. It is not automatic compliance and carries no regulator endorsement. Feltproof owns its own legal decisions.
- The team owns review, audit, deployment, and maintenance of `PokerGame`.
- No viewing keys, spending keys, or Alchemy keys in git.
- Least privilege: request only the STRK20 actions the table uses.

## 11. Open items to re-verify at build time

- Run `python3 .agents/skills/strk20-privacy-integration/scripts/check_freshness.py`.
- Fetch the WalletAccount guide before writing connect / invoke code.
- Whether every Ready `strk20InvokeTransaction` is already relayer-submitted.
- Ready session-key dapp API: usable or not.
- Pool fee via `get_fee_amount` (was large enough to matter — reserve it in UX).
- Xverse dapp-facing Wallet API.
- Wallet API sub-accounts (still pending).
- Helper audit owner and date.

## 12. Links

- RFP-03: <https://strk20.starknet.io/rfp/private-poker>
- Hackathon: <https://github.com/starkience/strk20-hackathon>
- Day 0: <https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md>
- Repo: <https://github.com/gstohl/feltproof>
- Starter kit: <https://github.com/Akashneelesh/strk20-starter-kit>
- What STRK20 is: <https://strk20-by-example.org/what-is-strk20>
- Notes: <https://strk20-by-example.org/notes-and-nullifiers>
- Viewing keys: <https://strk20-by-example.org/viewing-keys>
- Wallet API: <https://strk20-by-example.org/starknet-wallet-api/overview>
- Private DeFi / invoke: <https://strk20-by-example.org/starknet-wallet-api/private-defi>
- `privacy_invoke`: <https://strk20-by-example.org/helpers/privacy-invoke>
- Pool: <https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a>
- WalletAccount guide: <https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6>
- Wallet test dapp: <https://starknet-wallet-account.vercel.app/>
- Ready: <https://www.ready.co/>
- Cairo CoreStars: `@sncorestars`

After this file is approved, execute Phase 1 only. Mark headings `✅ done <date>` per `references/execute.md`. Do not generate Cairo. Do not start Phase 2 until the Phase 1 manual checklist is signed off.
