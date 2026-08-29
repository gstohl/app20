import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  QUOTE_DOMAIN,
  QUOTE_V2_DOMAIN,
  canonicalMakerReservation,
  canonicalPrivateRfq,
  canonicalSolverQuote,
  canonicalSolverQuoteV2,
  digestPrivateRfq,
  digestSolverQuoteV2,
  createMakerReservation,
  transitionMakerReservation,
  type MakerReservationV1,
  type PrivateRfqV1,
  type SolverQuote,
  type StarknetPool,
  type UnsignedSolverQuote,
  type UnsignedSolverQuoteV2,
} from "@app20/private-intents";

const WAL_DOMAIN = "app20/maker-reservation-wal/v1" as const;
const HEX_32_PATTERN = /^0x[0-9a-f]{64}$/;
const MAX_U128 = (1n << 128n) - 1n;

export type MakerTerminalReconciliation = Readonly<{
  attemptId: string;
  authorityDigest: string;
  authorityRevision: number;
  outcome: "settled" | "refunded";
  selectionFence: bigint;
  reconciledAt: number;
}>;

export type MakerAuthorityQuarantine = Readonly<{
  attemptId: string;
  authorityDigest: string;
  authorityRevision: number;
  outcome: "settled" | "refunded";
  reason: "authority-disagreement" | "authority-reorged";
  selectionFence: bigint;
  quarantinedAt: number;
}>;

export type StoredMakerReservation = Readonly<{
  reservation: MakerReservationV1;
  nonce: string;
  solverId: string;
  solverKey: string;
  spreadBps: number;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  grossBuyAmount: bigint;
  buyAmount: bigint;
  minBuyAmount: bigint;
  rfqExpiresAt: number;
  pricingProvenance: string;
  signedCanonical?: string;
  signature?: string;
  quoteDigest?: string;
  settlementDealId?: string;
  settlementDeadline?: number;
  settlementTicketAddress?: string;
  authorityQuarantine?: MakerAuthorityQuarantine;
  terminalReconciliation?: MakerTerminalReconciliation;
}>;

export type MakerReconciliationTarget = Readonly<{
  reservationId: string;
  intentDigest: string;
  fence: bigint;
  quoteDigest: string;
  dealId: string;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  buyAmount: bigint;
  deadline: number;
  ticketAddress: string;
}>;

export type MakerTerminalReconciliationRequest = Readonly<{
  target: MakerReconciliationTarget;
  attemptId: string;
  authorityDigest: string;
  authorityRevision: number;
  outcome: "settled" | "refunded";
  settlementTransactionHash?: string;
}>;

export type MakerAuthorityQuarantineRequest = Readonly<{
  target: MakerReconciliationTarget;
  attemptId: string;
  authorityDigest: string;
  authorityRevision: number;
  outcome: "settled" | "refunded";
  reason: "authority-disagreement" | "authority-reorged";
}>;

export type MakerReconciliationSnapshot = Readonly<{
  makerId: string;
  intentDigest: string;
  reservationId: string;
  fence: string;
  quoteDigest: string;
  dealId: string;
  sellToken: string;
  sellAmount: string;
  buyToken: string;
  buyAmount: string;
  deadline: number;
  ticketAddress: string;
  state: MakerReservationV1["state"];
  settlementTransactionHash?: string;
  authorityQuarantine?: Readonly<{
    attemptId: string;
    authorityDigest: string;
    authorityRevision: number;
    outcome: "settled" | "refunded";
    reason: "authority-disagreement" | "authority-reorged";
    selectionFence: string;
    quarantinedAt: number;
  }>;
  terminalReconciliation?: Readonly<{
    attemptId: string;
    authorityDigest: string;
    authorityRevision: number;
    outcome: "settled" | "refunded";
    selectionFence: string;
    reconciledAt: number;
  }>;
}>;

export type MakerQuoteRequest = Readonly<{
  rfq: PrivateRfqV1;
  rfqDigest: string;
  intentDigest: string;
  expiresAt: number;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  minBuyAmount: bigint;
}>;

export type MakerReservationOffer = Readonly<{
  solverId: string;
  solverKey: string;
  grossBuyAmount: bigint;
  sellToken: string;
  buyToken: string;
  spreadBps: number;
  provenance: string;
  nonce: string;
  reservationId: string;
  reservationExpiresAt: number;
  fence: bigint;
}>;

export type MakerFillRequest = Readonly<{
  reservationId: string;
  intentDigest: string;
  fence: bigint;
  quoteDigest: string;
  dealId: string;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  buyAmount: bigint;
  deadline: number;
  ticketAddress: string;
}>;

export type MakerWalletAdapter = Readonly<{
  settlementAccount: string;
  privateBalance: (asset: string) => Promise<bigint>;
  fill: (request: MakerFillRequest) => Promise<{ transactionHash: string }>;
}>;

export type MakerNodeConfig = Readonly<{
  makerId: string;
  solverKey: string;
  pool: StarknetPool;
  helper: string;
  spreadBps: number;
  reservationTtlSeconds: number;
  price: (request: MakerQuoteRequest) => Promise<{
    grossBuyAmount: bigint;
    provenance: string;
  }>;
  signer: (canonical: string) => Promise<string>;
  wallet: MakerWalletAdapter;
  randomId?: () => string;
}>;

type StoredWire = Readonly<{
  reservation: Omit<MakerReservationV1, "amountBaseUnits" | "fence"> & {
    amountBaseUnits: string;
    fence: string;
  };
  nonce: string;
  solverId: string;
  solverKey: string;
  spreadBps: number;
  sellToken: string;
  sellAmount: string;
  buyToken: string;
  grossBuyAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  rfqExpiresAt: number;
  pricingProvenance: string;
  signedCanonical?: string;
  signature?: string;
  quoteDigest?: string;
  settlementDealId?: string;
  settlementDeadline?: number;
  settlementTicketAddress?: string;
  authorityQuarantine?: Omit<MakerAuthorityQuarantine, "selectionFence"> & {
    selectionFence: string;
  };
  terminalReconciliation?: Omit<
    MakerTerminalReconciliation,
    "selectionFence"
  > & {
    selectionFence: string;
  };
}>;

type WalPayload = Readonly<{
  records: readonly StoredWire[];
}>;

type WalEntry = Readonly<{
  version: 1;
  domain: typeof WAL_DOMAIN;
  sequence: number;
  previousDigest: string | null;
  payload: WalPayload;
  digest: string;
}>;

export class MakerNodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MakerNodeError";
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new MakerNodeError(`${label} is required.`);
  return normalized;
}

function requireHex32(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HEX_32_PATTERN.test(normalized)) {
    throw new MakerNodeError(`${label} must be a canonical 32-byte hex value.`);
  }
  return normalized;
}

function requireAmount(value: bigint, label: string): bigint {
  if (value <= 0n || value > MAX_U128) {
    throw new MakerNodeError(`${label} must be a positive u128 value.`);
  }
  return value;
}

function requireTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MakerNodeError(
      `${label} must be a positive unix-seconds timestamp.`,
    );
  }
  return value;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function quoteDigest(canonical: string): string {
  return `0x${createHash("sha256").update(canonical).digest("hex")}`;
}

