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
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  MAKER_MID_DOMAIN,
  QUOTE_DOMAIN,
  QUOTE_V2_DOMAIN,
  QUOTE_V3_DOMAIN,
  assertLadderBucket,
  assertPriceSchedule,
  assertPrivateRfqV2,
  canonicalMakerMid,
  canonicalMakerReservation,
  canonicalPrivateRfq,
  canonicalSolverQuote,
  canonicalSolverQuoteV2,
  canonicalSolverQuoteV3,
  createMakerReservation,
  decodeStoredMakerReservation,
  digestPrivateRfq,
  digestPrivateRfqV2,
  digestSolverQuoteV2,
  digestSolverQuoteV3,
  isCanonicalQuoteSignature,
  scheduleUnitPriceE18,
  transitionMakerReservation,
  verifySelectionTranscriptForMaker,
  type MakerIndicativeMidV1,
  type MakerReservationV1,
  type PriceSchedule,
  type PrivateRfqV1,
  type PrivateRfqV2,
  type SelectionTranscriptV1,
  type SizeBucketSymbol,
  type SolverQuote,
  type SolverQuoteV3,
  type StarknetPool,
  type UnsignedSolverQuote,
  type UnsignedSolverQuoteV2,
  type UnsignedSolverQuoteV3,
} from "@app20/private-intents";
import type {
  DurableMakerTranscriptJournal,
  MakerTranscriptRecord,
} from "./transcript-journal.ts";

const WAL_DOMAIN = "app20/maker-reservation-wal/v1" as const;
const HEX_32_PATTERN = /^0x[0-9a-f]{64}$/;
const FELT_HEX_PATTERN = /^0x[0-9a-f]{1,64}$/;
const MAX_U128 = (1n << 128n) - 1n;
const STARK_FIELD_PRIME =
  0x0800000000000011000000000000000000000000000000000000000000000001n;
const MAX_TEXT_LENGTH = 8192;
const MAX_FELT_HEX_LENGTH = 66;
const MAX_LOCK_FILE_BYTES = 4096;

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

export type LockRecordV1State =
  | "locking"
  | "open"
  | "taken"
  | "expired"
  | "settling"
  | "settled"
  | "quarantined";

export type LockRecordV1 = Readonly<{
  lockId: string;
  rfqDigest: string;
  rfqFelt: string;
  takerCommitment: string;
  tokenA: string;
  tokenB: string;
  schedule: PriceSchedule;
  maxB: bigint;
  expiry: number;
  ticket: string;
  lockTxHash: string;
  state: LockRecordV1State;
  takenA: bigint;
  takenB: bigint;
  proceedsTxHash?: string;
  releaseTxHash?: string;
  quoteDigest?: string;
}>;

export type LockRecordV1Wire = Readonly<{
  lockId: string;
  rfqDigest: string;
  rfqFelt: string;
  takerCommitment: string;
  tokenA: string;
  tokenB: string;
  schedule: readonly Readonly<{ a: string; b: string }>[];
  maxB: string;
  expiry: number;
  ticket: string;
  lockTxHash: string;
  state: LockRecordV1State;
  takenA: string;
  takenB: string;
  proceedsTxHash?: string;
  releaseTxHash?: string;
  quoteDigest?: string;
}>;

export type MakerOnChainLock = Readonly<{
  tokenA: string;
  tokenB: string;
  rfqId: string;
  takerCommitment: string;
  expiry: number;
  schedule: PriceSchedule;
  remainingB: bigint;
  earnedA: bigint;
  ticket: string;
  proceedsSettled: boolean;
  collateralReleased: boolean;
  status: "empty" | "open";
}>;

export type MakerLockRequest = Readonly<{
  lockId: string;
  rfqFelt: string;
  takerCommitment: string;
  tokenA: string;
  tokenB: string;
  schedule: PriceSchedule;
  expiry: number;
}>;

export type MakerLockSettlementRequest = Readonly<{
  lockId: string;
  ticket: string;
  outputToken: string;
}>;

export class MakerWalletOperationError extends Error {
  readonly outcome: "reverted" | "unknown";

  constructor(
    outcome: "reverted" | "unknown",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MakerWalletOperationError";
    this.outcome = outcome;
  }
}

export type MakerWalletAdapter = Readonly<{
  settlementAccount: string;
  privateBalance: (asset: string) => Promise<bigint>;
  fill: (request: MakerFillRequest) => Promise<{ transactionHash: string }>;
  lock?: (request: MakerLockRequest) => Promise<{
    ticket: string;
    transactionHash: string;
    lock: MakerOnChainLock;
  }>;
  getLock?: (lockId: string) => Promise<MakerOnChainLock>;
  settleProceeds?: (
    request: MakerLockSettlementRequest,
  ) => Promise<{ transactionHash: string }>;
  releaseCollateral?: (
    request: MakerLockSettlementRequest,
  ) => Promise<{ transactionHash: string }>;
}>;

export type MakerQuoteV3RefusalCode =
  | "bucket"
  | "insufficient-inventory"
  | "policy"
  | "lock-failed"
  | "expired";

export type MakerQuoteV3Result =
  | Readonly<{
      quote: SolverQuoteV3;
      lock: Readonly<{
        lockId: string;
        ticket: string;
        transactionHash: string;
      }>;
    }>
  | Readonly<{
      refused: Readonly<{ code: MakerQuoteV3RefusalCode; reason: string }>;
    }>;

export type MakerScheduleV3Request = Readonly<{
  rfq: PrivateRfqV2;
  bucketSymbol: SizeBucketSymbol;
  availableBuyInventory: bigint;
  now: number;
}>;

export type MakerScheduleV3Result = Readonly<{
  schedule: PriceSchedule;
  spreadBps: number;
  pricingProvenance: string;
}>;

export type MakerEconomicPolicyV3Input = Readonly<{
  rfq: PrivateRfqV2;
  rfqDigest: string;
  schedule: PriceSchedule;
  amountA: bigint;
  amountB: bigint;
  quoteTtlSeconds: number;
  now: number;
}>;

