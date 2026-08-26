import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIVATE_RFQ_DOMAIN,
  QUOTE_DOMAIN,
  canonicalPrivateRfq,
  canonicalSolverQuote,
  transitionMakerReservation,
  type PrivateRfqV1,
  type UnsignedSolverQuote,
} from "@app20/private-intents";
import {
  DurableMakerNode,
  DurableReservationStore,
  MakerNodeError,
  type MakerNodeConfig,
  type MakerQuoteRequest,
} from "./index";

const NOW = 1_800_000_000;
const USDC =
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const HELPER =
  "0x067c772d127482e87807deaa5b4f5014d48e54d12f190737b47fb37f6438c434";
const ACCOUNT =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
const DIGEST_A = `0x${"11".repeat(32)}`;
const DIGEST_B = `0x${"22".repeat(32)}`;
const DIGEST_C = `0x${"33".repeat(32)}`;
const SIGNATURE = `0x${"aa".repeat(64)}`;

const tempRoots: string[] = [];
const openStores: DurableReservationStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) await store.close();
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function walPath(): string {
  const root = mkdtempSync(join(tmpdir(), "app20-maker-node-"));
  tempRoots.push(root);
  return join(root, "reservations.wal");
}

function open(path = walPath()): DurableReservationStore {
  const store = DurableReservationStore.open(path);
  openStores.push(store);
  return store;
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `0x${String(index).padStart(64, "0")}`;
}

function request(
  overrides: Partial<MakerQuoteRequest> = {},
): MakerQuoteRequest {
  const {
    rfq: overrideRfq,
    rfqDigest: overrideRfqDigest,
    ...fieldOverrides
  } = overrides;
  const fields = {
    intentDigest: DIGEST_A,
    expiresAt: NOW + 1_200,
    sellToken: USDC,
    sellAmount: 100n,
    buyToken: STRK,
    minBuyAmount: 90n,
    ...fieldOverrides,
  };
  const rfq: PrivateRfqV1 = overrideRfq ?? {
    version: 1,
    domain: PRIVATE_RFQ_DOMAIN,
    rfqId: DIGEST_B,
    intentDigest: fields.intentDigest,
    chainId: "starknet:APP20_LOCALNET",
    registryRevision: "localnet-registry:4",
    directoryEpoch: 0,
    settlementHelper: HELPER,
    sellToken: fields.sellToken,
    sellAmountBaseUnits: fields.sellAmount,
    buyToken: fields.buyToken,
    minBuyAmountBaseUnits: fields.minBuyAmount,
    createdAt: NOW,
    responseDeadline: NOW + 600,
    expiresAt: fields.expiresAt,
  };
  const rfqDigest =
    overrideRfqDigest ??
    `0x${createHash("sha256").update(canonicalPrivateRfq(rfq)).digest("hex")}`;
  return { ...fields, rfq, rfqDigest };
}

function fixture(
  store: DurableReservationStore,
  overrides: Partial<MakerNodeConfig> = {},
) {
  let balance = 1_000n;
  let signCount = 0;
  let fillCount = 0;
  const config: MakerNodeConfig = {
    makerId: "maker-a",
    solverKey: "maker-a/quote/p256/v1",
    pool: "starknet:APP20_LOCALNET",
    helper: HELPER,
    spreadBps: 0,
    reservationTtlSeconds: 600,
    price: async (input) => ({
      grossBuyAmount: input.sellAmount,
      provenance: "fixture:one-to-one",
    }),
    signer: async () => {
      signCount += 1;
      return SIGNATURE;
    },
    wallet: {
      settlementAccount: ACCOUNT,
      privateBalance: async () => balance,
      fill: async () => {
        fillCount += 1;
        return { transactionHash: "0xf11" };
      },
    },
    randomId: ids(DIGEST_B, DIGEST_C, `0x${"44".repeat(32)}`),
    ...overrides,
  };
  const node = new DurableMakerNode(store, config);
  return {
    node,
    setBalance(value: bigint) {
      balance = value;
    },
    get signCount() {
      return signCount;
    },
    get fillCount() {
      return fillCount;
    },
  };
}

