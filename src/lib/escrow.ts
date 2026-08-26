import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ec, hash, num, shortString } from "starknet";
import { canonicalizeStarknetAddress, feltEquals } from "./addresses";
import {
  hasConsistentTokenMetadata,
  isPositiveBaseUnitAmount,
  normalizeTokenRef,
  type StorageLike,
  type TokenRef,
} from "./otc";
import { sanitizeUntrustedText } from "./text";

export const ESCROW_STORAGE_PREFIX = "app20/escrow/v1";
export const ESCROW_CLAIM_KEY_LABEL = "app20/escrow-claim/v1";
export const ESCROW_CLAIM_TAG = "APP20_ESCROW_CLAIM_V1";
export const ESCROW_CLAIM_OPERATION = "CLAIM";
export const ESCROW_TIMEOUT_OPERATION = "TIMEOUT";

const MAIL_SEED_BYTES = 32;
const CLAIM_KEY_BYTES = 32;
const DEAL_ID_BYTES = 32;
const MAX_TOKEN_DECIMALS = 255;
const U128_MAX = 2n ** 128n - 1n;
const U64_MAX = 2n ** 64n - 1n;
const CLAIM_KEY_SALT = new TextEncoder().encode(ESCROW_CLAIM_KEY_LABEL);

/** Stark-curve scalar order, distinct from the Starknet felt field modulus. */
export const STARK_CURVE_SCALAR_ORDER = ec.starkCurve.CURVE.n;
export const STARK_FIELD_PRIME = ec.starkCurve.CURVE.p;

export type EscrowLeg = {
  token: TokenRef;
  amount: string;
};

/** Encrypted announcement for a Fund operation. Contract state remains authoritative. */
export type EscrowFundPayload = {
  dealId: string;
  escrowAddress: string;
  maker: string;
  legA: EscrowLeg;
  legB: EscrowLeg;
  deadline: number;
  /** V2 claim-ticket contract. Mail seeds cannot spend this private note. */
  ticket?: string;
  /** Historical V1 display alias; equals `ticket` for V2 payloads. */
  claimPubkey: string;
  note?: string;
};

export type EscrowFillPayload = {
  dealId: string;
  escrowAddress: string;
};

export type EscrowClaimPayload = {
  dealId: string;
  escrowAddress: string;
};

export type EscrowTimeoutPayload = {
  dealId: string;
  escrowAddress: string;
};

export type EscrowEnvelopePayload =
  | EscrowFundPayload
  | EscrowFillPayload
  | EscrowClaimPayload
  | EscrowTimeoutPayload;

export type EscrowContractStatus =
  | "empty"
  | "funded"
  | "filled"
  | "settled"
  | "timed_out";

export type EscrowContractDeal = {
  legAToken: string;
  legAAmount: string;
  legBToken: string;
  legBTerms: string;
  legBAmount: string;
  deadline: number;
  ticket: string;
  /** Compatibility alias for historical V1 display paths. */
  claimPubkey: string;
  status: EscrowContractStatus;
};

export type EscrowOperation = "fund" | "fill" | "claim" | "timeout";
export type EscrowOperationState =
  | "reserved"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "unknown";

export type EscrowOperationRecord = {
  state: EscrowOperationState;
  transactionHash?: string;
  updatedAt: number;
};

export type EscrowDealRecord = {
  dealId: string;
  fund: EscrowFundPayload;
  chainStatus?: EscrowContractStatus;
  chainDeal?: EscrowContractDeal;
  operations: Partial<Record<EscrowOperation, EscrowOperationRecord>>;
  /** Decrypted update envelopes are coordination hints, never chain proof. */
  counterpartyClaims: Partial<
    Record<Exclude<EscrowOperation, "fund">, boolean>
  >;
  updatedAt: number;
};

export type EscrowState = {
  version: 1;
  deals: Record<string, EscrowDealRecord>;
};

export type EscrowClaimKey = {
  /** Ephemeral only. Never persist or log this scalar. */
  privateKey: Uint8Array;
  claimPubkey: string;
  derivationAttempt: number;
};