export type MakerNodeV3Config = Readonly<{
  tokenSymbol: (token: string) => SizeBucketSymbol | undefined;
  buildSchedule: (
    request: MakerScheduleV3Request,
  ) => Promise<MakerScheduleV3Result | null> | MakerScheduleV3Result | null;
  economicPolicy: Readonly<{
    evaluate: (input: MakerEconomicPolicyV3Input) =>
      | Promise<
          Readonly<{
            allowed: boolean;
            reason?: string;
            commitmentUsdcBaseUnits?: bigint;
          }>
        >
      | Readonly<{
          allowed: boolean;
          reason?: string;
          commitmentUsdcBaseUnits?: bigint;
        }>;
    commit?: (
      input: MakerEconomicPolicyV3Input &
        Readonly<{
          lockId: string;
          commitmentUsdcBaseUnits: bigint;
        }>,
    ) => Promise<void> | void;
  }>;
  midE18: bigint;
  transcriptJournal: DurableMakerTranscriptJournal;
  clock?: () => number;
  randomFelt?: () => string;
  randomNonce?: () => string;
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
  v3?: MakerNodeV3Config;
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

type StoredLockRecord = LockRecordV1 &
  Readonly<{
    nonce: string;
    quotedAt: number;
    spreadBps: number;
    pricingProvenance: string;
    signature?: string;
    settlingAction?: "proceeds" | "release";
  }>;

type StoredLockWire = LockRecordV1Wire &
  Readonly<{
    nonce: string;
    quotedAt: number;
    spreadBps: number;
    pricingProvenance: string;
    signature?: string;
    settlingAction?: "proceeds" | "release";
  }>;

type WalPayload = Readonly<{
  records: readonly StoredWire[];
  locks?: readonly StoredLockWire[];
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
  if (typeof value !== "string") {
    throw new MakerNodeError(`${label} is required.`);
  }
  const normalized = value.trim();
  if (!normalized) throw new MakerNodeError(`${label} is required.`);
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw new MakerNodeError(`${label} exceeds the bounded length.`);
  }
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
      : {
          signedCanonical: requireText(
            record.signedCanonical,
            "signedCanonical",
          ),
        }),
    ...(record.signature === undefined
      ? {}
      : { signature: requireText(record.signature, "signature") }),
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
  return decodeStoredMakerReservation({
    ...wire,
    reservation: {
      ...wire.reservation,
      amountBaseUnits: BigInt(wire.reservation.amountBaseUnits),
      fence: BigInt(wire.reservation.fence),
    },
    sellAmount: BigInt(wire.sellAmount),
    grossBuyAmount: BigInt(wire.grossBuyAmount),
    buyAmount: BigInt(wire.buyAmount),
    minBuyAmount: BigInt(wire.minBuyAmount),
    ...(wire.authorityQuarantine === undefined
      ? {}
      : {
          authorityQuarantine: {
            ...wire.authorityQuarantine,
            selectionFence: BigInt(wire.authorityQuarantine.selectionFence),
          },
        }),
    ...(wire.terminalReconciliation === undefined
      ? {}
      : {
          terminalReconciliation: {
            ...wire.terminalReconciliation,
            selectionFence: BigInt(wire.terminalReconciliation.selectionFence),
          },
        }),
  });
}

const LOCK_RECORD_STATES = new Set<LockRecordV1State>([
  "locking",
  "open",
  "taken",
  "expired",
  "settling",
  "settled",
  "quarantined",
]);

function requireNonnegativeAmount(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U128) {
    throw new MakerNodeError(`${label} must be a non-negative u128 value.`);
  }
  return value;
}

function canonicalStoredLock(record: StoredLockRecord): StoredLockRecord {
  assertPriceSchedule(record.schedule);
  const schedule = Object.freeze(
    record.schedule.map((point) =>
      Object.freeze({
        a: requireAmount(point.a, "lock schedule amount"),
        b: requireAmount(point.b, "lock schedule payout"),
      }),
    ),
  );
  const maxB = requireAmount(record.maxB, "lock maxB");
  if (schedule[schedule.length - 1]!.b !== maxB) {
    throw new MakerNodeError(
      "Lock maxB must equal the schedule maximum payout.",
    );
  }
  if (!LOCK_RECORD_STATES.has(record.state)) {
    throw new MakerNodeError("Lock record state is invalid.");
  }
  const spreadBps = requireSpread(record.spreadBps);
  const quoteDigestValue =
    record.quoteDigest === undefined
      ? undefined
      : requireHex32(record.quoteDigest, "lock quoteDigest");
  if (
    record.settlingAction !== undefined &&
    record.settlingAction !== "proceeds" &&
    record.settlingAction !== "release"
  ) {
    throw new MakerNodeError("Lock settlement action is invalid.");
  }
  return Object.freeze({
    lockId: requireFeltText(record.lockId, "lockId"),
    rfqDigest: requireHex32(record.rfqDigest, "lock rfqDigest"),
    rfqFelt: requireFeltText(record.rfqFelt, "lock rfqFelt"),
    takerCommitment: requireFeltText(
      record.takerCommitment,
      "lock takerCommitment",
    ),
    tokenA: requireFeltText(record.tokenA, "lock tokenA"),
    tokenB: requireFeltText(record.tokenB, "lock tokenB"),
    schedule,
    maxB,
    expiry: requireTimestamp(record.expiry, "lock expiry"),
    ticket: requireFeltText(record.ticket, "lock ticket"),
    lockTxHash: requireFeltText(record.lockTxHash, "lock transaction hash"),
    state: record.state,
    takenA: requireNonnegativeAmount(record.takenA, "lock takenA"),
    takenB: requireNonnegativeAmount(record.takenB, "lock takenB"),
    ...(record.proceedsTxHash === undefined
      ? {}
      : {
          proceedsTxHash: requireFeltText(
            record.proceedsTxHash,
            "lock proceeds transaction hash",
          ),
        }),
    ...(record.releaseTxHash === undefined
      ? {}
      : {
          releaseTxHash: requireFeltText(
            record.releaseTxHash,
            "lock release transaction hash",
          ),
        }),
    ...(quoteDigestValue === undefined
      ? {}
      : { quoteDigest: quoteDigestValue }),
    nonce: requireHex32(record.nonce, "lock nonce"),
    quotedAt: requireTimestamp(record.quotedAt, "lock quotedAt"),
    spreadBps,
    pricingProvenance: requireText(
      record.pricingProvenance,
      "lock pricingProvenance",
    ),
    ...(record.signature === undefined
      ? {}
      : { signature: requireText(record.signature, "lock signature") }),
    ...(record.settlingAction === undefined
      ? {}
      : { settlingAction: record.settlingAction }),
  });
}

