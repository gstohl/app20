# Privy-authenticated STRK20 prover proxy

The proxy lets approved Privy applications share one private Starknet proving node without exposing that node publicly.

## Identity model

A Privy **App Client ID is public** and is not present in Privy's signed access-token claims. It cannot authorize proving by itself.

Enrollment therefore stores:

| Field | Purpose |
| --- | --- |
| `tenantId` | Opaque routing identifier issued by the proxy operator |
| `privyClientId` | App-client enrollment metadata; not an authenticator |
| `privyAppId` | Expected signed access-token audience/app ID |
| `verificationKeys` | Public Privy access-token verification key(s) |
| `poolAddress` | Only pool this tenant may prove against |
| `enabled` | Revocation switch |

Enrollment must be operator-approved and prove control of the Privy application. The package deliberately exposes no public enrollment HTTP endpoint. The in-memory registry permits only one tenant ID per Privy App ID; plans requiring isolated quotas must use separate App IDs or an independently signed backend assertion.

For every proof request, the proxy:

1. resolves `X-Strk20-Tenant`
2. verifies the bearer token's ES256 signature with the enrolled public key
3. requires Privy's verified `app_id` to equal the enrolled App ID
4. pseudonymizes `tenantId + user DID` with HMAC for quotas
5. validates JSON-RPC method, v3 zero-price proof transaction, block identifier, and pool sender
6. applies tenant/user concurrency and request limits
7. forwards only the JSON-RPC body to the private prover

The bearer token and tenant header are never forwarded upstream.

## Proxy module

```ts
import {
  InMemoryProverTenantRegistry,
  createPrivyProverProxyServer,
} from "strk20-privy/proxy";

const registry = new InMemoryProverTenantRegistry([
  {
    tenantId: "tenant-42",
    privyClientId: "client-...",
    privyAppId: "clp...",
    verificationKeys: [process.env.PRIVY_JWT_VERIFICATION_KEY!],
    poolAddress: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    enabled: true,
  },
]);

const server = createPrivyProverProxyServer({
  registry,
  upstreamUrl: process.env.PRIVATE_STARKNET_PROVER_URL!,
  upstreamHeaders: {
    authorization: `Bearer ${process.env.UPSTREAM_TOKEN}`,
  },
  identityHashSecret: process.env.IDENTITY_HASH_SECRET!,
});

server.listen(8787, "127.0.0.1");
```

Endpoints:

- `GET /health` — local process health only; does not call the prover
- `POST /rpc` — authenticated JSON-RPC proxy

Allowed RPC methods are `starknet_specVersion` and `starknet_proveTransaction`. Batch requests and browser-origin requests are rejected.

## Privy client module

```ts
import { PrivyStrk20Client } from "strk20-privy/client";

const client = new PrivyStrk20Client({
  network: "sepolia",
  privyAppId: process.env.PRIVY_APP_ID!,
  privyAppSecret: process.env.PRIVY_APP_SECRET!,
  authorizationPrivateKey: process.env.PRIVY_WALLET_AUTH_PRIVATE_KEY,
  rpcUrl: process.env.SEPOLIA_RPC_URL!,
  poolAddress: process.env.STRK20_POOL_ADDRESS!,
  proxy: {
    url: "https://proxy.example/rpc",
    tenantId: "tenant-42",
    submittable: true,
  },
});

// The browser obtained this with Privy's getAccessToken() and sent it to
// this app backend. Build one short-lived session per authenticated request.
const session = await client.session(wallet, {
  accessToken: async ({ forceRefresh }) =>
    getCurrentPrivyToken({ forceRefresh }),
});

await session.shield({ amount: 10n ** 15n });
```

The access token is verified before session construction, and the requested wallet must appear in that token user's Privy wallet list. It always authorizes the proxy request. If no backend authorization key is configured, it is also offered to Privy's User Signer JWT exchange; that requires a compatible JWT authentication setup. When `authorizationPrivateKey` is configured, client mode `auto` uses the backend key for `rawSign` and avoids JWT wallet-key exchange. On proxy error `401/-32001`, the provider invokes the token callback once with `forceRefresh: true`.

## No Ready-hosted dependency

This route uses no Ready wallet API, prover, discovery service, or paymaster. Privy signs, your backend builds transactions, your proxy authenticates, and your Starknet-provided node proves.

The default account class remains the open-source Ready/Argent v0.5 account class because Privy's Starknet address derivation assumes it. Replacing that class is a separate account-contract/address-derivation project, not a proxy change.

## Privacy warning

The proxy terminates authentication and therefore can observe a Privy tenant/user at the same time as a proof invocation. This is a deliberate trust boundary and potential metadata-linkage point.

Required policy:

- never persist or log bearer tokens
- never log user DIDs
- never log full proof-invocation bodies
- audit only pseudonymous user hashes, status, method, and latency
- do not combine identity and transaction telemetry in APM/error tools
- operate the proxy and prover under an explicit privacy/retention policy

## Production checklist

- TLS and an edge/WAF IP limit before Node
- private network or mTLS from proxy to prover
- operator-approved app ownership during enrollment
- Redis/database tenant registry and distributed quota/concurrency controls
- verification-key rotation with old and new keys temporarily active
- random HMAC secret, rotated under a documented migration plan
- strict upstream/request timeouts and connection caps
- one pool/network/release combination per prover deployment
- screening support before enabling shield/deposit
- `submittable: false` until a proof is independently accepted on Sepolia

The included in-memory registry and limiter are suitable for a single-process demo, not a replicated production gateway.