export type EscrowSignature = { sigR: string; sigS: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function parseFelt(value: unknown, allowZero = true): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = BigInt(value);
    if (
      parsed < 0n ||
      parsed >= STARK_FIELD_PRIME ||
      (!allowZero && parsed === 0n)
    ) {
      return null;
    }
    return num.toHex(parsed);
  } catch {
    return null;
  }
}

function parseAddress(value: unknown, allowZero = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const address = canonicalizeStarknetAddress(value);
    if (!allowZero && BigInt(address) === 0n) return null;
    return address;
  } catch {
    return null;
  }
}

function parseTokenRef(value: unknown): TokenRef | null {
  if (!isObject(value)) return null;
  const address = parseAddress(value.address);
  const symbol =
    typeof value.symbol === "string"
      ? sanitizeUntrustedText(value.symbol).trim()
      : "";
  if (
    !address ||
    !symbol ||
    typeof value.symbol !== "string" ||
    value.symbol.length > 32 ||
    symbol.length > 32 ||
    !Number.isInteger(value.decimals) ||
    (value.decimals as number) < 0 ||
    (value.decimals as number) > MAX_TOKEN_DECIMALS
  ) {
    return null;
  }
  const token = {
    address,
    symbol,
    decimals: value.decimals as number,
  };
  return hasConsistentTokenMetadata(token) ? normalizeTokenRef(token) : null;
}

function parseLeg(value: unknown): EscrowLeg | null {
  if (!isObject(value)) return null;
  const token = parseTokenRef(value.token);
  if (
    !token ||
    !isPositiveBaseUnitAmount(value.amount) ||
    BigInt(value.amount) > U128_MAX
  ) {
    return null;
  }
  return { token, amount: value.amount };
}

function parseDeadline(value: unknown): number | null {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    BigInt(value as number) > U64_MAX
  ) {
    return null;
  }
  return value as number;
}

function parseNote(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 512) return null;
  return sanitizeUntrustedText(value);
}

export function parseEscrowFundPayload(
  value: unknown,
): EscrowFundPayload | null {
  if (!isObject(value)) return null;
  const dealId = parseFelt(value.dealId, false);
  const escrowAddress = parseAddress(value.escrowAddress);
  const maker = parseAddress(value.maker);
  const legA = parseLeg(value.legA);
  const legB = parseLeg(value.legB);
  const deadline = parseDeadline(value.deadline);
  const ticket = parseAddress(value.ticket);
  const claimPubkey = parseFelt(value.claimPubkey, false);
  const note = parseNote(value.note);
  if (
    !dealId ||
    !escrowAddress ||
    !maker ||
    !legA ||
    !legB ||
    !deadline ||
    (!ticket && !claimPubkey) ||
    Boolean(ticket && claimPubkey && !feltEquals(ticket, claimPubkey)) ||
    note === null ||
    feltEquals(legA.token.address, legB.token.address)
  ) {
    return null;
  }
  return {
    dealId,
    escrowAddress,
    maker,
    legA,
    legB,
    deadline,
    ...(ticket
      ? { ticket, claimPubkey: ticket }
      : { claimPubkey: claimPubkey! }),
    ...(note === undefined ? {} : { note }),
  };
}

function parseEscrowUpdatePayload(
  value: unknown,
): EscrowFillPayload | EscrowClaimPayload | EscrowTimeoutPayload | null {
  if (!isObject(value)) return null;
  const dealId = parseFelt(value.dealId, false);
  const escrowAddress = parseAddress(value.escrowAddress);
  return dealId && escrowAddress ? { dealId, escrowAddress } : null;
}

export const parseEscrowFillPayload = parseEscrowUpdatePayload;
export const parseEscrowClaimPayload = parseEscrowUpdatePayload;
export const parseEscrowTimeoutPayload = parseEscrowUpdatePayload;

