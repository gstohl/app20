# APP20 value flows

**Operative scope:** section 8 describes the current build-gated localnet RFQ.
Sections 0–7 are archived pre-RFQ architecture sketches, not current product
capabilities or approved backlog: APP20 does not wire an AVNU/Ekubo swap helper,
anonymizer/CCTP ingress, public execution, a route composer, private crossing,
or a TEE clerk. Section 9 is a separately gated future market proposal outside
the definitive RFQ goal. No diagram in this document grants settlement or
deployment authority. See [`GAPS.md`](GAPS.md).

Boxes marked **PUBLIC** identify information that a hypothetical flow would
expose. **PRIVATE** means only that an in-pool STRK20 transfer can hide selected
note ownership; it is not an anonymity or unlinkability claim.

## 0. Archived dependency sketch — not a current APP20 flow

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

## 1. Rejected in-pool public-venue sketch — not implemented

APP20 has no wired AVNU/Ekubo swap helper and makes no liquidity or privacy-performance claim for this sketch. A refused RFQ never routes here automatically.

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

## 2. Archived USDC/CCTP ingress sketch — not implemented

This was a hypothetical **USDC + CCTP** boundary. NEAR remains a dry review rail; APP20 exposes no deposit address or live cross-chain execution.

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

The sketch intended to avoid directly reusing the Ready address as the funder address. It would not establish unlinkability across size, time, Circle, or 1Click.

---

## 3. What does _not_ break the link

```mermaid
flowchart LR
  A[NEAR in 500 USDC] -->|minutes later| V[RFQ funding]
  V -->|same 500| B[NEAR out 500]
  A -.->|solver + amount + time| B
```

Same number, short wait, maybe same solver = one payment. Addresses changed; the link did not.

---

## 4. Rejected Private Swap composer — not implemented

This automatic router conflicts with the current explicit-rail product and is not approved.

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

## 5. Rejected book/crossing sketch — outside the definitive RFQ goal

APP20 is bookless. It does not cross takers or operate a public book; atomic crossing would require a separate product decision, specification, and audit.

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

Under this rejected sketch, the taker would not contact 1Click directly; APP20 would see the RFQ and the public market would see an APP20 hedge.

---

## 6. Rejected TEE clerk sketch — not implemented

No TEE can sign or submit APP20 value. Attestation would not make this a stronger mixer.

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

Under this rejected sketch, the pool transaction would omit a direct Ready address while the enclave would see the order and public markets would see the hedge.

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

In the current localnet RFQ only, Cairo and finalized pool state govern the
fixture settlement boundary. The NEAR, CCTP, and TEE roles above are archival
sketches, not active APP20 services. None would turn a same-size round trip into
unlinkability.

---

## 8. Focus market — private USDC ↔ STRK RFQ

The first market is intentionally narrow. RFQ v3 keeps the taker's exact size
and floor in the browser during invitation. Each invited maker receives only
the pair/direction, one fixed STRK or USDC ladder bucket, RFQ/helper bindings,
and expiry, then collateralizes a one-to-four-point price schedule on chain
before returning a signed quote.

```mermaid
flowchart LR
  T[Private taker note: exact A stays local] --> Q[Bucket-only RFQ]
  Q --> A[Maker A collateral lock + schedule]
  Q --> B[Maker B collateral lock + schedule]
  A --> S[Browser verifies get_lock and selects]
  B --> S
  S --> X[One atomic Take: up to four locks]
  X --> U[Aggregate token B OPEN note]
  X --> P[PUBLIC LockTaken and DealTaken exact totals]
  A --> M[Maker expiry settlement]
  B --> M
  M --> R[Proceeds + unused collateral OPEN notes]
```

Selection evaluates schedules at the local exact amount, prefers the best
covering single lock, otherwise assembles at most four fills, and then applies
the browser-only floor. `Take` succeeds for every fill or reverts as a whole;
there is no v3 taker claim ticket, maker fill wait, or taker timeout/refund.
After expiry, each maker spends its two-unit `LockTicket` one unit at a time to
pull earned token A and unused token B.

The request is size-blind, but settlement is not. `takerCommitment` is the
retained wire name for the ephemeral taker Stark public key. `LockCreated`
publicly exposes that key, tokens, expiry, collateral maximum, and the complete
schedule; Take calldata exposes the signature and ordered fills; `LockTaken`
exposes each exact fill; and `DealTaken` exposes exact aggregate A/B totals,
fill count, and ordered `fillsDigest`. The signed message cannot bind the
output-note owner through the current pool API, leaving a relayer/sequencer
copy-sniping race. The full fair-loss transcript sent after selection also includes
winning `amountA` allocations, so invited makers can infer exact size by
summing them even though the request and transcript have no dedicated
`exactSellAmount` field.

The localnet service and browser-data layers support STRK→USDC and USDC→STRK
with a six-decimal USDC fixture and unchanged caps of 50 STRK or 100 USDC per trade. Makers publish
signed indicative fixture mids (2.00 and 2.01 USDC/STRK); these are not an
external price feed. CoinGecko remains a separate browser opt-in. Public pool
deposit events provide only a ten-block note-maturity estimate and cannot see
notes received by private transfer.

A localnet USDC invoice hands off to the mounted RFQ v3 desk for STRK→USDC
sizing against verified mids and schedules. The desk records the confirmed Take
and returns to Mail, which waits until the output note reaches `takeBlock + 10`
before sending the exact USDC payment.

This is a maker-principal collateralized RFQ, not atomic two-taker crossing.
Operational netting remains a fail-closed policy model, and public hedges or
bridges remain separately scoped future operator infrastructure.

---

## 9. Separately gated future SOL-market proposal — not approved

This proposal is outside the definitive RFQ goal and no token admission, bridge
enrollment, deployment, or live test is authorized. A SOL-denominated Starknet
market might be technically possible through the existing
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
