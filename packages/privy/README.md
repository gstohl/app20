# @app20/privy

Reusable TypeScript integration for browser-owned and server-side Privy Starknet wallets with the STRK20 privacy pool.

It combines:

- Privy embedded Starknet wallets (`rawSign`), including browser `useSignRawHash`
- the Privy-compatible open-source Argent/Ready v0.5 account class (on-chain only)
- Starknet.js v3 transactions and optional AVNU paymasters
- the official Starknet Privacy SDK
- a pluggable prover and discovery layer
- register, shield, private transfer, unshield, and shielded-balance APIs

```text
browser: Privy user signer + viewing key + notes + witness
   ├── public transaction ─────────────────────────────> Starknet
   └── locally encrypted OHTTP ──> blind relay ────────> prover/discovery
```

> **No Ready-hosted infrastructure:** the package does not call Ready's wallet API, prover, discovery service, or paymaster. The only retained Ready/Argent element is the open-source account class Privy's Starknet address derivation currently assumes.

## Status

The package and mock safety boundary are implemented and unit tested. A live STRK20 end-to-end transaction still requires:

1. `@starkware-libs/starknet-privacy-sdk >= 0.14.3-rc.5`
2. a real Stwo transaction-prover endpoint
3. a discovery endpoint (contract discovery is suitable for development)
4. a funded/deployed Privy-backed Starknet account

Only proofs produced by the official Starknet/Stwo path are accepted by Starknet. The mock is not a lightweight replacement for that prover.

### What must be deployed?

For normal register → shield → private transfer → unshield flows, no new privacy contract is required. Use the canonical pool and existing token contracts. Each Privy wallet deploys its own account instance, but its class is already declared. Prover and discovery are off-chain services. Deploy a separate Cairo contract only for an application-specific private action such as a swap, vault, or treasury helper.

## Requirements

- Node.js **24 or newer** for server tooling and the pinned SDK build
- Privy App ID; an App Secret is required only by server control-plane/token-verification code
- Privy browser user signer or an explicitly configured server authorization mechanism
- Starknet RPC (Alchemy or another RPC v0.10 provider)

## Install

```bash
npm install @app20/privy
```

The Privacy SDK is an optional peer because it is distributed through GitHub Packages:

```bash
gh auth refresh -h github.com -s read:packages
npm config set @starkware-libs:registry https://npm.pkg.github.com
npm config set '//npm.pkg.github.com/:_authToken' "$(gh auth token)"
npm install @starkware-libs/starknet-privacy-sdk
```

Public wallet/deployment helpers work without the Privacy SDK. Private and mock flows require it. This repository's development install uses the pinned runtime artifact documented in [`docs/SDK_RUNTIME.md`](docs/SDK_RUNTIME.md); published consumers should use the matching official package release.

## Modules

| Import | Purpose |
| --- | --- |
| `@app20/privy` | low-level Privy account, public transactions, proving/discovery abstractions |
| `@app20/privy/client` | app-backend client combining Privy wallet signing with the authenticated proxy |
| `@app20/privy/browser` | browser-safe signer, account/session client, OHTTP proving and discovery |
| `@app20/privy/proxy` | multi-tenant access-token verification, quotas, validation, and prover forwarding |

The proxy enrollment records a Privy Client ID as metadata, but authorization never trusts it alone. A valid Privy access token must verify against the enrolled **App ID and public verification key**. See [`docs/PROXY.md`](docs/PROXY.md) and the runnable [`demo/`](demo/).

## Browser-owned privacy

Inside a React component, adapt Privy's Starknet hook to the browser-safe client:

```ts
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import {
  BrowserStrk20Client,
  serviceDiscovery,
  serviceProver,
} from "@app20/privy/browser";

const { signRawHash } = useSignRawHash();
const client = new BrowserStrk20Client({
  network: "sepolia",
  rpcUrl: `${location.origin}/api/starknet`,
  prover: serviceProver({
    url: "https://prover.ohttp.invalid",
    ohttp: { relayUrl: "/api/ohttp/prover", publicKeyConfig: proverKeys },
  }),
  discovery: serviceDiscovery("https://discovery.ohttp.invalid", {
    ohttp: { relayUrl: "/api/ohttp/discovery", publicKeyConfig: discoveryKeys },
  }),
});
const session = await client.session(wallet, (hash) =>
  signRawHash({ address: wallet.privyAddress, chainType: "starknet", hash }),
);
```

The browser holds viewing keys, notes, private inputs, and witness construction. A blind relay sees authenticated/pseudonymous quota context plus ciphertext; the final remote prover still sees the decrypted witness. See [`docs/BROWSER_PRIVACY.md`](docs/BROWSER_PRIVACY.md).

### Application-specific private invocation

`invokeExternal()` groups private transfers, explicit helper funding, one OPEN recovery note, and one external invocation into the same proof. Helper funding is mandatory and application-reviewed; the SDK never invents a dust amount.

