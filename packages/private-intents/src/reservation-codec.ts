import {
  assertMakerReservation,
  canonicalMakerReservation,
  type MakerReservationV1,
} from "#protocol";

const HEX_32 = /^0x[0-9a-f]{64}$/;
const MAX_U128 = (1n << 128n) - 1n;
const REQUIRED_FIELDS = [
  "reservation",
  "nonce",
  "solverId",
  "solverKey",
  "spreadBps",
  "sellToken",
  "sellAmount",
  "buyToken",
  "grossBuyAmount",
  "buyAmount",
  "minBuyAmount",
  "rfqExpiresAt",
  "pricingProvenance",
] as const;
const OPTIONAL_FIELDS = new Set([
  "signedCanonical",
  "signature",
  "quoteDigest",
  "settlementDealId",
  "settlementDeadline",
  "settlementTicketAddress",
  "authorityQuarantine",
  "terminalReconciliation",
]);

export type ReservationCodecReconciliationBinding = Readonly<{
  attemptId: string;
  authorityDigest: string;
  authorityRevision: number;
  outcome: "settled" | "refunded";
  selectionFence: bigint;
}>;

export type CodecStoredMakerReservation = Readonly<{
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
  authorityQuarantine?: ReservationCodecReconciliationBinding &
    Readonly<{
      reason: "authority-disagreement" | "authority-reorged";
      quarantinedAt: number;
    }>;
  terminalReconciliation?: ReservationCodecReconciliationBinding &
    Readonly<{ reconciledAt: number }>;
}>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required.`);
  return value.trim();
}

function hex32(value: unknown, label: string): string {
  const normalized = text(value, label).toLowerCase();
  if (!HEX_32.test(normalized))
    throw new Error(`${label} must be a canonical 32-byte hex value.`);
  return normalized;
}

function amount(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_U128)
    throw new Error(`${label} must be a positive u128 value.`);
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`${label} must be a positive unix-seconds timestamp.`);
  return value as number;
}

function reconciliation(
  value: unknown,
  label: string,
): ReservationCodecReconciliationBinding {
  const input = object(value, `${label} metadata`);
  const outcome = input.outcome;
  if (outcome !== "settled" && outcome !== "refunded")
    throw new Error(`${label} outcome is invalid.`);
  return {
    attemptId: text(input.attemptId, `${label} attemptId`),
    authorityDigest: hex32(input.authorityDigest, `${label} authorityDigest`),
    authorityRevision: timestamp(
      input.authorityRevision,
      `${label} authorityRevision`,
    ),
    outcome,
    selectionFence: amount(input.selectionFence, `${label} selectionFence`),
  };
}

/**
 * The single Worker-safe runtime codec for complete maker reservation records.
 * It accepts decoded bigint values and rejects missing or unknown fields.
 */
export function decodeStoredMakerReservation(
  value: unknown,
): CodecStoredMakerReservation {
  const input = object(value, "Stored maker reservation");
  for (const field of REQUIRED_FIELDS) {
    if (!(field in input))
      throw new Error(`Stored maker reservation ${field} is required.`);
  }
  for (const field of Object.keys(input)) {
    if (
      !(REQUIRED_FIELDS as readonly string[]).includes(field) &&
      !OPTIONAL_FIELDS.has(field)
    )
      throw new Error(
        `Stored maker reservation field ${field} is unsupported.`,
      );
  }

  assertMakerReservation(input.reservation);
  const reservation = input.reservation;
  canonicalMakerReservation(reservation);
  if (!Number.isSafeInteger(input.spreadBps) || (input.spreadBps as number) < 0)
    throw new Error("spreadBps must be a non-negative safe integer.");

  const signedCanonical = input.signedCanonical;
  const signature = input.signature;
  const quoteDigest = input.quoteDigest;
  if (
    (signedCanonical === undefined) !== (signature === undefined) ||
    (signedCanonical === undefined) !== (quoteDigest === undefined)
  )
    throw new Error("Persisted quote signature fields are incomplete.");

  return {
    reservation,
    nonce: hex32(input.nonce, "nonce"),
    solverId: text(input.solverId, "solverId"),
    solverKey: text(input.solverKey, "solverKey"),
    spreadBps: input.spreadBps as number,
    sellToken: text(input.sellToken, "sellToken"),
    sellAmount: amount(input.sellAmount, "sellAmount"),
    buyToken: text(input.buyToken, "buyToken"),
    grossBuyAmount: amount(input.grossBuyAmount, "grossBuyAmount"),
    buyAmount: amount(input.buyAmount, "buyAmount"),
    minBuyAmount: amount(input.minBuyAmount, "minBuyAmount"),
    rfqExpiresAt: timestamp(input.rfqExpiresAt, "rfqExpiresAt"),
    pricingProvenance: text(input.pricingProvenance, "pricingProvenance"),
    ...(signedCanonical === undefined
      ? {}
      : {
          signedCanonical: text(signedCanonical, "signedCanonical"),
          signature: text(signature, "signature"),
          quoteDigest: hex32(quoteDigest, "quoteDigest"),
        }),
    ...(input.settlementDealId === undefined
      ? {}
      : {
          settlementDealId: text(
            input.settlementDealId,
            "settlementDealId",
          ).toLowerCase(),
        }),
    ...(input.settlementDeadline === undefined
      ? {}
      : {
          settlementDeadline: timestamp(
            input.settlementDeadline,
            "settlementDeadline",
          ),
        }),
    ...(input.settlementTicketAddress === undefined
      ? {}
      : {
          settlementTicketAddress: text(
            input.settlementTicketAddress,
            "settlementTicketAddress",
          ).toLowerCase(),
        }),
    ...(input.authorityQuarantine === undefined
      ? {}
      : {
          authorityQuarantine: {
            ...reconciliation(
              input.authorityQuarantine,
              "authority quarantine",
            ),
            reason: (() => {
              const reason = object(
                input.authorityQuarantine,
                "authority quarantine metadata",
              ).reason;
              if (
                reason !== "authority-disagreement" &&
                reason !== "authority-reorged"
              )
                throw new Error("authority quarantine reason is invalid.");
              return reason;
            })(),
            quarantinedAt: timestamp(
              object(input.authorityQuarantine, "authority quarantine metadata")
                .quarantinedAt,
              "authority quarantine quarantinedAt",
            ),
          },
        }),
    ...(input.terminalReconciliation === undefined
      ? {}
      : {
          terminalReconciliation: {
            ...reconciliation(
              input.terminalReconciliation,
              "terminal reconciliation",
            ),
            reconciledAt: timestamp(
              object(
                input.terminalReconciliation,
                "terminal reconciliation metadata",
              ).reconciledAt,
              "terminal reconciliation reconciledAt",
            ),
          },
        }),
  };
}
