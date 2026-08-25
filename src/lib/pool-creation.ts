import { canonicalizeStarknetAddress } from "./addresses";

export const POOL_PROPOSAL_SCHEMA_REVISION = "app20/pool-proposal/v1" as const;

export const POOL_REFERENCE_PRICE_ORIENTATION = "token-b-per-token-a" as const;

const POOL_REVIEW_CHECKSUM_DOMAIN =
  "app20/pool-proposal-review-checksum/v1" as const;
const MAX_U128 = (1n << 128n) - 1n;
const MAX_DECIMALS = 255n;
const MAX_DECIMAL_INPUT_LENGTH = 1_024;

export type CanonicalPoolNetwork = "mainnet" | "sepolia" | "localnet";

/**
 * Registry-resolved metadata accepted by the proposal model. Callers must pass
 * only tokens returned by the active network registry; null represents an
 * identifier that the registry did not verify.
 */
export type CanonicalPoolToken = Readonly<{
  network: CanonicalPoolNetwork;
  address: string;
  symbol: string;
  decimals: number;
}>;

export type PoolCreationDraft = Readonly<{
  account: string;
  chainId: string;
  registryRevision: string;
  tokenA: CanonicalPoolToken | null;
  tokenB: CanonicalPoolToken | null;
  proposedAmountA: string;
  proposedAmountB: string;
  referencePrice: string;
}>;

export type PoolCreationField =
  | "account"
  | "chainId"
  | "registryRevision"
  | "tokenA"
  | "tokenB"
  | "pair"
  | "proposedAmountA"
  | "proposedAmountB"
  | "referencePrice";

export type PoolCreationReviewToken = Readonly<{
  address: string;
  symbol: string;
  decimals: number;
}>;

export type PoolCreationReview = Readonly<{
  proposalSchemaRevision: typeof POOL_PROPOSAL_SCHEMA_REVISION;
  registryRevision: string;
  account: string;
  chainId: string;
  tokenA: PoolCreationReviewToken;
  tokenB: PoolCreationReviewToken;
  proposedAmountABaseUnits: string;
  proposedAmountBBaseUnits: string;
  referencePrice: Readonly<{
    orientation: typeof POOL_REFERENCE_PRICE_ORIENTATION;
    canonicalDecimal: string;
    executable: false;
  }>;
}>;

export type PoolCreationValidation =
  | Readonly<{
      ok: true;
      review: PoolCreationReview;
      errors: Readonly<Partial<Record<PoolCreationField, string>>>;
    }>
  | Readonly<{
      ok: false;
      errors: Readonly<Partial<Record<PoolCreationField, string>>>;
    }>;

type DecimalParts = Readonly<{
  whole: string;
  fraction: string;
  rawFraction: string;
  canonical: string;
  positive: boolean;
}>;

type PreparedToken = Readonly<{
  network: CanonicalPoolNetwork;
  review: PoolCreationReviewToken;
  decimals: bigint;
}>;

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

type UnknownRecord = Record<string, unknown>;

function canonicalDecimalParts(value: unknown): DecimalParts | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_DECIMAL_INPUT_LENGTH) return null;

  const match = /^(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))$/.exec(trimmed);
  if (!match) return null;

  const rawWhole = match[1] ?? "0";
  const rawFraction = match[2] ?? match[3] ?? "";
  const whole = rawWhole.replace(/^0+/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  const positive = whole !== "0" || /[1-9]/.test(fraction);

  return { whole, fraction, rawFraction, canonical, positive };
}

function parseDecimals(value: unknown): bigint | null {
  if (typeof value !== "number" || Object.is(value, -0)) return null;
  const decimalText = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(decimalText)) return null;

  const decimals = BigInt(decimalText);
  return decimals <= MAX_DECIMALS ? decimals : null;
}

function canonicalBaseUnits(value: unknown, decimals: bigint): string | null {
  const parsed = canonicalDecimalParts(value);
  if (!parsed?.positive) return null;

  let fractionLength = BigInt(String(parsed.rawFraction.length));
  if (fractionLength > decimals) return null;

  let paddedFraction = parsed.rawFraction;
  while (fractionLength < decimals) {
    paddedFraction += "0";
    fractionLength += 1n;
  }

  const baseUnits =
    `${parsed.whole}${paddedFraction}`.replace(/^0+/, "") || "0";
  const exactValue = BigInt(baseUnits);
  if (exactValue === 0n || exactValue > MAX_U128) return null;
  return baseUnits;
}

