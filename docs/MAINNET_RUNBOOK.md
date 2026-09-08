# APP20 mainnet operations

Updated 2026-09-08. A [real-proof operator Chat message](../deployments/mainnet/chat-message-2026-09-08.json) is accepted on mainnet, decrypted, replay-protected and verified to preserve its private balance. Ready extension and mainnet recipient-payment acceptance remain unverified. The confidential escrow is deployed and its SDK enabled; atomic settlement validation remains pending. The three earlier swap receipts belong to the retired public-funded-terms protocol. [The private settlement policy](PRIVATE_SETTLEMENT_POLICY.md) governs current execution; historical preparation and maker sections below do not enable new legacy trading.

## Completed mainnet settlement demo

At the user's instruction, the funded operator wallet registered with STRK20 and shielded 0.03 STRK, acquired a small native-USDC inventory, registered/funded a maker, and completed three encrypted-request → funded-quote → private-fill rounds. Each fill exchanged 0.01 shielded STRK for 0.001 shielded USDC. The same operator controlled both roles.

All three successful mainnet receipts, quote-fill events, pool/APP20 traces and class pins were verified. Local viewing-key discovery confirmed 0.003 USDC in three shielded notes. Maker proceeds were withdrawn, inventory checked at zero, and the test maker deactivated. See [public execution evidence](../deployments/mainnet/smoke-test-2026-09-07.json) and [hackathon status](HACKATHON_DEMO.md). The `fixed` manifest retains those three historical hashes, adds the verified Chat and confidential-settlement hashes, and links the current fixed-branch video. The deadline release remains separately available.

Demo network and pool fees were **35.863877034965690848 STRK**. Including the earlier deployment, fees were **63.910369825551435280 STRK**, within the existing 65 STRK ceiling. A separate 0.5 STRK was converted to USDC inventory. The runner enforces the combined fee ceiling, a per-transaction gas cap, a 6 STRK pool-fee cap, exact token/recipient/amount checks and durable pending-transaction fences.

`scripts/mainnet-demo.mjs check` is read-only. Transaction stages require `--execute`, the existing operator keystore and retained private journals under `~/.config/app20/mainnet-demo/`. Completed stages refuse replay. Preserve the viewing key: it controls recovery of the received shielded USDC. Never copy keys, quote secrets or proof journals into the repository.

Real proving used the authenticated APP20/Starkscan REST relay. Starkscan's RPC write gateway reported disabled writes despite the key's write scope. Cartridge rejected the new proof-fact version in tracing and failed proof-bearing estimation. Lava's mainnet v0.10 RPC successfully estimated, broadcast and traced the transactions; no Starkscan credential was sent to Lava. Recheck provider capabilities before another run. The initial shield reused the exact signed transaction after a definitive upstream write rejection; no duplicate shield was submitted.

## Candidate and scope

The first independently preparable component is `App20Chat`, built from `cairo/src/lib.cairo` with Scarb 2.18.0. Its constructor takes the live STRK20 pool address:

`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

The upstream deployment reference is [STRK20 deployed contracts](https://strk20-by-example.org/contract-addresses). `scripts/prepare-mainnet.mjs` separately checks the RPC chain ID, an observed block, pool class and current fee. A successful read establishes those observations only; it does not establish wallet compatibility or independent security review.

Alice/Bob is a build-gated development adapter. It is already absent from production bundles. Mainnet users connect their own Ready wallets. The initial mainnet page uses real wallet addresses and existing address-book labels.

The legacy v3 ladder RFQ remains a separate engineering workstream. The independent fixed-quote maker flow now has executable settlement; see the Independent makers section below. See `GAPS.md`. The localnet fixture is not a production maker service; changing a flag does not implement those dependencies. No missing review, operator, transaction or deployment evidence is filled in by this preparation.

## Reproduce the preparation

```sh
npm ci
npm run build
npm run test:evidence
npm run mainnet:prepare -- --rpc https://api.cartridge.gg/x/starknet/mainnet
npx wrangler deploy --dry-run --outdir artifacts/mainnet-preparation/worker
```

`mainnet:prepare` rebuilds the contracts with Scarb 2.18.0, computes Sierra/CASM class hashes and file/ABI digests, records the current commit and whether tracked files are dirty, and writes `artifacts/mainnet-preparation/candidate.json` plus `App20Chat.abi.json`. This tool has no signing key, signer or broadcast method. Its RPC method allowlist permits reads only. An RPC failure aborts candidate generation rather than producing positive verification.

To generate the concrete unsigned UDC deployment calls and predicted address, supply the real deployer's public address and a nonzero hex salt:

```sh
npm run mainnet:prepare -- --rpc https://api.cartridge.gg/x/starknet/mainnet --deployer PUBLIC_ADDRESS --salt 0x1
```

The plan uses the installed Starknet SDK's current UDC, a deployer-unique salt and the candidate class hash. The account must declare the exact Sierra/CASM pair first. Add `--max-fee-strk DECIMAL_AMOUNT` to record the user-selected maximum total fee budget in exact base units. It is a planning cap, not a fee estimate or a broadcast authorization. Wallet-specific signing, nonce/resource bounds and enforcement of that total fee budget are required before execution; they are not guessed or embedded in the repository.

## Chat transaction compatibility

`buildMessageOnlyChatActions` is wired into normal messages, documents, backups and responses. It pairs an encrypted 1-base-unit STRK self-transfer with an unfunded `compute_and_invoke` callback. The existing shielded balance is preserved; the self-transfer supplies pool note replay protection. A callback alone fails the real pool's `NO_REPLAY_PROTECTION` check. No helper funding, public withdrawal or OPEN recovery note is used. Numeric payments provide their own encrypted transfer rather than adding this self-transfer.

The deployed helper and this Core SDK path succeeded in mainnet block 14529927. The encrypted event, bound helper replay slot, pool/helper trace, contract pins and unchanged private balance were verified. See [Chat evidence](CHAT_MAINNET_EVIDENCE_PLAN.md). Runtime addresses are pinned in `constants.ts` and `helperForNetwork`; RFQ/escrow activation remains separate.

Ready extension acceptance is still unverified. The installed Wallet API union does not declare the `compute_and_invoke` extension; localnet support does not establish the real extension's behavior. A supported adapter must preserve private computation, proof facts and both replay checks. Do not fall back to public invokes or strip protection. Preserve proof and pending-message journals across reloads and reconcile unknown submissions before retrying.

## Hosting

`wrangler.jsonc` supplies server-side RPC endpoints; these are not browser credentials. The verified operator Chat run used hosted proving and Publicnode proof-aware submission. A browser adapter needs its own authenticated proving and private-state integration; the Node receipt does not establish Ready support.

The public frontend is deployed as Worker `app20` at **https://app20.io**, with `workers_dev` also enabled. The custom domain, HTTPS, desktop routes and same-origin Starknet RPC were verified on 2026-09-07 (Europe/Vaduz). See [frontend deployment evidence](../deployments/mainnet/frontend.json). The current RFQ screen is confidential-only; the older Node demo verified the retired funded maker protocol. Browser wallet acceptance and an ongoing maker operation remain separate work. Privy backend authentication and OHTTP are not activated.

After the candidate has real wallet/contract configuration, publish with the existing `npm run deploy:cf` command. Verify the resulting public URL, security headers, same-origin RPC, wallet connection and a message round trip from two real accounts. Configure optional Privy services separately if they will be offered.

## Execution and evidence

1. Obtain the deployer's public address and total fee budget; retain signing keys in the wallet.
2. Freeze/rebuild the candidate and record its exact hashes. Declare and deploy `App20Chat` using the mainnet pool constructor. Record successful receipts and deployment address.
3. Verify the deployed class and constructor storage against the candidate:

   ```sh
   npm run mainnet:prepare -- --rpc https://api.cartridge.gg/x/starknet/mainnet --verify-deployment DEPLOYED_CHAT_ADDRESS
   ```

4. Activate the verified address and compatible transaction builder, run the application/contract/build/browser gates, and publish the public frontend.
5. With two real wallets, register chat keys, then demonstrate encrypted messages and replies. Record at least three successful mainnet transactions that touch the STRK20 pool and the deployed helper. Chat key registration, declaration and deployment alone are not three pool interactions.
6. Put verified hashes, the contract address and actual public URL in `strk20.json`. Add the three-minute demo video. Do not use localnet hashes or historical Sepolia proofs.

On 2026-09-06 the mainnet pool returned a fee of **6 STRK** (`6000000000000000000` base units). This is a point-in-time RPC observation, not a total deployment cost or guaranteed future fee. Re-read fees immediately before signing and budget network fees and setup separately.

## Current state

- Chat: deployed and enabled, with one verified operator-controlled mainnet message. Ready acceptance, independent two-wallet messaging and a recipient payment remain unverified.
- Confidential RFQ: one `/rfq` screen, deployed escrow and enabled SDK; accepted atomic settlement and independent browser integration remain pending.
- Earlier maker/settlement contracts: three mainnet swaps verified historically. New public-term registration, funding, quoting and settlement are disabled; only explicit historical recovery remains.
- The public frontend is https://app20.io. The `fixed` submission manifest links the refreshed 63-second video; the original deadline release remains separately available.


## Historical independent-maker deployment

The earlier independent maker flow supported funded fixed quotes and shielded settlement through `App20PrivateSwap`, with public funded terms. Current clients block new execution; see [historical recovery](makers/README.md). Makers can withdraw proceeds and reclaim expired reservations. It does not require the legacy localnet pre-call or compute-and-invoke shim. The real-pool devnet test uses simulated proof facts; the Node SDK additionally completed real mainnet proof execution. Ready extension acceptance remains unverified.

Use `npm run mainnet:prepare:settlement -- --rpc https://api.cartridge.gg/x/starknet/mainnet` for both contract artifacts and deployment verification. The maker book and private swap were deployed and verified on 2026-09-06 under a 65 STRK total fee ceiling. Account activation, both declarations and deployment cost 28.046492790585744432 STRK combined. Exact addresses, transaction hashes, class hashes and the verification block are in the [deployment manifest](../deployments/mainnet/private-settlement.json). Those addresses remain pinned for historical record handling; new execution is blocked by current clients. The completed historical Node demo is recorded above.