function quoteFor(
  offer: Awaited<ReturnType<DurableMakerNode["reserve"]>>,
  overrides: Partial<UnsignedSolverQuote> = {},
): UnsignedSolverQuote {
  return {
    domain: QUOTE_DOMAIN,
    pool: "starknet:APP20_LOCALNET",
    helper: HELPER,
    sellToken: offer.sellToken,
    sellAmount: 100n,
    buyToken: offer.buyToken,
    intentDigest: DIGEST_A,
    solverId: offer.solverId,
    solverKey: offer.solverKey,
    nonce: offer.nonce,
    reservationId: offer.reservationId,
    reservationExpiresAt: offer.reservationExpiresAt,
    buyAmount: 100n,
    spreadBps: offer.spreadBps,
    pricingProvenance: offer.provenance,
    quotedAt: NOW + 1,
    quoteExpiresAt: NOW + 120,
    ...overrides,
  };
}

async function reserveSignSelect(
  node: DurableMakerNode,
): Promise<Awaited<ReturnType<DurableMakerNode["reserve"]>>> {
  const offer = await node.reserve(request(), NOW);
  const quote = quoteFor(offer);
  await node.signQuote(quote, canonicalSolverQuote(quote), NOW + 1);
  await node.select(offer.reservationId, DIGEST_A, NOW + 2);
  return offer;
}

describe("durable reservation WAL", () => {
  it("persists snapshots, recovers a truncated tail, and preserves exact units", async () => {
    const path = walPath();
    const first = open(path);
    const { node } = fixture(first);
    await node.reserve(request({ sellAmount: 101n, minBuyAmount: 100n }), NOW);
    await first.close();
    openStores.splice(openStores.indexOf(first), 1);
    appendFileSync(path, '{"partial":', "utf8");

    const recovered = open(path);
    expect(recovered.sequence).toBe(1);
    expect(recovered.list()).toHaveLength(1);
    expect(recovered.list()[0]!.sellAmount).toBe(101n);
    expect(readFileSync(path, "utf8")).toMatch(/\n$/);
  });

  it("fails closed on a tampered complete WAL record", async () => {
    const path = walPath();
    const first = open(path);
    const { node } = fixture(first);
    await node.reserve(request(), NOW);
    await first.close();
    openStores.splice(openStores.indexOf(first), 1);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    entry.payload.records[0].buyAmount = "999";
    writeFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
    expect(() => DurableReservationStore.open(path)).toThrow(/invalid digest/i);
  });

  it("refuses a second live process owner for the same WAL", async () => {
    const path = walPath();
    open(path);
    expect(() => DurableReservationStore.open(path)).toThrow(/already owned/i);
  });
});