function serializeStored(record: StoredMakerReservation): StoredWire {
  canonicalMakerReservation(record.reservation);
  return {
    reservation: {
      ...record.reservation,
      amountBaseUnits: record.reservation.amountBaseUnits.toString(),
      fence: record.reservation.fence.toString(),
    },
    nonce: requireHex32(record.nonce, "nonce"),
    solverId: requireText(record.solverId, "solverId"),
    solverKey: requireText(record.solverKey, "solverKey"),
    spreadBps: record.spreadBps,
    sellToken: record.sellToken,
    sellAmount: record.sellAmount.toString(),
    buyToken: record.buyToken,
    grossBuyAmount: record.grossBuyAmount.toString(),
    buyAmount: record.buyAmount.toString(),
    minBuyAmount: record.minBuyAmount.toString(),
    rfqExpiresAt: record.rfqExpiresAt,
    pricingProvenance: requireText(
      record.pricingProvenance,
      "pricingProvenance",
    ),
    ...(record.signedCanonical === undefined
      ? {}
      : { signedCanonical: record.signedCanonical }),
    ...(record.signature === undefined ? {} : { signature: record.signature }),
    ...(record.quoteDigest === undefined
      ? {}
      : { quoteDigest: requireHex32(record.quoteDigest, "quoteDigest") }),
    ...(record.settlementDealId === undefined
      ? {}
      : {
          settlementDealId: requireText(
            record.settlementDealId,
            "settlementDealId",
          ).toLowerCase(),
        }),
    ...(record.settlementDeadline === undefined
      ? {}
      : {
          settlementDeadline: requireTimestamp(
            record.settlementDeadline,
            "settlementDeadline",
          ),
        }),
    ...(record.settlementTicketAddress === undefined
      ? {}
      : {
          settlementTicketAddress: requireText(
            record.settlementTicketAddress,
            "settlementTicketAddress",
          ).toLowerCase(),
        }),
    ...(record.authorityQuarantine === undefined
      ? {}
      : {
          authorityQuarantine: {
            attemptId: requireText(
              record.authorityQuarantine.attemptId,
              "authority quarantine attemptId",
            ),
            authorityDigest: requireHex32(
              record.authorityQuarantine.authorityDigest,
              "authority quarantine authorityDigest",
            ),
            authorityRevision: requireTimestamp(
              record.authorityQuarantine.authorityRevision,
              "authority quarantine authorityRevision",
            ),
            outcome: record.authorityQuarantine.outcome,
            reason: record.authorityQuarantine.reason,
            selectionFence:
              record.authorityQuarantine.selectionFence.toString(),
            quarantinedAt: requireTimestamp(
              record.authorityQuarantine.quarantinedAt,
              "authority quarantine quarantinedAt",
            ),
          },
        }),
    ...(record.terminalReconciliation === undefined
      ? {}
      : {
          terminalReconciliation: {
            attemptId: requireText(
              record.terminalReconciliation.attemptId,
              "terminal reconciliation attemptId",
            ),
            authorityDigest: requireHex32(
              record.terminalReconciliation.authorityDigest,
              "terminal reconciliation authorityDigest",
            ),
            authorityRevision: requireTimestamp(
              record.terminalReconciliation.authorityRevision,
              "terminal reconciliation authorityRevision",
            ),
            outcome: record.terminalReconciliation.outcome,
            selectionFence:
              record.terminalReconciliation.selectionFence.toString(),
            reconciledAt: requireTimestamp(
              record.terminalReconciliation.reconciledAt,
              "terminal reconciliation reconciledAt",
            ),
          },
        }),
  };
}

function deserializeStored(wire: StoredWire): StoredMakerReservation {
  const reservation = {
    ...wire.reservation,
    amountBaseUnits: BigInt(wire.reservation.amountBaseUnits),
    fence: BigInt(wire.reservation.fence),
  } as MakerReservationV1;
  canonicalMakerReservation(reservation);
  const record: StoredMakerReservation = {
    reservation,
    nonce: requireHex32(wire.nonce, "nonce"),
    solverId: requireText(wire.solverId, "solverId"),
    solverKey: requireText(wire.solverKey, "solverKey"),
    spreadBps: wire.spreadBps,
    sellToken: requireText(wire.sellToken, "sellToken"),
    sellAmount: requireAmount(BigInt(wire.sellAmount), "sellAmount"),
    buyToken: requireText(wire.buyToken, "buyToken"),
    grossBuyAmount: requireAmount(
      BigInt(wire.grossBuyAmount),
      "grossBuyAmount",
    ),
    buyAmount: requireAmount(BigInt(wire.buyAmount), "buyAmount"),
    minBuyAmount: requireAmount(BigInt(wire.minBuyAmount), "minBuyAmount"),
    rfqExpiresAt: requireTimestamp(wire.rfqExpiresAt, "rfqExpiresAt"),
    pricingProvenance: requireText(wire.pricingProvenance, "pricingProvenance"),
    ...(wire.signedCanonical === undefined
      ? {}
      : { signedCanonical: wire.signedCanonical }),
    ...(wire.signature === undefined ? {} : { signature: wire.signature }),
    ...(wire.quoteDigest === undefined
      ? {}
      : { quoteDigest: requireHex32(wire.quoteDigest, "quoteDigest") }),
    ...(wire.settlementDealId === undefined
      ? {}
      : {
          settlementDealId: requireText(
            wire.settlementDealId,
            "settlementDealId",
          ).toLowerCase(),
        }),
    ...(wire.settlementDeadline === undefined
      ? {}
      : {
          settlementDeadline: requireTimestamp(
            wire.settlementDeadline,
            "settlementDeadline",
          ),
        }),
    ...(wire.settlementTicketAddress === undefined
      ? {}
      : {
          settlementTicketAddress: requireText(
            wire.settlementTicketAddress,
            "settlementTicketAddress",
          ).toLowerCase(),
        }),
    ...(wire.authorityQuarantine === undefined
      ? {}
      : {
          authorityQuarantine: {
            attemptId: requireText(
              wire.authorityQuarantine.attemptId,
              "authority quarantine attemptId",
            ),
            authorityDigest: requireHex32(
              wire.authorityQuarantine.authorityDigest,
              "authority quarantine authorityDigest",
            ),
            authorityRevision: requireTimestamp(
              wire.authorityQuarantine.authorityRevision,
              "authority quarantine authorityRevision",
            ),
            outcome: wire.authorityQuarantine.outcome,
            reason: wire.authorityQuarantine.reason,
            selectionFence: BigInt(wire.authorityQuarantine.selectionFence),
            quarantinedAt: requireTimestamp(
              wire.authorityQuarantine.quarantinedAt,
              "authority quarantine quarantinedAt",
            ),
          },
        }),
    ...(wire.terminalReconciliation === undefined
      ? {}
      : {
          terminalReconciliation: {
            attemptId: requireText(
              wire.terminalReconciliation.attemptId,
              "terminal reconciliation attemptId",
            ),
            authorityDigest: requireHex32(
              wire.terminalReconciliation.authorityDigest,
              "terminal reconciliation authorityDigest",
            ),
            authorityRevision: requireTimestamp(
              wire.terminalReconciliation.authorityRevision,
              "terminal reconciliation authorityRevision",
            ),
            outcome: wire.terminalReconciliation.outcome,
            selectionFence: BigInt(wire.terminalReconciliation.selectionFence),
            reconciledAt: requireTimestamp(
              wire.terminalReconciliation.reconciledAt,
              "terminal reconciliation reconciledAt",
            ),
          },
        }),
  };
  if (
    record.authorityQuarantine &&
    ((record.authorityQuarantine.outcome !== "settled" &&
      record.authorityQuarantine.outcome !== "refunded") ||
      (record.authorityQuarantine.reason !== "authority-disagreement" &&
        record.authorityQuarantine.reason !== "authority-reorged") ||
      record.authorityQuarantine.selectionFence <= 0n)
  ) {
    throw new MakerNodeError(
      "Persisted authority quarantine metadata is invalid.",
    );
  }
  if (
    record.terminalReconciliation &&
    ((record.terminalReconciliation.outcome !== "settled" &&
      record.terminalReconciliation.outcome !== "refunded") ||
      record.terminalReconciliation.selectionFence <= 0n)
  ) {
    throw new MakerNodeError(
      "Persisted terminal reconciliation metadata is invalid.",
    );
  }
  if (
    (record.signedCanonical === undefined) !==
      (record.signature === undefined) ||
    (record.signedCanonical === undefined) !==
      (record.quoteDigest === undefined)
  ) {
    throw new MakerNodeError(
      "Persisted quote signature fields are incomplete.",
    );
  }
  return record;
}

