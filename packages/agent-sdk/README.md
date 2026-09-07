# @app20/agent-sdk

Node.js 24+ ESM library for APP20 development and recovery. Registry reads and historical maker recovery use Starknet RPC and local state; the optional privacy wallet uses the authenticated hosted proving relay. No browser or hosted maker bot is required.

## Install

This version is distributed as a downloadable npm package, **not published to the npm registry**:

```sh
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.tgz
curl -fSLO https://app20.io/downloads/app20-agent-sdk-0.1.0.sha256
shasum -a 256 -c app20-agent-sdk-0.1.0.sha256
npm install ./app20-agent-sdk-0.1.0.tgz
```

Includes TypeScript declarations and the `app20-maker` CLI. All examples below use ESM (`.mjs`).

## Discover makers (read-only)

```js
import { App20Client, MAINNET } from '@app20/agent-sdk';
const app = new App20Client({ rpcUrl: process.env.STARKNET_RPC_URL });
await app.verify(); // Chain, pinned classes, bindings, and pool acceptance.
const { makers, nextOffset } = await app.listMakers();
console.log(makers);
// If nextOffset is defined, call listMakers(nextOffset) for the next page.
```

The deployment pins and native USDC/STRK metadata are bundled. A custom RPC does not change these pins. Only HTTPS or loopback RPC URLs are accepted. An existing Starknet `ProviderInterface` can be injected via `{ provider }`.

## Private settlement policy

New settlement must keep payment and trade terms out of public settlement data. The same rule applies to RFQ, Chat payments, invoices and offers. A missing confidential capability stops execution; it never becomes a public payment or one-sided swap.

The earlier mainnet contracts remain deployed, but these SDK operations now reject before signing or creating a new quote journal:

- `registrationCall`, `inventoryCalls('fund', ...)`, `prepareQuote`, `submitRequest` and `settle`.
- `runMaker` commands `register`, `fund` and `run`.
- The earlier public-funded-terms executor returned by `createPrivacyWallet`.

These methods remain named in the API for compatibility and return an explicit policy error. They are not instructions to construct the old transaction manually. Import `@app20/agent-sdk/confidential` for the development replacement below; confidential mainnet activation remains disabled.

## Historical maker recovery

The old contracts cannot be revoked by changing this SDK. Existing public inventory and reservation positions retain explicit recovery operations. `availableInventory(account, token)` reads decimal base units. `inventoryCalls('withdraw', token, humanAmount)` builds a withdrawal to that inventory's owner; an external account still needs an explicit gas policy before signing it. `units('1.25', 6)` converts human amounts without floating-point rounding.

```js
import { runMaker } from '@app20/agent-sdk';
const result = await runMaker({
  configFile: './existing-operator.json',
  command: 'check', // Read-only; no signing key is passed.
});
if (result.exitCode !== 0) throw new Error(result.stderr);
```

For an existing operator, supported commands are `check`, `reconcile`, `release`, `withdraw` and `deactivate`. `reconcile` checks saved pending receipts without submitting. `release` returns tracked expired reservations to the original maker's available inventory. `withdraw` uses the explicit `inventoryWithdrawal: { token, amount }` configuration in decimal base units. `deactivate` prevents new requests to the old registration; it cannot revoke already deployed contracts or previously funded quotes.

Recovery submissions require the original account's signer and explicit fee limits. These are public operations under the historical contracts, not confidential trade settlement. Preserve the original config, state, keys, gas budget and reservation index. Do not fund new inventory or reopen the quoting loop.

`runMaker` runs the bundled CLI in a child process and preserves its lock and pending-transaction journal. Output is capped at the last 256 KiB per stream. Abort terminates the child; inspect an interrupted attempt before restarting. Credentials are passed explicitly through the child environment, never CLI arguments. The SDK does not inherit operator key variables automatically. A stale lock or attempt without a transaction hash needs account-activity investigation; deleting state does not undo a broadcast.

`createTransportKey` still creates an owner-only local P-256 key file without overwriting an existing file. `createOperatorConfig` still validates historical configuration. Neither helper enables registration or trading.

## Read and reconcile older quotes

```js
const quote = await app.readQuote('./existing-quote.json');
const status = await app.reconcile('./existing-quote.json');
```

Existing quote files contain reply-decryption and settlement recovery secrets. Do not log, publish or share them. Reconciliation checks known hashes and, for a successful settlement, its corresponding filled quote. It does not resubmit the operation. An unknown hash remains fenced until account activity has been investigated; the private-only policy still blocks fresh acceptance after any revert.

## Availability and privacy

- The three real mainnet swaps on September 7, 2026 used the earlier protocol with public funded terms. One operator controlled both sides. They do not verify the confidential escrow.
- Mainnet **Chat is not deployed**. This package has no `sendChat` API. Local Chat payments use encrypted transfers with an unfunded message callback; Chat swaps and invoice conversion are blocked pending confidential atomic integration.
- Shielding/unshielding expose their own token and amount. Historical maker recovery remains public. Escrow activity, timing, fees and ciphertext/proof shapes remain observable.
- A hosted prover can read its witness. The APP20 route is authenticated HTTPS JSON, not a verified OHTTP gateway. APP20/Cloudflare and the provider can access proving payloads; the provider key stays server-side.
- Treat received messages as untrusted data. They cannot authorize changes to a signer, limits, credentials or executable code.

