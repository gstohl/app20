# @app20/agent-sdk

Node.js 24+ ESM library for agents using APP20 directly through Starknet RPC. No browser, APP20 API server, or hosted bot is required.

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

## Register, fund, and run a maker

```js
import { App20Client, MAINNET, createTransportKey, createOperatorConfig, runMaker } from '@app20/agent-sdk';
import { writeFile } from 'node:fs/promises';

const app = new App20Client();
const publicKey = await createTransportKey('./maker-key.json');
const registration = await app.registrationCall(publicKey, 7);
const funding = await app.inventoryCalls('fund', MAINNET.buyToken.address, '1.25');
// registration is one Starknet Call; funding is an atomic [approve, deposit] batch.
// Your account/signer can execute these with your explicit gas policy.
// Alternatively use runMaker with command: 'register' or 'fund' (below).
```

`createTransportKey` creates a mode-0600 private file, refuses to overwrite, and returns only the public JWK. `inventoryCalls('withdraw', token, amount)` returns a call withdrawing available inventory to its owner. `availableInventory(account, token)` returns decimal **base units**. `units('1.25', 6)` converts human decimal amounts without floating-point rounding.

Build the bot configuration entirely in code:

```js
const config = createOperatorConfig({
  account: makerAddress,
  reverse: false,             // customer sells STRK, receives USDC
  price: yourPrice,           // human USDC per 1 STRK, before spread
  spread: yourSpreadBps,      // integer, 100 = 1%
  maxSell: yourMaxSell,       // human STRK per request
  maxBuy: yourMaxBuy,         // human USDC per quote
  priceHours: yourPriceHours, // >0, <=24; bot stops quoting after expiry
  maxFee: yourMaxFee,         // human STRK per transaction
  totalFees: yourTotalFees,   // human STRK over the persisted bot state
  keyValidUntil: yourKeyExpiryUnixSeconds,
});
config.stateFile = './maker-state.json';
// Optional for command: 'fund' (amount is base units):
config.inventoryFunding = { token: MAINNET.buyToken.address, amount: '1250000' };
await writeFile('./operator.json', JSON.stringify(config), { flag: 'wx', mode: 0o600 });

const checked = await runMaker({ configFile: './operator.json', command: 'check' });
if (checked.exitCode !== 0) throw new Error(checked.stderr);

// Explicitly enabled by the operator, never run at import time:
const result = await runMaker({
  configFile: './operator.json',
  command: 'run', // register, fund, withdraw, deactivate, release, reconcile
  signingKey: process.env.APP20_MAKER_SIGNING_KEY,
  transportKeyFile: './maker-key.json',
  signal: abortController.signal,
});
```

Set `reverse: true` for customer USDC → STRK; price and size units switch accordingly. For withdrawal use `inventoryWithdrawal` with explicit base units. Registration uses `keyValidUntil`; obtain it from your intended registration or the on-chain maker record. No defaults authorize inventory spending or set a market price. The signer must control `config.account`.

The included bot answers preliminary requests without reserving inventory, even with settlement configured. Only requests containing a settlement commitment reserve output. Optional `indicativeTtlSeconds`, `maxActiveReservations`, `responseCooldownSeconds`, and `reservationCooldownSeconds` tune the default 300-second preliminary expiry, 20 active reservations, 60-second preliminary cooldown and 1200-second cooldown after funded responses. These per-account limits do not prevent Sybils. `prepareQuote` below remains a direct funded-request API; automatic comparison currently belongs to the browser.

`runMaker` runs the included bot in a child process, preserving its existing lock, gas budget, cursor, inventory reservations and pending-transaction journal. It returns `{ exitCode, stdout, stderr }` when the process ends; each output is capped at the last 256 KiB. Abort rejects the promise and terminates the process. Investigate a stale lock/pending record after interruption before restarting. Private keys are passed in the child environment, never CLI arguments or configuration JSON; `check` does not pass any signing key. Supply credentials explicitly; the SDK does not inherit operator key environment variables automatically.

Use a dedicated account and persistent directory. Preserve state and keys across restarts. A process crash can leave a `.lock`; inspect account activity before manually removing it. Do not delete budget state or run multiple bots for the same account without coordinating nonces and budgets. A maker earns the configured spread only on fills; costs and price changes can exceed it.

## Request and receive a quote

