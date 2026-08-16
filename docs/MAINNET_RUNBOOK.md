# Quietline Mainnet Scoring Runbook

Human checklist for the Phase 4 scoring pass. A person with the Ready extension executes every financial action. Agents do not hold keys, do not submit mainnet txs, and do not invent RPC / discovery / proving URLs.

Scoring deadline: **31 Aug 2026, 23:59 UTC**. The sprint scraper rereads <https://github.com/gstohl/quietline> about every 30 minutes. Fill `strk20.json` only with real mainnet artifacts.

Grounding used here: `STRK20_INTEGRATION_PLAN.md` Phases 3–4 and §8, `README.md`, `cairo/src/lib.cairo`, `src/utils/constants.ts`, `scripts/e2e-mail.mjs`, and [MAINNET-DAY-0.md](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md).

## Locked mainnet values

Copy these. Do not substitute Sepolia values from `.env.example` or the starter kit.

| Item | Value | Source |
| --- | --- | --- |
| Chain | `SN_MAIN` (`0x534e5f4d41494e`) | Day-0, `src/utils/constants.ts` |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | Day-0, plan §1 / §4 |
| Pool Voyager | <https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a> | Day-0, skill links |
| STRK token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | plan §4, `src/utils/constants.ts` |
| Day-0 CLI RPC | `https://rpc.starknet.lava.build` | Day-0 (sncast / fee read only) |
| App RPC | Alchemy key in `VITE_PROVIDER_URL`; prefix is already in `src/utils/constants.ts` | `.env.example`, `constants.ts` |
| Helper constructor arg | the pool address above, as a single felt | `cairo/src/lib.cairo` `constructor(pool)` |
| Scoring JSON | `strk20.json` | README, Day-0 |
| Wallet | Ready on **Mainnet** | plan §0, README |
| Day-0 token | **STRK** | plan §0 |

Day-0 still withholds the mainnet **discovery/indexer URL** and **proving service URL**. Do not guess them. Quietline’s user path is Ready + Wallet API (`WalletAccountV6` / `strk20InvokeTransaction`). Ready hosts proving and note discovery. The dapp never needs those unpublished endpoints.

---

## 1. Prerequisites

Do this before any mainnet declare, deploy, or shield.

### 1.1 Ready on `SN_MAIN`

1. Install Ready from <https://www.ready.co/> if the extension is missing.
2. Open the Ready popup → network switcher → **Starknet Mainnet** (`SN_MAIN`).
3. Confirm the account you will score with is the one shown.
4. Create a **second account** (Bob) in a second browser profile, using the same wallet. Do not reuse Alice’s profile. Mail seeds live in `localStorage` under `quietline/mailseed/v1/<chainId>/<address>` (`src/components/mail/Onboard.tsx`).
5. Optional sanity check against the wallet test dapp: <https://starknet-wallet-account.vercel.app/>

### 1.1a Which wallet — check this before spending anything

Quietline is wallet-neutral: it enables privacy actions for **any** wallet that declares Wallet API / spec `>= 0.10` and exposes the STRK20 methods (`src/lib/strk20.ts`). It does not require one specific brand.

What matters is the **dapp-facing** STRK20 API, which is not the same as a wallet having in-wallet privacy features. A wallet can ship privacy in its own UI and still not expose it to dapps.

Connect first and read the **capability diagnostic** before spending anything. When a wallet fails the check, the diagnostic reports the declared `walletApiVersions` and `specVersions`, the minimum required, and whether `strk20InvokeTransaction` / `strk20Balances` exist on the account. That tells you in seconds whether the wallet simply has not shipped the dapp-facing API yet.

- **Ready** — known to work for the dapp-facing STRK20 API; use it for the scoring run.
- **Xverse** — ships in-wallet privacy; dapp-facing STRK20 support was still in progress when this was written. Connect it and read the diagnostic to find out. If it fails the check, fall back to Ready rather than trying to work around the gate.

Never weaken or bypass the capability gate to make a wallet appear to work. An incapable wallet must fail visibly.

### 1.2 How much real STRK to hold

Day-0: start with an amount you would not mind losing. Three successful pool-touching transactions satisfy eligibility, but every operation also pays the live pool fee. Quietline defaults value inputs to **0.1 STRK** and never converts through a JavaScript float.

