# APP20 process diagrams

These Mermaid diagrams describe current repository behavior and explicit future gates. Dashed or blocked paths are not live capabilities. RFQ v3 is implemented below the presentation layer; the mounted localnet desk still drives legacy v1 until the final presentation wiring in [`GAPS.md`](GAPS.md) is complete.

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

    RM --> V[Funding utilities, public send unavailable]
    RS --> V
    PS --> PR[Privy Sepolia recovery vault]
    LD --> D[Private RFQ: v1 UI, v3 lower layers]
    RW -. UI view only, live Mail action denied .-> M[Mailbox and Counterparties, localnet actions only]
    LW --> M

    D -. no automatic fallback .-> X[Public venue]
    X -->|Future separate approval, not implemented| PX[Public execution route]
```

Mainnet rejects Privy and the development wallet. Localnet exists only when its build flag is enabled. Selecting one rail never silently borrows another rail's signer. Public-network RFQ transport and settlement remain immutable-off.

## 2. STRK20 funding and v3 public boundary

```mermaid
flowchart LR
    A[Public wallet balance] -->|Shield: public amount and timing| P[STRK20 private note pool]
    P -->|Private transfer| Q[Encrypted notes]
    Q -->|Maker Lock through pool| L[App20Escrow collateral]
    Q -->|Taker Take through pool| L
    L --> O[Private OPEN output notes]
    Q -->|Unshield: public amount and timing| B[Public wallet balance]

    L --> C[PUBLIC LockCreated schedule and max collateral]
    L --> S[PUBLIC Take calldata taker-secret preimage]
    L --> F[PUBLIC LockTaken exact per-fill A and B]
    L --> D[PUBLIC DealTaken exact totals and fill count]

    classDef private fill:#173d2d,stroke:#4ade80,color:#ffffff;
    classDef public fill:#4a2b16,stroke:#fb923c,color:#ffffff;
    class P,Q,O private;
    class A,B,C,S,F,D public;
```

The pool can hide note ownership and private-transfer counterparties. It does not hide shield/unshield boundaries or v3 helper facts. A schedule, pair, RFQ id, expiry, collateral maximum, Take's `takerSecret` preimage, exact fills, aggregate totals, helper use, and timing are public and correlatable.

## 3. Collateralized, bucket-only RFQ v3

```mermaid
sequenceDiagram
    actor T as Taker
    participant B as APP20 browser data layer
    participant C as Localnet coordinator
    participant A as Maker A node
    participant M as Maker B node
    participant P as STRK20 pool
    participant E as App20Escrow v3

    T->>B: Enter pair, exact size, local floor
    B->>B: Derive ladder bucket, secret, Poseidon commitment
    B->>C: RFQ v2: pair, direction, bucket, expiry; no exact size/floor

    par Invite Maker A
        C->>A: RFQ v2
        A->>P: Lock token B maximum + two-unit ticket note
        P->>E: Apply Lock with schedule
        A-->>C: Signed quote v3 referencing confirmed lock
    and Invite Maker B
        C->>M: RFQ v2
        M->>P: Lock token B maximum + two-unit ticket note
        P->>E: Apply Lock with schedule
        M-->>C: Signed quote v3 referencing confirmed lock
    end

    C-->>B: Quotes and refusal digests
    B->>E: Read every get_lock
    B->>B: Verify signatures and locks; evaluate exact size
    B->>B: Select one or up to four fills; apply local floor
    B->>C: Digest-bound fair-loss transcript
    C->>A: Full transcript
    C->>M: Full transcript
    T->>B: Explicit final acceptance
    B->>P: One Take with exact fill list
    P->>E: Apply atomic Take
    E-->>P: One aggregate token B OPEN deposit
    P-->>T: Private output note

    Note over A,M: After expiry, each maker scans get_lock every 5 s
    A->>P: SettleProceeds and/or ReleaseCollateral
    M->>P: SettleProceeds and/or ReleaseCollateral
    P->>E: Burn one LockTicket per non-zero side
```

Any invalid fill reverts the whole Take. There is no v3 taker claim ticket, funded wait, maker fill step, or taker timeout/refund. The transcript does not contain a dedicated exact-size or floor field, but it carries every winning `amountA`; because the coordinator and all invited makers receive it, they can infer exact size by summing those allocations. Coordinator Take-state endpoints also receive expected exact fills/totals. Refused makers acknowledge receipt but cannot verify against a signed quote lock.

The diagram shows implemented service/data behavior. The mounted `LocalnetPrivateIntentDesk` has not been migrated to call it and still exposes the legacy v1 sequence.

## 4. Maker lock WAL and expiry settlement

```mermaid
stateDiagram-v2
    [*] --> Locking: persist lock intent before wallet call
    Locking --> Open: confirmed lock matches get_lock
    Locking --> Quarantined: submission outcome unknown
    Locking --> [*]: known reverted lock
    Open --> Open: identical RFQ digest returns persisted quote
    Open --> Taken: get_lock reports earned A
    Open --> Expired: expiry reached with a non-zero side
    Taken --> Expired: expiry reached
    Expired --> Settling: persist side before wallet call
    Settling --> Expired: known revert and refreshed chain state
    Settling --> Settled: all non-zero sides confirmed pulled
    Settling --> Quarantined: unknown or contradictory outcome
    Open --> Settled: no proceeds and no collateral remain
    Quarantined --> ManualReview