function serializeStoredLock(record: StoredLockRecord): StoredLockWire {
  const canonical = canonicalStoredLock(record);
  return {
    ...canonical,
    schedule: canonical.schedule.map((point) => ({
      a: point.a.toString(),
      b: point.b.toString(),
    })),
    maxB: canonical.maxB.toString(),
    takenA: canonical.takenA.toString(),
    takenB: canonical.takenB.toString(),
  };
}

function deserializeStoredLock(wire: StoredLockWire): StoredLockRecord {
  return canonicalStoredLock({
    ...wire,
    schedule: wire.schedule.map((point) => ({
      a: BigInt(point.a),
      b: BigInt(point.b),
    })),
    maxB: BigInt(wire.maxB),
    takenA: BigInt(wire.takenA),
    takenB: BigInt(wire.takenB),
  });
}

export function encodeLockRecordV1(record: LockRecordV1): LockRecordV1Wire {
  assertPriceSchedule(record.schedule);
  requireAmount(record.maxB, "lock maxB");
  requireNonnegativeAmount(record.takenA, "lock takenA");
  requireNonnegativeAmount(record.takenB, "lock takenB");
  if (!LOCK_RECORD_STATES.has(record.state)) {
    throw new MakerNodeError("Lock record state is invalid.");
  }
  return Object.freeze({
    lockId: requireFeltText(record.lockId, "lockId"),
    rfqDigest: requireHex32(record.rfqDigest, "lock rfqDigest"),
    rfqFelt: requireFeltText(record.rfqFelt, "lock rfqFelt"),
    takerCommitment: requireFeltText(
      record.takerCommitment,
      "lock takerCommitment",
    ),
    tokenA: requireFeltText(record.tokenA, "lock tokenA"),
    tokenB: requireFeltText(record.tokenB, "lock tokenB"),
    schedule: Object.freeze(
      record.schedule.map((point) =>
        Object.freeze({ a: point.a.toString(), b: point.b.toString() }),
      ),
    ),
    maxB: record.maxB.toString(),
    expiry: requireTimestamp(record.expiry, "lock expiry"),
    ticket: requireFeltText(record.ticket, "lock ticket"),
    lockTxHash: requireFeltText(record.lockTxHash, "lock transaction hash"),
    state: record.state,
    takenA: record.takenA.toString(),
    takenB: record.takenB.toString(),
    ...(record.proceedsTxHash === undefined
      ? {}
      : {
          proceedsTxHash: requireFeltText(
            record.proceedsTxHash,
            "lock proceeds transaction hash",
          ),
        }),
    ...(record.releaseTxHash === undefined
      ? {}
      : {
          releaseTxHash: requireFeltText(
            record.releaseTxHash,
            "lock release transaction hash",
          ),
        }),
    ...(record.quoteDigest === undefined
      ? {}
      : {
          quoteDigest: requireHex32(record.quoteDigest, "lock quoteDigest"),
        }),
  });
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

function cloneLocks(
  records: ReadonlyMap<string, StoredLockRecord>,
): Map<string, StoredLockRecord> {
  return new Map(
    [...records.entries()].map(([id, record]) => [
      id,
      deserializeStoredLock(serializeStoredLock(record)),
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
  #locks = new Map<string, StoredLockRecord>();
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

  listLocks(): readonly StoredLockRecord[] {
    return [...this.#locks.values()].map((record) =>
      deserializeStoredLock(serializeStoredLock(record)),
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
        this.#appendSnapshot(draft, cloneLocks(this.#locks));
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
    this.#tail = run.catch(() => undefined);
    await run;
    return result;
  }

  async lockTransaction<T>(
    mutate: (
      draft: Map<string, StoredLockRecord>,
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
      let draft: Map<string, StoredLockRecord>;
      try {
        draft = cloneLocks(this.#locks);
      } catch (error) {
        this.#failed = true;
        throw new MakerNodeError(
          "Reservation WAL serialization failed; the store is fail-stopped.",
          { cause: error },
        );
      }
      try {
        const value = await mutate(draft, this.#sequence + 1);
        this.#appendSnapshot(cloneRecords(this.#records), draft);
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
        if (statSync(this.#lockPath).size > MAX_LOCK_FILE_BYTES) {
          throw new MakerNodeError("Reservation WAL lock file is invalid.");
        }
        return JSON.parse(readFileSync(this.#lockPath, "utf8")) as {
          pid?: number;
        };
      } catch (error) {
        if (error instanceof MakerNodeError) throw error;
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
      const nextLocks = new Map<string, StoredLockRecord>();
      for (const wire of entry.payload.locks ?? []) {
        const record = deserializeStoredLock(wire);
        if (nextLocks.has(record.lockId)) {
          throw new MakerNodeError(
            `Reservation WAL line ${index + 1} repeats lock ${record.lockId}.`,
          );
        }
        nextLocks.set(record.lockId, record);
      }
      this.#records = next;
      this.#locks = nextLocks;
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

  #appendSnapshot(
    records: Map<string, StoredMakerReservation>,
    locks: Map<string, StoredLockRecord>,
  ): void {
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
        locks: [...locks.values()]
          .sort((left, right) => left.lockId.localeCompare(right.lockId))
          .map(serializeStoredLock),
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
      this.#locks = locks;
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
  if (
    normalized.length > MAX_FELT_HEX_LENGTH ||
    !FELT_HEX_PATTERN.test(normalized)
  )
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

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function schedulesMatch(left: PriceSchedule, right: PriceSchedule): boolean {
  try {
    assertPriceSchedule(left);
    assertPriceSchedule(right);
    return (
      left.length === right.length &&
      left.every(
        (point, index) =>
          point.a === right[index]!.a && point.b === right[index]!.b,
      )
    );
  } catch {
    return false;
  }
}

function requireOpenChainLock(
  chain: MakerOnChainLock,
  record: StoredLockRecord,
): MakerOnChainLock {
  if (!chain || chain.status !== "open") {
    throw new MakerNodeError("Escrow lock is not open on chain.");
  }
  assertPriceSchedule(chain.schedule);
  requireTimestamp(chain.expiry, "on-chain lock expiry");
  requireNonnegativeAmount(chain.remainingB, "on-chain remaining collateral");
  requireNonnegativeAmount(chain.earnedA, "on-chain earned proceeds");
  const takenB = record.maxB - chain.remainingB;
  if (
    takenB < 0n ||
    !sameFelt(chain.rfqId, record.rfqFelt) ||
    !sameFelt(chain.takerCommitment, record.takerCommitment) ||
    !sameFelt(chain.tokenA, record.tokenA) ||
    !sameFelt(chain.tokenB, record.tokenB) ||
    chain.expiry !== record.expiry ||
    !schedulesMatch(chain.schedule, record.schedule) ||
    !sameFelt(chain.ticket, record.ticket)
  ) {
    throw new MakerNodeError(
      "On-chain lock does not match its durable maker binding.",
    );
  }
  return chain;
}

function lockStateFromChain(
  record: StoredLockRecord,
  chain: MakerOnChainLock,
  now: number,
): StoredLockRecord {
  const open = requireOpenChainLock(chain, record);
  const proceedsComplete = open.earnedA === 0n || open.proceedsSettled;
  const collateralComplete = open.remainingB === 0n || open.collateralReleased;
  const state: LockRecordV1State =
    proceedsComplete && collateralComplete
      ? "settled"
      : now >= record.expiry
        ? "expired"
        : open.earnedA > 0n
          ? "taken"
          : "open";
  return canonicalStoredLock({
    ...record,
    state,
    takenA: open.earnedA,
    takenB: record.maxB - open.remainingB,
    settlingAction: undefined,
  });
}

function publicLockRecord(record: StoredLockRecord): LockRecordV1 {
  const canonical = canonicalStoredLock(record);
  return Object.freeze({
    lockId: canonical.lockId,
    rfqDigest: canonical.rfqDigest,
    rfqFelt: canonical.rfqFelt,
    takerCommitment: canonical.takerCommitment,
    tokenA: canonical.tokenA,
    tokenB: canonical.tokenB,
    schedule: canonical.schedule,
    maxB: canonical.maxB,
    expiry: canonical.expiry,
    ticket: canonical.ticket,
    lockTxHash: canonical.lockTxHash,
    state: canonical.state,
    takenA: canonical.takenA,
    takenB: canonical.takenB,
    ...(canonical.proceedsTxHash === undefined
      ? {}
      : { proceedsTxHash: canonical.proceedsTxHash }),
    ...(canonical.releaseTxHash === undefined
      ? {}
      : { releaseTxHash: canonical.releaseTxHash }),
    ...(canonical.quoteDigest === undefined
      ? {}
      : { quoteDigest: canonical.quoteDigest }),
  });
}

function unsignedQuoteV3For(
  record: StoredLockRecord,
  config: MakerNodeConfig,
): UnsignedSolverQuoteV3 {
  return {
    domain: QUOTE_V3_DOMAIN,
    version: 3,
    solverId: config.makerId,
    quoteKeyId: config.solverKey,
    nonce: record.nonce,
    pool: config.pool,
    helper: config.helper,
    escrowAddress: config.helper,
    rfqDigest: record.rfqDigest,
    rfqFelt: record.rfqFelt,
    sellToken: record.tokenA,
    buyToken: record.tokenB,
    schedule: record.schedule,
    lockId: record.lockId,
    lockTicket: record.ticket,
    lockTransactionHash: record.lockTxHash,
    lockExpiresAt: record.expiry,
    spreadBps: record.spreadBps,
    pricingProvenance: record.pricingProvenance,
    quotedAt: record.quotedAt,
    quoteExpiresAt: record.expiry,
  };
}

function quoteV3Refusal(
  code: MakerQuoteV3RefusalCode,
  reason: string,
): MakerQuoteV3Result {
  return Object.freeze({
    refused: Object.freeze({ code, reason: requireText(reason, "reason") }),
  });
}

function settlingActionConfirmed(
  record: StoredLockRecord,
  chain: MakerOnChainLock,
): boolean {
  if (record.state !== "settling") return true;
  if (record.settlingAction === "release") return chain.collateralReleased;
  if (record.settlingAction === "proceeds") return chain.proceedsSettled;
  return (
    (chain.earnedA === 0n || chain.proceedsSettled) &&
    (chain.remainingB === 0n || chain.collateralReleased)
  );
}

function terminalLockState(state: LockRecordV1State): boolean {
  return state === "settled" || state === "quarantined";
}

export class DurableMakerNode {
  readonly #store: DurableReservationStore;
  readonly #config: MakerNodeConfig;

  constructor(store: DurableReservationStore, config: MakerNodeConfig) {
    this.#store = store;
    if (config.v3) {
      if (config.pool !== "starknet:APP20_LOCALNET") {
        throw new MakerNodeError(
          "RFQ v3 maker support is restricted to APP20 localnet.",
        );
      }
      if (typeof config.v3.midE18 !== "bigint" || config.v3.midE18 <= 0n) {
        throw new MakerNodeError("Maker v3 midE18 must be positive.");
      }
      if (
        typeof config.v3.tokenSymbol !== "function" ||
        typeof config.v3.buildSchedule !== "function" ||
        typeof config.v3.economicPolicy?.evaluate !== "function" ||
        typeof config.v3.transcriptJournal?.append !== "function" ||
        typeof config.v3.transcriptJournal?.list !== "function" ||
        (config.v3.clock !== undefined && typeof config.v3.clock !== "function")
      ) {
        throw new MakerNodeError("Maker v3 configuration is incomplete.");
      }
      if (
        typeof config.wallet.lock !== "function" ||
        typeof config.wallet.getLock !== "function" ||
        typeof config.wallet.settleProceeds !== "function" ||
        typeof config.wallet.releaseCollateral !== "function"
      ) {
        throw new MakerNodeError(
          "Maker v3 requires lock reads and both settlement wallet actions.",
        );
      }
    }
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

  listLocks(): readonly LockRecordV1Wire[] {
    return this.#store
      .listLocks()
      .map((record) => encodeLockRecordV1(publicLockRecord(record)));
  }

  listTranscripts(): readonly MakerTranscriptRecord[] {
    return this.#v3().transcriptJournal.list();
  }

  async indicativeMid(now: number): Promise<MakerIndicativeMidV1> {
    requireTimestamp(now, "now");
    const v3 = this.#v3();
    const unsigned = {
      version: 1 as const,
      domain: MAKER_MID_DOMAIN,
      makerId: this.#config.makerId,
      quoteKeyId: this.#config.solverKey,
      marketId: "STRK_USDC" as const,
      midE18: v3.midE18,
      observedAt: now,
      validUntil: now + 30,
    };
    const signature = requireText(
      await this.#config.signer(canonicalMakerMid(unsigned)),
      "maker mid signature",
    );
    if (!isCanonicalQuoteSignature(signature)) {
      throw new MakerNodeError(
        "Maker mid signer returned a non-canonical P-256 signature.",
      );
    }
    return Object.freeze({ ...unsigned, signature });
  }

  async journalTranscript(
    transcript: SelectionTranscriptV1,
    now: number,
  ): Promise<
    Readonly<{ accepted: true; consistent: boolean; reason?: string }>
  > {
    requireTimestamp(now, "now");
    const v3 = this.#v3();
    const own = this.#store
      .listLocks()
      .find(
        (record) =>
          record.rfqDigest === transcript.rfqDigest.toLowerCase() &&
          record.quoteDigest !== undefined,
      );
    const verification = own
      ? await verifySelectionTranscriptForMaker(transcript, {
          makerId: this.#config.makerId,
          ownQuoteDigest: own.quoteDigest!,
          ownUnitPriceE18: scheduleUnitPriceE18(
            own.schedule,
            own.schedule[own.schedule.length - 1]!.a,
          ),
        })
      : Object.freeze({
          consistent: false,
          reason: "Maker has no signed quote for this RFQ digest.",
        });
    const record = v3.transcriptJournal.append(transcript, verification, now);
    return Object.freeze({
      accepted: true,
      consistent: record.consistent,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
    });
  }

  async quoteV3(rfq: PrivateRfqV2, now: number): Promise<MakerQuoteV3Result> {
    requireTimestamp(now, "now");
    assertPrivateRfqV2(rfq);
    const v3 = this.#v3();
    if (
      rfq.chainId !== this.#config.pool ||
      !sameFelt(rfq.settlementHelper, this.#config.helper)
    ) {
      throw new MakerNodeError(
        "RFQ v2 does not match this maker's localnet settlement context.",
      );
    }
    if (rfq.responseDeadline <= now || rfq.expiresAt <= now) {
      return quoteV3Refusal("expired", "RFQ response or lock window expired.");
    }
    const quoteTtlSeconds = rfq.lockExpiresAt - now;
    if (
      rfq.lockExpiresAt - rfq.createdAt > 90 ||
      quoteTtlSeconds <= 0 ||
      quoteTtlSeconds > 90
    ) {
      return quoteV3Refusal(
        "policy",
        "RFQ lock TTL must not exceed 90 seconds.",
      );
    }
    const bucketSymbol = v3.tokenSymbol(rfq.sellToken);
    if (!bucketSymbol) {
      return quoteV3Refusal(
        "policy",
        "Maker supports only the reviewed STRK/USDC market.",
      );
    }
    try {
      assertLadderBucket(bucketSymbol, {
        min: rfq.sellBucketMinBaseUnits,
        max: rfq.sellBucketMaxBaseUnits,
      });
    } catch (error) {
      return quoteV3Refusal(
        "bucket",
        error instanceof Error
          ? error.message
          : "RFQ size bucket is not reviewed.",
      );
    }
    const rfqDigest = await digestPrivateRfqV2(rfq);
    const acquisition = await this.#store.lockTransaction(async (draft) => {
      const prior = [...draft.values()].find(
        (record) => record.rfqDigest === rfqDigest,
      );
      if (prior) {
        if (
          prior.signature &&
          prior.quoteDigest &&
          prior.state === "open" &&
          prior.takenA === 0n &&
          prior.takenB === 0n &&
          prior.expiry > now
        ) {
          return { kind: "existing" as const, record: prior };
        }
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            "RFQ digest is fenced by its durable lock history.",
          ),
        };
      }
      let walletBalance: bigint;
      try {
        walletBalance = requireNonnegativeAmount(
          await this.#config.wallet.privateBalance(rfq.buyToken),
          "private inventory",
        );
      } catch {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "insufficient-inventory",
            "Private maker inventory is unavailable.",
          ),
        };
      }
      const unresolved = [...draft.values()]
        .filter(
          (record) =>
            (record.state === "locking" || record.state === "quarantined") &&
            sameFelt(record.tokenB, rfq.buyToken),
        )
        .reduce((total, record) => total + record.maxB, 0n);
      const legacyReserved = this.#store
        .list()
        .filter(
          (record) =>
            capacityLockedState(record.reservation.state) &&
            sameFelt(record.buyToken, rfq.buyToken),
        )
        .reduce((total, record) => total + record.buyAmount, 0n);
      const unavailable = unresolved + legacyReserved;
      const availableBuyInventory =
        walletBalance > unavailable ? walletBalance - unavailable : 0n;
      let built: MakerScheduleV3Result | null;
      try {
        built = await v3.buildSchedule({
          rfq,
          bucketSymbol,
          availableBuyInventory,
          now,
        });
      } catch (error) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            error instanceof Error
              ? error.message
              : "Maker schedule construction failed closed.",
          ),
        };
      }
      if (!built) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "insufficient-inventory",
            "Private maker inventory cannot cover the bucket minimum.",
          ),
        };
      }
      try {
        assertPriceSchedule(built.schedule);
        requireSpread(built.spreadBps);
        requireText(built.pricingProvenance, "pricing provenance");
      } catch (error) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            error instanceof Error
              ? error.message
              : "Maker produced an invalid schedule.",
          ),
        };
      }
      const first = built.schedule[0]!;
      const last = built.schedule[built.schedule.length - 1]!;
      if (
        first.a !== rfq.sellBucketMinBaseUnits ||
        last.a > rfq.sellBucketMaxBaseUnits ||
        last.b > availableBuyInventory
      ) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            last.b > availableBuyInventory
              ? "insufficient-inventory"
              : "policy",
            "Maker schedule is outside the authenticated bucket or inventory cap.",
          ),
        };
      }
      const economicInput: MakerEconomicPolicyV3Input = Object.freeze({
        rfq,
        rfqDigest,
        schedule: built.schedule,
        amountA: last.a,
        amountB: last.b,
        quoteTtlSeconds,
        now,
      });
      let decision: Awaited<
        ReturnType<MakerNodeV3Config["economicPolicy"]["evaluate"]>
      >;
      try {
        decision = await v3.economicPolicy.evaluate(economicInput);
      } catch (error) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            error instanceof Error
              ? error.message
              : "RFQ economic policy was unavailable.",
          ),
        };
      }
      if (!decision || typeof decision.allowed !== "boolean") {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            "RFQ economic policy returned an invalid decision.",
          ),
        };
      }
      if (!decision.allowed) {
        const reason =
          typeof decision.reason === "string" && decision.reason.trim()
            ? decision.reason
            : "RFQ economic policy refused the schedule.";
        return {
          kind: "refused" as const,
          result: quoteV3Refusal("policy", reason),
        };
      }
      if (
        v3.economicPolicy.commit &&
        (typeof decision.commitmentUsdcBaseUnits !== "bigint" ||
          decision.commitmentUsdcBaseUnits <= 0n)
      ) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            "RFQ economic policy did not produce a durable commitment amount.",
          ),
        };
      }
      const randomFelt =
        v3.randomFelt ?? (() => `0x${randomBytes(31).toString("hex")}`);
      const randomNonce =
        v3.randomNonce ?? (() => `0x${randomBytes(32).toString("hex")}`);
      let candidateValue: bigint;
      let nonce: string;
      try {
        candidateValue = BigInt(requireFeltText(randomFelt(), "lockId"));
        nonce = requireHex32(randomNonce(), "lock nonce");
      } catch {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            "Maker lock identity generator returned invalid output.",
          ),
        };
      }
      if (candidateValue === 0n || candidateValue >= STARK_FIELD_PRIME) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            "Maker lock identity generator returned an invalid felt.",
          ),
        };
      }
      const lockId = `0x${candidateValue.toString(16)}`;
      if (draft.has(lockId)) {
        return {
          kind: "refused" as const,
          result: quoteV3Refusal(
            "policy",
            "Maker lock identity collided with durable history.",
          ),
        };
      }
      const record = canonicalStoredLock({
        lockId,
        rfqDigest,
        rfqFelt: rfq.rfqFelt,
        takerCommitment: rfq.takerCommitment,
        tokenA: rfq.sellToken,
        tokenB: rfq.buyToken,
        schedule: built.schedule,
        maxB: last.b,
        expiry: rfq.lockExpiresAt,
        ticket: "0x0",
        lockTxHash: "0x0",
        state: "locking",
        takenA: 0n,
        takenB: 0n,
        nonce,
        quotedAt: now,
        spreadBps: built.spreadBps,
        pricingProvenance: built.pricingProvenance,
      });
      draft.set(lockId, record);
      return {
        kind: "new" as const,
        record,
        economicInput,
        commitmentUsdcBaseUnits: decision.commitmentUsdcBaseUnits,
      };
    });
    if (acquisition.kind === "refused") return acquisition.result;
    if (acquisition.kind === "existing") {
      const unsigned = unsignedQuoteV3For(acquisition.record, this.#config);
      const quote = Object.freeze({
        ...unsigned,
        signature: acquisition.record.signature!,
      });
      canonicalSolverQuoteV3(quote);
      return Object.freeze({
        quote,
        lock: Object.freeze({
          lockId: acquisition.record.lockId,
          ticket: acquisition.record.ticket,
          transactionHash: acquisition.record.lockTxHash,
        }),
      });
    }

    const walletLock = this.#config.wallet.lock!;
    let confirmed: StoredLockRecord;
    try {
      const result = await walletLock({
        lockId: acquisition.record.lockId,
        rfqFelt: acquisition.record.rfqFelt,
        takerCommitment: acquisition.record.takerCommitment,
        tokenA: acquisition.record.tokenA,
        tokenB: acquisition.record.tokenB,
        schedule: acquisition.record.schedule,
        expiry: acquisition.record.expiry,
      });
      const ticket = requireFeltText(result.ticket, "lock ticket");
      const lockTxHash = requireFeltText(
        result.transactionHash,
        "lock transaction hash",
      );
      if (BigInt(ticket) === 0n || BigInt(lockTxHash) === 0n) {
        throw new MakerNodeError(
          "Confirmed lock omitted its ticket or transaction hash.",
        );
      }
      confirmed = lockStateFromChain(
        canonicalStoredLock({
          ...acquisition.record,
          ticket,
          lockTxHash,
          state: "open",
        }),
        result.lock,
        now,
      );
      if (
        confirmed.state !== "open" ||
        confirmed.takenA !== 0n ||
        confirmed.takenB !== 0n
      ) {
        throw new MakerNodeError(
          "New on-chain lock was not fully collateralized and untouched.",
        );
      }
      await this.#store.lockTransaction((draft) => {
        const current = draft.get(confirmed.lockId);
        if (!current || current.state !== "locking") {
          throw new MakerNodeError(
            "Durable lock changed during on-chain submission.",
          );
        }
        draft.set(confirmed.lockId, confirmed);
      });
    } catch (error) {
      const knownRevert =
        error instanceof MakerWalletOperationError &&
        error.outcome === "reverted";
      await this.#store.lockTransaction((draft) => {
        const current = draft.get(acquisition.record.lockId);
        if (!current) return;
        if (knownRevert) draft.delete(current.lockId);
        else draft.set(current.lockId, { ...current, state: "quarantined" });
      });
      return quoteV3Refusal(
        "lock-failed",
        knownRevert
          ? "On-chain lock transaction reverted."
          : "On-chain lock outcome is unknown; collateral was quarantined.",
      );
    }

    let completedAt: number;
    try {
      completedAt = requireTimestamp(
        v3.clock?.() ?? now,
        "quote completion time",
      );
    } catch {
      return quoteV3Refusal(
        "lock-failed",
        "Maker clock was unavailable after lock confirmation.",
      );
    }
    if (completedAt >= confirmed.expiry) {
      return quoteV3Refusal(
        "expired",
        "RFQ lock expired before quote signing completed.",
      );
    }

    if (
      v3.economicPolicy.commit &&
      acquisition.commitmentUsdcBaseUnits !== undefined
    ) {
      try {
        await v3.economicPolicy.commit({
          ...acquisition.economicInput,
          lockId: confirmed.lockId,
          commitmentUsdcBaseUnits: acquisition.commitmentUsdcBaseUnits,
        });
      } catch (error) {
        return quoteV3Refusal(
          "policy",
          error instanceof Error
            ? error.message
            : "RFQ economic commitment failed closed.",
        );
      }
    }

    const unsigned = unsignedQuoteV3For(confirmed, this.#config);
    let signature: string;
    try {
      signature = requireText(
        await this.#config.signer(canonicalSolverQuoteV3(unsigned)),
        "quote v3 signature",
      );
      if (!isCanonicalQuoteSignature(signature)) {
        throw new MakerNodeError(
          "Quote v3 signer returned a non-canonical P-256 signature.",
        );
      }
    } catch (error) {
      return quoteV3Refusal(
        "lock-failed",
        error instanceof Error ? error.message : "Quote v3 signing failed.",
      );
    }
    if (v3.clock) {
      let signedAt: number;
      try {
        signedAt = requireTimestamp(v3.clock(), "quote signing time");
      } catch {
        return quoteV3Refusal(
          "lock-failed",
          "Maker clock was unavailable after quote signing.",
        );
      }
      if (signedAt >= confirmed.expiry) {
        return quoteV3Refusal(
          "expired",
          "RFQ lock expired before quote signing completed.",
        );
      }
    }
    const quote = Object.freeze({ ...unsigned, signature });
    const quoteDigestValue = await digestSolverQuoteV3(quote);
    await this.#store.lockTransaction((draft) => {
      const current = draft.get(confirmed.lockId);
      if (
        !current ||
        terminalLockState(current.state) ||
        current.lockTxHash !== confirmed.lockTxHash
      ) {
        throw new MakerNodeError(
          "Confirmed lock changed before quote signing completed.",
        );
      }
      draft.set(current.lockId, {
        ...current,
        signature,
        quoteDigest: quoteDigestValue,
      });
    });
    return Object.freeze({
      quote,
      lock: Object.freeze({
        lockId: confirmed.lockId,
        ticket: confirmed.ticket,
        transactionHash: confirmed.lockTxHash,
      }),
    });
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
    if (this.#store.listLocks().length === 0) return;
    const getLock = this.#v3Wallet().getLock;
    for (const record of this.#store.listLocks()) {
      if (terminalLockState(record.state)) continue;
      try {
        const chain = await getLock(record.lockId);
        if (chain.status !== "open") {
          await this.#quarantineLock(record.lockId);
          continue;
        }
        const candidate =
          record.state === "locking"
            ? canonicalStoredLock({ ...record, ticket: chain.ticket })
            : record;
        const open = requireOpenChainLock(chain, candidate);
        if (!settlingActionConfirmed(record, open)) {
          await this.#quarantineLock(record.lockId);
          continue;
        }
        const recovered = lockStateFromChain(candidate, open, now);
        await this.#store.lockTransaction((draft) => {
          const current = draft.get(record.lockId);
          if (current && !terminalLockState(current.state)) {
            draft.set(record.lockId, recovered);
          }
        });
      } catch {
        await this.#quarantineLock(record.lockId);
      }
    }
  }

  async settleExpiredLocks(now: number): Promise<void> {
    requireTimestamp(now, "now");
    for (const snapshot of this.#store.listLocks()) {
      if (terminalLockState(snapshot.state) || snapshot.expiry > now) continue;
      await this.#settleExpiredLock(snapshot.lockId, now);
    }
  }

  async #settleExpiredLock(lockId: string, now: number): Promise<void> {
    const wallet = this.#v3Wallet();
    let record = this.#store
      .listLocks()
      .find((candidate) => candidate.lockId === lockId);
    if (!record || terminalLockState(record.state)) return;
    let chain: MakerOnChainLock;
    try {
      chain = await wallet.getLock(lockId);
      if (chain.status !== "open") {
        await this.#quarantineLock(lockId);
        return;
      }
      const candidate =
        record.state === "locking"
          ? canonicalStoredLock({ ...record, ticket: chain.ticket })
          : record;
      const open = requireOpenChainLock(chain, candidate);
      if (!settlingActionConfirmed(record, open)) {
        await this.#quarantineLock(lockId);
        return;
      }
      record = lockStateFromChain(candidate, open, now);
      await this.#store.lockTransaction((draft) => {
        if (draft.has(lockId)) draft.set(lockId, record!);
      });
      chain = open;
    } catch {
      return;
    }
    if (record.state === "settled") return;

    if (chain.earnedA > 0n && !chain.proceedsSettled) {
      await this.#store.lockTransaction((draft) => {
        const current = draft.get(lockId);
        if (current && !terminalLockState(current.state)) {
          draft.set(lockId, {
            ...current,
            state: "settling",
            settlingAction: "proceeds",
          });
        }
      });
      let transactionHash: string;
      try {
        transactionHash = requireFeltText(
          (
            await wallet.settleProceeds({
              lockId,
              ticket: record.ticket,
              outputToken: record.tokenA,
            })
          ).transactionHash,
          "proceeds transaction hash",
        );
        if (BigInt(transactionHash) === 0n) {
          throw new MakerNodeError("Proceeds settlement returned a zero hash.");
        }
      } catch (error) {
        if (
          error instanceof MakerWalletOperationError &&
          error.outcome === "reverted"
        ) {
          await this.#resetKnownRevertedSettlement(lockId, now);
        } else {
          await this.#quarantineLock(lockId);
        }
        return;
      }
      await this.#store.lockTransaction((draft) => {
        const current = draft.get(lockId);
        if (current && !terminalLockState(current.state)) {
          draft.set(lockId, {
            ...current,
            state: "settling",
            proceedsTxHash: transactionHash,
            settlingAction: "proceeds",
          });
        }
      });
      try {
        chain = await wallet.getLock(lockId);
        const current = this.#store
          .listLocks()
          .find((candidate) => candidate.lockId === lockId)!;
        const open = requireOpenChainLock(chain, current);
        if (!open.proceedsSettled) {
          await this.#quarantineLock(lockId);
          return;
        }
        record = lockStateFromChain(current, open, now);
        await this.#store.lockTransaction((draft) => {
          if (draft.has(lockId)) draft.set(lockId, record!);
        });
        chain = open;
      } catch {
        return;
      }
    }

    if (chain.remainingB > 0n && !chain.collateralReleased) {
      await this.#store.lockTransaction((draft) => {
        const current = draft.get(lockId);
        if (current && !terminalLockState(current.state)) {
          draft.set(lockId, {
            ...current,
            state: "settling",
            settlingAction: "release",
          });
        }
      });
      let transactionHash: string;
      try {
        transactionHash = requireFeltText(
          (
            await wallet.releaseCollateral({
              lockId,
              ticket: record.ticket,
              outputToken: record.tokenB,
            })
          ).transactionHash,
          "collateral transaction hash",
        );
        if (BigInt(transactionHash) === 0n) {
          throw new MakerNodeError("Collateral release returned a zero hash.");
        }
      } catch (error) {
        if (
          error instanceof MakerWalletOperationError &&
          error.outcome === "reverted"
        ) {
          await this.#resetKnownRevertedSettlement(lockId, now);
        } else {
          await this.#quarantineLock(lockId);
        }
        return;
      }
      await this.#store.lockTransaction((draft) => {
        const current = draft.get(lockId);
        if (current && !terminalLockState(current.state)) {
          draft.set(lockId, {
            ...current,
            state: "settling",
            releaseTxHash: transactionHash,
            settlingAction: "release",
          });
        }
      });
      try {
        chain = await wallet.getLock(lockId);
        const current = this.#store
          .listLocks()
          .find((candidate) => candidate.lockId === lockId)!;
        const open = requireOpenChainLock(chain, current);
        if (!open.collateralReleased) {
          await this.#quarantineLock(lockId);
          return;
        }
        record = lockStateFromChain(current, open, now);
        await this.#store.lockTransaction((draft) => {
          if (draft.has(lockId)) draft.set(lockId, record!);
        });
      } catch {
        return;
      }
    }
  }

  async #resetKnownRevertedSettlement(
    lockId: string,
    now: number,
  ): Promise<void> {
    const record = this.#store
      .listLocks()
      .find((candidate) => candidate.lockId === lockId);
    if (!record) return;
    try {
      const chain = requireOpenChainLock(
        await this.#v3Wallet().getLock(lockId),
        record,
      );
      const refreshed = lockStateFromChain(record, chain, now);
      await this.#store.lockTransaction((draft) => {
        if (draft.has(lockId)) draft.set(lockId, refreshed);
      });
    } catch {
      await this.#quarantineLock(lockId);
    }
  }

  async #quarantineLock(lockId: string): Promise<void> {
    await this.#store.lockTransaction((draft) => {
      const current = draft.get(lockId);
      if (current && current.state !== "settled") {
        draft.set(lockId, { ...current, state: "quarantined" });
      }
    });
  }

  #v3(): MakerNodeV3Config {
    if (!this.#config.v3) {
      throw new MakerNodeError("Maker v3 is not configured.");
    }
    return this.#config.v3;
  }

  #v3Wallet(): Required<
    Pick<
      MakerWalletAdapter,
      "getLock" | "lock" | "releaseCollateral" | "settleProceeds"
    >
  > {
    this.#v3();
    return this.#config.wallet as Required<
      Pick<
        MakerWalletAdapter,
        "getLock" | "lock" | "releaseCollateral" | "settleProceeds"
      >
    >;
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
      const unresolvedLocks = this.#store
        .listLocks()
        .filter(
          (record) =>
            (record.state === "locking" || record.state === "quarantined") &&
            sameFelt(record.tokenB, request.buyToken),
        )
        .reduce((total, record) => total + record.maxB, 0n);
      if (
        reserved + unresolvedLocks >= walletBalance ||
        buyAmount > walletBalance - reserved - unresolvedLocks
      ) {
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
          typeof request.sellToken === "string" &&
          request.sellToken.length <= MAX_FELT_HEX_LENGTH &&
          current.sellToken.toLowerCase() === request.sellToken.toLowerCase() &&
          current.sellAmount === request.sellAmount &&
          typeof request.buyToken === "string" &&
          request.buyToken.length <= MAX_FELT_HEX_LENGTH &&
          current.buyToken.toLowerCase() === request.buyToken.toLowerCase() &&
          current.buyAmount === request.buyAmount &&
          Number.isSafeInteger(request.deadline) &&
          request.deadline === current.rfqExpiresAt &&
          typeof request.dealId === "string" &&
          request.dealId.length <= MAX_FELT_HEX_LENGTH &&
          typeof request.ticketAddress === "string" &&
          request.ticketAddress.length <= MAX_FELT_HEX_LENGTH &&
          FELT_HEX_PATTERN.test(request.dealId.toLowerCase()) &&
          FELT_HEX_PATTERN.test(request.ticketAddress.toLowerCase()) &&
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
export * from "./transcript-journal.ts";
export * from "#hpke-ingress";
export * from "#production-ports";