| Action | Amount the app actually submits | File |
| --- | --- | --- |
| Mailbox wallet rail → **Shield** | exact user-entered STRK amount; default **0.1 STRK** | `src/components/mail/PrivacyWalletMenu.tsx` |
| Legacy wallet → **Send** (self-transfer) | exact user-entered STRK amount; default **0.1 STRK** | `src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx` |
| Mailbox wallet rail → **Unshield** | exact user-entered STRK amount to the connected account; default **0.1 STRK** | `src/components/mail/PrivacyWalletMenu.tsx` |
| Inbox attach STRK | exact amount you type; a new attachment defaults to **0.1 STRK** | `src/components/mail/Compose.tsx` |
| `register_pubkey` | 0 STRK value; public Starknet tx | `Onboard.tsx` |
| Helper declare + deploy | whatever mainnet declare/deploy costs | `scripts/e2e-mail.mjs` shape |

**Pool fee caveat — do not assume 4 STRK.** Plan §11 and `wallet-api-route.md` say: a **flat pool fee applies per private operation**; read it from the pool’s `get_fee_amount` rather than hard-coding. A historical snapshot in that skill note was **4 STRK on mainnet at time of writing**. That number may have moved. Wallet flows currently sponsor **gas**, not pool fees.

Read the live fee before funding:

```bash
# Day-0 verified RPC. Function name is the one named in the plan / wallet-api notes.
sncast --url https://rpc.starknet.lava.build call \
  --contract-address 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a \
  --function get_fee_amount
```

If your `sncast` build wants a different call syntax, use `sncast call --help`. Do not invent another RPC. Record the returned amount as `F` (human STRK, 18 decimals).

**Alice funding floor (public STRK on the connected account):**

```text
A               # the exact shield amount entered in the UI (default 0.1 STRK)
+ F              # shield pool fee
+ F              # mail send / privacy_invoke pool fee
+ F              # unshield or second private action pool fee
+ public gas     # register_pubkey and helper deployment; the wallet may sponsor some gas
+ slack          # screening retry is not a reason to restock; see §6
```

If `get_fee_amount` returns 4 STRK and `A` is 0.1 STRK, the three pool operations alone need **12.1 STRK**, plus unsponsored public gas and modest slack. Tiny transfer amounts do not make the flat fee tiny. Recompute from the live value; never use this example as a quote.

Enter the intended amount in the shipped UI. Before a Mainnet value action, verify the native preflight says `SN_MAIN`, the exact STRK and base-unit amount, the live `get_fee_amount`, the public balance and required `amount + fee`, the public shield/unshield warning, and “moves real funds.” Cancel if any value is unavailable or unexpected.

### 1.3 Rotate the Alchemy key into `.env.local`

`VITE_PROVIDER_URL` is the **key only**, not a full URL. `src/utils/constants.ts` prefixes:

- Mainnet: `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/` + key
- Sepolia: `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/` + key

Plan §11: rotate the key if it has ever shipped in a client bundle.

1. Create a new Alchemy Starknet key at <https://alchemy.com>.
2. Revoke the old key.
3. From the repo root:

```bash
cp .env.example .env.local
```

1. Edit `.env.local` (never commit it; `.gitignore` already excludes `.env.*`):

```text
VITE_PROVIDER_URL=<rotated_alchemy_key_only>
VITE_MAIL_HELPER_SEPOLIA=0x0
VITE_MAIL_HELPER_MAINNET=0x0
```

Leave `VITE_MAIL_HELPER_MAINNET=0x0` until §2 finishes. The inbox disables send/register when the helper is `0x0` (`isConfiguredMailHelper` in `src/lib/mail-actions.ts`).

Every `VITE_*` value is baked into the browser bundle. Treat the Alchemy key as public once the site is deployed.

### 1.4 Cloudflare demo already deployed

The SPA must be live before you point the GitHub **Website** field at it. A first deploy with helper `0x0` is fine; you will redeploy after §2.

**Path A — Cloudflare Pages (README):**

1. Cloudflare → **Workers & Pages → Create application → Pages → Connect to Git**.
2. Select `gstohl/quietline`.
3. Production branch `main`.
4. Build command `npm run build`.
5. Build output directory `dist` (repository root `/`).
6. **Settings → Environment variables** (production):
   - `VITE_PROVIDER_URL` = rotated Alchemy key only
   - `VITE_MAIL_HELPER_SEPOLIA` = `0x0`
   - `VITE_MAIL_HELPER_MAINNET` = `0x0` for this first deploy
