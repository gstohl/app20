import { canonicalizeStarknetFelt, parseDigest256 } from "@app20/domain";
import type { WALLET_API } from "@starknet-io/types-js";
import {
  ESCROW_VNEXT_ABI_EXPECTATION,
  assertVnextAbiReady,
  type VnextCommitment,
} from "./escrow-vnext";
import { OPEN_NOTE_ID_PLACEHOLDER, POOL_ADDRESS_PLACEHOLDER } from "./strk20";

export { OPEN_NOTE_ID_PLACEHOLDER, POOL_ADDRESS_PLACEHOLDER };

type VnextActionBase = Readonly<{
  escrowAddress: string;
  recoveryAddress: string;
  dealId: string;
}>;

/** Complete FundV1 payload in the frozen contract field vocabulary. */
export type VnextFundOperationPayload = Readonly<
  VnextCommitment & { commitmentDigest: string }
>;

/** Complete FillV1 payload in the frozen contract field vocabulary. */
export type VnextFillOperationPayload = Readonly<{
  commitmentDigest: string;
  reservationId: string;
  reservationFence: bigint;
  winningQuoteDigest: string;
  buyToken: string;
  buyAmount: bigint;
}>;

/** Complete ClaimV1 payload in the frozen contract field vocabulary. */
export type VnextClaimOperationPayload = Readonly<{
  commitmentDigest: string;
  claimIdentity: string;
}>;

/** Complete TimeoutV1 payload in the frozen contract field vocabulary. */
export type VnextTimeoutOperationPayload = Readonly<{
  commitmentDigest: string;
  claimIdentity: string;
}>;

export type VnextFundActionInput = VnextActionBase &
  Readonly<{ payload: VnextFundOperationPayload }>;

export type VnextFillActionInput = VnextActionBase &
  Readonly<{
    payload: VnextFillOperationPayload;
    /** Fill returns the already-funded sell asset to the destination note. */
    sellToken: string;
  }>;

export type VnextClaimActionInput = VnextActionBase &
  Readonly<{
    payload: VnextClaimOperationPayload;
    /** Claim returns the filled buy asset to the destination note. */
    buyToken: string;
  }>;

export type VnextTimeoutActionInput = VnextActionBase &
  Readonly<{
    payload: VnextTimeoutOperationPayload;
    /** Timeout returns the originally-funded sell asset. */
    sellToken: string;
  }>;

const WALLET_FELT_LIMIT = 1n << 251n;
const U256_LIMIT = 1n << 256n;

type CanonicalFundPayload = VnextFundOperationPayload;
type CanonicalFillPayload = VnextFillOperationPayload;
type CanonicalClaimPayload = VnextClaimOperationPayload;
type CanonicalTimeoutPayload = VnextTimeoutOperationPayload;

export type VnextOperationPayload =
  | Readonly<{ kind: "Fund"; payload: VnextFundOperationPayload }>
  | Readonly<{ kind: "Fill"; payload: VnextFillOperationPayload }>
  | Readonly<{ kind: "Claim"; payload: VnextClaimOperationPayload }>
  | Readonly<{ kind: "Timeout"; payload: VnextTimeoutOperationPayload }>;

export type CanonicalVnextOperation =
  | Readonly<{ kind: "Fund"; payload: CanonicalFundPayload }>
  | Readonly<{ kind: "Fill"; payload: CanonicalFillPayload }>
  | Readonly<{ kind: "Claim"; payload: CanonicalClaimPayload }>
  | Readonly<{ kind: "Timeout"; payload: CanonicalTimeoutPayload }>;

function nonzeroFelt(value: string, label: string): string {
  let canonical: string;
  try {
    canonical = canonicalizeStarknetFelt(value);
  } catch {
    throw new Error(`${label} must be a canonicalizable Starknet felt.`);
  }
  if (canonical === "0x0") throw new Error(`${label} must not be zero.`);
  return canonical;
}