/** Creates a non-zero 248-bit id, so it is always a valid felt252 without reduction. */
export function createEscrowDealId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(31));
  if (bytes.every((byte) => byte === 0)) bytes[30] = 1;
  return num.toHex(bytesToBigInt(bytes));
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(length * 8)) {
    throw new Error(`Value does not fit in ${length} bytes.`);
  }
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function assertMailSeed(mailSeed: Uint8Array): void {
  if (mailSeed.length !== MAIL_SEED_BYTES) {
    throw new Error(`Mail seed must be exactly ${MAIL_SEED_BYTES} bytes.`);
  }
}

function dealIdBytes(dealId: string): Uint8Array {
  const parsed = parseFelt(dealId, false);
  if (!parsed) throw new Error("Escrow deal id must be a non-zero felt252.");
  return bigIntToBytes(BigInt(parsed), DEAL_ID_BYTES);
}

function counterBytes(counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffff_ffff) {
    throw new Error("Claim-key derivation counter overflowed u32.");
  }
  return Uint8Array.of(
    (counter >>> 24) & 0xff,
    (counter >>> 16) & 0xff,
    (counter >>> 8) & 0xff,
    counter & 0xff,
  );
}

/**
 * Derives the per-deal Stark claim key from the mailbox seed.
 *
 * Frozen v1 encoding: HKDF-SHA256 IKM is the raw 32-byte mail seed, salt is
 * UTF-8 `app20/escrow-claim/v1`, and info is deal_id as 32-byte big-endian
 * followed by a u32 big-endian attempt counter (present from attempt zero).
 * The 32-byte OKM has only its four excess high bits cleared, producing a
 * uniform 252-bit candidate. Zero and candidates >= the Stark scalar order are
 * rejected and re-derived. There is no modular scalar reduction and no bias.
 * Changing any of these details breaks existing claims and requires a new label.
 */
export function deriveEscrowClaimKey(
  mailSeed: Uint8Array,
  dealId: string,
): EscrowClaimKey {
  assertMailSeed(mailSeed);
  const deal = dealIdBytes(dealId);

  for (let attempt = 0; attempt <= 0xffff_ffff; attempt += 1) {
    const info = concatBytes(deal, counterBytes(attempt));
    const candidateBytes = hkdf(
      sha256,
      mailSeed,
      CLAIM_KEY_SALT,
      info,
      CLAIM_KEY_BYTES,
    );
    // This masks only the excess bits of the sampling space. It does not reduce
    // a scalar; out-of-range candidates are rejected below.
    candidateBytes[0] &= 0x0f;
    const candidate = bytesToBigInt(candidateBytes);
    if (candidate === 0n || candidate >= STARK_CURVE_SCALAR_ORDER) continue;

    const privateKey = candidateBytes.slice();
    return {
      privateKey,
      claimPubkey: num.toHex(ec.starkCurve.getStarkKey(num.toHex(candidate))),
      derivationAttempt: attempt,
    };
  }

  throw new Error("Could not derive an in-range escrow claim key.");
}

export type EscrowPayoutOperation = "claim" | "timeout";

/** Mirrors App20Escrow.compute_claim_message exactly. */
export function computeEscrowClaimMessage(
  escrowAddress: string,
  dealId: string,
  operation: EscrowPayoutOperation,
  noteId: string,
): string {
  const escrow = parseAddress(escrowAddress);
  const deal = parseFelt(dealId, false);
  const note = parseFelt(noteId);
  if (!escrow || !deal || !note) {
    throw new Error(
      "Escrow address, deal id, and payout note id must be felts.",
    );
  }
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString(ESCROW_CLAIM_TAG),
    escrow,
    deal,
    shortString.encodeShortString(
      operation === "claim" ? ESCROW_CLAIM_OPERATION : ESCROW_TIMEOUT_OPERATION,
    ),
    note,
  ]);
}

export function signEscrowPayout(
  mailSeed: Uint8Array,
  escrowAddress: string,
  dealId: string,
  operation: EscrowPayoutOperation,
  noteId: string,
): EscrowSignature {
  const claimKey = deriveEscrowClaimKey(mailSeed, dealId);
  try {
    const signature = ec.starkCurve.sign(
      computeEscrowClaimMessage(escrowAddress, dealId, operation, noteId),
      claimKey.privateKey,
    );
    return { sigR: num.toHex(signature.r), sigS: num.toHex(signature.s) };
  } finally {
    claimKey.privateKey.fill(0);
  }
}

