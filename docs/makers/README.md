# Independent makers and private settlement

The implemented path is **maker-funded quote → atomic STRK20 swap → maker proceeds**. Each operator runs their own bot, wallet, price policy and gas budget. Maker discovery, encrypted request/reply delivery, reservations, fills and refunds use Starknet. The bot needs only a Starknet RPC and local persistent storage: no RFQ server, Cloudflare account, hosted database, pricing API or directory administrator.

The maker book and settlement were deployed and verified on mainnet on 2026-09-06; see the [deployment manifest](../../deployments/mainnet/private-settlement.json). The production UI now pins this deployment for STRK/native USDC in both directions and exposes executable quote acceptance. Maker inventory and a real-wallet rehearsal remain pending. Production is mainnet-only; old Sepolia display preferences are ignored. Without settlement configuration the old indicative mode remains available and cannot authorize a trade.

## How a trade works

1. The maker approves and deposits its buy-token inventory into `App20PrivateSwap`. These are public maker transactions. The contract tracks each maker's available balance separately.
2. By default, the browser first batches preliminary requests to up to five active makers from a randomly chosen registry page. These omit the settlement commitment: the bot returns an encrypted indicative price without reserving inventory. The UI rejects expired/below-minimum replies and ranks receive amounts. Only after selection does the taker's browser encrypt a funded request to that maker, including a one-use settlement authorization commitment. The requesting wallet posts it through `App20MakerBook`. Private authorization and reply decryption keys are saved locally before submission.
3. The bot decrypts the request, applies its explicit rate, spread, size limits, price expiry and available inventory. It reserves the full output and publishes its encrypted reply in **one account multicall**. Both succeed or both revert. The contract authenticates the maker against the book request; a signed account transaction authenticates the quote.
4. The frontend checks the deployed classes, pinned book/pool, pool output-note acceptance, on-chain reservation, exact amounts, authorization and expiry. Review shows the sell amount, guaranteed output and current STRK pool fee, plus the fact that wallet/network fees may apply.
5. The user's privacy-enabled wallet submits the standard `withdraw → transfer OPEN → invoke` batch. Sell tokens leave the shielded pool; the helper consumes that quote exactly once, credits the maker's proceeds, and returns the exact buy amount to the taker's open note. **No localnet pre-call or unpublished compute-and-invoke action is required.** A failed exchange reverts the entire batch; there is no separate taker escrow claim to get stuck in.
6. The maker can withdraw earned proceeds using `--withdraw` or use them as available inventory for the reverse market. Unaccepted quotes become releasable after their deadline; `--run` releases tracked expiries while polling, and `--release` performs this explicitly. Anyone can release an expired quote, but the credit always returns to its maker.

Makers can capture a spread through completed trades. Profit is not guaranteed: response gas, pool/transaction fees, price movement, inventory exposure and competition matter. The bot does not automatically hedge on an external exchange. Configure both market directions if you want it to quote against inventory earned from previous fills.

## Contracts and conservation

`App20MakerBook` provides permissionless account-owned encryption keys and encrypted messages. Its constructor takes no arguments. Key registration lasts at most 30 days; rotations invalidate unanswered transport requests. Registration is not a certification or an inventory proof.

`App20PrivateSwap` takes `[privacy_pool, maker_book]`. It has no admin, upgrade hook, oracle or custody operator. A live reserved quote cannot be withdrawn or cancelled by its maker. Quotes are fixed-size, single-fill and immutable; new partial-fill or ladder behavior requires a separate protocol version.

Per-token liabilities cover available inventory, reserved output and credited proceeds. The pool's outstanding token allowance is also reserved until the output-note transfer consumes it. This prevents a second invocation from treating an output still owed to the pool as a new payment. Maker funding requires an exact ERC-20 balance delta; incoming private payments must cover their quoted amount above all assigned liabilities. Direct, unaccounted token donations are not recoverable user deposits and may be consumed as unassigned backing: fund through `deposit_inventory` or the wallet's atomic swap batch.

The intended assets are standard ERC-20s with truthful balances, allowances and transfer behavior. This contract does not make arbitrary malicious, rebasing or transfer-tax tokens safe. Frontend token metadata and maker market configuration must identify the intended assets exactly.

## Privacy boundary

Request and response messages use HPKE with P-256 / HKDF-SHA256 / AES-256-GCM and bounded padding. Authentication binds network, book, request, maker, taker, key revision, expiry and direction. The maker sees requests addressed to it; replies use a per-request browser key.