function canonicalWalEntry(
  sequence: number,
  previousDigest: string | null,
  payload: WalPayload,
): string {
  return JSON.stringify({
    domain: WAL_DOMAIN,
    payload,
    previousDigest,
    sequence,
    version: 1,
  });
}

function cloneRecords(
  records: ReadonlyMap<string, StoredMakerReservation>,
): Map<string, StoredMakerReservation> {
  return new Map(
    [...records.entries()].map(([id, record]) => [
      id,
      deserializeStored(serializeStored(record)),
    ]),
  );
}

export type DurableReservationFileSystem = Readonly<{
  open: (path: string, flags: string, mode?: number) => number;
  write: (
    descriptor: number,
    buffer: Buffer,
    offset: number,
    length: number,
  ) => number;
  fsync: (descriptor: number) => void;
  close: (descriptor: number) => void;
  rename: (from: string, to: string) => void;
  chmod: (path: string, mode: number) => void;
}>;

const durableReservationFileSystem: DurableReservationFileSystem = {
  open: (path, flags, mode) => openSync(path, flags, mode),
  write: (descriptor, buffer, offset, length) =>
    writeSync(descriptor, buffer, offset, length),
  fsync: (descriptor) => fsyncSync(descriptor),
  close: (descriptor) => closeSync(descriptor),
  rename: (from, to) => renameSync(from, to),
  chmod: (path, mode) => chmodSync(path, mode),
};

export type DurableReservationStoreOptions = Readonly<{
  faultInjector?: (stage: string) => void;
  fileSystem?: DurableReservationFileSystem;
}>;

export class DurableReservationStore {
  readonly #walPath: string;
  readonly #lockPath: string;
  readonly #exitHandler: () => void;
  readonly #faultInjector?: (stage: string) => void;
  readonly #fileSystem: DurableReservationFileSystem;
  #records = new Map<string, StoredMakerReservation>();
  #sequence = 0;
  #headDigest: string | null = null;
  #durableSerialized = "";
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #failed = false;

  private constructor(
    walPath: string,
    options: DurableReservationStoreOptions = {},
  ) {
    this.#walPath = walPath;
    this.#lockPath = `${walPath}.lock`;
    this.#faultInjector = options.faultInjector;
    this.#fileSystem = options.fileSystem ?? durableReservationFileSystem;
    this.#exitHandler = () => rmSync(this.#lockPath, { force: true });
  }