const CONTRACT_STATUSES: EscrowContractStatus[] = [
  "empty",
  "funded",
  "filled",
  "settled",
  "timed_out",
];

export function parseEscrowContractDeal(
  result: readonly string[],
): EscrowContractDeal {
  if (result.length !== 8) {
    throw new Error("Escrow get_deal returned an unexpected shape.");
  }
  const statusIndex = Number(BigInt(result[7]));
  const status = CONTRACT_STATUSES[statusIndex];
  const deadlineValue = BigInt(result[5]);
  if (!status || deadlineValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Escrow get_deal returned invalid values.");
  }
  return {
    legAToken: canonicalizeStarknetAddress(result[0]),
    legAAmount: BigInt(result[1]).toString(),
    legBToken: canonicalizeStarknetAddress(result[2]),
    legBTerms: BigInt(result[3]).toString(),
    legBAmount: BigInt(result[4]).toString(),
    deadline: Number(deadlineValue),
    ticket: canonicalizeStarknetAddress(result[6]),
    claimPubkey: num.toHex(result[6]),
    status,
  };
}

export function contractDealMatchesFund(
  deal: EscrowContractDeal,
  fund: EscrowFundPayload,
): boolean {
  return (
    feltEquals(deal.legAToken, fund.legA.token.address) &&
    deal.legAAmount === fund.legA.amount &&
    feltEquals(deal.legBToken, fund.legB.token.address) &&
    deal.legBTerms === fund.legB.amount &&
    deal.deadline === fund.deadline &&
    (fund.ticket
      ? feltEquals(deal.ticket, fund.ticket)
      : feltEquals(deal.claimPubkey, fund.claimPubkey))
  );
}

export function emptyEscrowState(): EscrowState {
  return { version: 1, deals: {} };
}

export function escrowStorageKey(chainId: string, selfAddress: string): string {
  return `${ESCROW_STORAGE_PREFIX}/${chainId}/${selfAddress}`;
}

export function loadEscrowState(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
): EscrowState {
  const serialized = storage.getItem(escrowStorageKey(chainId, selfAddress));
  if (!serialized) return emptyEscrowState();
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isObject(value) || value.version !== 1 || !isObject(value.deals)) {
      return emptyEscrowState();
    }
    return {
      version: 1,
      deals: value.deals as Record<string, EscrowDealRecord>,
    };
  } catch {
    return emptyEscrowState();
  }
}

function saveEscrowState(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  state: EscrowState,
): void {
  storage.setItem(
    escrowStorageKey(chainId, selfAddress),
    JSON.stringify(state),
  );
}

export function recordEscrowFund(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  payload: EscrowFundPayload,
  at = nowSeconds(),
): EscrowDealRecord {
  const fund = parseEscrowFundPayload(payload);
  if (!fund) throw new Error("Invalid escrow Fund envelope.");
  const state = loadEscrowState(storage, chainId, selfAddress);
  const existing = state.deals[fund.dealId];
  if (existing) {
    const prior = existing.fund;
    if (
      !feltEquals(prior.escrowAddress, fund.escrowAddress) ||
      !feltEquals(prior.maker, fund.maker) ||
      !feltEquals(prior.legA.token.address, fund.legA.token.address) ||
      prior.legA.token.symbol !== fund.legA.token.symbol ||
      prior.legA.token.decimals !== fund.legA.token.decimals ||
      prior.legA.amount !== fund.legA.amount ||
      !feltEquals(prior.legB.token.address, fund.legB.token.address) ||
      prior.legB.token.symbol !== fund.legB.token.symbol ||
      prior.legB.token.decimals !== fund.legB.token.decimals ||
      prior.legB.amount !== fund.legB.amount ||
      prior.deadline !== fund.deadline ||
      prior.ticket !== fund.ticket ||
      prior.claimPubkey !== fund.claimPubkey ||
      prior.note !== fund.note
    ) {
      throw new Error("Cannot replace an existing escrow deal announcement.");
    }
    return existing;
  }
  const record: EscrowDealRecord = {
    dealId: fund.dealId,
    fund,
    operations: {},
    counterpartyClaims: {},
    updatedAt: at,
  };
  state.deals[fund.dealId] = record;
  saveEscrowState(storage, chainId, selfAddress, state);
  return record;
}