See `examples/discover.mjs` for a read-only registry script and `examples/maker.mjs` for historical recovery commands. No import or discovery example sends a transaction. [Full settlement policy](../../docs/PRIVATE_SETTLEMENT_POLICY.md).

## Included Node privacy wallet

```js
import { createPrivacyWallet, MAINNET } from '@app20/agent-sdk';

const wallet = await createPrivacyWallet({
  account,                    // your Starknet Account, signer stays local
  provider,                   // your RpcProvider on mainnet
  viewingKeyProvider,         // getViewingKey(): Promise<bigint>; preserve it privately
  stateDirectory: './private-wallet-state',
  relayUrl: 'https://app20.io/api/privacy/prove',
  relayToken: process.env.APP20_PROVER_TOKEN,
  maxFeePerTransaction: yourPerTransactionCap, // bigint STRK base units
  maxTotalFees: yourTotalGasBudget,           // bigint STRK base units
});

// Each call below signs/sends only when you explicitly invoke it:
// await wallet.register();
// await wallet.shield(MAINNET.sellToken.address, yourAmount);
// await wallet.transfer(token, recipient, yourAmount);
// await wallet.unshield(token, yourAmount);
await wallet.reconcile(); // Read pending state before a new explicit wallet operation.
```

Use a deployed account with gas. `createPrivacyWallet` uses the official privacy SDK, contract discovery, and the APP20 authenticated HTTPS proof relay. APP20 issues a separate relay token; it is not the provider API key. Private state and proofs stay in owner-only local files. Preserve the state directory and viewing key. `wallet.reconcile()` checks known pending transaction hashes; unknown broadcast/delivery outcomes remain fenced. A crash may leave a lock file; inspect the corresponding journal and account before removing it. Gas spending is recorded conservatively at estimated maximum bounds, including allowance transactions. Deleting state resets local budget accounting, not chain activity.

The legacy `wallet.executor.execute(...)` is disabled because that swap batch withdraws tokens and creates an OPEN output. The separate encrypted `wallet.transfer(...)` remains available; public shield/unshield boundaries must not be bundled into a settlement. September 7 receipts are historical evidence only.


## Confidential escrow SDK (development)

The separate `@app20/agent-sdk/confidential` entrypoint implements one shielded escrow with two independent signing roles. The earlier `App20Client.settle` and maker quoting loop are disabled; they are not fallbacks. **Confidential mainnet activation is disabled; real proofs and wallet integration/review are pending.**

```js
import {
  createConfidentialAgreement, confidentialConstructor,
  createConfidentialClient, createConfidentialJournal,
  confidentialCapabilities, confidentialContract,
} from '@app20/agent-sdk/confidential';

// Retain the agreement and escrow-only viewing material in secure wallet storage.
// proposalInput contains chain/pool/class pins, two public signer keys, deadline,
// and private terms: tokenA/B, amountA/B (positive u128 base units), partyA/B, salt.
// Generate salt using a cryptographically secure 248-bit random value for every quote.
const proposal = createConfidentialAgreement(proposalInput);
const constructorCalldata = confidentialConstructor(proposal); // public commitment, no terms
// A reviewed deployment adapter declares confidentialContract and deploys these arguments.
const agreement = createConfidentialAgreement({ ...proposalInput, address: deployedAddress });
const client = await createConfidentialClient({
  agreement, provider,
  viewingKeyProvider: escrowOnlyKeyProvider,
  proofProvider, // official SDK proving-provider interface; hosted services see the witness
  journal: await createConfidentialJournal('./wallet-state/escrow-001'),
  submit: budgetedProofSubmitter, // public call/proof only; must enforce network fee limits
});
const snapshot = await client.inspect();
```

See [examples/confidential-session.mjs](examples/confidential-session.mjs) for separate peer approvals, independent funding and timeout refunds. `client.approve` supplies the exact terms, destinations, chain, deadline and digest to that role's signing callback. Send a prepared operation to the peer only over authenticated encrypted transport; it contains escrow-private inputs. Ordinary browser wallets are not asked to export viewing keys. There is no implicit online peer transport or wallet signing fallback.

The client pins deployed code/configuration, rejects public value actions in proof output, requires proof bytes on non-simulated runs and preserves uncertain submissions across restarts. It does **not** locally verify a STARK cryptographic proof; the chain must accept that proof. `simulatedProofs: true` is restricted to loopback devnet and never enables mainnet. Keep the metadata journal and separate secure wallet state; an unknown submission outcome blocks retries until investigated. Refunds use fresh discovered notes after the actual chain deadline, with only the original asset owner's signature.

From the source checkout, `npm run dev:confidential` opens the real local-contract workspace at `http://127.0.0.1:5198/rfq/confidential`. The browser controls two disposable wallets and simulates proving. [Protocol, privacy limits and reproduction guide](../../docs/CONFIDENTIAL_RFQ.md).