```ts
await session.invokeExternal({
  funding: { token: STRK, recipient: helperAddress, amount: helperFunding },
  recovery: { token: STRK, recipient: session.address },
  transfers: [{ token: STRK, recipient, amount }], // optional
  calldata: ({ poolAddress, openNotes }) => ({
    contractAddress: helperAddress,
    calldata: [
      STRK,
      poolAddress,
      (openNotes as Array<{ noteId: bigint }>)[0]!.noteId,
      ...encryptedApplicationPayload,
    ],
  }),
});
```

This is the browser-owned seam used by APP20's Privacy Mail Vault. Message plaintext must already be end-to-end encrypted before it enters the invocation payload.

## Legacy server-side shared prover

```ts
import { PrivyStrk20Client } from "@app20/privy/client";

const client = new PrivyStrk20Client({
  network: "sepolia",
  privyAppId: process.env.PRIVY_APP_ID!,
  privyAppSecret: process.env.PRIVY_APP_SECRET!,
  authorizationPrivateKey: process.env.PRIVY_WALLET_AUTH_PRIVATE_KEY!,
  rpcUrl: process.env.SEPOLIA_RPC_URL!,
  poolAddress: process.env.STRK20_POOL_ADDRESS!,
  proxy: {
    url: "https://proxy.example/rpc",
    tenantId: "tenant-42",
    submittable: true,
  },
});

const session = await client.session(wallet, {
  accessToken: async ({ forceRefresh }) =>
    getCurrentPrivyAccessToken({ forceRefresh }),
});
await session.shield({ amount: 10n ** 15n });
```

This server-owned signing pattern is retained for integrations that explicitly accept custody. It is not used by the browser demo. A threshold-1 backend authorization key can sign independently and therefore must not be treated as user-controlled authorization.

## Start safely with the mock prover

```ts
import { Strk20Privy, mockProver, contractDiscovery } from "@app20/privy";

const client = new Strk20Privy({
  network: "sepolia",
  privyAppId: process.env.PRIVY_APP_ID!,
  privyAppSecret: process.env.PRIVY_APP_SECRET!,
  authorizationPrivateKey: process.env.PRIVY_WALLET_AUTH_PRIVATE_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY!,
  prover: mockProver(),
  discovery: contractDiscovery(),
});

const wallet = await client.createWallet({
  owner: { userId: "did:privy:..." },
});
const session = await client.session(wallet);

// Builds and signs the proof invocation, compiles apply_actions through RPC,
// but never submits the result to Starknet.
const result = await session.register();

if (!result.submitted) {
  console.log(result.proverKind);   // "mock"
  console.log(result.callAndProof); // useful for app integration and inspection
}
```

The same mode is available through environment configuration:

```env
STRK20_PROVER_MODE=mock
```

Mock mode automatically chooses direct contract discovery when no discovery URL is supplied.

### Mock limitations

- It produces **no valid STARK proof**.
- It never changes on-chain or shielded state.
- A build-only shield therefore will not create a note that a later transfer can spend.
- It is useful for Privy signing, SDK wiring, request construction, UI/backend integration, and `apply_actions` fee-shape testing. It does not include a real deposit approval or proof-verification cost.
- `PrivacyClient.submit()` throws `UnsubmittableProofError` for every mock source.

## Switch to our testnet prover later

No session or application call changes:

```ts
import {
  Strk20Privy,
  serviceProver,
  serviceDiscovery,
} from "@app20/privy";

const client = new Strk20Privy({
  network: "sepolia",
  privyAppId: process.env.PRIVY_APP_ID!,
  privyAppSecret: process.env.PRIVY_APP_SECRET!,
  authorizationPrivateKey: process.env.PRIVY_WALLET_AUTH_PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL!,
  prover: serviceProver({
    url: process.env.STRK20_PROVING_URL!,
    requestTimeoutMs: 120_000,
    retry: { maxRetries: 3, baseDelayMs: 1_000 },
  }),
  discovery: serviceDiscovery(process.env.STRK20_DISCOVERY_URL!),
});
```

Legacy `provingUrl` / `discoveryUrl` options and `STRK20_PROVING_URL` / `STRK20_DISCOVERY_URL` environment variables resolve to the same service sources.

A remote mock that implements the real JSON-RPC shape must be explicitly marked build-only:

```ts
serviceProver({ url: "http://127.0.0.1:8787", submittable: false });
```

See [`docs/PROVER_API.md`](docs/PROVER_API.md) for the endpoint contract our testnet prover must implement.

## Wallet and privacy lifecycle

```ts
const wallet = await client.createWallet();
const session = await client.session(wallet);

// Required only for real submission. Fund wallet.address first.
await session.ensureDeployed();

await session.publicBalances();
await session.publicTransfer({
  recipient: "0x...",
  amount: 10n ** 15n,
});

// Registration is bundled into the first shield when needed.
await session.shield({ amount: 10n ** 18n });
await session.balances();
await session.transfer({ recipient: "0x...", amount: 5n * 10n ** 17n });
await session.unshield({ amount: 10n ** 17n });
```