export function recordEscrowUpdateClaim(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  operation: Exclude<EscrowOperation, "fund">,
  payload: EscrowFillPayload | EscrowClaimPayload | EscrowTimeoutPayload,
  at = nowSeconds(),
): EscrowDealRecord {
  const parsed = parseEscrowUpdatePayload(payload);
  if (!parsed) throw new Error("Invalid escrow update envelope.");
  const state = loadEscrowState(storage, chainId, selfAddress);
  const current = state.deals[parsed.dealId];
  if (
    !current ||
    !feltEquals(current.fund.escrowAddress, parsed.escrowAddress)
  ) {
    throw new Error("The referenced escrow deal is not stored locally.");
  }
  const next = {
    ...current,
    counterpartyClaims: {
      ...current.counterpartyClaims,
      [operation]: true,
    },
    updatedAt: at,
  };
  state.deals[parsed.dealId] = next;
  saveEscrowState(storage, chainId, selfAddress, state);
  return next;
}

function assertOperationAllowed(
  record: EscrowDealRecord,
  operation: EscrowOperation,
  at: number,
): void {
  const priorOperation = record.operations[operation];
  if (priorOperation && priorOperation.state !== "reverted") {
    throw new Error(
      `This escrow ${operation} was already reserved; no second transfer was sent.`,
    );
  }
  const status = record.chainStatus;
  if (operation === "fund") {
    if (status && status !== "empty") {
      throw new Error("This escrow deal is already funded.");
    }
    return;
  }
  if (operation === "fill" && status !== "funded") {
    throw new Error("Only a chain-verified funded escrow can be filled.");
  }
  if (operation === "fill" && at >= record.fund.deadline) {
    throw new Error("This escrow fill deadline has passed.");
  }
  if (operation === "claim" && status !== "filled") {
    throw new Error("Only a chain-verified filled escrow can be claimed.");
  }
  if (operation === "timeout" && status !== "funded") {
    throw new Error("Only an unfilled funded escrow can time out.");
  }
  if (operation === "timeout" && at < record.fund.deadline) {
    throw new Error("This escrow deal has not reached its timeout deadline.");
  }
}

/** Synchronously reserves an operation before any wallet request can emit value. */
export function claimEscrowOperation(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  operation: EscrowOperation,
  at = nowSeconds(),
): EscrowDealRecord {
  const parsedDealId = parseFelt(dealId, false);
  const state = loadEscrowState(storage, chainId, selfAddress);
  const current = parsedDealId ? state.deals[parsedDealId] : undefined;
  if (!current)
    throw new Error("The referenced escrow deal is not stored locally.");
  assertOperationAllowed(current, operation, at);
  const next: EscrowDealRecord = {
    ...current,
    operations: {
      ...current.operations,
      [operation]: { state: "reserved", updatedAt: at },
    },
    updatedAt: at,
  };
  state.deals[current.dealId] = next;
  saveEscrowState(storage, chainId, selfAddress, state);
  return next;
}

export function markEscrowOperationSubmitted(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  operation: EscrowOperation,
  transactionHash: string,
  at = nowSeconds(),
): EscrowDealRecord {
  const txHash = parseFelt(transactionHash, false);
  const state = loadEscrowState(storage, chainId, selfAddress);
  const current = state.deals[num.toHex(dealId)];
  const reserved = current?.operations[operation];
  if (!current || !reserved || reserved.state !== "reserved" || !txHash) {
    throw new Error(
      "No matching escrow operation reservation can be submitted.",
    );
  }
  const next: EscrowDealRecord = {
    ...current,
    operations: {
      ...current.operations,
      [operation]: {
        state: "submitted",
        transactionHash: txHash,
        updatedAt: at,
      },
    },
    updatedAt: at,
  };
  state.deals[current.dealId] = next;
  saveEscrowState(storage, chainId, selfAddress, state);
  return next;
}