7. Deploy.
8. Open the printed URL and `/inbox` directly. Both must serve the SPA (`public/_redirects` + `wrangler.jsonc` `not_found_handling`).

**Path B — Wrangler Workers static assets (README):**

```bash
npm ci
npx wrangler login
npm run deploy:cf
```

`npm run deploy:cf` is `npm run build && wrangler deploy`. It reads `.env.local` at build time. Do not commit `.env.local` or `dist/`.

Record the public HTTPS origin Cloudflare prints. You will paste it into the GitHub **Website** field first, then into `strk20.json` `demo_url` (§5).

---

## 2. Deploy `QuietlineMail` to `SN_MAIN`

Constructor takes **one** argument: the live pool.

```text
pool = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

`cairo/src/lib.cairo` stores that address and authorizes `privacy_invoke` against `get_caller_address() == pool`. The calldata `pool_address` argument is a **wallet placeholder only** and is ignored for authorization.

There is **no** `get_pool` view. After deploy, prove the constructor by reading the **deploy transaction calldata** on Voyager, not by calling a getter.

Build first (from `cairo/`, Scarb `2.18.0`, edition `2024_07`):

```bash
cd cairo
scarb build
snforge test
```

Artifacts (same names `scripts/e2e-mail.mjs` loads):

- Sierra: `cairo/target/dev/quietline_mail_QuietlineMail.contract_class.json`
- CASM: `cairo/target/dev/quietline_mail_QuietlineMail.compiled_contract_class.json`

This repo has **no** `snfoundry.toml`. Pass `--url` / `--account` on the CLI. Use Day-0 `https://rpc.starknet.lava.build` for sncast so you do not put the Alchemy key on the command line.

### 2.1 Path A — one script (`npm run deploy:helper:mainnet`)

Use a **separate funded Starknet account** you control. This is a public declare/deploy, not a STRK20 private action. Ready’s scoring wallet can be this account if it has extra public STRK; a dedicated deployer is cleaner.

Create the account once if you do not have one:

```bash
sncast account create --name quietline-deployer --network mainnet
# fund the printed address with a few public STRK from Ready
sncast account deploy --name quietline-deployer --network mainnet --url https://rpc.starknet.lava.build
```

Then from the repo root:

```bash
# fee estimate only — no transaction
npm run deploy:helper:mainnet -- --account quietline-deployer

# real mainnet declare + deploy
I_UNDERSTAND_MAINNET=1 npm run deploy:helper:mainnet -- --account quietline-deployer --broadcast
```

The script rebuilds Cairo, locks constructor calldata to the mainnet pool, writes `VITE_MAIL_HELPER_MAINNET` into `.env.local`, and never deploys escrow. Restart `npm run dev` after it prints the helper address.

Manual equivalent, if you prefer raw sncast from `cairo/`:

```bash
sncast --account <DEPLOYER_ACCOUNT> \
  --url https://rpc.starknet.lava.build \
  declare --contract-name QuietlineMail
```

1. Record:
   - declare transaction hash
   - **class hash** printed by sncast
   - Voyager declare link: `https://voyager.online/tx/<declare_hash>`
2. Deploy with the pool as the only constructor felt:

```bash
sncast --account <DEPLOYER_ACCOUNT> \
  --url https://rpc.starknet.lava.build \
  deploy \
  --class-hash <CLASS_HASH_FROM_DECLARE> \
  --constructor-calldata 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

1. Record:
   - deploy transaction hash
   - **contract address**
   - Voyager deploy link: `https://voyager.online/tx/<deploy_hash>`
   - Voyager contract: `https://voyager.online/contract/<helper_address>`

If your sncast version names flags differently, run `sncast declare --help` and `sncast deploy --help`. Do not change the constructor calldata. Contract name is `QuietlineMail` (`cairo/src/lib.cairo`, `scripts/e2e-mail.mjs`).

Logical mirror of `scripts/e2e-mail.mjs` (do **not** point that script at mainnet; it talks to Devnet and a mock pool caller):

- `declareIfNot({ contract: sierra, casm })`
- `deployContract({ classHash, constructorCalldata: [pool] })`

### 2.2 Path B — class-hash and verification steps

Do this even if Path A succeeded. This is how you prove you deployed *this* class with *this* pool.