function canonicalNonzeroFelt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const canonical = canonicalizeStarknetAddress(value);
    return canonical === "0x0" ? null : canonical;
  } catch {
    return null;
  }
}

function canonicalRevision(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const revision = value.trim();
  if (
    revision.length === 0 ||
    revision.length > 128 ||
    /[\u0000-\u001f\u007f\s]/u.test(revision)
  ) {
    return null;
  }
  return revision;
}

function canonicalSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9._-]{0,31}$/.test(symbol) ? symbol : null;
}

function isCanonicalPoolNetwork(value: unknown): value is CanonicalPoolNetwork {
  return value === "mainnet" || value === "sepolia" || value === "localnet";
}

function prepareToken(token: CanonicalPoolToken | null): PreparedToken | null {
  if (!token || !isCanonicalPoolNetwork(token.network)) return null;
  const address = canonicalNonzeroFelt(token.address);
  const symbol = canonicalSymbol(token.symbol);
  const decimals = parseDecimals(token.decimals);
  if (address === null || symbol === null || decimals === null) return null;

  return {
    network: token.network,
    decimals,
    review: Object.freeze({ address, symbol, decimals: token.decimals }),
  };
}

function deepFreezeReview(review: PoolCreationReview): PoolCreationReview {
  Object.freeze(review.tokenA);
  Object.freeze(review.tokenB);
  Object.freeze(review.referencePrice);
  return Object.freeze(review);
}

export function validatePoolCreationDraft(
  draft: PoolCreationDraft,
): PoolCreationValidation {
  const errors: Partial<Record<PoolCreationField, string>> = {};

  const account = canonicalNonzeroFelt(draft.account);
  if (account === null) {
    errors.account = "Enter a canonical nonzero owner account.";
  }

  const chainId = canonicalNonzeroFelt(draft.chainId);
  if (chainId === null) {
    errors.chainId = "Use a canonical nonzero Starknet chain identifier.";
  }

  const registryRevision = canonicalRevision(draft.registryRevision);
  if (registryRevision === null) {
    errors.registryRevision =
      "A canonical token registry revision is required.";
  }

  const tokenA = prepareToken(draft.tokenA);
  const tokenB = prepareToken(draft.tokenB);
  if (tokenA === null) {
    errors.tokenA = "Token A is not verified by the active registry.";
  }
  if (tokenB === null) {
    errors.tokenB = "Token B is not verified by the active registry.";
  }

  if (tokenA && tokenB) {
    if (tokenA.network !== tokenB.network) {
      errors.pair = "Choose two tokens reviewed for the same network.";
    } else if (tokenA.review.address === tokenB.review.address) {
      errors.pair = "Choose two canonically different token contracts.";
    }
  }

  const proposedAmountA = tokenA
    ? canonicalBaseUnits(draft.proposedAmountA, tokenA.decimals)
    : null;
  const proposedAmountB = tokenB
    ? canonicalBaseUnits(draft.proposedAmountB, tokenB.decimals)
    : null;
  if (proposedAmountA === null) {
    errors.proposedAmountA =
      "Enter a positive exact amount within Token A decimal precision.";
  }
  if (proposedAmountB === null) {
    errors.proposedAmountB =
      "Enter a positive exact amount within Token B decimal precision.";
  }

  const parsedReferencePrice = canonicalDecimalParts(draft.referencePrice);
  if (!parsedReferencePrice?.positive) {
    errors.referencePrice =
      "Enter a positive plain-decimal non-executable reference price.";
  }

  if (
    Object.keys(errors).length > 0 ||
    account === null ||
    chainId === null ||
    registryRevision === null ||
    tokenA === null ||
    tokenB === null ||
    proposedAmountA === null ||
    proposedAmountB === null ||
    !parsedReferencePrice?.positive
  ) {
    return Object.freeze({ ok: false as const, errors: Object.freeze(errors) });
  }

  const review: PoolCreationReview = {
    proposalSchemaRevision: POOL_PROPOSAL_SCHEMA_REVISION,
    registryRevision,
    account,
    chainId,
    tokenA: tokenA.review,
    tokenB: tokenB.review,
    proposedAmountABaseUnits: proposedAmountA,
    proposedAmountBBaseUnits: proposedAmountB,
    referencePrice: {
      orientation: POOL_REFERENCE_PRICE_ORIENTATION,
      canonicalDecimal: parsedReferencePrice.canonical,
      executable: false,
    },
  };

  return Object.freeze({
    ok: true as const,
    errors: Object.freeze(errors),
    review: deepFreezeReview(review),
  });
}

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function assertExactKeys(
  value: UnknownRecord,
  label: string,
  expected: readonly string[],
): void {
  const actual = Object.keys(value);
  const unknownKey = actual.find((key) => !expected.includes(key));
  if (unknownKey !== undefined) {
    throw new Error(`${label} contains an unrecognized field (${unknownKey}).`);
  }
  const missingKey = expected.find((key) => !Object.hasOwn(value, key));
  if (missingKey !== undefined) {
    throw new Error(`${label} is missing required field ${missingKey}.`);
  }
}

