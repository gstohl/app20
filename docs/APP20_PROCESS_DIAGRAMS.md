# APP20 process diagrams

These Mermaid diagrams describe current repository behavior and explicit future gates. Dashed or blocked paths are not live capabilities.

## 1. Wallet, network, and product rails

```mermaid
flowchart TD
    U[User] --> H[Single header session control]
    H --> R{Selected account rail}

    R -->|Ready| RW[Ready Wallet Standard]
    R -->|Privy| PV[Privy browser signer]
    R -->|Development build only| LW[Localnet wallet]

    RW --> RN{Network policy}
    RN -->|Mainnet| RM[Ready-only live wallet actions]
    RN -->|Sepolia| RS[Ready testnet actions]

    PV --> PS[Sepolia recovery rail only]
    LW --> LD[Ephemeral localnet demo]

    RM --> V[RFQ funding utilities and public send]
    RS --> V
    PS --> PR[Privy Sepolia recovery vault]
    LD --> D[Private RFQ]
    RW --> M[Mailbox and Counterparties]
    LW --> M

    D -. no automatic fallback .-> X[Public venue]
    X -->|Separate explicit confirmation only| PX[Public execution route]
```

Mainnet rejects Privy and the development wallet. Localnet exists only when its build flag is enabled. Selecting one rail never silently borrows another rail's signer.

## 2. STRK20 funding and privacy boundary

```mermaid
flowchart LR
    A[Public wallet balance] -->|Shield: public amount and timing| P[STRK20 private note pool]
    P -->|Private transfer| Q[New encrypted notes]
    Q -->|Private RFQ note ownership| E[APP20 escrow interaction]
    Q -->|Unshield: public amount and timing| B[Public wallet balance]

    E --> C[Public pair, amounts, deadline, lifecycle events]

    classDef private fill:#173d2d,stroke:#4ade80,color:#ffffff;
    classDef public fill:#4a2b16,stroke:#fb923c,color:#ffffff;
    class P,Q private;
    class A,B,C public;
```

Inside the pool, note ownership and private-transfer counterparties can be hidden. Shield/unshield and first-version escrow facts remain public and correlatable.

## 3. Invited-maker RFQ and settlement

```mermaid
sequenceDiagram
    actor T as Taker
    participant B as APP20 browser
    participant A as Maker A node
    participant C as Maker B node
    participant E as App20Escrow localnet
    participant P as STRK20 pool

    T->>B: Enter exact pair, size, floor, and expiry
    B->>B: Run privacy preflight
    B-->>T: Show unavailable evidence and public leakage
    T->>B: Explicit informed confirmation

    par Private invitation
        B->>A: Canonical RFQ
        A->>A: Reserve inventory and fsync WAL
        A-->>B: Reservation-bound signed quote
    and Private invitation
        B->>C: Canonical RFQ
        C->>C: Reserve inventory and fsync WAL
        C-->>B: Reservation-bound signed quote
    end

    B->>B: Verify every quote and rank locally
    B->>A: Release losing reservation
    B->>C: Select winner and persist begin-fill
    T->>P: Fund escrow through wallet action
    C->>P: Fill from pre-positioned private inventory
    P->>E: Apply Fund and Fill privacy invokes

    alt Filled before deadline
        T->>P: Return claim ticket and claim
        P->>E: Apply Claim
        E-->>B: Public lifecycle events
    else Not filled before deadline
        T->>P: Return claim ticket and timeout
        P->>E: Apply Timeout
        E-->>B: Exact refund lifecycle events
    end

    B->>B: Build receipt from verified chain evidence when verifier exists
```

Only invited makers receive exact pre-trade terms. There is no public RFQ book and refusal never triggers automatic public routing.

## 4. Maker reservation and crash recovery

```mermaid
stateDiagram-v2
    [*] --> Reserved: reserve inventory
    Reserved --> Reserved: identical idempotent request
    Reserved --> Selected: winner selected
    Reserved --> Released: loser or user release
    Reserved --> Expired: lease expires
    Selected --> Filling: fsync begin-fill before wallet call
    Filling --> Consumed: finalized fill reconciled
    Filling --> Quarantined: unknown chain outcome or crash recovery
    Selected --> Quarantined: ambiguous recovery
    Released --> [*]
    Expired --> [*]
    Consumed --> [*]
    Quarantined --> ManualReview
```