1. Keep the class hash from the declare receipt.
2. On Voyager, open the deploy tx → constructor calldata → confirm the single argument equals  
   `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`  
   (felt equality; leading zeros may differ).
3. On Voyager, open the contract page → class hash matches the declare.
4. Optional read-only checks against Day-0 Lava or the app Alchemy provider:
   - `message_count` → `0` on a fresh helper
   - `get_pubkey(alice)` → `(0, 0)` before registration
5. Do **not** call `privacy_invoke` from the deployer. Non-pool callers revert `BAD_POOL`. The pool is the only legal caller; Ready’s `strk20InvokeTransaction` is what makes the pool call the helper.

If declare says the class already exists, reuse that class hash and only deploy. Do not redeploy a second helper “just in case” after the site is pointed at the first address.

### 2.3 Point the site at the helper and redeploy

1. Local `.env.local`:

```text
VITE_MAIL_HELPER_MAINNET=<deployed_helper_address>
```

1. Cloudflare production env: set the same `VITE_MAIL_HELPER_MAINNET`. Leave Sepolia at `0x0` unless you also deployed there.
2. Redeploy (`npm run deploy:cf` or trigger the Pages build).
3. Hard-refresh the live site. Inbox header should show **MAINNET** after Ready connects on `SN_MAIN`. Register/send must no longer say “No QuietlineMail helper is configured”.
4. Append the helper address to `strk20.json` `contracts` (full file in §5). Commit after the three scoring txs exist, or commit the contract address now and the hashes later — scraper reads whatever is on `main`.

---

## 3. The three scoring transactions

Day-0 / plan §8: prizes need **three successful mainnet transactions that touched the STRK20 pool**, listed by hash in `strk20.json`.

Each hash is checked on-chain. It must:

1. exist on `SN_MAIN`,
2. have **succeeded**,
3. carry a **STRK20 pool event**.

**Eligibility is not `tx.sender`.** Private txs are submitted by **rotating shared relayers**. Voyager will show a relayer with a huge nonce; Alice’s address is absent from sender, calldata, and signature. That is the system working (Day-0 §4, concepts.md).

Attribute activity from **pool events**:

- Shield: pool `Deposit(user_addr, token, amount)` — first indexed key is the depositing account.
- Private send / `privacy_invoke`: the pool event on that tx (encrypted note / nullifier / invoke), not the relayer.
- Unshield: the pool withdrawal event (destination + amount stay public).

Do **not** put `register_pubkey` hashes or the helper declare/deploy hashes in `transactions`. Those are public Starknet txs and do not satisfy “carry a STRK20 pool event”.

For every scoring tx, write down:

| Record | Where |
| --- | --- |
| Transaction hash | Ready receipt or Quietline result card |
| Voyager | `https://voyager.online/tx/<hash>` (app builds this when `providerIndex === 0`) |
| Finality / execution | `ACCEPTED_ON_L2` + `SUCCEEDED` |
| What it proves | see each step below |
| Pool event present | Voyager event list on the **pool** contract, not “from address = Alice” |

Quietline waits up to **20 minutes** for confirmation (`STRK20_WAIT_TIMEOUT_MS` in `src/lib/strk20.ts`). If the UI times out, keep the hash and finish confirmation on Voyager. Do not resubmit blindly.

### 3.1 Recommended order (do not skip the wait)

```text
Alice + Bob: connect a STRK20-capable wallet on SN_MAIN
Alice + Bob: register_pubkey  (§4)     ← public, not a scoring tx
Alice: Shield amount A        (§3.2)   ← scoring tx (a); start at 0.1 STRK
WAIT ~10 blocks               (§3.3)
Alice: Encrypt & send         (§3.4)   ← scoring tx (b), pool-touching privacy_invoke
Alice: Unshield amount A
        or self-transfer A    (§3.5)   ← scoring tx (c); start at 0.1 STRK
Bob: Scan public events       (§4)     ← demo, not a scoring tx
```

### 3.2 (a) Shield STRK via the app

**What it is:** public ERC-20 deposit into the pool. Depositor, token, and amount are **public**. Privacy starts after this.

**Clicks:**