```

Lock records share the maker's sequence- and hash-chain-bound, fsynced, PID-locked WAL with legacy reservations. Unknown collateral outcomes remain unavailable inventory. This is durable on one host, not replicated linearizable production custody.

## 5. Mail, negotiation, and settlement authority

```mermaid
flowchart TD
    W[Wallet account] -->|SNIP-12 attestation only| K[Wallet-to-Mail binding certificate]
    S[Independent mailbox seed] --> MK[Mail encryption and auth keys]
    K --> N[Signed negotiation documents]
    MK --> N

    N --> T[Encrypted Mail transcript]
    T --> EV[Non-authoritative correspondence evidence]

    Q[Maker-signed quote + matching collateral lock] --> ST[Atomic Take]
    ST --> CH[Cairo plus pool-applied chain state]
    CH --> LA[Same-devnet local authority]
    LA -. not production configured-chain authority .-> AR[Future production receipt]

    EV -. may reference intent or receipt digest .-> AR
    EV -. cannot authorize value .-> ST
```

Wallet signatures attest correspondence-key control; they are never encryption-key material. Mail, quote signatures, transcript digests, WAL state, and browser lifecycle rows cannot prove settlement. Only contract and pool state provide value authority in the local fixture.

## 6. Receipt and selective disclosure

```mermaid
flowchart LR
    CE[Future configured-chain RPC and event verifier; unavailable] --> VR[Verified production chain receipt]
    LE[Local intent, lock, quote, transcript, and Take evidence] --> LR[Local evidence layer]

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

## 7. Chain-anchored backup and USDC invoice completion

```mermaid
flowchart TD
    R[Contacts or RFQ history] --> S[Authenticated BackupSnapshotV1]
    S --> F{Fits one encrypted Mail?}
    F -->|Yes| IM[Self-addressed inline Mail ciphertext]
    F -->|No| B[AES-GCM blob padded to 4096-byte bucket]
    B --> C[CIDv1 raw sha2-256]
    C --> I[Configured IPFS RPC pin]
    C --> PM[Self-addressed encrypted Mail pointer]
    IM --> CH[PUBLIC Mail transaction and ciphertext metadata]
    PM --> CH
    I --> G[Gateway fetch]
    G --> V[CID + pointer digest + AES + snapshot verification]
    V --> M[Explicit keep-newer merge]
```

The localnet IPFS emulator is loopback-only and in-memory. A configured IPFS RPC/gateway sees source metadata, timing, CID, and padded ciphertext size, not backup plaintext. Production blob storage is unavailable unless both browser origins and the relay CSP allowlist are configured. The relay changes CSP only; it does not proxy or pin the blob.

```mermaid
sequenceDiagram
    actor P as Payer
    participant M as Mail
    participant D as RFQ v3 data layer
    participant E as Escrow and pool
    participant O as Local OTC store
    participant Y as Payee

    M->>D: USDC invoice handoff; sell private STRK
    D->>D: Estimate bucket from verified maker median
    D->>E: Take for at least the exact USDC invoice amount
    E-->>D: USDC OPEN note at takeBlock
    D->>O: awaiting-note-maturity
    Note over M,O: Eligible when head is at least takeBlock + 10
    P->>M: Complete payment
    M->>Y: Existing private USDC memo-transfer path
```

Mail implements handoff creation, maturity gating, and completion for a recorded Take. The current RFQ UI does not consume the handoff or record that Take, so the full invoice journey remains unwired.

## 8. Contract rollout and release gates

```mermaid
flowchart TD
    L[Current localnet contracts] --> LM[App20Mail]
    L --> LE[App20Escrow v3 plus legacy variants]
    L --> LT[LockTicket supply two]
    L --> CT[Legacy ClaimTicket supply one]
    L --> ME[MockErc20 test fixture]

    LM -->|Separate approval and review| MS[Optional Mainnet Mail scoring lane]
    LE -. do not deploy directly .-> VN[Canonical production App20Escrow]
    LT -. localnet only; no production-v3 commitment .-> LTO[No approved v3 rollout]
    CT -. replace; do not reuse .-> TN[Canonical production App20Claim]

    VN --> A1[Independent Cairo and protocol audits]
    TN --> A1
    A1 --> S[Sepolia deployment and two-maker soak]
    S --> H{Explicit tiny-Mainnet approval}
    H -->|No| STOP[RFQ stays disabled]
    H -->|Yes, hard caps| MM[Tiny Mainnet RFQ evidence]

    MM -. separate specification and audit .-> AX[Atomic two-taker crossing]
    MM -. separate specification and audit .-> RE[Recurring or milestone escrow]
```

The localnet escrow and `LockTicket` are not production classes; v3 production enablement is out of scope and does not alter the separate App20Escrow/App20Claim VNext proposal. Atomic v3 multi-maker Take is not atomic two-taker crossing. Every production contract needs a separate specification, audit, deployment identity, and human approval.

## 9. Release evidence ladder

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
    D -. blocked: v3 presentation and accepted review .-> P3
    D -. blocked: canonical contracts, configured-chain verifier, replicated storage .-> P4
```

Passing a later-looking UI test cannot skip an earlier trust gate. Current RFQ evidence allows localnet demonstration and dry review only; separate Ready/Privy wallet surfaces do not authorize Mail or RFQ.
