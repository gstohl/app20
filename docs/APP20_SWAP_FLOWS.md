# APP20 value flows

What the current stack can do, and what we can invent on top.
Boxes marked **PUBLIC** leak account, amount, or timing.
Boxes marked **PRIVATE** are in-pool STRK20 (Ready is not on that hop).

## 0. Tech we actually have

```mermaid
flowchart LR
  subgraph User["Browser"]
    Ready[Ready Wallet API]
    Book[Address book]
    Desk[Vault desk]
  end

  subgraph Starknet["Starknet / Cairo"]
    Pool[STRK20 pool]
    Mail[QuietlineMail]
    Avnu[AVNU / Ekubo]
    Inb[InboundAnonymizer]
    Out[OutboundAnonymizer]
    CctpSn[CCTP on Starknet]
  end

  subgraph Off["Off Starknet"]
    OneClick[NEAR 1Click solvers]
    Circle[Circle CCTP]
    Tee[TEE clerk — not live]
  end

  Desk --> Ready
  Ready --> Pool
  Pool --> Mail
  Pool --> Avnu
  Pool --> Inb
  Pool --> Out
  Inb --> CctpSn
  Out --> CctpSn
  CctpSn --- Circle
  OneClick --- Circle
  Desk -.-> OneClick
  Tee -.-> Desk
```

---

## 1. Stay private — in-pool swap

Best hide. Depth = Starknet only (AVNU is often thin).

```mermaid
sequenceDiagram
  actor U as User Ready
  participant V as APP20 Vault
  participant P as STRK20 pool
  participant A as AVNU / Ekubo

  U->>V: Private USDC → private STRK
  V->>P: privacy_invoke swap helper
  P->>A: settle on public book
  Note over A: PUBLIC liquidity and price
  P-->>U: new STRK note
  Note over P,U: PRIVATE pair, size, account
```

---

## 2. Hide the wallet, buy depth — USDC door

Privacy-bridge is **USDC + CCTP only**. NEAR is the public book.

```mermaid
flowchart TB
  subgraph IN["IN — public to private"]
    W1[User wallet on NEAR/EVM] -->|PUBLIC 1Click any→USDC| U1[USDC]
    U1 -->|PUBLIC CCTP| M[mint on Starknet]
    M -->|InboundAnonymizer| N1[Private USDC note]
  end

  subgraph REST["Protected default"]
    N1 --> Stop[STOP in Vault]
  end

  subgraph OUT["OUT — later, new quote"]
    Stop -->|aged note, standard size| N2[Spend private USDC]
    N2 -->|OutboundAnonymizer| B[CCTP burn]
    B -->|mint_recipient = fresh 1Click addr PUBLIC| Q[1Click]
    Q --> W2[Different dest wallet]
  end
```

Breaks: Ready address ↔ funder address.  
Does not break: size, time, Circle, 1Click.

---

## 3. What does *not* break the link

```mermaid
flowchart LR
  A[NEAR in 500 USDC] -->|minutes later| V[Vault]
  V -->|same 500| B[NEAR out 500]
  A -.->|solver + amount + time| B
```

Same number, short wait, maybe same solver = one payment. Addresses changed; the link did not.

---

## 4. Invented: one Private Swap composer

User never picks Bridge vs Intents vs AVNU.

```mermaid
flowchart TD
  Q[You pay / you receive / Protected or Fast]
  Q --> Plan{Planner}

  Plan -->|both assets in pool and AVNU close| A[Route A in-pool]
  Plan -->|need size, want private balance| B[Route B 1Click → CCTP → note STOP]
  Plan -->|aged private USDC → other chain| C[Route C anonymizer → fresh 1Click]
  Plan -->|public to public| D[B then dwell then C two consents]

  A --> HonestA[Label: private in-pool]
  B --> HonestB[Label: public entrance, private settlement]
  C --> HonestC[Label: private source, public settlement]
  D --> HonestD[Label: two public boundaries]
```

---

## 5. Invented: APP20 as the book

We add STRK depth by **inventory + crossing**, not by copying NEAR into Cairo.

```mermaid
flowchart TB
  U1[User sells private STRK]
  U2[User buys private STRK]
  Desk[APP20 RFQ desk]

  U1 --> Desk
  U2 --> Desk
  Desk -->|match| Cross[Private crossing]
  Cross --> N1[New notes both sides]
  Desk -->|residual only| Inv[APP20 inventory notes]
  Inv -->|later, our address, standard size| H[1Click hedge]
  H -->|PUBLIC our hedge| Mkt[NEAR / CEX / AVNU]
```

User never hits 1Click. We see the RFQ. Public market sees **our** hedge.

---

## 6. Invented: TEE clerk

Automation and policy. Not a stronger mixer.

```mermaid
sequenceDiagram
  actor U as User
  participant T as TEE clerk
  participant P as STRK20
  participant H as Our 1Click hedge

  U->>T: 500 USDC → private STRK, Protected
  Note over T: sees the order
  T->>T: wait / chunk / try cross
  alt crossed or inventory
    T->>P: note for note
  else need depth
    T->>H: hedge from APP20 inventory
    Note over H: PUBLIC size, our address
    T->>P: drop STRK note
  end
  T-->>U: receipt + measurement
```

Disclose: chain does not see Ready. Enclave sees the order. Markets see the hedge.

---

## 7. Who can see what

```mermaid
flowchart LR
  subgraph Hidden
    Ready[Ready address in-pool]
    Pair[In-pool pair and size]
  end

  subgraph Visible
    Shield[Shield / unshield]
    Cctp[CCTP amount + mint_recipient]
    Click[1Click route, dest, size, time]
    TeeOp[TEE operator if we host it]
  end

  User --> Hidden
  User --> Visible
```

Cairo enforces the vault door on Starknet.  
NEAR is depth.  
CCTP is the USDC pipe.  
TEE is the clerk.  
None of them turn a same-size round trip into unlinkability.