1. Open the live demo URL (not `localhost` if you want the video to match `demo_url`).
2. Wallet popup: network = **Mainnet**.
3. Click **Connect wallet** → pick the installed STRK20-capable wallet → approve the account.
4. Confirm the network chip says **MAINNET**. If it says SEPOLIA, disconnect, switch the wallet, and reconnect.
5. In the mailbox wallet rail, enter **0.1** (or another deliberately tiny amount).
6. Confirm the rail shows both `0.1 STRK` and `100000000000000000 base units`.
7. Click **Shield**. Read the Mainnet preflight and verify its live fee and balance before choosing OK.
8. Wallet prompt 1: **approve** STRK for the pool. Wait until that public approve is visible. A deposit is two transactions, never one (`wallet-api-route.md`).
9. Wallet prompt 2: **deposit** the exact entered amount. Screening signature is protocol-enforced. If this reverts, it is usually screening — see §6. Do not treat it as an app bug.
10. Wait for the in-app receipt **Shield confirmed** (or Voyager `SUCCEEDED`).

**Record:**

- Hash: `0x…`
- Voyager: `https://voyager.online/tx/0x…`
- Proves: Alice deposited the exact entered amount into pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. `Deposit.user_addr` is Alice. Amount and depositor are public on purpose.

Optional: Home → **Balances** → **Query balances** (this *does* prompt for shielded-balance consent; it is not a scoring tx).

### 3.3 Maturity wait (~10 blocks) — mandatory before (b)

Notes mature **~10 blocks** after creation (`wallet-api-route.md`, plan Phase 3). Freshly shielded funds are not spendable. A send immediately after shield fails.

Starknet block times vary; wait until Voyager shows the shield **at least 10 blocks behind latest**, then add a couple of extra blocks.

Do **not** compose shield + send in one wallet batch to skip the wait. That publishes “this address deposited amount A” next to the mail it funded (concepts.md “Composition leaks”). The honest Quietline story is: shield first, later private send with no public ERC-20 leg.

### 3.4 (b) Mail send / memo-carrying private transfer (`privacy_invoke`)

This is the **pool-touching** Quietline action. Ready builds `strk20InvokeTransaction` from `buildMailActions` (`src/lib/mail-actions.ts`):

1. optional private `transfer` of attached STRK to Bob,
2. `transfer` `amount: "OPEN"` back to Alice (recovery slot for helper dust),
3. `invoke` to the helper with calldata:

```text
token,
${poolAddress},          ← leave this literal; wallet substitutes
${openNoteIds[0]},       ← leave this literal; wallet substitutes
eph_pk_0, eph_pk_1,
view_tag,
nonce_0, nonce_1,
ct_len, ...ct            ← max 140 felts (cairo/src/lib.cairo MAX_CT_FELTS)
```

The pool calls `QuietlineMail.privacy_invoke`. The helper emits `MessagePosted` with **no wallet address**. Voyager sender is the relayer.

**Clicks (Alice’s browser profile):**

1. Confirm §4 already registered **Bob’s** mail key. Compose looks up `get_pubkey(recipient)` and refuses a zero key.
2. Home → **Open inbox →** (`src/app/page.tsx`).
3. Network chip = **MAINNET**. Helper configured.
4. If Alice’s key is not loaded this session: **Load device key & register** (no second register tx if `get_pubkey` already matches).
5. Compose:
   - **Recipient Starknet address** = Bob’s Ready address (copy from Bob’s Ready popup, not from Voyager sender fields).
   - **Message** = a short honest demo line, e.g. `memo: invoice 17`. Keep well under 4096 characters.
   - **Attach STRK (optional)** = leave empty **or** a tiny amount (0.01). Attachment is a private in-pool transfer in the **same** atomic batch. It is *not* a public shield. Prefer empty if `F` is large.
6. Click **Encrypt & send**.
7. Approve the single Ready privacy popup. One wallet popup per private action is expected (plan §0).
8. Wait for “Encrypted mail confirmed.” (or the atomic payment variant).

**Record:**

- Hash: `0x…`
- Voyager: `https://voyager.online/tx/0x…`
- Proves: a successful mainnet pool tx whose last external call is `privacy_invoke` on QuietlineMail. Ciphertext + timing are public. Sender, recipient, and body are not. Relayer is `tx.sender`.

On Voyager, also open the **helper** contract events and confirm a `MessagePosted` on this hash. Scoring still requires a **pool** event on the same tx.

### 3.5 (c) Unshield or second private action

Pick one. Both touch the pool.

**Option C1 — Unshield (public withdrawal):**