For User Signer wallets backed by a separately configured JWT authentication provider, authorize signing with that provider's user JWT:

```ts
const session = await client.session(wallet, {
  authorization: { userJwts: [userAccessToken] },
});
```

Never send `PRIVY_APP_SECRET`, authorization private keys, upstream credentials, or unrestricted server capabilities to a browser. Viewing keys and private state may be browser-owned when the application uses a hardened client runtime and encrypts proving/discovery requests before a blind relay.

## Prover abstraction

Three sources are public:

| Source | Purpose | Submits? |
| --- | --- | --- |
| `mockProver()` | Official SDK call-based mock for development | **never** |
| `serviceProver({ url })` | Official JSON-RPC proving service | yes |
| `customProver(provider, { submittable })` | Application-owned provider object | explicit policy |

The explicit `submittable` property is a security boundary. Proof facts alone do not prove that proof data is valid; the package also rejects a response containing facts without proof data.

Discovery is independently pluggable:

| Source | Purpose |
| --- | --- |
| `contractDiscovery()` | Query the pool through RPC; development/small workloads |
| `serviceDiscovery(url)` | Production note/channel indexer |
| `customDiscovery(provider)` | Application-owned implementation |

Direct discovery is rate-limited by default. Tune or disable it explicitly:

```ts
contractDiscovery({
  rateLimit: { concurrency: 4, maxRetries: 3, baseDelayMs: 100 },
});
// contractDiscovery({ rateLimit: false })
```

## Concurrent requests and replicas

Private operations are serialized per `network:address`. The built-in coordinator is shared by all `Strk20Privy` instances in one Node process. If the app has multiple replicas or serverless workers, provide a distributed coordinator backed by Redis or a database advisory lock:

```ts
import type { PrivacyCoordinator } from "@app20/privy";

const privacyCoordinator: PrivacyCoordinator = {
  async acquire(key) {
    // Atomically acquire an exclusive lock for `key` and load the persisted
    // lastPrivateTxBlock. Use a lease/TTL and fencing token in production.
    return {
      lastPrivateTxBlock: await loadLastBlock(key),
      setLastPrivateTxBlock: (block) => saveLastBlock(key, block),
      release: () => releaseLock(key),
    };
  },
};

const client = new Strk20Privy({ privacyCoordinator });
```

Persisting the last submitted block is important: the next replica must wait for note/proof maturity, not merely avoid simultaneous execution.

## Viewing keys

By default, a session asks the Privy-backed account to sign a deterministic SNIP-12 message and folds that signature into a canonical viewing key. Alternatives:

```ts
await client.session(wallet, { viewingPassphrase: "user secret" });
await client.session(wallet, { viewingKey: 123n });
await client.session(wallet, { viewingKey: async () => loadFromHsm() });
```

The viewing key must be in `[1, half STARK curve order]`. Do not log it or store it beside application logs.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | yes | Privy server client |
| `PRIVY_WALLET_AUTH_PRIVATE_KEY` | legacy server-owned signing only | Privy Wallet API authorization; never used by the browser module |
| `ALCHEMY_API_KEY` or `RPC_URL` | yes | Starknet RPC |
| `STARKNET_NETWORK` | no | `sepolia` (default) or `mainnet` |
| `STRK20_POOL_ADDRESS` | mainnet/custom | Privacy pool |
| `STRK20_PROVER_MODE` | development | `mock` or `service` |
| `STRK20_PROVING_URL` | live proving | `starknet_proveTransaction` service |
| `STRK20_DISCOVERY_URL` | production discovery | Notes/channels indexer |
| `STRK20_MATURITY_POLL_MS` | optional | block polling interval |
| `STRK20_MATURITY_TIMEOUT_MS` | optional | bounded wait deadline (default fifteen minutes) |
| `PAYMASTER_URL`, `PAYMASTER_API_KEY` | optional | AVNU deployment/public gas |

## Privacy and operational boundaries

- Privy only signs; it does not prove or discover STRK20 notes. Privy remains able to observe wallet identity and requested signature hashes.
- OHTTP hides plaintext from the relay, not from the final prover/discovery gateway.
- Deposits, withdrawals, pool interaction, source-IP/timing correlation, and public boundary amounts remain observable.
- Browser compromise or XSS can read private state before encryption and request signatures through the active user session.
- Notes mature after ten blocks, and proofs must use an old-enough base block. Maturity waits are bounded so a stalled RPC cannot hold a wallet queue forever.
- Deposits can require FPI screening attestations.
- A paymaster and a prover are different services.
- This package does not expose or depend on Ready/Xverse private endpoints.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## License

MIT