function identifier(value: string, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty canonical identifier.`);
  }
  return value;
}

function digest(value: string, label: string): string {
  try {
    parseDigest256(value);
  } catch {
    throw new Error(`${label} must be a canonical Digest256.`);
  }
  return value.toLowerCase();
}

function nonzeroDigestIdentifier(value: string, label: string): string {
  const canonical = digest(value, label);
  const limbs = parseDigest256(canonical);
  if (limbs.low === 0n && limbs.high === 0n) {
    throw new Error(`${label} must not be zero.`);
  }
  return canonical;
}

function positiveU256(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value <= 0n || value >= U256_LIMIT) {
    throw new Error(`${label} must be a positive u256.`);
  }
  return value;
}

function positiveWalletAmount(value: bigint, label: string): string {
  if (typeof value !== "bigint" || value <= 0n || value >= WALLET_FELT_LIMIT) {
    throw new Error(`${label} must be a positive Wallet API FELT bigint.`);
  }
  return `0x${value.toString(16)}`;
}

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function canonicalFundPayload(
  payload: VnextFundOperationPayload,
): CanonicalFundPayload {
  return Object.freeze({
    chainId: identifier(payload.chainId, "Fund chainId"),
    escrowAddress: nonzeroFelt(payload.escrowAddress, "Fund escrowAddress"),
    escrowClassHash: nonzeroFelt(
      payload.escrowClassHash,
      "Fund escrowClassHash",
    ),
    claimTicketClassHash: nonzeroFelt(
      payload.claimTicketClassHash,
      "Fund claimTicketClassHash",
    ),
    poolAddress: nonzeroFelt(payload.poolAddress, "Fund poolAddress"),
    registryRevision: identifier(
      payload.registryRevision,
      "Fund registryRevision",
    ),
    directoryDigest: digest(payload.directoryDigest, "Fund directoryDigest"),
    directoryEpoch: nonNegativeSafeInteger(
      payload.directoryEpoch,
      "Fund directoryEpoch",
    ),
    transportKeyId: identifier(payload.transportKeyId, "Fund transportKeyId"),
    quoteKeyId: identifier(payload.quoteKeyId, "Fund quoteKeyId"),
    makerId: identifier(payload.makerId, "Fund makerId"),
    makerSettlementAccount: nonzeroFelt(
      payload.makerSettlementAccount,
      "Fund makerSettlementAccount",
    ),
    takerSettlementAccount: nonzeroFelt(
      payload.takerSettlementAccount,
      "Fund takerSettlementAccount",
    ),
    intentDigest: digest(payload.intentDigest, "Fund intentDigest"),
    rfqDigest: digest(payload.rfqDigest, "Fund rfqDigest"),
    settlementContextDigest: digest(
      payload.settlementContextDigest,
      "Fund settlementContextDigest",
    ),
    winningQuoteDigest: digest(
      payload.winningQuoteDigest,
      "Fund winningQuoteDigest",
    ),
    reservationId: nonzeroDigestIdentifier(
      payload.reservationId,
      "Fund reservationId",
    ),
    reservationFence: positiveU256(
      payload.reservationFence,
      "Fund reservationFence",
    ),
    sellToken: nonzeroFelt(payload.sellToken, "Fund sellToken"),
    sellAmountBaseUnits: positiveU256(
      payload.sellAmountBaseUnits,
      "Fund sellAmountBaseUnits",
    ),
    buyToken: nonzeroFelt(payload.buyToken, "Fund buyToken"),
    buyAmountBaseUnits: positiveU256(
      payload.buyAmountBaseUnits,
      "Fund buyAmountBaseUnits",
    ),
    deadline: positiveSafeInteger(payload.deadline, "Fund deadline"),
    dealId: nonzeroFelt(payload.dealId, "Fund dealId"),
    claimTicketIdentity: nonzeroFelt(
      payload.claimTicketIdentity,
      "Fund claimTicketIdentity",
    ),
    commitmentDigest: digest(payload.commitmentDigest, "Fund commitmentDigest"),
  });
}

function canonicalFillPayload(
  payload: VnextFillOperationPayload,
): CanonicalFillPayload {
  return Object.freeze({
    commitmentDigest: digest(payload.commitmentDigest, "Fill commitmentDigest"),
    reservationId: nonzeroDigestIdentifier(
      payload.reservationId,
      "Fill reservationId",
    ),
    reservationFence: positiveU256(
      payload.reservationFence,
      "Fill reservationFence",
    ),
    winningQuoteDigest: digest(
      payload.winningQuoteDigest,
      "Fill winningQuoteDigest",
    ),
    buyToken: nonzeroFelt(payload.buyToken, "Fill buyToken"),
    buyAmount: positiveU256(payload.buyAmount, "Fill buyAmount"),
  });
}

function canonicalClaimPayload(
  payload: VnextClaimOperationPayload,
): CanonicalClaimPayload {
  return Object.freeze({
    commitmentDigest: digest(
      payload.commitmentDigest,
      "Claim commitmentDigest",
    ),
    claimIdentity: nonzeroFelt(payload.claimIdentity, "Claim claimIdentity"),
  });
}

function canonicalTimeoutPayload(
  payload: VnextTimeoutOperationPayload,
): CanonicalTimeoutPayload {
  return Object.freeze({
    commitmentDigest: digest(
      payload.commitmentDigest,
      "Timeout commitmentDigest",
    ),
    claimIdentity: nonzeroFelt(payload.claimIdentity, "Timeout claimIdentity"),
  });
}

/**
 * Pure canonical operation shaping shared by action and recovery builders.
 * It accepts only typed operation fields: never an ABI, encoded calldata, or
 * an execution capability. Exact Digest256 values, including zero, survive.
 */
export function canonicalVnextOperation(
  operation: Extract<VnextOperationPayload, { kind: "Fund" }>,
): Extract<CanonicalVnextOperation, { kind: "Fund" }>;
export function canonicalVnextOperation(
  operation: Extract<VnextOperationPayload, { kind: "Fill" }>,
): Extract<CanonicalVnextOperation, { kind: "Fill" }>;
export function canonicalVnextOperation(
  operation: Extract<VnextOperationPayload, { kind: "Claim" }>,
): Extract<CanonicalVnextOperation, { kind: "Claim" }>;
export function canonicalVnextOperation(
  operation: Extract<VnextOperationPayload, { kind: "Timeout" }>,
): Extract<CanonicalVnextOperation, { kind: "Timeout" }>;
export function canonicalVnextOperation(
  operation: VnextOperationPayload,
): CanonicalVnextOperation;
export function canonicalVnextOperation(
  operation: VnextOperationPayload,
): CanonicalVnextOperation {
  switch (operation?.kind) {
    case "Fund":
      return Object.freeze({
        kind: "Fund",
        payload: canonicalFundPayload(operation.payload),
      });
    case "Fill":
      return Object.freeze({
        kind: "Fill",
        payload: canonicalFillPayload(operation.payload),
      });
    case "Claim":
      return Object.freeze({
        kind: "Claim",
        payload: canonicalClaimPayload(operation.payload),
      });
    case "Timeout":
      return Object.freeze({
        kind: "Timeout",
        payload: canonicalTimeoutPayload(operation.payload),
      });
    default:
      throw new Error("Escrow VNext operation kind is unsupported.");
  }
}

/**
 * The only operation encoder seam. It accepts a complete, field-validated,
 * discriminated operation and no ABI or pre-encoded calldata. Replace this
 * body only together with an accepted generated codec and its pinned reviewed
 * artifact digest. Zero enum values and zero u256/Digest256 limbs must remain
 * valid generated output; callers never supply those serialized limbs.
 */
function acceptedGeneratedOperation(
  _operation: CanonicalVnextOperation,
): readonly [string, ...string[]] {
  throw new Error(
    "An accepted generated EscrowOperationV1 encoder is not configured.",
  );
}

function sameFelt(left: string, right: string): boolean {
  return canonicalizeStarknetFelt(left) === canonicalizeStarknetFelt(right);
}

function buildActions(
  input: VnextActionBase,
  operation: CanonicalVnextOperation,
  incoming: { token: string; amount: bigint; label: string },
  outgoingToken: string,
): WALLET_API.STRK20_ACTION[] {
  const escrowAddress = nonzeroFelt(
    input.escrowAddress,
    "Escrow VNext address",
  );
  const recoveryAddress = nonzeroFelt(
    input.recoveryAddress,
    "Recovery address",
  );
  const dealId = nonzeroFelt(input.dealId, "dealId");
  const incomingToken = nonzeroFelt(incoming.token, "Incoming token");
  const outgoing = nonzeroFelt(outgoingToken, "Outgoing token");
  const amount = positiveWalletAmount(incoming.amount, incoming.label);

  // The immutable checked-in manifest is the only gate. Unknown object fields
  // cannot substitute selectors or an ABI at runtime.
  assertVnextAbiReady(ESCROW_VNEXT_ABI_EXPECTATION);
  const calldata = acceptedGeneratedOperation(operation);

  return [
    {
      type: "withdraw",
      token: incomingToken,
      amount,
      recipient: escrowAddress,
    },
    {
      type: "transfer",
      token: outgoing,
      amount: "OPEN",
      recipient: recoveryAddress,
    },
    {
      type: "invoke",
      contract: escrowAddress,
      calldata: [
        ...calldata,
        dealId,
        POOL_ADDRESS_PLACEHOLDER,
        OPEN_NOTE_ID_PLACEHOLDER,
      ],
    },
  ];
}

/** Fund remains unavailable until the checked-in ABI and generated codec are accepted. */
export function buildVnextFundActions(
  input: VnextFundActionInput,
): WALLET_API.STRK20_ACTION[] {
  const operation = canonicalVnextOperation({
    kind: "Fund",
    payload: input.payload,
  });
  const payload = operation.payload;
  const escrowAddress = nonzeroFelt(
    input.escrowAddress,
    "Escrow VNext address",
  );
  const dealId = nonzeroFelt(input.dealId, "dealId");
  if (!sameFelt(escrowAddress, payload.escrowAddress)) {
    throw new Error("Fund payload escrowAddress must match the action target.");
  }
  if (!sameFelt(dealId, payload.dealId)) {
    throw new Error("Fund payload dealId must match the outer dealId.");
  }
  return buildActions(
    input,
    operation,
    {
      token: payload.sellToken,
      amount: payload.sellAmountBaseUnits,
      label: "Funding amount",
    },
    payload.claimTicketIdentity,
  );
}

/** Fill remains unavailable until the checked-in ABI and generated codec are accepted. */
export function buildVnextFillActions(
  input: VnextFillActionInput,
): WALLET_API.STRK20_ACTION[] {
  const operation = canonicalVnextOperation({
    kind: "Fill",
    payload: input.payload,
  });
  const payload = operation.payload;
  return buildActions(
    input,
    operation,
    {
      token: payload.buyToken,
      amount: payload.buyAmount,
      label: "Fill amount",
    },
    input.sellToken,
  );
}

/** Claim remains unavailable until the checked-in ABI and generated codec are accepted. */
export function buildVnextClaimActions(
  input: VnextClaimActionInput,
): WALLET_API.STRK20_ACTION[] {
  const operation = canonicalVnextOperation({
    kind: "Claim",
    payload: input.payload,
  });
  const payload = operation.payload;
  return buildActions(
    input,
    operation,
    {
      token: payload.claimIdentity,
      amount: 1n,
      label: "Claim ticket amount",
    },
    input.buyToken,
  );
}

/** Timeout remains unavailable until the checked-in ABI and generated codec are accepted. */
export function buildVnextTimeoutActions(
  input: VnextTimeoutActionInput,
): WALLET_API.STRK20_ACTION[] {
  const operation = canonicalVnextOperation({
    kind: "Timeout",
    payload: input.payload,
  });
  const payload = operation.payload;
  return buildActions(
    input,
    operation,
    {
      token: payload.claimIdentity,
      amount: 1n,
      label: "Claim ticket amount",
    },
    input.sellToken,
  );
}