1. In the mailbox wallet rail, enter the exact tiny STRK amount you intend to withdraw (start at **0.1 STRK**).
2. Confirm the UI shows the same human amount and exact base units.
3. Click **Unshield**.
4. Read and explicitly accept the Mainnet real-funds preflight, then approve the wallet request.
5. Withdrawal destination (Alice) and the entered amount are public. Which note funded it stays private.

**Option C2 — Second private action (self-transfer):**

1. In the legacy wallet screen, open **Send** and enter the exact tiny STRK amount (start at **0.1 STRK**).
2. Confirm the human amount and base units, then click **Private self-transfer**.
3. Read and explicitly accept the Mainnet preflight, then approve the wallet request.
4. Amount and counterparties stay inside the pool. Timing and public pool-fee payment remain observable.

You need another matured note and another live pool fee `F`. The preflight blocks submission if the public STRK balance cannot cover the entered amount plus `F`. A failed or reverted third hash does not count.

**Record:**

- Hash: `0x…`
- Voyager: `https://voyager.online/tx/0x…`
- Proves: a second (unshield) or third (if you also self-transferred) successful pool-touching tx. Unshield proves the public exit leg; self-transfer proves a second private note spend.

---

## 4. `register_pubkey` + two-profile send → discover → decrypt

Mail keys are **app x25519 keys**, not the STRK20 viewing key `k`. The dapp must never see `k` (plan §0, §2, README). Pool registration (viewing key) is Ready’s job on first private use.

`register_pubkey(pk: (felt252, felt252))` writes `pubkeys[caller]`. It is a **normal public** Starknet transaction from the user’s account (not a relayer). It does **not** go in `strk20.json` `transactions`.

### 4.1 Two-browser setup

| Role | Browser | Ready account | localStorage seed |
| --- | --- | --- | --- |
| Alice | Profile A (e.g. Chrome “Alice”) | Alice on `SN_MAIN` | `quietline/mailseed/v1/<SN_MAIN felt>/<alice>` |
| Bob | Profile B or a second browser | Bob on `SN_MAIN` | `quietline/mailseed/v1/<SN_MAIN felt>/<bob>` |

Do not share profiles, do not export `localStorage` to a server, do not paste a viewing key anywhere.

### 4.2 Register both identities

On **each** profile, against the live helper:

1. Ready = Mainnet, connect that profile’s account.
2. Open `/inbox`.
3. Card **01 Set up a mailbox key** → **Load device key & register**.
4. First time only: a backup hex phrase appears (“shown once”). Copy it offline. Anyone with it can decrypt mail to that key. Quietline does not upload it.
5. Approve the public `register_pubkey` tx in Ready.
6. Wait for “Device mail key registered and ready for local scans.”
7. Write down the registration hash (debug only).

If the helper already has a **different** key for that address, the UI refuses to overwrite. Use the original profile or its backup. Do not “fix” this by deploying a second helper.

### 4.3 Demo loop after scoring tx (b)

1. **Alice (Profile A):** already sent in §3.4.
2. **Bob (Profile B):** `/inbox` → **Load device key & register** (load only if already registered) → **Scan public events**.
3. Bob’s client downloads `MessagePosted` from block 0 via `getEvents` (`src/app/inbox/page.tsx`) and trial-decrypts locally.
4. Success: plaintext appears under **Inbox** as “decrypted on this device”. Status like `Decrypted 1 of N valid ciphertext events locally.`
5. Alice scanning the same events with Alice’s key should **not** decrypt Bob’s mail (wrong x25519). That is the demo of “content decrypts only on the recipient’s device”.

Do not stand up a hosted indexer. Do not paste `k` into any UI. Discovery that needs `k` stays in Ready.

---

## 5. Fill `strk20.json`

Current empty shape (`strk20.json`):

```json
{
  "transactions": [],
  "contracts": [],
  "demo_video": "",
  "demo_url": ""
}
```

README order of operations for the URL:

1. Set the GitHub repository **Website** field to the Cloudflare origin.
2. Put that **same** URL in `demo_url`.

Sprint detection looks at Website first.

Replace placeholders after the txs confirm. Do not commit fake hashes.