## Starkscan proving transport limitation (2026-09-07)

Checked Starkscan's authenticated `/v1/meta/capabilities`, complete documentation (`https://starkscan.co/llms-full.txt`), and published OpenAPI (`https://starkscan.co/starkscan-openapi.yaml`). None advertises OHTTP, an OHTTP gateway/key configuration, or `message/ohttp` transport. This establishes no verified public OHTTP integration, not that an unpublished gateway cannot exist. The user accepted proceeding with this limitation.

The documented integration is HTTPS JSON: `POST https://api.starkscan.co/v1/SN_MAIN/prove` with a stable Idempotency-Key, then `GET /v1/SN_MAIN/prove/{jobId}`. See https://starkscan.co/docs/api/strk20-prover. The initial validation-only probe returned `idempotency_key_required`. Subsequent authenticated real proof jobs powered the mainnet shield and three fills recorded above.

An APP20 Worker proxy hides the provider API key from clients, but APP20/Cloudflare and Starkscan/the proving operator can access the proving payload at their respective TLS endpoints. This transport is not OHTTP and does not hide payloads from the relay. Wallet signing keys and viewing-key secrets must stay local; proving payloads may still reveal transaction details. Do not log request/response bodies or credentials. Require authenticated callers, bounded quotas, per-caller job ownership, and durable idempotency/recovery. The complete proof result (including additional_data) is delivered once and must be preserved privately by the client.

The existing `/api/ohttp/prover` route remains separate and must not silently fall back to this JSON transport. The Starkscan relay and Node proof-provider adapter are deployed and verified by the mainnet demo.

### Privy mainnet follow-up

The accepted plain-HTTPS proving limitation also applies to Privy; blind-relay/OHTTP claims must not be reused for this transport. Starkscan supplies hosted proving. The asynchronous adapter, mainnet configuration and direct contract discovery are implemented, and the Node demo verified real proofs. Privy still needs its backend app secret and browser account activation/register/shield/transfer/unshield acceptance. Node execution does not establish Privy browser activation.

## Implemented Privy / agent proving update

The Starkscan REST adapter, authenticated Worker proof routes, caller-bound job capabilities, per-caller idempotency, browser encrypted proof journal, and Node owner-only proof/account journals are implemented. The public Privy app/client IDs are configured. Worker provider/capability/session secrets and a hashed operator relay token are configured. `PRIVY_APP_SECRET` has not been supplied, so authenticated Privy wallet lookup cannot be verified or treated as activated. Live submission is enabled in configuration only for real proofs, not mock proofs.

The browser Privy wallet has mainnet registration, shielding, transfer and unshield paths. Ready remains the default RFQ wallet; Privy does not silently become the Ready account or move its funds. The Node SDK `createPrivacyWallet` supplies an executor for APP20 settlement plus wallet operations, using the official SDK and contract discovery. Its mainnet registration/shield and three private fills are now verified. This does not establish Ready or Privy browser acceptance, a standalone private transfer, or unshield execution.

The `[20]` SVG replaces the Starknet favicon. README and agent guidance describe the accepted plaintext-at-relay proving limitation. The September 7 preparation candidate was subsequently declared, deployed and activated on September 8; its verified Chat operation is recorded above.