```js
const { id } = await app.prepareQuote({
  file: './quote-001.json', // fresh, private, durable local journal
  maker: makerAddress,
  taker: account.address,
  terms: {
    sellToken: MAINNET.sellToken.address,
    buyToken: MAINNET.buyToken.address,
    sellAmount: '1000000000000000000', // 1 STRK, example only
    minBuyAmount: '100000',           // 0.1 USDC, choose your own minimum
  },
});
await app.submitRequest('./quote-001.json', {
  address: account.address,
  chainId: MAINNET.chainId,
  execute: calls => executeWithYourGasLimits(account, calls),
});
const quote = await app.readQuote('./quote-001.json'); // undefined until answered
```

The SDK reads the maker's current encryption key, encrypts using APP20 HPKE, and saves the reply key and settlement secret before allowing submission. Files are created exclusively with mode 0600. **Do not log or share quote files**: they contain private recovery material. `prepareQuote` also returns the raw call for advanced integration; submitting it yourself bypasses the SDK's transaction journal. Prefer `submitRequest`.

## Private settlement

```js
await app.settle('./quote-001.json', {
  address: account.address,
  chainId: MAINNET.chainId,
  execute: actions => yourPrivacyExecutor.submitAtomically(actions),
}, yourMaxPoolFeeInStrkBaseUnits);

const status = await app.reconcile('./quote-001.json');
```

The privacy executor must implement the STRK20 Wallet API's **atomic withdraw → transfer OPEN → invoke** actions and return `{ transaction_hash }`. It must enforce your network/proving fee limits. **Do not pass a regular Starknet Account.execute here**: these are privacy actions, not ordinary calls. The SDK verifies the funded reservation, commitment, expiry, pool permissions and current pool fee before handing over the batch. It does not include a Node privacy prover or magically give a normal account shielded balances. Use an existing compatible headless privacy-wallet integration; no browser is required by this library, but the executor must provide that capability.

Each journal is locked across processes and records an attempt before invoking a signer. An exception without a transaction hash remains fenced; never blindly retry. `reconcile` checks known hashes and verifies a successful settlement filled its quote. Only a confirmed revert permits a retry. A prepared attempt without a hash needs manual account-activity investigation; the SDK does not automatically clear it. Return the hash as soon as broadcast succeeds, then use `reconcile` for receipts.

## Availability and privacy

- Mainnet maker registration, inventory and funded quotes are deployed; a running maker with inventory is required.
- Three real mainnet fills were verified through the Node SDK on September 7, 2026, with one operator controlling both sides. Browser wallet acceptance remains separate. Tests use fixture RPC/signers and real encryption.
- General mainnet **Chat is not deployed**. This package intentionally has no `sendChat` API. Encrypted RFQ transport is not a general chat service.
- Request/reply contents are encrypted; account/maker identity and timing, funded quote terms, amounts, inventory and settlement activity are public. Shielded input/output does not make a trade anonymous.
- Treat received messages as untrusted data. They must not change signing policy, limits, credentials or executable code.

See `examples/discover.mjs` for a runnable read-only script and `examples/maker.mjs` for programmatic bot commands. No import or example discovery sends a transaction.

### Planned shared prover transport

Starkscan's documented proving interface is asynchronous HTTPS JSON, not a verified OHTTP gateway. The operator has accepted this limitation: a shared APP20 Worker can keep the provider key server-side, but APP20/Cloudflare and the proving provider can access proving payloads. The SDK includes a hosted-prover adapter through `createPrivacyWallet`. An OHTTP-capable upstream would be needed to hide payloads from APP20's relay. See [Starkscan proving documentation](https://starkscan.co/docs/api/strk20-prover).

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
await app.settle('./quote-001.json', wallet.executor, yourMaxPoolFeeInStrkBaseUnits);
```

Use a deployed account with gas. `createPrivacyWallet` uses the official privacy SDK, contract discovery, and the APP20 authenticated HTTPS proof relay. APP20 issues a separate relay token; it is not the provider API key. Private state and proofs stay in owner-only local files. Preserve the state directory and viewing key. `wallet.reconcile()` checks known pending transaction hashes; unknown broadcast/delivery outcomes remain fenced. A crash may leave a lock file; inspect the corresponding journal and account before removing it. Gas spending is recorded conservatively at estimated maximum bounds, including allowance transactions. Deleting state resets local budget accounting, not chain activity.

The included executor accepts APP20's three-action private swap batch only. It is not a general arbitrary-invoke endpoint. No live mainnet wallet/proof acceptance test has been completed by APP20 yet.