  static open(
    walPath: string,
    options: DurableReservationStoreOptions = {},
  ): DurableReservationStore {
    const store = new DurableReservationStore(walPath, options);
    store.#acquireLock();
    try {
      store.#load();
      process.once("exit", store.#exitHandler);
      return store;
    } catch (error) {
      store.#releaseLock();
      throw error;
    }
  }

  get sequence(): number {
    return this.#sequence;
  }

  list(): readonly StoredMakerReservation[] {
    return [...this.#records.values()].map((record) =>
      deserializeStored(serializeStored(record)),
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.#tail;
    this.#closed = true;
    process.removeListener("exit", this.#exitHandler);
    this.#releaseLock();
  }

  async transaction<T>(
    mutate: (
      draft: Map<string, StoredMakerReservation>,
      nextSequence: number,
    ) => Promise<T> | T,
  ): Promise<T> {
    if (this.#closed) throw new MakerNodeError("Reservation store is closed.");
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const run = this.#tail.then(async () => {
      if (this.#closed)
        throw new MakerNodeError("Reservation store is closed.");
      if (this.#failed)
        throw new MakerNodeError(
          "Reservation store is fail-stopped after an uncertain WAL transition; reopen it from disk before retrying.",
        );
      let draft: Map<string, StoredMakerReservation>;
      try {
        draft = cloneRecords(this.#records);
      } catch (error) {
        this.#failed = true;
        throw new MakerNodeError(
          "Reservation WAL serialization failed; the store is fail-stopped.",
          { cause: error },
        );
      }
      try {
        const value = await mutate(draft, this.#sequence + 1);
        this.#appendSnapshot(draft);
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
    this.#tail = run.catch(() => undefined);
    await run;
    return result;
  }

  #acquireLock(): void {
    mkdirSync(dirname(this.#walPath), { recursive: true, mode: 0o700 });
    const existing = (() => {
      try {
        return JSON.parse(readFileSync(this.#lockPath, "utf8")) as {
          pid?: number;
        };
      } catch {
        return null;
      }
    })();
    if (existing?.pid && Number.isInteger(existing.pid)) {
      try {
        process.kill(existing.pid, 0);
        throw new MakerNodeError(
          `Reservation WAL is already owned by live process ${existing.pid}.`,
        );
      } catch (error) {
        if (error instanceof MakerNodeError) throw error;
        rmSync(this.#lockPath, { force: true });
      }
    } else {
      rmSync(this.#lockPath, { force: true });
    }
    let descriptor: number | undefined;
    try {
      descriptor = openSync(this.#lockPath, "wx", 0o600);
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, openedAt: Date.now() })}\n`,
      );
      fsyncSync(descriptor);
    } catch (error) {
      throw new MakerNodeError("Could not acquire the reservation WAL lock.", {
        cause: error,
      });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  #releaseLock(): void {
    rmSync(this.#lockPath, { force: true });
  }

  #checkpoint(stage: string): void {
    this.#faultInjector?.(stage);
  }

  #load(): void {
    mkdirSync(dirname(this.#walPath), { recursive: true, mode: 0o700 });
    if (!existsSync(this.#walPath)) {
      this.#replaceDurableFile("", "initial");
      this.#durableSerialized = "";
      return;
    }
    chmodSync(this.#walPath, 0o600);
    let content = readFileSync(this.#walPath, "utf8");
    if (content && !content.endsWith("\n")) {
      const lastComplete = content.lastIndexOf("\n") + 1;
      truncateSync(this.#walPath, lastComplete);
      const descriptor = openSync(this.#walPath, "r");
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      content = content.slice(0, lastComplete);
    }
    this.#durableSerialized = content;
    const lines = content.split("\n").filter(Boolean);
    for (const [index, line] of lines.entries()) {
      let entry: WalEntry;
      try {
        entry = JSON.parse(line) as WalEntry;
      } catch (error) {
        throw new MakerNodeError(
          `Reservation WAL line ${index + 1} is invalid JSON.`,
          {
            cause: error,
          },
        );
      }
      if (
        entry.version !== 1 ||
        entry.domain !== WAL_DOMAIN ||
        entry.sequence !== this.#sequence + 1 ||
        entry.previousDigest !== this.#headDigest
      ) {
        throw new MakerNodeError(
          `Reservation WAL line ${index + 1} broke the hash chain.`,
        );
      }
      const digest = sha256(
        canonicalWalEntry(entry.sequence, entry.previousDigest, entry.payload),
      );
      if (entry.digest !== digest) {
        throw new MakerNodeError(
          `Reservation WAL line ${index + 1} has an invalid digest.`,
        );
      }
      const next = new Map<string, StoredMakerReservation>();
      for (const wire of entry.payload.records) {
        const record = deserializeStored(wire);
        const id = record.reservation.reservationId;
        if (next.has(id)) {
          throw new MakerNodeError(
            `Reservation WAL line ${index + 1} repeats ${id}.`,
          );
        }
        next.set(id, record);
      }
      this.#records = next;
      this.#sequence = entry.sequence;
      this.#headDigest = entry.digest;
    }
  }

  #replaceDurableFile(candidate: string, label: string): void {
    const directoryPath = dirname(this.#walPath);
    const temporary = `${this.#walPath}.${process.pid}.${label}.${randomBytes(8).toString("hex")}.tmp`;
    let descriptor: number | undefined;
    let directory: number | undefined;
    try {
      this.#checkpoint("open");
      descriptor = this.#fileSystem.open(temporary, "wx", 0o600);
      const bytes = Buffer.from(candidate, "utf8");
      const split = Math.floor(bytes.length / 2);
      const first = this.#fileSystem.write(descriptor, bytes, 0, split);
      if (first !== split)
        throw new MakerNodeError(
          "Reservation WAL candidate write was partial.",
        );
      this.#checkpoint("partial-write");
      let offset = split;
      do {
        const written = this.#fileSystem.write(
          descriptor,
          bytes,
          offset,
          bytes.length - offset,
        );
        if (written < 0 || (offset < bytes.length && written === 0))
          throw new MakerNodeError(
            "Reservation WAL candidate write was partial.",
          );
        offset += written;
      } while (offset < bytes.length);
      this.#checkpoint("write");
      this.#checkpoint("file-fsync");
      this.#fileSystem.fsync(descriptor);
      this.#checkpoint("close");
      this.#fileSystem.close(descriptor);
      descriptor = undefined;
      this.#checkpoint("rename");
      this.#fileSystem.rename(temporary, this.#walPath);
      this.#checkpoint("chmod");
      this.#fileSystem.chmod(this.#walPath, 0o600);
      this.#checkpoint("dir-open");
      directory = this.#fileSystem.open(directoryPath, "r");
      this.#checkpoint("dir-fsync");
      this.#fileSystem.fsync(directory);
      this.#checkpoint("dir-close");
      this.#fileSystem.close(directory);
      directory = undefined;
    } finally {
      if (descriptor !== undefined) {
        try {
          this.#fileSystem.close(descriptor);
        } catch {
          // The caller fail-stops on every uncertainty.
        }
      }
      if (directory !== undefined) {
        try {
          this.#fileSystem.close(directory);
        } catch {
          // The caller fail-stops on every uncertainty.
        }
      }
      rmSync(temporary, { force: true });
    }
  }

  #appendSnapshot(records: Map<string, StoredMakerReservation>): void {
    try {
      this.#checkpoint("serialize");
      const sequence = this.#sequence + 1;
      const payload = {
        records: [...records.values()]
          .sort((left, right) =>
            left.reservation.reservationId.localeCompare(
              right.reservation.reservationId,
            ),
          )
          .map(serializeStored),
      } satisfies WalPayload;
      const canonical = canonicalWalEntry(sequence, this.#headDigest, payload);
      const entry: WalEntry = {
        version: 1,
        domain: WAL_DOMAIN,
        sequence,
        previousDigest: this.#headDigest,
        payload,
        digest: sha256(canonical),
      };
      const serializedEntry = `${JSON.stringify(entry)}\n`;
      const candidate = `${this.#durableSerialized}${serializedEntry}`;
      this.#replaceDurableFile(candidate, String(sequence));
      this.#records = records;
      this.#sequence = sequence;
      this.#headDigest = entry.digest;
      this.#durableSerialized = candidate;
    } catch (error) {
      this.#failed = true;
      throw new MakerNodeError(
        "Reservation WAL transition was uncertain; the store is fail-stopped and must be reopened from disk.",
        { cause: error },
      );
    }
  }
}

function activeState(state: MakerReservationV1["state"]): boolean {
  return state === "reserved" || state === "selected" || state === "filling";
}

/**
 * Replay identity is retained for every durable record, while capacity is
 * locked only by reservations whose inventory outcome is still available or
 * unknown. In particular, quarantine is never treated as spare inventory.
 */
function capacityLockedState(state: MakerReservationV1["state"]): boolean {
  return activeState(state) || state === "quarantined";
}

function sameTerms(
  record: StoredMakerReservation,
  request: MakerQuoteRequest,
): boolean {
  return (
    record.reservation.intentDigest === request.intentDigest &&
    record.reservation.rfqDigest === request.rfqDigest &&
    record.sellToken.toLowerCase() === request.sellToken.toLowerCase() &&
    record.sellAmount === request.sellAmount &&
    record.buyToken.toLowerCase() === request.buyToken.toLowerCase() &&
    record.minBuyAmount === request.minBuyAmount &&
    record.rfqExpiresAt === request.expiresAt
  );
}

function toOffer(record: StoredMakerReservation): MakerReservationOffer {
  return {
    solverId: record.solverId,
    solverKey: record.solverKey,
    grossBuyAmount: record.grossBuyAmount,
    sellToken: record.sellToken,
    buyToken: record.buyToken,
    spreadBps: record.spreadBps,
    provenance: record.pricingProvenance,
    nonce: record.nonce,
    reservationId: record.reservation.reservationId,
    reservationExpiresAt: record.reservation.expiresAt,
    fence: record.reservation.fence,
  };
}

function pruneDraft(
  draft: Map<string, StoredMakerReservation>,
  now: number,
): void {
  for (const [id, record] of draft) {
    if (
      !activeState(record.reservation.state) ||
      record.reservation.expiresAt > now
    ) {
      continue;
    }
    const reservation =
      record.reservation.state === "reserved"
        ? transitionMakerReservation(record.reservation, {
            kind: "expire",
            expectedFence: record.reservation.fence,
            at: now,
          })
        : transitionMakerReservation(record.reservation, {
            kind: "quarantine",
            expectedFence: record.reservation.fence,
            at: now,
            reason: "selected reservation expired with unknown chain outcome",
          });
    draft.set(id, { ...record, reservation });
  }
}

function requireSpread(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10_000) {
    throw new MakerNodeError("spreadBps must be an integer in [0, 10000). ");
  }
  return value;
}

function requireTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 24 * 60 * 60) {
    throw new MakerNodeError("reservationTtlSeconds must be in (0, 86400].");
  }
  return value;
}

function requireFeltText(value: string, label: string): string {
  const normalized = requireText(value, label).toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(normalized))
    throw new MakerNodeError(`${label} must be a canonical felt.`);
  return normalized;
}

function canonicalReconciliationTarget(
  input: MakerReconciliationTarget,
): MakerReconciliationTarget {
  return Object.freeze({
    reservationId: requireHex32(input.reservationId, "reservationId"),
    intentDigest: requireHex32(input.intentDigest, "intentDigest"),
    fence: requireAmount(input.fence, "selection fence"),
    quoteDigest: requireHex32(input.quoteDigest, "quoteDigest"),
    dealId: requireFeltText(input.dealId, "dealId"),
    sellToken: requireFeltText(input.sellToken, "sellToken"),
    sellAmount: requireAmount(input.sellAmount, "sellAmount"),
    buyToken: requireFeltText(input.buyToken, "buyToken"),
    buyAmount: requireAmount(input.buyAmount, "buyAmount"),
    deadline: requireTimestamp(input.deadline, "deadline"),
    ticketAddress: requireFeltText(input.ticketAddress, "ticketAddress"),
  });
}

function selectionFenceForReconciliation(
  record: StoredMakerReservation,
): bigint {
  if (record.terminalReconciliation)
    return record.terminalReconciliation.selectionFence;
  if (record.authorityQuarantine)
    return record.authorityQuarantine.selectionFence;
  const fence = record.reservation.fence;
  switch (record.reservation.state) {
    case "selected":
      return fence;
    case "filling":
      return fence - 1n;
    case "consumed":
      return fence - 2n;
    case "quarantined":
      return fence - (record.reservation.settlementAttemptId ? 2n : 1n);
    default:
      throw new MakerNodeError(
        "Reservation state has no terminal reconciliation authority.",
      );
  }
}

function assertReconciliationBinding(
  record: StoredMakerReservation | undefined,
  target: MakerReconciliationTarget,
  makerId: string,
): StoredMakerReservation {
  if (
    !record ||
    record.solverId !== makerId ||
    record.reservation.intentDigest !== target.intentDigest ||
    record.quoteDigest !== target.quoteDigest ||
    record.sellToken.toLowerCase() !== target.sellToken ||
    record.sellAmount !== target.sellAmount ||
    record.buyToken.toLowerCase() !== target.buyToken ||
    record.buyAmount !== target.buyAmount ||
    record.rfqExpiresAt !== target.deadline ||
    record.settlementDealId !== target.dealId ||
    record.settlementDeadline !== target.deadline ||
    record.settlementTicketAddress !== target.ticketAddress ||
    selectionFenceForReconciliation(record) !== target.fence
  ) {
    throw new MakerNodeError(
      "Maker reservation does not match the exact terminal reconciliation target.",
    );
  }
  return record;
}

function reconciliationSnapshot(
  record: StoredMakerReservation,
): MakerReconciliationSnapshot {
  if (
    !record.quoteDigest ||
    !record.settlementTicketAddress ||
    record.settlementDeadline === undefined
  ) {
    throw new MakerNodeError(
      "Maker reservation lacks durable settlement reconciliation fields.",
    );
  }
  return Object.freeze({
    makerId: record.solverId,
    intentDigest: record.reservation.intentDigest,
    reservationId: record.reservation.reservationId,
    fence: selectionFenceForReconciliation(record).toString(),
    quoteDigest: record.quoteDigest,
    dealId: record.settlementDealId!,
    sellToken: record.sellToken,
    sellAmount: record.sellAmount.toString(),
    buyToken: record.buyToken,
    buyAmount: record.buyAmount.toString(),
    deadline: record.settlementDeadline,
    ticketAddress: record.settlementTicketAddress,
    state: record.reservation.state,
    ...(record.reservation.settlementTransactionHash === undefined
      ? {}
      : {
          settlementTransactionHash:
            record.reservation.settlementTransactionHash,
        }),
    ...(record.authorityQuarantine === undefined
      ? {}
      : {
          authorityQuarantine: Object.freeze({
            attemptId: record.authorityQuarantine.attemptId,
            authorityDigest: record.authorityQuarantine.authorityDigest,
            authorityRevision: record.authorityQuarantine.authorityRevision,
            outcome: record.authorityQuarantine.outcome,
            reason: record.authorityQuarantine.reason,
            selectionFence:
              record.authorityQuarantine.selectionFence.toString(),
            quarantinedAt: record.authorityQuarantine.quarantinedAt,
          }),
        }),
    ...(record.terminalReconciliation === undefined
      ? {}
      : {
          terminalReconciliation: Object.freeze({
            attemptId: record.terminalReconciliation.attemptId,
            authorityDigest: record.terminalReconciliation.authorityDigest,
            authorityRevision: record.terminalReconciliation.authorityRevision,
            outcome: record.terminalReconciliation.outcome,
            selectionFence:
              record.terminalReconciliation.selectionFence.toString(),
            reconciledAt: record.terminalReconciliation.reconciledAt,
          }),
        }),
  });
}

export class DurableMakerNode {
  readonly #store: DurableReservationStore;
  readonly #config: MakerNodeConfig;

  constructor(store: DurableReservationStore, config: MakerNodeConfig) {
    this.#store = store;
    this.#config = {
      ...config,
      makerId: requireText(config.makerId, "makerId"),
      solverKey: requireText(config.solverKey, "solverKey"),
      pool: config.pool,
      helper: requireText(config.helper, "helper"),
      spreadBps: requireSpread(config.spreadBps),
      reservationTtlSeconds: requireTtl(config.reservationTtlSeconds),
      wallet: {
        ...config.wallet,
        settlementAccount: requireText(
          config.wallet.settlementAccount,
          "settlementAccount",
        ),
      },
    };
  }

  get makerId(): string {
    return this.#config.makerId;
  }

  get solverKey(): string {
    return this.#config.solverKey;
  }

  get settlementAccount(): string {
    return this.#config.wallet.settlementAccount;
  }

  async recoverAfterRestart(now: number): Promise<void> {
    requireTimestamp(now, "now");
    await this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      for (const [id, record] of draft) {
        if (record.reservation.state !== "filling") continue;
        draft.set(id, {
          ...record,
          reservation: transitionMakerReservation(record.reservation, {
            kind: "quarantine",
            expectedFence: record.reservation.fence,
            at: now,
            reason: "maker process restarted with unknown chain outcome",
          }),
        });
      }
    });
  }

  async reserve(
    request: MakerQuoteRequest,
    now: number,
  ): Promise<MakerReservationOffer> {
    requireTimestamp(now, "now");
    canonicalPrivateRfq(request.rfq);
    const rfqDigest = requireHex32(request.rfqDigest, "rfqDigest");
    if (rfqDigest !== (await digestPrivateRfq(request.rfq))) {
      throw new MakerNodeError("RFQ digest does not match the canonical RFQ.");
    }
    requireHex32(request.intentDigest, "intentDigest");
    requireTimestamp(request.expiresAt, "expiresAt");
    requireAmount(request.sellAmount, "sellAmount");
    requireAmount(request.minBuyAmount, "minBuyAmount");
    if (
      request.rfq.intentDigest !== request.intentDigest ||
      request.rfq.expiresAt !== request.expiresAt ||
      request.rfq.sellToken.toLowerCase() !== request.sellToken.toLowerCase() ||
      request.rfq.sellAmountBaseUnits !== request.sellAmount ||
      request.rfq.buyToken.toLowerCase() !== request.buyToken.toLowerCase() ||
      request.rfq.minBuyAmountBaseUnits !== request.minBuyAmount ||
      request.rfq.chainId !== this.#config.pool ||
      request.rfq.settlementHelper.toLowerCase() !==
        this.#config.helper.toLowerCase()
    ) {
      throw new MakerNodeError(
        "RFQ request fields do not match the canonical private RFQ.",
      );
    }
    if (request.expiresAt <= now) {
      throw new MakerNodeError("RFQ already expired.");
    }
    return this.#store.transaction(async (draft, nextSequence) => {
      pruneDraft(draft, now);
      const existing = [...draft.values()].find(
        (record) => record.reservation.intentDigest === request.intentDigest,
      );
      if (existing) {
        if (!sameTerms(existing, request)) {
          throw new MakerNodeError(
            "RFQ intent digest was reused with different terms.",
          );
        }
        if (existing.reservation.state !== "reserved") {
          throw new MakerNodeError(
            "RFQ intent replay is fenced by its durable reservation history.",
          );
        }
        return toOffer(existing);
      }
      const priced = await this.#config.price(request);
      const grossBuyAmount = requireAmount(
        priced.grossBuyAmount,
        "grossBuyAmount",
      );
      const buyAmount =
        (grossBuyAmount * BigInt(10_000 - this.#config.spreadBps)) / 10_000n;
      if (buyAmount < request.minBuyAmount) {
        throw new MakerNodeError("Maker quote is below the RFQ floor.");
      }
      const walletBalance = requireAmount(
        await this.#config.wallet.privateBalance(request.buyToken),
        "private inventory",
      );
      const reserved = [...draft.values()]
        .filter(
          (record) =>
            capacityLockedState(record.reservation.state) &&
            record.buyToken.toLowerCase() === request.buyToken.toLowerCase(),
        )
        .reduce((total, record) => total + record.buyAmount, 0n);
      if (buyAmount > walletBalance - reserved) {
        throw new MakerNodeError(
          "Private maker inventory cannot cover this RFQ.",
        );
      }
      const randomId =
        this.#config.randomId ?? (() => `0x${randomBytes(32).toString("hex")}`);
      const reservationId = requireHex32(randomId(), "reservationId");
      const nonce = requireHex32(randomId(), "nonce");
      const reservationExpiresAt = Math.min(
        request.expiresAt,
        now + this.#config.reservationTtlSeconds,
      );
      const record: StoredMakerReservation = {
        reservation: createMakerReservation({
          reservationId,
          makerId: this.#config.makerId,
          intentDigest: request.intentDigest,
          rfqDigest,
          asset: request.buyToken,
          amountBaseUnits: buyAmount,
          createdAt: now,
          expiresAt: reservationExpiresAt,
          fence: BigInt(nextSequence),
        }),
        nonce,
        solverId: this.#config.makerId,
        solverKey: this.#config.solverKey,
        spreadBps: this.#config.spreadBps,
        sellToken: request.sellToken,
        sellAmount: request.sellAmount,
        buyToken: request.buyToken,
        grossBuyAmount,
        buyAmount,
        minBuyAmount: request.minBuyAmount,
        rfqExpiresAt: request.expiresAt,
        pricingProvenance: requireText(priced.provenance, "pricing provenance"),
      };
      draft.set(reservationId, record);
      return toOffer(record);
    });
  }

  async signQuote(
    quote: UnsignedSolverQuote,
    canonical: string,
    now: number,
  ): Promise<{ signature: string; canonical: string }> {
    requireTimestamp(now, "now");
    return this.#store.transaction(async (draft) => {
      pruneDraft(draft, now);
      const reservationId = requireHex32(quote.reservationId, "reservationId");
      const record = draft.get(reservationId);
      if (!record || record.reservation.state !== "reserved") {
        throw new MakerNodeError(
          "Quote reservation is missing, expired, or no longer signable.",
        );
      }
      const reconstructed = canonicalSolverQuote(quote);
      if (canonical !== reconstructed) {
        throw new MakerNodeError(
          "Quote canonical payload does not match its fields.",
        );
      }
      if (
        quote.domain !== QUOTE_DOMAIN ||
        quote.pool !== this.#config.pool ||
        quote.helper.toLowerCase() !== this.#config.helper.toLowerCase() ||
        quote.solverId !== record.solverId ||
        quote.solverKey !== record.solverKey ||
        quote.intentDigest !== record.reservation.intentDigest ||
        quote.nonce !== record.nonce ||
        quote.sellToken.toLowerCase() !== record.sellToken.toLowerCase() ||
        quote.sellAmount !== record.sellAmount ||
        quote.buyToken.toLowerCase() !== record.buyToken.toLowerCase() ||
        quote.buyAmount !== record.buyAmount ||
        quote.spreadBps !== record.spreadBps ||
        quote.pricingProvenance !== record.pricingProvenance ||
        quote.reservationExpiresAt !== record.reservation.expiresAt ||
        !Number.isSafeInteger(quote.quotedAt) ||
        quote.quotedAt > now + 30 ||
        !Number.isSafeInteger(quote.quoteExpiresAt) ||
        quote.quoteExpiresAt <= quote.quotedAt ||
        quote.quoteExpiresAt > record.reservation.expiresAt
      ) {
        throw new MakerNodeError(
          "Quote does not match its durable inventory reservation.",
        );
      }
      if (record.signedCanonical !== undefined) {
        if (record.signedCanonical !== canonical || !record.signature) {
          throw new MakerNodeError(
            "Maker refused quote equivocation for this reservation.",
          );
        }
        return { signature: record.signature, canonical };
      }
      const signature = requireText(
        await this.#config.signer(canonical),
        "signature",
      );
      const updated: StoredMakerReservation = {
        ...record,
        signedCanonical: canonical,
        signature,
        quoteDigest: quoteDigest(canonical),
      };
      draft.set(reservationId, updated);
      return { signature, canonical };
    });
  }

  async signQuoteV2(
    quote: UnsignedSolverQuoteV2,
    canonical: string,
    now: number,
  ): Promise<{ signature: string; canonical: string }> {
    requireTimestamp(now, "now");
    return this.#store.transaction(async (draft) => {
      pruneDraft(draft, now);
      const reservationId = requireHex32(quote.reservationId, "reservationId");
      const record = draft.get(reservationId);
      if (!record || record.reservation.state !== "reserved") {
        throw new MakerNodeError(
          "Quote v2 reservation is missing, expired, or no longer signable.",
        );
      }
      if (quote.domain !== QUOTE_V2_DOMAIN) {
        throw new MakerNodeError("Only quote v2 may use signQuoteV2.");
      }
      const reconstructed = canonicalSolverQuoteV2(quote);
      if (canonical !== reconstructed) {
        throw new MakerNodeError(
          "Quote v2 canonical payload does not match its fields.",
        );
      }
      if (
        quote.pool !== this.#config.pool ||
        quote.helper.toLowerCase() !== this.#config.helper.toLowerCase() ||
        quote.solverId !== record.solverId ||
        quote.quoteKeyId !== record.solverKey ||
        quote.intentDigest !== record.reservation.intentDigest ||
        quote.rfqDigest !== record.reservation.rfqDigest ||
        quote.nonce !== record.nonce ||
        quote.sellToken.toLowerCase() !== record.sellToken.toLowerCase() ||
        quote.sellAmount !== record.sellAmount ||
        quote.buyToken.toLowerCase() !== record.buyToken.toLowerCase() ||
        quote.buyAmount !== record.buyAmount ||
        quote.spreadBps !== record.spreadBps ||
        quote.pricingProvenance !== record.pricingProvenance ||
        quote.reservationExpiresAt !== record.reservation.expiresAt ||
        quote.reservationFence !== record.reservation.fence ||
        !Number.isSafeInteger(quote.quotedAt) ||
        quote.quotedAt > now + 30 ||
        !Number.isSafeInteger(quote.quoteExpiresAt) ||
        quote.quoteExpiresAt <= quote.quotedAt ||
        quote.quoteExpiresAt > record.reservation.expiresAt
      ) {
        throw new MakerNodeError(
          "Quote v2 does not match its durable inventory reservation.",
        );
      }
      if (record.signedCanonical !== undefined) {
        if (record.signedCanonical !== canonical || !record.signature) {
          throw new MakerNodeError(
            "Maker refused quote v2 equivocation for this reservation.",
          );
        }
        return { signature: record.signature, canonical };
      }
      const signature = requireText(
        await this.#config.signer(canonical),
        "signature",
      );
      const signedQuoteDigest = await digestSolverQuoteV2({
        ...quote,
        signature,
      });
      draft.set(reservationId, {
        ...record,
        signedCanonical: canonical,
        signature,
        quoteDigest: signedQuoteDigest,
      });
      return { signature, canonical };
    });
  }

  async select(
    reservationId: string,
    intentDigest: string,
    now: number,
  ): Promise<Readonly<{ fence: bigint; quoteDigest: string }>> {
    return this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      const id = requireHex32(reservationId, "reservationId");
      const record = draft.get(id);
      const expectedIntentDigest = requireHex32(intentDigest, "intentDigest");
      if (
        record?.reservation.state === "selected" &&
        record.reservation.intentDigest === expectedIntentDigest &&
        record.quoteDigest
      ) {
        return {
          fence: record.reservation.fence,
          quoteDigest: record.quoteDigest,
        };
      }
      if (
        !record ||
        record.reservation.state !== "reserved" ||
        record.reservation.intentDigest !== expectedIntentDigest ||
        !record.quoteDigest
      ) {
        throw new MakerNodeError(
          "Only a signed active reservation can be selected.",
        );
      }
      const selected = transitionMakerReservation(record.reservation, {
        kind: "select",
        expectedFence: record.reservation.fence,
        at: now,
        quoteDigest: record.quoteDigest,
      });
      draft.set(id, { ...record, reservation: selected });
      return { fence: selected.fence, quoteDigest: record.quoteDigest };
    });
  }

  async release(
    reservationId: string,
    now: number,
    reason: string,
  ): Promise<boolean> {
    return this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      const id = requireHex32(reservationId, "reservationId");
      const record = draft.get(id);
      if (!record) return false;
      if (record.reservation.state === "released") return true;
      if (
        record.reservation.state !== "reserved" &&
        record.reservation.state !== "selected"
      ) {
        return false;
      }
      if (now >= record.reservation.expiresAt) return false;
      draft.set(id, {
        ...record,
        reservation: transitionMakerReservation(record.reservation, {
          kind: "release",
          expectedFence: record.reservation.fence,
          at: now,
          reason,
        }),
      });
      return true;
    });
  }

  async bindSettlementForReconciliation(
    input: MakerReconciliationTarget,
    now: number,
  ): Promise<MakerReconciliationSnapshot> {
    const target = canonicalReconciliationTarget(input);
    requireTimestamp(now, "now");
    return this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      const record = draft.get(target.reservationId);
      if (
        !record ||
        record.solverId !== this.#config.makerId ||
        record.reservation.intentDigest !== target.intentDigest ||
        record.quoteDigest !== target.quoteDigest ||
        record.sellToken.toLowerCase() !== target.sellToken ||
        record.sellAmount !== target.sellAmount ||
        record.buyToken.toLowerCase() !== target.buyToken ||
        record.buyAmount !== target.buyAmount ||
        record.rfqExpiresAt !== target.deadline ||
        selectionFenceForReconciliation(record) !== target.fence ||
        (record.settlementDealId !== undefined &&
          record.settlementDealId !== target.dealId) ||
        (record.settlementDeadline !== undefined &&
          record.settlementDeadline !== target.deadline) ||
        (record.settlementTicketAddress !== undefined &&
          record.settlementTicketAddress !== target.ticketAddress)
      ) {
        throw new MakerNodeError(
          "Maker refused a substituted settlement reconciliation binding.",
        );
      }
      const bound: StoredMakerReservation = {
        ...record,
        settlementDealId: target.dealId,
        settlementDeadline: target.deadline,
        settlementTicketAddress: target.ticketAddress,
      };
      draft.set(target.reservationId, bound);
      return reconciliationSnapshot(bound);
    });
  }

  async readReconciliationSnapshot(
    input: MakerReconciliationTarget,
    now: number,
  ): Promise<MakerReconciliationSnapshot> {
    const target = canonicalReconciliationTarget(input);
    requireTimestamp(now, "now");
    return this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      return reconciliationSnapshot(
        assertReconciliationBinding(
          draft.get(target.reservationId),
          target,
          this.#config.makerId,
        ),
      );
    });
  }

  async quarantineForAuthority(
    input: MakerAuthorityQuarantineRequest,
    now: number,
  ): Promise<MakerReconciliationSnapshot> {
    const target = canonicalReconciliationTarget(input.target);
    const attemptId = requireText(
      input.attemptId,
      "authority quarantine attemptId",
    );
    const authorityDigest = requireHex32(
      input.authorityDigest,
      "authority quarantine authorityDigest",
    );
    const authorityRevision = requireTimestamp(
      input.authorityRevision,
      "authority quarantine authorityRevision",
    );
    if (input.outcome !== "settled" && input.outcome !== "refunded")
      throw new MakerNodeError("Authority quarantine outcome is invalid.");
    if (
      input.reason !== "authority-disagreement" &&
      input.reason !== "authority-reorged"
    )
      throw new MakerNodeError("Authority quarantine reason is invalid.");
    requireTimestamp(now, "now");
    return this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      const record = assertReconciliationBinding(
        draft.get(target.reservationId),
        target,
        this.#config.makerId,
      );
      const prior = record.authorityQuarantine;
      if (prior && authorityRevision < prior.authorityRevision)
        throw new MakerNodeError(
          "Maker refused a stale authority quarantine revision.",
        );
      if (prior?.authorityRevision === authorityRevision) {
        if (
          prior.attemptId !== attemptId ||
          prior.authorityDigest !== authorityDigest ||
          prior.outcome !== input.outcome ||
          prior.reason !== input.reason ||
          prior.selectionFence !== target.fence
        )
          throw new MakerNodeError(
            "Maker refused authority quarantine equivocation.",
          );
        return reconciliationSnapshot(record);
      }
      if (
        record.terminalReconciliation &&
        (record.terminalReconciliation.outcome !== input.outcome ||
          authorityRevision <= record.terminalReconciliation.authorityRevision)
      )
        throw new MakerNodeError(
          "Maker refused authority quarantine that did not supersede terminal authority.",
        );
      if (now < record.reservation.updatedAt)
        throw new MakerNodeError(
          "Authority quarantine time moved behind reservation history.",
        );
      const authorityQuarantine: MakerAuthorityQuarantine = {
        attemptId,
        authorityDigest,
        authorityRevision,
        outcome: input.outcome,
        reason: input.reason,
        selectionFence: target.fence,
        quarantinedAt: now,
      };
      const reservation: MakerReservationV1 =
        record.reservation.state === "quarantined"
          ? {
              ...record.reservation,
              updatedAt: now,
              terminalReason:
                input.reason === "authority-reorged"
                  ? "chain authority reorged; exact reconciliation required"
                  : "chain readers disagreed; exact reconciliation required",
            }
          : {
              ...record.reservation,
              state: "quarantined",
              fence: record.reservation.fence + 1n,
              updatedAt: now,
              terminalReason:
                input.reason === "authority-reorged"
                  ? "chain authority reorged; exact reconciliation required"
                  : "chain readers disagreed; exact reconciliation required",
            };
      canonicalMakerReservation(reservation);
      const next: StoredMakerReservation = {
        ...record,
        authorityQuarantine,
        reservation,
      };
      draft.set(target.reservationId, next);
      return reconciliationSnapshot(next);
    });
  }

  async reconcileAuthoritativeTerminal(
    input: MakerTerminalReconciliationRequest,
    now: number,
  ): Promise<MakerReconciliationSnapshot> {
    const target = canonicalReconciliationTarget(input.target);
    const attemptId = requireText(
      input.attemptId,
      "terminal reconciliation attemptId",
    );
    const authorityDigest = requireHex32(
      input.authorityDigest,
      "terminal reconciliation authorityDigest",
    );
    const authorityRevision = requireTimestamp(
      input.authorityRevision,
      "terminal reconciliation authorityRevision",
    );
    if (input.outcome !== "settled" && input.outcome !== "refunded")
      throw new MakerNodeError("Terminal reconciliation outcome is invalid.");
    requireTimestamp(now, "now");
    return this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      const record = assertReconciliationBinding(
        draft.get(target.reservationId),
        target,
        this.#config.makerId,
      );
      const prior = record.terminalReconciliation;
      if (prior && authorityRevision < prior.authorityRevision)
        throw new MakerNodeError(
          "Maker refused a stale terminal reconciliation revision.",
        );
      if (prior?.authorityRevision === authorityRevision) {
        if (
          prior.attemptId !== attemptId ||
          prior.authorityDigest !== authorityDigest ||
          prior.outcome !== input.outcome ||
          prior.selectionFence !== target.fence
        )
          throw new MakerNodeError(
            "Maker refused terminal reconciliation equivocation.",
          );
        return reconciliationSnapshot(record);
      }
      if (prior && prior.outcome !== input.outcome)
        throw new MakerNodeError(
          "Maker refused terminal reconciliation outcome equivocation.",
        );
      if (
        record.authorityQuarantine &&
        authorityRevision <= record.authorityQuarantine.authorityRevision
      )
        throw new MakerNodeError(
          "Terminal authority does not supersede the maker quarantine revision.",
        );
      if (input.outcome === "settled") {
        const settlementTransactionHash = requireFeltText(
          input.settlementTransactionHash ?? "",
          "settlementTransactionHash",
        );
        if (
          (record.reservation.state !== "consumed" &&
            record.reservation.state !== "quarantined") ||
          !record.reservation.settlementAttemptId ||
          record.reservation.settlementTransactionHash?.toLowerCase() !==
            settlementTransactionHash
        ) {
          throw new MakerNodeError(
            "Settled authority does not match consumed maker inventory.",
          );
        }
      } else if (
        (record.reservation.state !== "selected" &&
          record.reservation.state !== "quarantined" &&
          !(
            record.reservation.state === "released" &&
            prior?.outcome === "refunded"
          )) ||
        record.reservation.settlementAttemptId ||
        record.reservation.settlementTransactionHash
      ) {
        throw new MakerNodeError(
          "Refund authority cannot release attempted or consumed maker inventory.",
        );
      }
      if (now < record.reservation.updatedAt)
        throw new MakerNodeError(
          "Terminal reconciliation time moved behind reservation history.",
        );
      const terminalReconciliation: MakerTerminalReconciliation = {
        attemptId,
        authorityDigest,
        authorityRevision,
        outcome: input.outcome,
        selectionFence: target.fence,
        reconciledAt: now,
      };
      const reservation: MakerReservationV1 =
        input.outcome === "settled"
          ? record.reservation.state === "consumed"
            ? record.reservation
            : {
                ...record.reservation,
                state: "consumed",
                fence: record.reservation.fence + 1n,
                updatedAt: now,
              }
          : record.reservation.state === "released"
            ? record.reservation
            : {
                ...record.reservation,
                state: "released",
                fence: record.reservation.fence + 1n,
                updatedAt: now,
                terminalReason: "exact chain-authoritative refund reconciled",
              };
      canonicalMakerReservation(reservation);
      const next: StoredMakerReservation = {
        ...record,
        terminalReconciliation,
        reservation,
      };
      draft.set(target.reservationId, next);
      return reconciliationSnapshot(next);
    });
  }

  async fill(
    request: MakerFillRequest,
    now: number,
  ): Promise<{ transactionHash: string }> {
    requireTimestamp(now, "now");
    const acquisition = await this.#store.transaction((draft) => {
      pruneDraft(draft, now);
      const id = requireHex32(request.reservationId, "reservationId");
      const current = draft.get(id);
      const exactTerms = Boolean(
        current &&
          current.reservation.intentDigest ===
            requireHex32(request.intentDigest, "intentDigest") &&
          current.quoteDigest ===
            requireHex32(request.quoteDigest, "quoteDigest") &&
          current.sellToken.toLowerCase() === request.sellToken.toLowerCase() &&
          current.sellAmount === request.sellAmount &&
          current.buyToken.toLowerCase() === request.buyToken.toLowerCase() &&
          current.buyAmount === request.buyAmount &&
          Number.isSafeInteger(request.deadline) &&
          request.deadline === current.rfqExpiresAt &&
          /^0x[0-9a-f]+$/i.test(request.dealId) &&
          /^0x[0-9a-f]+$/i.test(request.ticketAddress) &&
          (current.settlementDealId === undefined ||
            current.settlementDealId === request.dealId.toLowerCase()) &&
          (current.settlementDeadline === undefined ||
            current.settlementDeadline === request.deadline) &&
          (current.settlementTicketAddress === undefined ||
            current.settlementTicketAddress ===
              request.ticketAddress.toLowerCase()),
      );
      if (
        exactTerms &&
        current?.reservation.state === "consumed" &&
        current.reservation.fence === request.fence + 2n &&
        current.reservation.settlementTransactionHash
      ) {
        return {
          complete: true as const,
          transactionHash: current.reservation.settlementTransactionHash,
        };
      }
      if (
        !exactTerms ||
        current?.reservation.state !== "selected" ||
        current.reservation.fence !== request.fence
      ) {
        throw new MakerNodeError(
          "Selected reservation does not authorize this fill.",
        );
      }
      const randomId =
        this.#config.randomId ?? (() => `0x${randomBytes(32).toString("hex")}`);
      const filling: StoredMakerReservation = {
        ...current,
        settlementDealId: request.dealId.toLowerCase(),
        settlementDeadline: request.deadline,
        settlementTicketAddress: request.ticketAddress.toLowerCase(),
        reservation: transitionMakerReservation(current.reservation, {
          kind: "begin-fill",
          expectedFence: current.reservation.fence,
          at: now,
          settlementAttemptId: requireHex32(randomId(), "settlementAttemptId"),
        }),
      };
      draft.set(id, filling);
      return { complete: false as const, record: filling };
    });
    if (acquisition.complete)
      return { transactionHash: acquisition.transactionHash };
    const record = acquisition.record;
    try {
      const result = await this.#config.wallet.fill(request);
      await this.#store.transaction((draft) => {
        const current = draft.get(record.reservation.reservationId);
        if (!current || current.reservation.state !== "filling") {
          throw new MakerNodeError(
            "In-flight reservation changed during fill.",
          );
        }
        draft.set(current.reservation.reservationId, {
          ...current,
          reservation: transitionMakerReservation(current.reservation, {
            kind: "consume",
            expectedFence: current.reservation.fence,
            at: now,
            settlementTransactionHash: result.transactionHash,
          }),
        });
      });
      return result;
    } catch (error) {
      await this.#store.transaction((draft) => {
        const current = draft.get(record.reservation.reservationId);
        if (!current || current.reservation.state !== "filling") return;
        draft.set(current.reservation.reservationId, {
          ...current,
          reservation: transitionMakerReservation(current.reservation, {
            kind: "quarantine",
            expectedFence: current.reservation.fence,
            at: now,
            reason: "fill outcome unknown; operator reconciliation required",
          }),
        });
      });
      throw new MakerNodeError(
        "Maker fill failed and inventory was quarantined.",
        {
          cause: error,
        },
      );
    }
  }

  health(): Readonly<{
    makerId: string;
    solverKey: string;
    settlementAccount: string;
    walSequence: number;
    states: Readonly<Record<MakerReservationV1["state"], number>>;
  }> {
    const states: Record<MakerReservationV1["state"], number> = {
      reserved: 0,
      selected: 0,
      filling: 0,
      released: 0,
      consumed: 0,
      expired: 0,
      quarantined: 0,
    };
    for (const record of this.#store.list())
      states[record.reservation.state] += 1;
    return {
      makerId: this.#config.makerId,
      solverKey: this.#config.solverKey,
      settlementAccount: this.#config.wallet.settlementAccount,
      walSequence: this.#store.sequence,
      states,
    };
  }
}

export type { SolverQuote };
export * from "#hpke-ingress";
export * from "#production-ports";