```json
{
  "transactions": [
    "0xSHIELD_TX_HASH",
    "0xPRIVACY_INVOKE_MAIL_TX_HASH",
    "0xUNSHIELD_OR_SECOND_PRIVATE_TX_HASH"
  ],
  "contracts": [
    "0xQUIETLINE_MAIL_SN_MAIN"
  ],
  "demo_video": "https://PLACEHOLDER_3_MINUTE_WALKTHROUGH",
  "demo_url": "https://YOUR_CLOUDFLARE_ORIGIN"
}
```

Field rules:

| Field | What belongs | What does not |
| --- | --- | --- |
| `transactions` | three **successful** `SN_MAIN` hashes that each carry a **pool** event: shield, `privacy_invoke` send (or memo-transfer), unshield or second private action | `register_pubkey`, declare, deploy, failed/reverted, Sepolia, helper-only events |
| `contracts` | deployed `QuietlineMail` address on `SN_MAIN` | pool address (already canonical), Sepolia helper, class hash |
| `demo_video` | public URL of the ≤3 minute walkthrough. Use a placeholder string until the file is uploaded | a local path |
| `demo_url` | exact Cloudflare origin already set as GitHub **Website** | a preview deployment, a login-walled URL, `localhost` |

Commit on `main`. Scraper cadence is ~30 minutes.

---

## 6. Safety rails

### 6.1 Keep amounts small

- Shield, Unshield, and private self-transfer are user-entered and default to **0.1 STRK**. Verify both the STRK and base-unit displays before every click.
- The last valid wallet amount is remembered per network; do not assume switching accounts resets it.
- Prefer **no** attached STRK on the mail send unless you specifically want the memo+payment story. New attachments default to **0.1 STRK**, so remove the attachment if no value should move.
- The flat live pool fee applies in addition to the entered amount. A tiny amount can still incur a materially larger fee.
- Day-0: nothing in the sprint requires large transfer amounts. Never repeat a transaction “to be safe” while its outcome is unknown.

### 6.2 What not to do

| Do not | Why |
| --- | --- |
| Put a viewing key `k`, spending key, or seed in the dapp, URL, issue, or video | Plan §0 / §10. Discovery that needs `k` stays in Ready or a local user-held scan. |
| Ask Ready to export `k` “so we can scan like the SDK” | Wrong route. Quietline scans `MessagePosted` with the **mail** x25519 key only. |
| Bundle shield + send in one correlated step | Public `Deposit` then sits next to the transfer it funded. Wait ~10 blocks. |
| Treat a screening decline as an app bug or retry loop | Protocol state since v0.14.3. Surface it and stop. Self-hosted proving would not bypass it either. |
| Guess mainnet discovery / proving URLs | Day-0: two values still missing; a wrong prover looks like your bug. Wallet API does not need them. |
| Point `scripts/e2e-mail.mjs` at mainnet | It declares a helper whose constructor pool is a **Devnet mock account**, then calls `privacy_invoke` as that account. That is not the live pool. |
| Commit `.env.local`, backup phrases, or private keys | `.gitignore` already blocks `.env.*`. |
| Reuse a note id after a revert | See §6.3. |
| Overclaim privacy in the video or README | Hidden vs visible is §3 of the plan and the README table. Timing correlation on a two-person demo is real. |
| Use Sepolia hashes for scoring | Day-0: sprint is mainnet-only. |
| Feature-detect STRK20 by calling `strk20Balances` | Consent prompt; capability is `supportedWalletApi` / `supportedSpecs` `>= 0.10`. |

### 6.3 Rollback if a tx reverts

- **Approve succeeded, deposit reverted (often screening):** public allowance may remain. Do not keep clicking Shield. Read the Ready / UI message. `strk20ErrorMessage` maps screening-like errors to: “The deposit was declined by STRK20 protocol screening. No privacy action was submitted.” That hash is **not** a scoring hash.
- **Private send / unshield reverted after Ready signed:** the wallet may have reserved or invalidated a note. **Do not reuse note ids.** Quietline already passes `"${openNoteIds[0]}"` as a literal for the wallet to fill. Let Ready pick a new open note on the next attempt. Do not paste an old note id into calldata.
- **Helper `privacy_invoke` reverted `CT_TOO_LARGE`:** message packed above 140 felts. Shorten the body. Same note-id rule if the pool already consumed an input note (full-tx revert should roll the pool side back; still do not hand-reuse ids).
- **Helper `BAD_POOL`:** you called the helper directly instead of through Ready’s pool invoke. Stop. Use **Encrypt & send** or the home STRK20 tabs only.
- **UI timeout, Voyager later `SUCCEEDED`:** keep that hash. Do not send a duplicate.
- **UI timeout, Voyager `REVERTED`:** discard the hash. Wait, then retry with a **new** wallet-assembled note set.
- **Wrong network:** disconnect, switch Ready to Mainnet, reconnect. Sepolia successes do not score.

