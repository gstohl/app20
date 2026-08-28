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

  it.each(["select", "release", "fill-completion"] as const)(
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
      ["select", "release", "fill-acquisition", "fill-completion"] as const
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
