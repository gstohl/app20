import {
  PrivateIntentError,
  QUOTE_CLOCK_SKEW_SECONDS,
  isCanonicalQuoteSignature,
} from "./index.ts";

export const MAKER_MID_DOMAIN = "app20/maker-indicative-mid/v1" as const;

export type MakerIndicativeMidV1 = Readonly<{
  version: 1;
  domain: typeof MAKER_MID_DOMAIN;
  makerId: string;
  quoteKeyId: string;
  marketId: "STRK_USDC";
  midE18: bigint;
  observedAt: number;
  validUntil: number;
  signature: string;
}>;

export type UnsignedMakerIndicativeMidV1 = Omit<
  MakerIndicativeMidV1,
  "signature"
>;
export type MakerIndicativeMidV1Wire = Readonly<
  Omit<MakerIndicativeMidV1, "midE18"> & { midE18: string }
>;
export type MakerMidVerification = Readonly<{
  importPublicKey: (jwk: JsonWebKey) => Promise<CryptoKey>;
  verify: (
    canonical: string,
    signature: string,
    publicKey: CryptoKey,
  ) => Promise<boolean>;
  resolveKey: (
    makerId: string,
    quoteKeyId: string,
    at: number,
  ) => JsonWebKey | Promise<JsonWebKey>;
}>;
export type AggregatedMids = Readonly<{
  medianE18: bigint;
  dispersionBps: number;
  count: number;
}>;

const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const MAX_U256 = (1n << 256n) - 1n;
const MID_WIRE_FIELDS = [
  "domain",
  "makerId",
  "marketId",
  "midE18",
  "observedAt",
  "quoteKeyId",
  "signature",
  "validUntil",
  "version",
] as const;
const MID_WIRE_FIELD_SET = new Set<string>(MID_WIRE_FIELDS);

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PrivateIntentError(`${label} is required.`);
  return normalized;
}

function requireTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PrivateIntentError(
      `${label} must be a positive unix-seconds timestamp.`,
    );
  }
  return value;
}

function canonicalBody(mid: UnsignedMakerIndicativeMidV1) {
  if (mid.version !== 1 || mid.domain !== MAKER_MID_DOMAIN) {
    throw new PrivateIntentError("Only maker indicative mid v1 is supported.");
  }
  if (mid.marketId !== "STRK_USDC") {
    throw new PrivateIntentError("Maker mid marketId must be STRK_USDC.");
  }
  if (
    typeof mid.midE18 !== "bigint" ||
    mid.midE18 <= 0n ||
    mid.midE18 > MAX_U256
  ) {
    throw new PrivateIntentError("midE18 must be a positive u256 value.");
  }
  const observedAt = requireTimestamp(mid.observedAt, "observedAt");
  const validUntil = requireTimestamp(mid.validUntil, "validUntil");
  if (validUntil <= observedAt) {
    throw new PrivateIntentError(
      "Maker mid validUntil must be after observedAt.",
    );
  }
  return {
    domain: mid.domain,
    makerId: requireText(mid.makerId, "makerId"),
    marketId: mid.marketId,
    midE18: mid.midE18.toString(),
    observedAt,
    quoteKeyId: requireText(mid.quoteKeyId, "quoteKeyId"),
    validUntil,
    version: mid.version,
  };
}

export function canonicalMakerMid(mid: UnsignedMakerIndicativeMidV1): string {
  return JSON.stringify(canonicalBody(mid));
}

export function encodeMakerMid(
  mid: MakerIndicativeMidV1,
): MakerIndicativeMidV1Wire {
  const body = canonicalBody(mid);
  if (!isCanonicalQuoteSignature(mid.signature)) {
    throw new PrivateIntentError(
      "Maker mid signature must use canonical raw low-S P-256 encoding.",
    );
  }
  return Object.freeze({ ...body, signature: mid.signature });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodeMakerMid(value: unknown): MakerIndicativeMidV1 {
  if (!isRecord(value)) {
    throw new PrivateIntentError("Maker mid wire payload must be an object.");
  }
  for (const field of MID_WIRE_FIELDS) {
    if (!(field in value)) {
      throw new PrivateIntentError(`Maker mid ${field} is required.`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!MID_WIRE_FIELD_SET.has(field)) {
      throw new PrivateIntentError(`Maker mid field ${field} is unsupported.`);
    }
  }
  if (typeof value.midE18 !== "string" || !DECIMAL_PATTERN.test(value.midE18)) {
    throw new PrivateIntentError(
      "Maker mid wire midE18 must be a canonical decimal string.",
    );
  }
  const mid = {
    ...value,
    midE18: BigInt(value.midE18),
  } as MakerIndicativeMidV1;
  if (
    typeof mid.signature !== "string" ||
    !isCanonicalQuoteSignature(mid.signature)
  ) {
    throw new PrivateIntentError(
      "Maker mid signature must use canonical raw low-S P-256 encoding.",
    );
  }
  canonicalBody(mid);
  return Object.freeze(mid);
}

function sameJwk(left: JsonWebKey, right: JsonWebKey): boolean {
  return (
    left.kty === right.kty &&
    left.crv === right.crv &&
    left.x === right.x &&
    left.y === right.y
  );
}

export async function verifyMakerMid(
  mid: MakerIndicativeMidV1,
  now: number,
  input: MakerMidVerification,
): Promise<void> {
  const canonical = canonicalMakerMid(mid);
  if (!isCanonicalQuoteSignature(mid.signature)) {
    throw new PrivateIntentError(
      "Maker mid signature must use canonical raw low-S P-256 encoding.",
    );
  }
  requireTimestamp(now, "now");
  if (
    mid.observedAt > now + QUOTE_CLOCK_SKEW_SECONDS ||
    now >= mid.validUntil
  ) {
    throw new PrivateIntentError("Maker mid is outside its active window.");
  }
  const keyAtObservation = await input.resolveKey(
    mid.makerId,
    mid.quoteKeyId,
    mid.observedAt,
  );
  const keyNow = await input.resolveKey(mid.makerId, mid.quoteKeyId, now);
  if (!sameJwk(keyAtObservation, keyNow)) {
    throw new PrivateIntentError(
      "Maker mid quote key changed before verification.",
    );
  }
  if (
    !(await input.verify(
      canonical,
      mid.signature,
      await input.importPublicKey(keyNow),
    ))
  ) {
    throw new PrivateIntentError("Maker mid signature verification failed.");
  }
}

export function aggregateMids(
  mids: readonly MakerIndicativeMidV1[],
): AggregatedMids {
  if (mids.length === 0) {
    return Object.freeze({ medianE18: 0n, dispersionBps: 0, count: 0 });
  }
  const values = mids.map((mid) => {
    canonicalBody(mid);
    if (!isCanonicalQuoteSignature(mid.signature)) {
      throw new PrivateIntentError(
        "Maker mid signature must use canonical raw low-S P-256 encoding.",
      );
    }
    return mid.midE18;
  });
  values.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = Math.floor(values.length / 2);
  const medianE18 =
    values.length % 2 === 1
      ? values[middle]!
      : (values[middle - 1]! + values[middle]!) / 2n;
  const dispersionBps =
    values.length <= 1
      ? 0
      : Number(
          ((values[values.length - 1]! - values[0]!) * 10_000n) / medianE18,
        );
  return Object.freeze({ medianE18, dispersionBps, count: values.length });
}