describe("inventory reservations and signing", () => {
  it("serializes concurrent reservations so inventory cannot be double sold", async () => {
    const store = open();
    const { node, setBalance } = fixture(store, {
      randomId: ids(
        DIGEST_B,
        DIGEST_C,
        `0x${"44".repeat(32)}`,
        `0x${"55".repeat(32)}`,
      ),
    });
    setBalance(100n);
    const outcomes = await Promise.allSettled([
      node.reserve(
        request({ intentDigest: DIGEST_A, sellAmount: 60n, minBuyAmount: 50n }),
        NOW,
      ),
      node.reserve(
        request({
          intentDigest: `0x${"66".repeat(32)}`,
          sellAmount: 60n,
          minBuyAmount: 50n,
        }),
        NOW,
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(node.health().states.reserved).toBe(1);
  });

  it("is idempotent for identical RFQs and rejects digest reuse with changed terms", async () => {
    const store = open();
    const { node } = fixture(store);
    const first = await node.reserve(request(), NOW);
    const second = await node.reserve(request(), NOW + 1);
    expect(second.reservationId).toBe(first.reservationId);
    await expect(
      node.reserve(request({ minBuyAmount: 91n }), NOW + 1),
    ).rejects.toThrow(/reused with different terms/i);
  });

  it("signs once, persists the signature, and refuses quote equivocation", async () => {
    const path = walPath();
    const store = open(path);
    const context = fixture(store);
    const offer = await context.node.reserve(request(), NOW);
    const quote = quoteFor(offer);
    const canonical = canonicalSolverQuote(quote);
    const first = await context.node.signQuote(quote, canonical, NOW + 1);
    const second = await context.node.signQuote(quote, canonical, NOW + 2);
    expect(first).toEqual(second);
    expect(context.signCount).toBe(1);
    await expect(
      context.node.signQuote(
        { ...quote, quoteExpiresAt: quote.quoteExpiresAt + 1 },
        canonicalSolverQuote({
          ...quote,
          quoteExpiresAt: quote.quoteExpiresAt + 1,
        }),
        NOW + 2,
      ),
    ).rejects.toThrow(/equivocation|durable inventory reservation/i);

    await store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const recovered = open(path);
    expect(recovered.list()[0]!.signature).toBe(SIGNATURE);
  });

  it("never returns raw maker balances from offers or health", async () => {
    const store = open();
    const { node, setBalance } = fixture(store);
    setBalance(987_654_321n);
    const offer = await node.reserve(request(), NOW);
    const encoded = JSON.stringify(
      { offer, health: node.health() },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    );
    expect(encoded).not.toMatch(/privateBalance|inventory|987654321/i);
  });
});

describe("winner-only fill lifecycle", () => {
  it("persists begin-fill before wallet execution and blocks concurrent fills", async () => {
    const store = open();
    let startFill!: () => void;
    let finishFill!: () => void;
    const started = new Promise<void>((resolve) => {
      startFill = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishFill = resolve;
    });
    let fillCount = 0;
    const { node } = fixture(store, {
      wallet: {
        settlementAccount: ACCOUNT,
        privateBalance: async () => 1_000n,
        fill: async () => {
          fillCount += 1;
          startFill();
          await finish;
          return { transactionHash: "0xf11" };
        },
      },
    });
    const offer = await reserveSignSelect(node);
    const fillRequest = {
      reservationId: offer.reservationId,
      intentDigest: DIGEST_A,
      dealId: "0xd1",
      sellToken: USDC,
      sellAmount: 100n,
      buyToken: STRK,
      buyAmount: 100n,
    };
    const first = node.fill(fillRequest, NOW + 3);
    await started;
    expect(node.health().states.filling).toBe(1);
    await expect(node.fill(fillRequest, NOW + 3)).rejects.toThrow(
      /does not authorize/i,
    );
    expect(fillCount).toBe(1);
    finishFill();
    await expect(first).resolves.toEqual({ transactionHash: "0xf11" });
    expect(node.health().states.consumed).toBe(1);
  });

  it("quarantines inventory when the chain outcome is unknown", async () => {
    const store = open();
    const { node } = fixture(store, {
      wallet: {
        settlementAccount: ACCOUNT,
        privateBalance: async () => 1_000n,
        fill: async () => {
          throw new Error("RPC timeout after submit");
        },
      },
    });
    const offer = await reserveSignSelect(node);
    await expect(
      node.fill(
        {
          reservationId: offer.reservationId,
          intentDigest: DIGEST_A,
          dealId: "0xd1",
          sellToken: USDC,
          sellAmount: 100n,
          buyToken: STRK,
          buyAmount: 100n,
        },
        NOW + 3,
      ),
    ).rejects.toThrow(/quarantined/i);
    expect(node.health().states.quarantined).toBe(1);
  });

  it("quarantines a persisted in-flight attempt during crash recovery", async () => {
    const path = walPath();
    const first = open(path);
    const { node } = fixture(first);
    const offer = await reserveSignSelect(node);
    await first.transaction((draft) => {
      const record = draft.get(offer.reservationId)!;
      draft.set(offer.reservationId, {
        ...record,
        reservation: transitionMakerReservation(record.reservation, {
          kind: "begin-fill",
          expectedFence: record.reservation.fence,
          at: NOW + 3,
          settlementAttemptId: `0x${"77".repeat(32)}`,
        }),
      });
    });
    await first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const recoveredStore = open(path);
    const recovered = fixture(recoveredStore).node;
    await recovered.recoverAfterRestart(NOW + 4);
    expect(recovered.health().states.quarantined).toBe(1);
    expect(recoveredStore.list()[0]!.reservation.terminalReason).toMatch(
      /restarted with unknown chain outcome/i,
    );
  });
});

describe("configuration failures", () => {
  it("rejects invalid spread, TTL, and closed-store writes", async () => {
    const store = open();
    expect(() => fixture(store, { spreadBps: 10_000 })).toThrow(/spreadBps/i);
    expect(() => fixture(store, { reservationTtlSeconds: 0 })).toThrow(
      /reservationTtlSeconds/i,
    );
    await store.close();
    openStores.splice(openStores.indexOf(store), 1);
    await expect(store.transaction(() => undefined)).rejects.toBeInstanceOf(
      MakerNodeError,
    );
  });
});