Atomicity: one `strk20InvokeTransaction` is one pool transaction. If the helper reverts, the whole private op rolls back (anonymizer model). Funds should return to the pool, not sit on the helper, as long as you did not freelance extra calls.

---

## 7. Three-minute demo video — 30-second beats

Film the **live** `demo_url` + two Ready profiles. Speak the honest table; do not claim mixer-level privacy.

Quietline hides **who wrote whom and what they said**. It does **not** hide that someone used the pool at that time.

| Time | Shot | On screen | Say this |
| --- | --- | --- | --- |
| 0:00–0:30 | Title + limits | README / inbox privacy strip: Hidden = body + recipient link; Visible = helper activity, ciphertext, timing | “Encrypted on-chain mail. Observer sees *that* a pool tx happened, and when. Not who, not what. Two-person demos are timing-correlatable.” |
| 0:30–1:00 | Connect | Wallet network = Mainnet. Quietline chip **MAINNET**. Wallet rail showing **0.1 STRK** and exact base units | “Wallet on SN_MAIN. Shield is a public deposit. We already waited ten blocks after shielding so this send is not glued to the deposit.” |
| 1:00–1:30 | Public directory | Alice inbox card 01, then cut to Bob inbox card 01. Show `register_pubkey` as a **normal** account tx if you still have the receipt | “Mail keys are device x25519 keys in this browser profile. This public directory is not a viewing key. The dapp never touches `k`.” |
| 1:30–2:00 | Encrypt & send | Alice compose: Bob’s address, short memo, no huge attachment. Ready privacy popup. Receipt hash | “One `privacy_invoke` through the pool. Wallet substitutes `${poolAddress}` and the open note. Pool is `msg.sender` on the helper.” |
| 2:00–2:30 | Voyager honesty | `https://voyager.online/tx/<send_hash>`: relayer sender, huge nonce, Alice absent. Helper `MessagePosted` has no addresses. Pool event exists | “Eligibility is the pool event, not `tx.sender`. If you grep Alice as sender you get nothing — that’s the point.” |
| 2:30–3:00 | Discover + decrypt | Bob profile: **Scan public events** → plaintext. Alice scan does not show Bob’s body. Optional: flash the hidden-vs-visible table again | “Bob trial-decrypts locally. No server holds plaintext. Optional private STRK memo rides the same tx; shield/unshield amounts stay public.” |

Do not show backup phrases, Alchemy keys, or Ready seed phrases. Do not demo a hosted inbox. End on the limit, not a bigger claim.

Upload the video, replace `demo_video` in `strk20.json`, commit.

---

## Operator scratch pad

Fill while you work. Do not commit this table if it contains seeds.

| Item | Value |
| --- | --- |
| `get_fee_amount` (`F`) | |
| Alice Ready address | |
| Bob Ready address | |
| Helper address | |
| Class hash | |
| Declare tx | |
| Deploy tx | |
| Alice `register_pubkey` tx (not scored) | |
| Bob `register_pubkey` tx (not scored) | |
| (a) Shield hash + Voyager | |
| Shield block number + wait-until block | |
| (b) `privacy_invoke` hash + Voyager | |
| (c) Unshield / self-transfer hash + Voyager | |
| Cloudflare origin (= Website = `demo_url`) | |
| Video URL | |

---

## Done when

- [ ] Ready on `SN_MAIN`, rotated Alchemy key only in `VITE_PROVIDER_URL`, Cloudflare origin loads `/` and `/inbox`
- [ ] `QuietlineMail` on `SN_MAIN` with constructor pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- [ ] `VITE_MAIL_HELPER_MAINNET` set and site redeployed
- [ ] Both identities `register_pubkey`’d in separate browser profiles
- [ ] Three successful pool-event txs recorded, after the ~10-block maturity wait between shield and send
- [ ] GitHub **Website** set first; `strk20.json` has the four fields above
- [ ] 3-minute video matches the hidden-vs-visible story
- [ ] README still matches plan §3 (no overclaim)
