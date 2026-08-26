# APP20

Professional private RFQ trading desk on Starknet.

Three surfaces form one workflow:

1. **Desk** — inventory-backed private USDC↔STRK RFQs and shielded funding
2. **Mailbox** — encrypted deal correspondence, structured evidence, and contact recovery
3. **Counterparties** — a device-encrypted directory with RFQ and Mail handoffs

Users connect once in the header. Viewing keys and mailbox keys stay on the
device. The STRK20 pool is reached through the official Starknet privacy path.
Dry cross-chain review and payment links remain secondary tools,
not separate claims in the judged trading flow.

Repository: [github.com/gstohl/app20](https://github.com/gstohl/app20)

The first intended public host is `app20.gstohl.com`. That origin is not live
yet. This is not a Mainnet value-moving release.

## Product

| Rank | Feature | Route | Status |
| --- | --- | --- | --- |
| 1 | Private Desk | `/vault` | Localnet solicits two sealed USDC↔STRK makers with distinct processes, settlement accounts, quote keys, private-note inventories, and fsynced reservation WALs. APP20 verifies both signatures, selects deterministically, and proves crash recovery, lock, fill, claim, expiry refund, and insufficient-inventory refusal. No order book is published. Funding remains a distinct STRK20 rail. No production maker network is deployed |
| 2 | Mailbox | `/mail/inbox` | On-chain ciphertext for letters, legacy OTC documents, receipts, and authenticated self-addressed contact snapshots. Mail is correspondence/evidence, never settlement authority |
| 3 | Counterparties | `/contacts` | Device-encrypted labels and addresses with RFQ/Mail deep links. Optional recovery needs the same wallet plus the mailbox recovery phrase |
| 4 | Secondary tools | `/vault#intents`, `/pay` | Dry cross-chain review and unsigned payment links. No live 1Click submission or TEE execution |

`/pay` is a Mail helper, not a fifth product. It only creates an unsigned
payment-request link. Nothing is sent until the payer confirms in Mail.

### Desk, Mailbox, and Counterparties

The RFQ is authoritative only when Cairo and the pool confirm its lifecycle.
Mailbox letters can carry coordination and evidence but cannot prove a fill.
Counterparty labels remain local unless the user explicitly posts an encrypted
self-backup through Mail.

The same wallet opens all three surfaces. A Counterparty can start a prefilled
RFQ or encrypted letter; a settled local RFQ produces a lifecycle receipt and
links back to Mailbox. Shield, private transfer, and unshield remain separate
funding actions under **Balances & funding**.

Dry cross-chain Intents still share `/vault`, but remain a public review rail
against NEAR 1Click. They have different signers, disclosure, and failure modes
and are never merged into the private RFQ submit path.

Wallet policy is enforced below the UI:

- **Mainnet** — reviewed Ready / Argent Wallet Standard feature IDs only
- **Sepolia** — Ready, plus an optional Privy browser signer
- **Localnet** — build-gated development wallet

In the product, mail is **Mailbox** / **Mail**. This pre-release namespace
reset renames the active contracts, storage keys, cryptographic domains,
environment variables, and localnet paths to APP20. Pre-reset browser data,
Mail ciphertext, signed payment links, and contract artifacts are not compatible
and are not silently migrated.

## How APP20 works

### Wallet and network rails

```mermaid
flowchart TD
    U[User] --> H[Single header session control]
    H --> R{Selected rail}
    R -->|Ready| W[Ready Wallet Standard]
    R -->|Privy| P[Privy browser signer]
    R -->|Development build only| L[Localnet wallet]

    W --> N{Network policy}
    N -->|Mainnet| M[Ready-only wallet actions]
    N -->|Sepolia| S[Ready testnet actions]
    P --> PS[Sepolia recovery rail only]
    L --> LD[Ephemeral localnet demo]

    M --> V[Vault funding and public send]
    S --> V
    LD --> D[Private RFQ Desk]
    W --> MB[Mailbox and Counterparties]
    L --> MB

    D -. no automatic fallback .-> X[Public venue]
    X -->|Separate confirmation| PX[Public execution]
```

Mainnet rejects Privy and the development wallet. Selecting a rail never
silently borrows another rail's signer.

### STRK20 funding and visibility

```mermaid
flowchart LR
    A[Public wallet balance] -->|Shield: public amount and timing| P[STRK20 private note pool]
    P -->|Private transfer| Q[New encrypted notes]
    Q -->|Private note ownership| E[APP20 escrow interaction]
    Q -->|Unshield: public amount and timing| B[Public wallet balance]
    E --> C[Public pair, amounts, deadline, and lifecycle]
```

The pool can hide private-transfer ownership and counterparties. Shield,
unshield, and first-version settlement remain public and correlatable.

### Invited-maker RFQ

```mermaid
sequenceDiagram
    actor T as Taker
    participant B as APP20 browser
    participant A as Maker A
    participant C as Maker B
    participant P as STRK20 pool
    participant E as Localnet escrow

    T->>B: Enter pair, exact size, floor, and expiry
    B->>B: Run privacy preflight
    B-->>T: Show unavailable evidence and public leakage
    T->>B: Explicit informed confirmation

    par Invite Maker A
        B->>A: Canonical RFQ
        A->>A: Reserve inventory and fsync WAL
        A-->>B: Reservation-bound signed quote
    and Invite Maker B
        B->>C: Canonical RFQ
        C->>C: Reserve inventory and fsync WAL
        C-->>B: Reservation-bound signed quote
    end

    B->>B: Verify every quote and rank locally
    B->>A: Release loser
    B->>C: Select winner and persist begin-fill
    T->>P: Fund escrow
    C->>P: Fill from private inventory
    P->>E: Apply Fund and Fill

    alt Filled before deadline
        T->>P: Return ticket and claim
        P->>E: Apply Claim
    else Not filled before deadline
        T->>P: Return ticket and timeout
        P->>E: Apply exact refund
    end
```

Only invited makers receive exact pre-trade terms. There is no public RFQ book,
and refusal never triggers automatic public routing.

### Maker reservation and recovery

```mermaid
stateDiagram-v2
    [*] --> Reserved: reserve and fsync
    Reserved --> Reserved: identical idempotent request
    Reserved --> Selected: winner selected
    Reserved --> Released: loser or user release
    Reserved --> Expired: lease expires
    Selected --> Filling: fsync before wallet call
    Filling --> Consumed: finalized fill reconciled
    Filling --> Quarantined: unknown outcome or crash
    Selected --> Quarantined: ambiguous recovery
    Released --> [*]
    Expired --> [*]
    Consumed --> [*]
    Quarantined --> ManualReview
```

Localnet uses one PID-locked hash-chain WAL per maker. Production still needs
replicated linearizable storage and chain reconciliation.

### Mail and settlement authority

```mermaid
flowchart TD
    W[Wallet account] -->|SNIP-12 attestation only| K[Wallet-to-Mail binding]
    S[Independent mailbox seed] --> MK[Mail encryption and auth keys]
    K --> N[Offer, counter, accept, or cancel]
    MK --> N
    N --> T[Encrypted Mail transcript]
    T --> EV[Correspondence evidence]

    Q[Verified maker quote and reservation] --> ST[Settlement call]
    ST --> CH[Cairo plus finalized chain events]
    CH --> AR[Authoritative receipt after configured-chain verification]

    EV -. may reference a digest .-> AR
    EV -. cannot authorize value .-> ST
```

Wallet signatures attest correspondence-key control; they are never encryption
key material. Mail can preserve evidence but cannot invoke or prove settlement.

### Receipt and disclosure

```mermaid
flowchart LR
    CE[Configured-chain verifier] --> VR[Verified chain receipt]
    LE[Local quote and negotiation evidence] --> LR[Local evidence]
    VR --> FR[Canonical full receipt]
    LR --> FR
    FR --> DG[Receipt digest]
    U[User selects allowlisted fields] --> DP[Disclosure package]
    FR --> DP
    DG --> DP
    DP --> V[Recipient verifies against full receipt]
    DP -. excluded by default .-> X[Losing quotes, invited makers, Mail, note IDs, viewing keys, relay metadata]
```

A digest binds bytes but is not authorization. A disclosure is a selected
package, not a zero-knowledge or Merkle proof, and a copied disclosure cannot
be revoked.

### Contract rollout

```mermaid
flowchart TD
    L[Current localnet] --> LM[App20Mail]
    L --> LE[App20Escrow V2]
    L --> CT[ClaimTicket]
    L --> ME[MockErc20 test fixture]

    LM -->|Separate approval and review| MS[Optional Mainnet Mail scoring]
    LE -. do not deploy directly .-> VN[New quote-bound escrow VNext]
    CT -. compatibility review .-> TN[Reviewed ticket class]
    VN --> A[Independent audits]
    TN --> A
    A --> S[Sepolia two-maker soak]
    S --> H{Explicit tiny-Mainnet approval}
    H -->|No| STOP[RFQ stays disabled]
    H -->|Yes, hard caps| MM[Tiny Mainnet RFQ evidence]
```

Nothing is authorized for deployment now. `App20Escrow` is a localnet
development contract, not the production class. See
[`docs/APP20_CONTRACTS.md`](docs/APP20_CONTRACTS.md).

### Release ladder

```mermaid
flowchart LR
    P0[Immutable source] --> P1[Pure models]
    P1 --> P2[Production-shaped localnet]
    P2 --> P3[Adversarial localnet]
    P3 --> P4[Independent review]
    P4 --> P5[Sepolia soak]
    P5 --> P6[Tiny approved Mainnet]
    P6 --> P7[Capped production]

    D[Current state] --> P2
    D -. dirty source .-> P0
    D -. HPKE, chain verifier, replicated storage .-> P3
```

Passing a UI test cannot skip an earlier trust gate. Current evidence allows
only the build-gated localnet demonstration and dry review. Detailed diagrams:
[`docs/APP20_PROCESS_DIAGRAMS.md`](docs/APP20_PROCESS_DIAGRAMS.md).

## Privacy

APP20 can hide in-pool transfers and encrypt mail. It cannot promise
unlinkability.

| Hidden | Public |
| --- | --- |
| In-pool sender, recipient, and amount | Shield and unshield |
| Mail plaintext and self-backed contact labels | Ciphertext, size, timing, helper use, recipient count, backup frequency |
| Device-local contact labels and notes | Addresses when publicly used; code running in an unlocked browser profile can read them |
| Sender and recipient addresses in `MessagePosted` | Directory lookups at the configured RPC |
| Private note ownership in the RFQ | Prototype escrow pair, amounts, deadline, OPEN-note amount, and helper activity |
| OHTTP ciphertext on the relay | The final prover after decapsulation |

A replaced frontend can still request signatures and read browser-owned keys.
Ready signatures are not used as encryption keys and the dapp never requests a
STRK20 viewing key. Wallet connection identifies the mailbox but cannot decrypt
Mail or contact snapshots by itself: recovery also requires the mailbox backup
phrase. Old on-chain ciphertext cannot be deleted. Cross-chain amounts, assets,
destinations, and timing remain correlatable.

## Develop

Requires Node.js 24+. From the repository root:

```bash
npm install --ignore-scripts
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5173`.

Every `VITE_*` value is public. Do not put RPC credentials, Privy App Secret,
prover or discovery origins, OHTTP session secrets, or partner keys in browser
env files. Those belong in Worker secrets after deploy.

This repository does not contain testnet or mainnet prover, discovery, or RPC
origins. Browser code only sees public metadata and non-routable `.invalid`
OHTTP names.

### Localnet

```bash
npm run pool:setup
npm run dev:localnet
npm run localnet:stop
```

This deploys the real Cairo pool, a six-decimal local USDC fixture, and the
production mail action sequence, including the fixed 7-base-unit helper funding
withdrawal. It also proves both directions of the private USDC↔STRK RFQ market:
lock, inventory-first solver fill, claim, expiry refund, and insufficient-
inventory refusal. The selected maker is SIGKILLed after quote selection,
automatically restarts from its `0600` hash-chain WAL, and then completes the
fill. The browser journey also proves Counterparty → RFQ handoff and contact
snapshot → encrypted self-mail → explicit merge restore. Prices and private
keys are deterministic localnet fixtures and proof bytes are simulated. This is
not a Mainnet market or send.

## Packages

| Package | Role |
| --- | --- |
| `@app20/domain` | Accounts, canonical intents, lifecycle |
| `@app20/near-intents` | Dry-only NEAR 1Click connector |
| `@app20/policy-client` | Attestation and policy-receipt verification |
| `@app20/privacy-adapters` | Fail-closed Starknet wallet and network policy |
| `@app20/private-intents` | Canonical RFQ, signed directory, HPKE envelope, quote, reservation, and settlement models |
| `@app20/maker-node` | Server-only WAL-backed reservation, signing, custody-adapter, and crash-recovery core |
| `@app20/privy` | Browser-owned STRK20 and Privy integration |
| `@app20/relay` | Cloudflare assets, bootstrap, OHTTP, RPC, quotas |

Architecture: [`docs/APP20_ARCHITECTURE.md`](docs/APP20_ARCHITECTURE.md).
Private Desk and contact-recovery model:
[`docs/APP20_PRIVATE_DESK.md`](docs/APP20_PRIVATE_DESK.md).
Value flows and the gated future SOL/Wormhole→StarkGate market:
[`docs/APP20_SWAP_FLOWS.md`](docs/APP20_SWAP_FLOWS.md).
Contract inventory and rollout gates:
[`docs/APP20_CONTRACTS.md`](docs/APP20_CONTRACTS.md).
Negotiation/channel protocols and operations boundaries:
[`docs/APP20_NEGOTIATION_CHANNELS.md`](docs/APP20_NEGOTIATION_CHANNELS.md) and
[`docs/APP20_OPERATIONS_AND_INTEGRATIONS.md`](docs/APP20_OPERATIONS_AND_INTEGRATIONS.md).
Adversarial review and current release verdict:
[`docs/APP20_ADVERSARIAL_VALIDATION.md`](docs/APP20_ADVERSARIAL_VALIDATION.md) and
[`docs/APP20_RELEASE_GATES.md`](docs/APP20_RELEASE_GATES.md).

## Checks

```bash
npm run typecheck
npm run typecheck:packages
npm run test:all
npm run build
```

| Command | Scope |
| --- | --- |
| `npm test` | Application unit tests |
| `npm run test:packages` | Workspace packages |
| `npm run test:ui` | Playwright localnet journeys |
| `npm run test:e2e:pool` | Real-pool mail harness |
| `snforge test` | Mail helper contracts, from `cairo/` |

`npm run build` includes a browser-leak scan.

## Deployment

APP20 deploys as a Cloudflare Worker with assets, not a static Pages site.
`wrangler.jsonc` names `app20.gstohl.com`. Do not deploy until Worker secrets
are set with `wrangler secret put`.

Public browser variables:

```text
VITE_PRIVY_APP_ID
VITE_PRIVY_CLIENT_ID
VITE_PROVER_OHTTP_KEY_CONFIG
VITE_DISCOVERY_OHTTP_KEY_CONFIG
VITE_MAIL_HELPER_SEPOLIA
VITE_MAIL_HELPER_MAINNET
```

Worker secrets:

```text
PRIVY_APP_SECRET
OHTTP_SESSION_SECRET
PROVER_UPSTREAM_URL
PROVER_UPSTREAM_AUTHORIZATION
DISCOVERY_UPSTREAM_URL
DISCOVERY_UPSTREAM_AUTHORIZATION
STARKNET_SEPOLIA_RPC_URL
STARKNET_SEPOLIA_AUTHORIZATION
STARKNET_MAINNET_RPC_URL
STARKNET_MAINNET_AUTHORIZATION
```

## Not in this release

- Production maker-specific HPKE transport or replicated reservation storage
- A deployed/audited quote-bound escrow, atomic crossing, or recurring escrow
- Configured-chain authoritative receipt verification
- Live NEAR Intents quotes, deposits, or settlement
- An attested TEE that can authorize value
- Completed `strk20.json` sprint artifacts
- A production Cloudflare deployment

## License

MIT