export function confirmEscrowOperation(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  operation: EscrowOperation,
  transactionHash: string,
  at = nowSeconds(),
): EscrowDealRecord {
  const state = loadEscrowState(storage, chainId, selfAddress);
  const parsedDealId = parseFelt(dealId, false);
  const current = parsedDealId ? state.deals[parsedDealId] : undefined;
  const submitted = current?.operations[operation];
  const txHash = parseFelt(transactionHash, false);
  if (
    !current ||
    !submitted ||
    submitted.state !== "submitted" ||
    !submitted.transactionHash ||
    !txHash ||
    !feltEquals(submitted.transactionHash, txHash)
  ) {
    throw new Error("No matching submitted escrow operation can be confirmed.");
  }
  const next: EscrowDealRecord = {
    ...current,
    operations: {
      ...current.operations,
      [operation]: {
        state: "confirmed",
        transactionHash: txHash,
        updatedAt: at,
      },
    },
    updatedAt: at,
  };
  state.deals[next.dealId] = next;
  saveEscrowState(storage, chainId, selfAddress, state);
  return next;
}

export function markEscrowOperationOutcome(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  operation: EscrowOperation,
  transactionHash: string,
  outcome: "reverted" | "unknown",
  at = nowSeconds(),
): EscrowDealRecord {
  const state = loadEscrowState(storage, chainId, selfAddress);
  const parsedDealId = parseFelt(dealId, false);
  const current = parsedDealId ? state.deals[parsedDealId] : undefined;
  const submitted = current?.operations[operation];
  const txHash = parseFelt(transactionHash, false);
  if (
    !current ||
    !submitted ||
    submitted.state !== "submitted" ||
    !submitted.transactionHash ||
    !txHash ||
    !feltEquals(submitted.transactionHash, txHash)
  ) {
    throw new Error(
      "No matching submitted escrow operation can be reconciled.",
    );
  }
  const next: EscrowDealRecord = {
    ...current,
    operations: {
      ...current.operations,
      [operation]: {
        state: outcome,
        transactionHash: txHash,
        updatedAt: at,
      },
    },
    updatedAt: at,
  };
  state.deals[next.dealId] = next;
  saveEscrowState(storage, chainId, selfAddress, state);
  return next;
}

/** Releases only a pre-submission reservation. Submitted operations stay blocked. */
export function releaseEscrowOperation(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  operation: EscrowOperation,
  at = nowSeconds(),
): EscrowDealRecord | undefined {
  const state = loadEscrowState(storage, chainId, selfAddress);
  const parsedDealId = parseFelt(dealId, false);
  const current = parsedDealId ? state.deals[parsedDealId] : undefined;
  const reserved = current?.operations[operation];
  if (!current || !reserved || reserved.state !== "reserved") return current;
  const operations = { ...current.operations };
  delete operations[operation];
  const next = { ...current, operations, updatedAt: at };
  state.deals[current.dealId] = next;
  saveEscrowState(storage, chainId, selfAddress, state);
  return next;
}

export function recordEscrowChainDeal(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  chainDeal: EscrowContractDeal,
  at = nowSeconds(),
): EscrowDealRecord {
  const state = loadEscrowState(storage, chainId, selfAddress);
  const parsedDealId = parseFelt(dealId, false);
  const current = parsedDealId ? state.deals[parsedDealId] : undefined;
  if (!current)
    throw new Error("The referenced escrow deal is not stored locally.");
  if (
    chainDeal.status !== "empty" &&
    !contractDealMatchesFund(chainDeal, current.fund)
  ) {
    throw new Error(
      "On-chain escrow terms do not match the encrypted announcement.",
    );
  }
  const next = {
    ...current,
    chainStatus: chainDeal.status,
    chainDeal,
    updatedAt: at,
  };
  state.deals[current.dealId] = next;
  saveEscrowState(storage, chainId, selfAddress, state);
  return next;
}
