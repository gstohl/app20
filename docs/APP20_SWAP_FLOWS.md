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
    Desk[Private RFQ]
  end

  subgraph Starknet["Starknet / Cairo"]
    Pool[STRK20 pool]
    Mail[App20Mail]
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
  participant V as APP20 RFQ
  participant P as STRK20 pool
  participant A as AVNU / Ekubo

  U->>V: Private USDC → private STRK
  V->>P: privacy_invoke swap helper
  P->>A: settle on separately confirmed public venue
  Note over A: PUBLIC liquidity and price
  P-->>U: new STRK note
  Note over P,U: PRIVATE pair, size, account
```

---

## 2. Hide the wallet, buy depth — USDC door

Privacy-bridge is **USDC + CCTP only**. NEAR remains a separate public execution rail.

```mermaid
flowchart TB
  subgraph IN["IN — public to private"]
    W1[User wallet on NEAR/EVM] -->|PUBLIC 1Click any→USDC| U1[USDC]
    U1 -->|PUBLIC CCTP| M[mint on Starknet]
    M -->|InboundAnonymizer| N1[Private USDC note]
  end

  subgraph REST["Protected default"]
    N1 --> Stop[STOP in RFQ funding]
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
  A[NEAR in 500 USDC] -->|minutes later| V[RFQ funding]
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

Cairo enforces the private-settlement boundary on Starknet.
NEAR is depth.
CCTP is the USDC pipe.
TEE is the clerk.
None of them turn a same-size round trip into unlinkability.

---

## 8. Focus market — private USDC ↔ STRK RFQ

The first market is intentionally narrow. APP20 quotes from pre-positioned
private inventory, locks the taker note in Cairo escrow, and either fills before
the deadline or returns the original asset after expiry.

```mermaid
flowchart LR
  T[Private taker note] --> Q[APP20 RFQ]
  Q --> I[Selected maker private inventory]
  I --> E[Fill-or-refund Cairo escrow]
  E --> U[Private output note]
  I -. delayed operational netting .-> N[Completed maker fills]
  I -. delayed residual .-> H[PUBLIC hedge]
```

The localnet implementation proves both STRK→USDC and USDC→STRK with a
six-decimal USDC fixture, a deterministic test price, live solver-note inventory,
and fail-closed insufficient-inventory handling. It is not a production price
feed, deployed market, or yield product.

The narrow product is maker-principal RFQ plus operational netting of completed fills. Atomic two-taker crossing is outside the definitive RFQ goal and would require a separate future specification and audit. Bridges remain public commodity ingress and hedge infrastructure.

---

## 9. Future SOL market — exact allowlisted bridge asset

A SOL-denominated Starknet market is technically possible through the existing
Wormhole representation on Ethereum and StarkGate. It must never be labeled
native SOL on Starknet.

```mermaid
flowchart LR
  S[Native SOL / Solana] -->|Wormhole Portal · PUBLIC| W[Wormhole WSOL / Ethereum]
  W -->|StarkGate · PUBLIC| L[Starknet ERC-20 representation]
  L -->|Shield · PUBLIC| N[Private WSOL-origin note]
  N --> D[APP20 private RFQ market]
```

Candidate Ethereum asset:

```text
Wormhole SOL ERC-20
0xd31a59c85ae9d8edefec411d448f90841571b89c
```

Before APP20 admits it, an operator must:

1. Verify the exact Wormhole origin, implementation, decimals, redemption path,
   and current contract status from first-party sources.
2. Query `StarkgateRegistry.getBridge(token)`. Do not assume the token is
   enrolled or shown in the StarkGate UI.
3. If enrollment is permitted and approved, use the StarkGate Manager's
   `enrollTokenBridge(token)` flow and independently verify the resulting L2
   token returned by the canonical bridge.
4. Complete a tiny round trip: Solana → Ethereum representation → Starknet →
   Ethereum → Solana. A one-way deposit is not sufficient evidence.
5. Verify Ready and STRK20 can discover, shield, transfer, and unshield that
   exact L2 token.
6. Seed bounded solver notes and demonstrate both fill and expiry refund before
   exposing the pair.
7. Measure exit liquidity and disable quoting if the bridge, oracle, redemption,
   or inventory health check fails.

This asset stacks Wormhole, Ethereum, StarkGate, Starknet, and STRK20 risk. A
same-symbol token from any other contract is a different asset and must be
rejected.

### Maker earnings are a later, separate product

People cannot earn from the current escrow. A maker programme would require a
reviewed inventory-vault/accounting design that defines:

- which exact token notes the maker supplies;
- whether capital remains non-custodial or enters a managed vault;
- how filled principal, spreads, losses, and bridge costs are attributed;
- withdrawal queues and inventory concentration limits;
- bridge/depeg/adverse-selection loss disclosure;
- jurisdiction, sanctions, tax, and licensing treatment.

Returns would come from realized RFQ spreads and fees, not guaranteed yield.
APP20 must not advertise earnings until that accounting is implemented, audited,
and producing attributable realized results.

First-party references:

- [Wormhole Token Bridge](https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/portal/)
- [StarkGate app](https://starkgate.starknet.io/)
- [StarkGate contracts](https://github.com/starknet-io/starkgate-contracts)
- [StarkGate reference](https://docs.starknet.io/learn/cheatsheets/starkgate-reference)