**Funded quote terms and amounts are public in contract storage.** Maker inventory and withdrawals are public. The RFQ request account, selected maker, timing, settlement activity and fees are public and correlatable. User assets settle through STRK20 notes, but this direct-account RFQ design does not hide the requesting account or make the trade anonymous. Wallet-provided proving/discovery/relay dependencies still apply; the maker itself does not operate those services.

Ciphertext remains public indefinitely; later compromise of a recipient key can expose historical messages. Browser reply private keys are non-exportable CryptoKeys stored together with their public keys in IndexedDB. Request terms and the settlement authorization secret are also stored locally. This supports reload recovery, not protection against malicious same-origin scripts. Clearing browser storage loses local decryption/recovery. The frontend never requests wallet viewing keys.

## Run an operator

Requires Node 24+ with TypeScript stripping (tested with Node 26), repository dependencies, and a dedicated deployed maker account funded for gas and inventory. Copy `operator.example.json` outside source control and fill its placeholders.

- `npm run maker -- /absolute/path/operator.json --check`: verify configuration and chain deployments; no key loaded or transaction sent.
- `--register`: publish the operator's public P-256 key. Supply `APP20_MAKER_SIGNING_KEY` and `APP20_MAKER_TRANSPORT_JWK` through your own secret management. Keep the transport key across restarts and never put either secret in a `VITE_*` variable. To create a transport key in a protected local environment, use WebCrypto `generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveBits'])` and export its private key as JWK.
- `--fund`: atomically approve and deposit the explicit `inventoryFunding.token` / `inventoryFunding.amount` from the maker wallet. Amounts are decimal base-unit strings.
- `--run`: automatically quote, reserve inventory, publish replies and release tracked expired reservations. `maxResponses` bounds new quotes per invocation; persistent gas limits cover all its transactions.
- `--withdraw`: withdraw the explicitly configured `inventoryWithdrawal` amount to the maker's own account. It cannot withdraw reserved funds or another maker's balance. Recovery modes still work if the pool blocks new output-note deposits; they verify the settlement/book identities without requiring the private output path to be enabled.
- `--release`: release tracked expired reservations without running the quote loop.
- `--reconcile`: read the receipt for a saved pending transaction and update local state. It needs no signing key and sends no transaction. An attempt for which no hash was returned requires inspecting account activity; never blindly clear it and resend.
- `--deactivate`: disable new requests to the maker. Existing funded quotes remain executable until their expiry, subject to the pool accepting output notes; deactivation does not revoke promises already funded.

Prices are explicit operator inputs, not an oracle. Output before spread = `sellAmount × numerator / denominator`, using base units; include decimal differences in the ratio. Rates expire at `markets[].validUntil`. `quoteTtlSeconds` defaults to 1200 for settlement and is bounded between 60 and 3600 seconds; it is also capped by the request and rate expiry. Choose a window that accommodates wallet proving while accepting the corresponding inventory/price exposure.

`indicativeTtlSeconds` defaults to 300 seconds. The bot supports preliminary and funded requests with the same registration and config; existing direct funded clients remain compatible. Older settlement bots that require a commitment must update to answer comparison requests.

Admission defaults: `maxActiveReservations: 20`, `responseCooldownSeconds: 60`, `reservationCooldownSeconds: 1200`. A preliminary response permits an immediate funded request; after a funded response the longer cooldown applies to either kind. These limits persist in the operator state and count uncertain submissions conservatively. They cover this bot's tracked state, not all processes or Sybil identities. They complement inventory and gas caps; they do not guarantee profit or eliminate abandoned-offer risk.

`maxFeePerTransaction` and `maxTotalFees` are STRK base units (18 decimals). Maximum resource-bound fees are checked before signing and conservatively deducted from a cumulative local budget. This is a safety cap, not actual-profit accounting. Anyone can send requests, so do not assume every paid response leads to a trade.

Keep the state file on persistent local storage. Writes are flushed and atomically renamed; a file lock prevents concurrent processes sharing it. An unresolved submission stops the bot until reconciled. After a crash, inspect the pending record before removing a leftover process lock. Losing/deleting the state resets local fee accounting and its reservation index, but not on-chain ownership: `QuoteReserved` events and the `quote(id)` view recover the IDs, and `release_expired(id)` remains permissionless. Rewind the stored cursor after a deep chain reorganization; recent scans overlap 100 blocks. This does not claim full economic finality before L1 confirmation.

## Mainnet preparation and deployment

```sh
npm run mainnet:prepare:settlement -- --rpc https://api.cartridge.gg/x/starknet/mainnet
```

This builds both contracts with Scarb 2.18.0, records artifact and source hashes, checks the live mainnet pool, and writes `artifacts/private-settlement-mainnet/candidate.json`. It cannot sign or broadcast. With `--deployer PUBLIC_ADDRESS --max-fee-strk BUDGET`, it also builds ordered unsigned UDC calls and predicted addresses. The planning budget must still be enforced by the wallet/tool performing declaration and deployment.

Declare both exact classes through the deployer's signing wallet, then deploy the book and settlement in that order with the supplied constructor. Before runtime activation, run the preparation command with `--book-address ADDRESS --settlement-address ADDRESS` to verify both deployed class hashes, the constructor bindings, and the pool's acceptance of open-note deposits from the settlement contract. The mainnet deployment is recorded in the manifest above. A real-wallet rehearsal and operator inventory remain pending; contract deployment does not verify live STARK-proof execution.

Set `VITE_MAKER_BOOK_CONFIG` to public JSON with `rpcUrl`, `chainId`, book `address`, book `classHash`, `fromBlock`, `sellToken`/`buyToken` metadata and `settlement: { address, classHash, pool, poolClassHash }`. Use verified deployed addresses and the correct chain's token metadata. The browser checks all these bindings before value submission. Without privacy-wallet capability it offers no acceptance action; it never falls back to a public user payment.

The RPC URL is public build configuration and must contain no credentials. Static hosting only needs SPA routing and a `connect-src` allowance for your RPC origin. The existing Cloudflare host supports the optional `MAKER_RPC_ORIGINS` binding; this does not make Cloudflare a maker dependency.

The old localnet v3 ladder/claim-ticket flow and its production flags are independent. Do not enable them to activate this fixed-quote settlement path.

## Verification

- `npm test --workspace @app20/private-intents` and `npm test --workspace @app20/maker-node`.
- `cd cairo && snforge test`: reservation/ownership/conservation, expiry, unauthorized fill, missing payment, replay and refund checks, plus existing contracts.
- `npm run test:e2e:settlement`: starts isolated upstream devnet, runs the real maker CLI, funds and reserves a quote, swaps through the real STRK20 pool contract, discovers the shielded output, rejects replay, withdraws maker proceeds and releases unused inventory. Uses upstream simulated proof facts and test-only screening, **not live STARK proof bytes**.
- `npm run test:e2e:settlement:browser`: verifies review, standard wallet actions, one payment, reload/receipt recovery, IndexedDB attempt serialization, and 1440/1280/1024px layouts. RPC/wallet are fixtures; cryptography and browser storage are real.

The native USDC address was checked against [Circle’s publication](https://www.circle.com/blog/now-available-native-usdc-cctp-on-starknet), and its on-chain symbol and six decimals were verified before UI activation. `src/lib/mainnet-maker-config.ts` contains the public pins; production RPC uses the existing same-origin endpoint without API credentials.


## Public operator onboarding

RFQ → **Become a maker** (`https://app20.io/rfq/maker`) supports public-key registration/rotation, deactivation, exact approve-and-deposit funding, available-inventory withdrawal, and decimal-aware price/budget configuration export. Wallet signing is explicit. Pending attempts are scoped to account and deployment, persisted before submission, and coordinated across tabs; known-hash receipts can be reconciled after reload. An unknown wallet outcome remains fenced until investigated.

`https://app20.io/agents` and `/agents.md` explain operator and chat capabilities; `/.well-known/app20.json` exposes public deployment metadata. The guide explicitly marks general Chat as not deployed on mainnet. The standalone Node 24+ bot and SHA-256 file are served under `/downloads/`; `npm run build:maker` bundles the same CLI used in this repository, without operator keys. `--init-key FILE` creates a private P-256 file with owner-only permissions, refuses overwrite, and prints only its public key. Operators may use `APP20_MAKER_TRANSPORT_FILE` instead of embedding private JWK text in an environment value.

`npm run test:e2e:maker-setup` exercises public-key rejection/registration, exact funding, pending/reload recovery, withdrawal and configuration downloads with fixture wallets and RPC. It does not move real funds.