Every mutation is hash-chained and fsynced before success returns. Localnet uses one PID lock per maker WAL; production still needs replicated linearizable storage and reconciliation.

## 5. Mail, negotiation, and settlement authority

```mermaid
flowchart TD
    W[Wallet account] -->|SNIP-12 attestation only| K[Wallet-to-Mail binding certificate]
    S[Independent mailbox seed] --> MK[Mail encryption and auth keys]
    K --> N[Signed negotiation documents]
    MK --> N

    N --> O[Offer]
    O --> C[Counter]
    C --> AC[Accept]
    O --> CA[Cancel]
    C --> CA

    N --> T[Encrypted Mail transcript]
    T --> EV[Non-authoritative correspondence evidence]

    Q[Verified maker quote and reservation] --> ST[Settlement call]
    ST --> CH[Cairo plus finalized chain events]
    CH --> AR[Future authoritative receipt; configured-chain authority currently unavailable]

    EV -. may reference intent or receipt digest .-> AR
    EV -. cannot authorize value .-> ST
```

Wallet signatures attest correspondence-key control; they are never encryption-key material. Mail and negotiation can preserve evidence but cannot invoke or prove settlement.

## 6. Receipt and selective disclosure

```mermaid
flowchart LR
    CE[Future server-only configured-chain RPC/event verifier; unavailable] --> VR[Verified chain receipt]
    LE[Local intent, quote, ranking, and negotiation evidence] --> LR[Local evidence layer]

    VR --> FR[Canonical full receipt]
    LR --> FR
    FR --> DG[Receipt digest]

    U[User chooses allowlisted fields] --> DP[Disclosure package]
    FR --> DP
    DG --> DP
    DP --> V[Recipient verifies values against full receipt]

    DP -. excludes by default .-> X[Losing quotes, invited makers, Mail, note IDs, viewing keys, relay metadata]
```

A receipt or disclosure digest binds bytes but is not authorization. A disclosure is a selected package, not a zero-knowledge or Merkle proof, and copied disclosures cannot be revoked.

## 7. Contract rollout and release gates

```mermaid
flowchart TD
    L[Current localnet contracts] --> LM[App20Mail]
    L --> LE[App20Escrow V2]
    L --> CT[ClaimTicket]
    L --> ME[MockErc20 test fixture]

    LM -->|Separate approval and review| MS[Optional Mainnet Mail scoring lane]
    LE -. do not deploy directly .-> VN[New quote-bound escrow VNext]
    CT -. compatibility review .-> TN[Reviewed ticket class]

    VN --> A1[Independent Cairo and protocol audits]
    TN --> A1
    A1 --> S[Sepolia deployment and two-maker soak]
    S --> H{Explicit tiny-Mainnet approval}
    H -->|No| STOP[RFQ stays disabled]
    H -->|Yes, hard caps| MM[Tiny Mainnet RFQ evidence]

    MM -. separate specification and audit .-> AX[Atomic crossing]
    MM -. separate specification and audit .-> RE[Recurring or milestone escrow]
```

`App20Escrow` is a localnet development contract, not the production class. Every later contract has a separate specification, audit, deployment, and human-approval gate.

## 8. Release evidence ladder

```mermaid
flowchart LR
    P0[Immutable reviewed source] --> P1[Pure models]
    P1 --> P2[Production-shaped localnet]
    P2 --> P3[Adversarial localnet]
    P3 --> P4[Independent review]
    P4 --> P5[Sepolia soak]
    P5 --> P6[Tiny approved Mainnet]
    P6 --> P7[Capped production]

    D[Current state] --> P2
    D -. blocked: dirty source .-> P0
    D -. blocked: HPKE, chain verifier, replicated storage .-> P3
```

Passing a later-looking UI test cannot skip an earlier trust gate. Current release evidence allows localnet demonstration and dry review only.