function canonicalReviewToken(
  value: unknown,
  label: string,
): PoolCreationReviewToken {
  const token = record(value, label);
  assertExactKeys(token, label, ["address", "symbol", "decimals"]);
  const address = canonicalNonzeroFelt(token.address);
  const symbol = canonicalSymbol(token.symbol);
  const decimals = parseDecimals(token.decimals);
  if (address === null || symbol === null || decimals === null) {
    throw new Error(`${label} is not canonical reviewed token metadata.`);
  }
  return { address, symbol, decimals: token.decimals as number };
}

function canonicalIntegerAmount(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a canonical positive base-unit integer.`);
  }
  if (BigInt(value) > MAX_U128) {
    throw new Error(`${label} exceeds the u128 base-unit bound.`);
  }
  return value;
}

function canonicalJson(value: CanonicalJson): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as { readonly [key: string]: CanonicalJson };
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

/**
 * Canonical serialization for an identifier-only review checksum. This does
 * not sign, approve, authorize, submit, or assign an on-chain identifier.
 */
export function canonicalizePoolCreationReview(
  value: PoolCreationReview,
): string {
  const review = record(value, "PoolCreationReview");
  assertExactKeys(review, "PoolCreationReview", [
    "proposalSchemaRevision",
    "registryRevision",
    "account",
    "chainId",
    "tokenA",
    "tokenB",
    "proposedAmountABaseUnits",
    "proposedAmountBBaseUnits",
    "referencePrice",
  ]);

  const proposalSchemaRevision = canonicalRevision(
    review.proposalSchemaRevision,
  );
  const registryRevision = canonicalRevision(review.registryRevision);
  const account = canonicalNonzeroFelt(review.account);
  const chainId = canonicalNonzeroFelt(review.chainId);
  if (
    proposalSchemaRevision === null ||
    registryRevision === null ||
    account === null ||
    chainId === null
  ) {
    throw new Error("PoolCreationReview contains a non-canonical binding.");
  }

  const tokenA = canonicalReviewToken(review.tokenA, "tokenA");
  const tokenB = canonicalReviewToken(review.tokenB, "tokenB");
  if (tokenA.address === tokenB.address) {
    throw new Error("PoolCreationReview requires different token contracts.");
  }

  const proposedAmountABaseUnits = canonicalIntegerAmount(
    review.proposedAmountABaseUnits,
    "proposedAmountABaseUnits",
  );
  const proposedAmountBBaseUnits = canonicalIntegerAmount(
    review.proposedAmountBBaseUnits,
    "proposedAmountBBaseUnits",
  );

  const referencePrice = record(review.referencePrice, "referencePrice");
  assertExactKeys(referencePrice, "referencePrice", [
    "orientation",
    "canonicalDecimal",
    "executable",
  ]);
  const orientation = canonicalRevision(referencePrice.orientation);
  const decimal = canonicalDecimalParts(referencePrice.canonicalDecimal);
  if (orientation === null || !decimal?.positive) {
    throw new Error(
      "referencePrice must use a canonical positive decimal orientation.",
    );
  }
  if (referencePrice.executable !== false) {
    throw new Error("The proposal reference price must remain non-executable.");
  }

  return canonicalJson({
    domain: POOL_REVIEW_CHECKSUM_DOMAIN,
    review: {
      account,
      chainId,
      proposalSchemaRevision,
      proposedAmountABaseUnits,
      proposedAmountBBaseUnits,
      referencePrice: {
        canonicalDecimal: decimal.canonical,
        executable: false,
        orientation,
      },
      registryRevision,
      tokenA,
      tokenB,
    },
  });
}

/** Return a SHA-256 checksum identifier, never an authorization artifact. */
export async function digestPoolCreationReview(
  review: PoolCreationReview,
): Promise<string> {
  const serialized = canonicalizePoolCreationReview(review);
  const bytes = new TextEncoder().encode(serialized);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}
