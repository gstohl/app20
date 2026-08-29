import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIVATE_RFQ_DOMAIN,
  QUOTE_DOMAIN,
  QUOTE_V2_DOMAIN,
  canonicalPrivateRfq,
  canonicalSolverQuote,
  canonicalSolverQuoteV2,
  digestSolverQuoteV2,
  transitionMakerReservation,
  type PrivateRfqV1,
  type UnsignedSolverQuote,
  type UnsignedSolverQuoteV2,
} from "@app20/private-intents";
import {
  DurableMakerNode,
  DurableReservationStore,
  MakerNodeError,
  type DurableReservationFileSystem,
  type MakerFillRequest,
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
const SIGNATURE = `0x${"00".repeat(31)}01${"00".repeat(31)}01`;

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

function quoteV2For(
  offer: Awaited<ReturnType<DurableMakerNode["reserve"]>>,
  rfqDigest: string,
  overrides: Partial<UnsignedSolverQuoteV2> = {},
): UnsignedSolverQuoteV2 {
  return {
    domain: QUOTE_V2_DOMAIN,
    pool: "starknet:APP20_LOCALNET",
    helper: HELPER,
    sellToken: offer.sellToken,
    sellAmount: 100n,
    buyToken: offer.buyToken,
    intentDigest: DIGEST_A,
    solverId: offer.solverId,
    quoteKeyId: offer.solverKey,
    nonce: offer.nonce,
    reservationId: offer.reservationId,
    reservationFence: offer.fence,
    reservationExpiresAt: offer.reservationExpiresAt,
    buyAmount: 100n,
    spreadBps: offer.spreadBps,
    pricingProvenance: offer.provenance,
    quotedAt: NOW + 1,
    quoteExpiresAt: NOW + 120,
    directoryDigest: `0x${"55".repeat(32)}`,
    directoryEpoch: 0,
    registryRevision: "localnet-registry:4",
    escrowAddress: HELPER,
    escrowClassHash: "0x66",
    settlementContextDigest: `0x${"77".repeat(32)}`,
    rfqDigest,
    ...overrides,
  };
}

function signedQuoteDigest(
  offer: Awaited<ReturnType<DurableMakerNode["reserve"]>>,
): string {
  return `0x${createHash("sha256")
    .update(canonicalSolverQuote(quoteFor(offer)))
    .digest("hex")}`;
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

const FILE_OPERATION_ORDER = [
  "open",
  "partial-write",
  "write",
  "file-fsync",
  "close",
  "rename",
  "chmod",
  "dir-open",
  "dir-fsync",
  "dir-close",
] as const;
type FileOperation = (typeof FILE_OPERATION_ORDER)[number];
type MutationPhase =
  | "select"
  | "release"
  | "terminal-refund"
  | "fill-acquisition"
  | "fill-completion";

function fileSystemProbe(): Readonly<{
  fileSystem: DurableReservationFileSystem;
  trace: FileOperation[];
  arm: (stage: FileOperation, occurrence?: number) => void;
}> {
  const trace: FileOperation[] = [];
  const descriptors = new Map<number, "file" | "directory">();
  const occurrences = new Map<FileOperation, number>();
  let writeIndex = 0;
  let armed = false;
  let failure: FileOperation | undefined;
  let failureOccurrence = 1;
  const observe = (stage: FileOperation) => {
    trace.push(stage);
    const occurrence = (occurrences.get(stage) ?? 0) + 1;
    occurrences.set(stage, occurrence);
    if (armed && failure === stage && occurrence === failureOccurrence)
      throw new Error(`filesystem ${stage} failure`);
  };
  const fileSystem: DurableReservationFileSystem = {
    open(path, flags, mode) {
      const descriptor = openSync(path, flags, mode);
      const kind = flags === "wx" ? "file" : "directory";
      descriptors.set(descriptor, kind);
      if (kind === "file") writeIndex = 0;
      try {
        observe(kind === "file" ? "open" : "dir-open");
      } catch (error) {
        descriptors.delete(descriptor);
        closeSync(descriptor);
        throw error;
      }
      return descriptor;
    },
    write(descriptor, buffer, offset, length) {
      const written = writeSync(descriptor, buffer, offset, length);
      writeIndex += 1;
      observe(writeIndex === 1 ? "partial-write" : "write");
      return written;
    },
    fsync(descriptor) {
      const kind = descriptors.get(descriptor);
      fsyncSync(descriptor);
      observe(kind === "directory" ? "dir-fsync" : "file-fsync");
    },
    close(descriptor) {
      const kind = descriptors.get(descriptor);
      closeSync(descriptor);
      descriptors.delete(descriptor);
      if (kind) observe(kind === "directory" ? "dir-close" : "close");
    },
    rename(from, to) {
      renameSync(from, to);
      observe("rename");
    },
    chmod(path, mode) {
      chmodSync(path, mode);
      observe("chmod");
    },
  };
  return {
    fileSystem,
    trace,
    arm(stage, occurrence = 1) {
      trace.splice(0);
      occurrences.clear();
      failure = stage;
      failureOccurrence = occurrence;
      armed = true;
    },
  };
}

function exactFillRequest(
  offer: Awaited<ReturnType<DurableMakerNode["reserve"]>>,
  store: DurableReservationStore,
): MakerFillRequest {
  const record = store.list()[0]!;
  return {
    reservationId: offer.reservationId,
    intentDigest: DIGEST_A,
    fence: record.reservation.fence,
    quoteDigest: record.quoteDigest!,
    dealId: DIGEST_B,
    sellToken: record.sellToken,
    sellAmount: record.sellAmount,
    buyToken: record.buyToken,
    buyAmount: record.buyAmount,
    deadline: record.rfqExpiresAt,
    ticketAddress: ACCOUNT,
  };
}

function reconciliationTarget(
  offer: Awaited<ReturnType<DurableMakerNode["reserve"]>>,
  store: DurableReservationStore,
) {
  return exactFillRequest(offer, store);
}

function assertValidContiguousChain(
  path: string,
  minimumSequence: number,
  maximumSequence: number,
): void {
  const entries = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(entries.map((entry) => entry.sequence)).toEqual(
    Array.from({ length: entries.length }, (_, index) => index + 1),
  );
  expect(new Set(entries.map((entry) => entry.sequence)).size).toBe(
    entries.length,
  );
  expect(new Set(entries.map((entry) => entry.digest)).size).toBe(
    entries.length,
  );
  for (const [index, entry] of entries.entries())
    expect(entry.previousDigest).toBe(
      index === 0 ? null : entries[index - 1]!.digest,
    );
  expect(entries.length).toBeGreaterThanOrEqual(minimumSequence);
  expect(entries.length).toBeLessThanOrEqual(maximumSequence);
}

async function prepareMutationPhase(
  phase: MutationPhase,
  store: DurableReservationStore,
): Promise<
  Readonly<{
    context: ReturnType<typeof fixture>;
    oldSequence: number;
    operation: () => Promise<unknown>;
    oldOrNewStates: readonly string[];
  }>
> {
  const context = fixture(store);
  if (phase === "select") {
    const offer = await context.node.reserve(request(), NOW);
    const quote = quoteFor(offer);
    await context.node.signQuote(quote, canonicalSolverQuote(quote), NOW + 1);
    return {
      context,
      oldSequence: store.sequence,
      operation: () =>
        context.node.select(offer.reservationId, DIGEST_A, NOW + 2),
      oldOrNewStates: ["reserved", "selected"],
    };
  }
  const offer = await reserveSignSelect(context.node);
  if (phase === "release")
    return {
      context,
      oldSequence: store.sequence,
      operation: () =>
        context.node.release(offer.reservationId, NOW + 3, "loser cleanup"),
      oldOrNewStates: ["selected", "released"],
    };
  const fillRequest = exactFillRequest(offer, store);
  if (phase === "terminal-refund") {
    await context.node.bindSettlementForReconciliation(fillRequest, NOW + 3);
    return {
      context,
      oldSequence: store.sequence,
      operation: () =>
        context.node.reconcileAuthoritativeTerminal(
          {
            target: fillRequest,
            attemptId: "reconcile:mutation-refund",
            authorityDigest: DIGEST_C,
            authorityRevision: 9,
            outcome: "refunded",
          },
          NOW + 4,
        ),
      oldOrNewStates: ["selected", "released"],
    };
  }
  return {
    context,
    oldSequence: store.sequence,
    operation: () => context.node.fill(fillRequest, NOW + 3),
    oldOrNewStates:
      phase === "fill-acquisition"
        ? ["selected", "filling"]
        : ["filling", "consumed"],
  };
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

  it("atomically creates and durably permissions the initial WAL", async () => {
    const path = walPath();
    const store = open(path);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).isDirectory()).toBe(true);
    await store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = open(path);
    expect(reopened.sequence).toBe(0);
  });

  it.each([
    "open",
    "partial-write",
    "write",
    "file-fsync",
    "close",
    "rename",
    "chmod",
    "dir-open",
    "dir-fsync",
    "dir-close",
  ])("fails closed during initial WAL/parent durability at %s", (stage) => {
    const path = walPath();
    let injected = false;
    expect(() =>
      DurableReservationStore.open(path, {
        faultInjector(candidate) {
          if (!injected && candidate === stage) {
            injected = true;
            throw new Error(`initial ${stage}`);
          }
        },
      }),
    ).toThrow();
    expect(injected).toBe(true);
    const reopened = open(path);
    expect(reopened.sequence).toBe(0);
    expect(reopened.list()).toEqual([]);
  });

  it.each([
    "serialize",
    "open",
    "partial-write",
    "write",
    "file-fsync",
    "close",
    "rename",
    "chmod",
    "dir-open",
    "dir-fsync",
    "dir-close",
  ])(
    "fail-stops an uncertain %s transition and reopens one valid chain",
    async (stage) => {
      const path = walPath();
      let armed = false;
      let injected = false;
      const store = DurableReservationStore.open(path, {
        faultInjector(candidate) {
          if (armed && !injected && candidate === stage) {
            injected = true;
            throw new Error(`injected ${stage}`);
          }
        },
      });
      openStores.push(store);
      const { node } = fixture(store);
      const offer = await node.reserve(request(), NOW);
      const quote = quoteFor(offer);
      await node.signQuote(quote, canonicalSolverQuote(quote), NOW + 1);
      const oldSequence = store.sequence;
      armed = true;

      await expect(
        node.select(offer.reservationId, DIGEST_A, NOW + 2),
      ).rejects.toThrow(/fail-stopped|uncertain/i);
      expect(injected).toBe(true);
      await expect(
        node.select(offer.reservationId, DIGEST_A, NOW + 2),
      ).rejects.toThrow(/fail-stopped|uncertain/i);
      await store.close();
      openStores.splice(openStores.indexOf(store), 1);

      const reopened = open(path);
      expect([oldSequence, oldSequence + 1]).toContain(reopened.sequence);
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      const sequences = lines.map((line) => JSON.parse(line).sequence);
      expect(new Set(sequences).size).toBe(sequences.length);
      expect(sequences).toEqual(
        Array.from({ length: sequences.length }, (_, index) => index + 1),
      );
    },
  );

  it("fail-stops release acknowledgement after a real post-write error", async () => {
    const path = walPath();
    let armed = false;
    let injected = false;
    const store = DurableReservationStore.open(path, {
      faultInjector(stage) {
        if (armed && !injected && stage === "write") {
          injected = true;
          throw new Error("release post-write failure");
        }
      },
    });
    openStores.push(store);
    const { node } = fixture(store);
    const offer = await reserveSignSelect(node);
    const oldSequence = store.sequence;
    armed = true;
    await expect(
      node.release(offer.reservationId, NOW + 3, "loser cleanup"),
    ).rejects.toThrow(/fail-stopped|uncertain/i);
    await expect(
      node.release(offer.reservationId, NOW + 3, "loser cleanup"),
    ).rejects.toThrow(/fail-stopped|uncertain/i);
    await store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = open(path);
    expect([oldSequence, oldSequence + 1]).toContain(reopened.sequence);
    expect(["selected", "released"]).toContain(
      reopened.list()[0]!.reservation.state,
    );
  });

  it("blocks wallet execution when the durable filling pre-effect transition is uncertain", async () => {
    const path = walPath();
    let armed = false;
    let injected = false;
    const store = DurableReservationStore.open(path, {
      faultInjector(stage) {
        if (armed && !injected && stage === "write") {
          injected = true;
          throw new Error("post-write failure");
        }
      },
    });
    openStores.push(store);
    const context = fixture(store);
    const offer = await reserveSignSelect(context.node);
    const record = store.list()[0]!;
    armed = true;

    await expect(
      context.node.fill(
        {
          reservationId: offer.reservationId,
          intentDigest: DIGEST_A,
          fence: record.reservation.fence,
          quoteDigest: record.quoteDigest!,
          dealId: DIGEST_B,
          sellToken: record.sellToken,
          sellAmount: record.sellAmount,
          buyToken: record.buyToken,
          buyAmount: record.buyAmount,
          deadline: record.rfqExpiresAt,
          ticketAddress: ACCOUNT,
        },
        NOW + 3,
      ),
    ).rejects.toThrow(/fail-stopped|uncertain/i);
    expect(context.fillCount).toBe(0);
    await expect(
      context.node.release(offer.reservationId, NOW + 3, "retry"),
    ).rejects.toThrow(/fail-stopped|uncertain/i);
    expect(context.fillCount).toBe(0);
  });

  it("fail-stops an uncertain final fill transition after one durably authorized wallet call", async () => {
    const path = walPath();
    let armed = false;
    let writes = 0;
    const store = DurableReservationStore.open(path, {
      faultInjector(stage) {
        if (armed && stage === "write" && ++writes === 2)
          throw new Error("final fill post-write failure");
      },
    });
    openStores.push(store);
    const context = fixture(store);
    const offer = await reserveSignSelect(context.node);
    const record = store.list()[0]!;
    armed = true;
    await expect(
      context.node.fill(
        {
          reservationId: offer.reservationId,
          intentDigest: DIGEST_A,
          fence: record.reservation.fence,
          quoteDigest: record.quoteDigest!,
          dealId: DIGEST_B,
          sellToken: record.sellToken,
          sellAmount: record.sellAmount,
          buyToken: record.buyToken,
          buyAmount: record.buyAmount,
          deadline: record.rfqExpiresAt,
          ticketAddress: ACCOUNT,
        },
        NOW + 3,
      ),
    ).rejects.toThrow(/fail-stopped|uncertain|quarantined/i);
    expect(context.fillCount).toBe(1);
    await expect(
      context.node.release(offer.reservationId, NOW + 4, "retry"),
    ).rejects.toThrow(/fail-stopped|uncertain/i);
    await store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = open(path);
    expect(["filling", "consumed"]).toContain(
      reopened.list()[0]!.reservation.state,
    );
    const sequences = readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});

describe("mutation-sensitive filesystem WAL boundaries", () => {
  it("uses the exact durable replacement operation order for the initial WAL", async () => {
    const path = walPath();
    const probe = fileSystemProbe();
    const store = DurableReservationStore.open(path, {
      fileSystem: probe.fileSystem,
    });
    openStores.push(store);
    expect(probe.trace).toEqual(FILE_OPERATION_ORDER);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.each(FILE_OPERATION_ORDER)(
    "reopens a valid empty WAL after actual initial %s failure",
    (stage) => {
      const path = walPath();
      const probe = fileSystemProbe();
      probe.arm(stage);
      expect(() =>
        DurableReservationStore.open(path, { fileSystem: probe.fileSystem }),
      ).toThrow(/filesystem|reservation/i);
      expect(probe.trace).toContain(stage);
      const reopened = open(path);
      expect(reopened.sequence).toBe(0);
      expect(reopened.list()).toEqual([]);
      assertValidContiguousChain(path, 0, 0);
    },
  );

  it.each(["select", "release", "terminal-refund", "fill-completion"] as const)(
    "uses exact ordered filesystem effects for successful %s mutation(s)",
    async (phase) => {
      const path = walPath();
      const probe = fileSystemProbe();
      const store = DurableReservationStore.open(path, {
        fileSystem: probe.fileSystem,
      });
      openStores.push(store);
      const prepared = await prepareMutationPhase(phase, store);
      probe.trace.splice(0);
      await prepared.operation();
      const copies = phase === "fill-completion" ? 2 : 1;
      expect(probe.trace).toEqual(
        Array.from({ length: copies }, () => [...FILE_OPERATION_ORDER]).flat(),
      );
      expect(prepared.context.fillCount).toBe(
        phase === "fill-completion" ? 1 : 0,
      );
    },
  );

  it.each(
    (
      [
        "select",
        "release",
        "terminal-refund",
        "fill-acquisition",
        "fill-completion",
      ] as const
    ).flatMap((phase) =>
      FILE_OPERATION_ORDER.map((stage) => ({ phase, stage })),
    ),
  )(
    "fail-stops $phase at actual $stage and reopens only old or one new chain head",
    async ({ phase, stage }) => {
      const path = walPath();
      const probe = fileSystemProbe();
      const store = DurableReservationStore.open(path, {
        fileSystem: probe.fileSystem,
      });
      openStores.push(store);
      const prepared = await prepareMutationPhase(phase, store);
      const failureOccurrence = phase === "fill-completion" ? 2 : 1;
      probe.arm(stage, failureOccurrence);
      let acknowledgements = 0;
      await expect(
        prepared.operation().then((value) => {
          acknowledgements += 1;
          return value;
        }),
      ).rejects.toThrow(/fail-stopped|uncertain/i);
      expect(probe.trace).toContain(stage);
      expect(acknowledgements).toBe(0);
      expect(prepared.context.fillCount).toBe(
        phase === "fill-completion" ? 1 : 0,
      );
      await expect(store.transaction(() => undefined)).rejects.toThrow(
        /fail-stopped|uncertain/i,
      );
      await store.close();
      openStores.splice(openStores.indexOf(store), 1);

      const reopened = open(path);
      const minimumSequence =
        phase === "fill-completion"
          ? prepared.oldSequence + 1
          : prepared.oldSequence;
      const maximumSequence =
        phase === "fill-completion"
          ? prepared.oldSequence + 2
          : prepared.oldSequence + 1;
      expect(reopened.sequence).toBeGreaterThanOrEqual(minimumSequence);
      expect(reopened.sequence).toBeLessThanOrEqual(maximumSequence);
      expect(prepared.oldOrNewStates).toContain(
        reopened.list()[0]!.reservation.state,
      );
      assertValidContiguousChain(path, minimumSequence, maximumSequence);
    },
  );
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

  it("retains replay identity after expiry without retaining known-free capacity", async () => {
    const store = open();
    const { node, setBalance } = fixture(store);
    setBalance(100n);
    await node.reserve(request(), NOW);

    await expect(node.reserve(request(), NOW + 601)).rejects.toThrow(
      /replay is fenced/i,
    );
    await expect(
      node.reserve(
        request({ intentDigest: `0x${"66".repeat(32)}` }),
        NOW + 601,
      ),
    ).resolves.toMatchObject({ grossBuyAmount: 100n });
    expect(node.health().states.expired).toBe(1);
    expect(node.health().states.reserved).toBe(1);
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

  it("signs quote v2 only when its monotonic reservation fence and domain match", async () => {
    const store = open();
    const { node } = fixture(store);
    const rfq = request();
    const offer = await node.reserve(rfq, NOW);
    const quote = quoteV2For(offer, rfq.rfqDigest);
    const canonical = canonicalSolverQuoteV2(quote);
    await expect(node.signQuoteV2(quote, canonical, NOW + 1)).resolves.toEqual({
      canonical,
      signature: SIGNATURE,
    });
    await expect(
      node.select(offer.reservationId, DIGEST_A, NOW + 2),
    ).resolves.toEqual({
      fence: offer.fence + 1n,
      quoteDigest: await digestSolverQuoteV2({
        ...quote,
        signature: SIGNATURE,
      }),
    });

    const secondStore = open();
    const second = fixture(secondStore).node;
    const secondOffer = await second.reserve(rfq, NOW);
    const wrongFence = quoteV2For(secondOffer, rfq.rfqDigest, {
      reservationFence: secondOffer.fence + 1n,
    });
    await expect(
      second.signQuoteV2(
        wrongFence,
        canonicalSolverQuoteV2(wrongFence),
        NOW + 1,
      ),
    ).rejects.toThrow(/durable inventory reservation/);
    const v1 = quoteFor(secondOffer);
    await expect(
      second.signQuoteV2(
        v1 as unknown as UnsignedSolverQuoteV2,
        canonicalSolverQuote(v1),
        NOW + 1,
      ),
    ).rejects.toThrow(/Only quote v2/);
  });

  it("returns success when an acknowledged release is retried after response loss", async () => {
    const store = open();
    const { node } = fixture(store);
    const offer = await node.reserve(request(), NOW);
    await expect(
      node.release(offer.reservationId, NOW + 1, "cancelled"),
    ).resolves.toBe(true);
    await expect(
      node.release(offer.reservationId, NOW + 2, "cancelled retry"),
    ).resolves.toBe(true);
    expect(node.health().states.released).toBe(1);
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
      fence: offer.fence + 1n,
      quoteDigest: signedQuoteDigest(offer),
      dealId: "0xd1",
      sellToken: USDC,
      sellAmount: 100n,
      buyToken: STRK,
      buyAmount: 100n,
      deadline: NOW + 1_200,
      ticketAddress: "0xabc",
    };
    await expect(
      node.fill({ ...fillRequest, fence: fillRequest.fence - 1n }, NOW + 3),
    ).rejects.toThrow(/does not authorize/);
    await expect(
      node.fill({ ...fillRequest, quoteDigest: DIGEST_C }, NOW + 3),
    ).rejects.toThrow(/does not authorize/);
    const first = node.fill(fillRequest, NOW + 3);
    await started;
    expect(node.health().states.filling).toBe(1);
    await expect(node.fill(fillRequest, NOW + 3)).rejects.toThrow(
      /does not authorize/i,
    );
    expect(fillCount).toBe(1);
    finishFill();
    await expect(first).resolves.toEqual({ transactionHash: "0xf11" });
    await expect(node.fill(fillRequest, NOW + 4)).resolves.toEqual({
      transactionHash: "0xf11",
    });
    await expect(
      node.fill({ ...fillRequest, dealId: "0xd2" }, NOW + 4),
    ).rejects.toThrow(/does not authorize/i);
    await expect(
      node.fill(
        { ...fillRequest, deadline: fillRequest.deadline + 1 },
        NOW + 4,
      ),
    ).rejects.toThrow(/does not authorize/i);
    await expect(
      node.fill({ ...fillRequest, ticketAddress: "0xabd" }, NOW + 4),
    ).rejects.toThrow(/does not authorize/i);
    expect(fillCount).toBe(1);
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
          fence: offer.fence + 1n,
          quoteDigest: signedQuoteDigest(offer),
          dealId: "0xd1",
          sellToken: USDC,
          sellAmount: 100n,
          buyToken: STRK,
          buyAmount: 100n,
          deadline: NOW + 1_200,
          ticketAddress: "0xabc",
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

describe("chain-authoritative terminal reconciliation", () => {
  it("retains quarantined capacity through prune and restart until exact terminal release", async () => {
    const path = walPath();
    const first = open(path);
    const firstContext = fixture(first);
    firstContext.setBalance(100n);
    const offer = await reserveSignSelect(firstContext.node);
    const target = reconciliationTarget(offer, first);
    await firstContext.node.bindSettlementForReconciliation(target, NOW + 3);
    await firstContext.node.readReconciliationSnapshot(target, NOW + 700);

    const nextRequest = request({ intentDigest: `0x${"66".repeat(32)}` });
    await expect(
      firstContext.node.reserve(nextRequest, NOW + 701),
    ).rejects.toThrow(/inventory cannot cover/i);
    await first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const recoveredStore = open(path);
    const recoveredContext = fixture(recoveredStore);
    recoveredContext.setBalance(100n);
    await recoveredContext.node.recoverAfterRestart(NOW + 702);
    await expect(
      recoveredContext.node.reserve(nextRequest, NOW + 702),
    ).rejects.toThrow(/inventory cannot cover/i);

    await recoveredContext.node.reconcileAuthoritativeTerminal(
      {
        target,
        attemptId: "reconcile:capacity-release",
        authorityDigest: DIGEST_C,
        authorityRevision: 9,
        outcome: "refunded",
      },
      NOW + 703,
    );
    await expect(
      recoveredContext.node.reserve(nextRequest, NOW + 704),
    ).resolves.toMatchObject({ grossBuyAmount: 100n });
  });

  it("recovers authoritative revisions after durable quarantine and response loss", async () => {
    const path = walPath();
    const first = open(path);
    const firstNode = fixture(first).node;
    const offer = await reserveSignSelect(firstNode);
    const target = reconciliationTarget(offer, first);
    await firstNode.bindSettlementForReconciliation(target, NOW + 3);
    const initialTerminal = {
      target,
      attemptId: "reconcile:revision",
      authorityDigest: DIGEST_C,
      authorityRevision: 9,
      outcome: "refunded" as const,
    };

    // Treat this durable mutation as a lost response, then replay after a real
    // WAL close/reopen boundary.
    await firstNode.reconcileAuthoritativeTerminal(initialTerminal, NOW + 4);
    await first.close();
    openStores.splice(openStores.indexOf(first), 1);
    const replayStore = open(path);
    const replayNode = fixture(replayStore).node;
    await expect(
      replayNode.reconcileAuthoritativeTerminal(initialTerminal, NOW + 5),
    ).resolves.toMatchObject({ state: "released" });

    const quarantine = {
      target,
      attemptId: "quarantine:revision-10",
      authorityDigest: DIGEST_B,
      authorityRevision: 10,
      outcome: "refunded" as const,
      reason: "authority-disagreement" as const,
    };
    await expect(
      replayNode.quarantineForAuthority(
        {
          ...quarantine,
          target: { ...target, buyAmount: target.buyAmount + 1n },
        },
        NOW + 6,
      ),
    ).rejects.toThrow(/exact terminal reconciliation target/i);
    const firstQuarantine = await replayNode.quarantineForAuthority(
      quarantine,
      NOW + 6,
    );
    await expect(
      replayNode.quarantineForAuthority(quarantine, NOW + 7),
    ).resolves.toEqual(firstQuarantine);
    expect(firstQuarantine.state).toBe("quarantined");
    await replayStore.close();
    openStores.splice(openStores.indexOf(replayStore), 1);

    const recoveredStore = open(path);
    const recoveredNode = fixture(recoveredStore).node;
    const recoveredTerminal = {
      ...initialTerminal,
      authorityDigest: DIGEST_A,
      authorityRevision: 11,
    };
    // Again lose the response after the WAL mutation, restart, and prove the
    // exact higher-revision retry is idempotent rather than equivocation.
    await recoveredNode.reconcileAuthoritativeTerminal(
      recoveredTerminal,
      NOW + 8,
    );
    await recoveredStore.close();
    openStores.splice(openStores.indexOf(recoveredStore), 1);
    const finalStore = open(path);
    const finalNode = fixture(finalStore).node;
    await expect(
      finalNode.reconcileAuthoritativeTerminal(recoveredTerminal, NOW + 9),
    ).resolves.toMatchObject({
      state: "released",
      terminalReconciliation: {
        authorityDigest: DIGEST_A,
        authorityRevision: 11,
      },
    });
    await expect(
      finalNode.quarantineForAuthority(
        { ...quarantine, authorityDigest: DIGEST_C },
        NOW + 10,
      ),
    ).rejects.toThrow(/equivocation|stale|supersede/i);
  });

  it("keeps selected inventory quarantined until exact refund authority and replays after restart", async () => {
    const path = walPath();
    const first = open(path);
    const firstNode = fixture(first).node;
    const offer = await reserveSignSelect(firstNode);
    const target = reconciliationTarget(offer, first);
    await firstNode.bindSettlementForReconciliation(target, NOW + 3);

    const quarantined = await firstNode.readReconciliationSnapshot(
      target,
      NOW + 700,
    );
    expect(quarantined.state).toBe("quarantined");
    expect(firstNode.health().states.released).toBe(0);

    const request = {
      target,
      attemptId: "reconcile:refund-a",
      authorityDigest: DIGEST_C,
      authorityRevision: 9,
      outcome: "refunded" as const,
    };
    const released = await firstNode.reconcileAuthoritativeTerminal(
      request,
      NOW + 701,
    );
    expect(released.state).toBe("released");
    expect(released.fence).toBe(target.fence.toString());

    await first.close();
    openStores.splice(openStores.indexOf(first), 1);
    const recoveredStore = open(path);
    const recoveredNode = fixture(recoveredStore).node;
    await expect(
      recoveredNode.reconcileAuthoritativeTerminal(request, NOW + 702),
    ).resolves.toMatchObject({ state: "released" });
    await expect(
      recoveredNode.reconcileAuthoritativeTerminal(
        { ...request, authorityDigest: DIGEST_B },
        NOW + 703,
      ),
    ).rejects.toThrow(/equivocation/i);
  });

  it("accepts consumed inventory only with the exact authoritative fill hash", async () => {
    const store = open();
    const node = fixture(store).node;
    const offer = await reserveSignSelect(node);
    const target = reconciliationTarget(offer, store);
    await node.bindSettlementForReconciliation(target, NOW + 3);
    const fill = await node.fill(target, NOW + 4);

    await expect(
      node.reconcileAuthoritativeTerminal(
        {
          target,
          attemptId: "reconcile:settled-a",
          authorityDigest: DIGEST_C,
          authorityRevision: 10,
          outcome: "settled",
          settlementTransactionHash: "0xbad",
        },
        NOW + 5,
      ),
    ).rejects.toThrow(/consumed maker inventory/i);
    await expect(
      node.reconcileAuthoritativeTerminal(
        {
          target,
          attemptId: "reconcile:settled-a",
          authorityDigest: DIGEST_C,
          authorityRevision: 10,
          outcome: "settled",
          settlementTransactionHash: fill.transactionHash,
        },
        NOW + 5,
      ),
    ).resolves.toMatchObject({
      state: "consumed",
      settlementTransactionHash: fill.transactionHash,
    });
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
