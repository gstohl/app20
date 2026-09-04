import { canonicalizeStarknetFelt } from "@app20/domain";
import {
  Signature,
  getStarkKey,
  poseidonHashMany,
  sign,
  utils,
  verify,
} from "@scure/starknet";
import { PrivateIntentError } from "./index.ts";

export const TAKE_V4_DOMAIN = "app20-take-v4" as const;
export const TAKE_IDENTITY_V1_DOMAIN = "app20-take-id-v1" as const;
export const TAKE_DOMAIN = `0x${Array.from(
  new TextEncoder().encode(TAKE_V4_DOMAIN),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("")}` as const;
export const TAKE_IDENTITY_DOMAIN = `0x${Array.from(
  new TextEncoder().encode(TAKE_IDENTITY_V1_DOMAIN),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("")}` as const;

const U128_MAX = (1n << 128n) - 1n;

export type TakeSignatureFill = Readonly<{
  lockId: string;
  amountA: bigint;
}>;

export type TakeMessageInput = Readonly<{
  chainId: string;
  escrowAddress: string;
  identityCommitment: string;
  rfqFelt: string;
  tokenA: string;
  tokenB: string;
  fills: readonly TakeSignatureFill[];
}>;

function felt(value: string, label: string, allowZero = false): string {
  let canonical: string;
  try {
    canonical = canonicalizeStarknetFelt(value);
  } catch {
    throw new PrivateIntentError(`${label} must be a Starknet felt.`);
  }
  if (!allowZero && canonical === "0x0") {
    throw new PrivateIntentError(`${label} must not be zero.`);
  }
  return canonical;
}

function canonicalFills(
  fills: readonly TakeSignatureFill[],
): readonly Readonly<{ lockId: string; amountA: bigint }>[] {
  if (!Array.isArray(fills) || fills.length < 1 || fills.length > 4) {
    throw new PrivateIntentError(
      "Take authorization requires between one and four fills.",
    );
  }
  const seen = new Set<string>();
  return Object.freeze(
    fills.map((fill, index) => {
      if (!fill || typeof fill !== "object") {
        throw new PrivateIntentError(`Take fill ${index} is invalid.`);
      }
      const lockId = felt(fill.lockId, `Take fill ${index} lockId`);
      if (seen.has(lockId)) {
        throw new PrivateIntentError("Take authorization lock ids must differ.");
      }
      seen.add(lockId);
      if (
        typeof fill.amountA !== "bigint" ||
        fill.amountA <= 0n ||
        fill.amountA > U128_MAX
      ) {
        throw new PrivateIntentError(
          `Take fill ${index} amountA must be a positive u128 value.`,
        );
      }
      return Object.freeze({ lockId, amountA: fill.amountA });
    }),
  );
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

export function fillsDigest(fills: readonly TakeSignatureFill[]): string {
  const canonical = canonicalFills(fills);
  return hex(
    poseidonHashMany(
      canonical.flatMap(({ lockId, amountA }) => [BigInt(lockId), amountA]),
    ),
  );
}

/** Public, contract- and RFQ-specific pseudonym derived from the pool-private identity key. */
export function takeIdentityCommitment(
  identityKey: string,
  rfqFelt: string,
): string {
  return hex(
    poseidonHashMany([
      BigInt(TAKE_IDENTITY_DOMAIN),
      BigInt(felt(identityKey, "identityKey")),
      BigInt(felt(rfqFelt, "rfqFelt")),
    ]),
  );
}

export function takeMessageHash(input: TakeMessageInput): string {
  const chainId = felt(input.chainId, "chainId");
  const escrowAddress = felt(input.escrowAddress, "escrowAddress");
  const identityCommitment = felt(
    input.identityCommitment,
    "identityCommitment",
  );
  const rfqFelt = felt(input.rfqFelt, "rfqFelt");
  const tokenA = felt(input.tokenA, "tokenA");
  const tokenB = felt(input.tokenB, "tokenB");
  if (tokenA === tokenB) {
    throw new PrivateIntentError("tokenA and tokenB must differ.");
  }
  const digest = fillsDigest(input.fills);
  return hex(
    poseidonHashMany([
      BigInt(TAKE_DOMAIN),
      BigInt(chainId),
      BigInt(escrowAddress),
      BigInt(identityCommitment),
      BigInt(rfqFelt),
      BigInt(tokenA),
      BigInt(tokenB),
      BigInt(digest),
    ]),
  );
}

function signingKeyFelt(signingKey: string): string {
  const canonical = felt(signingKey, "taker signing key");
  try {
    getStarkKey(canonical);
  } catch {
    throw new PrivateIntentError(
      "Taker signing key must be a valid Stark-curve private scalar.",
    );
  }
  return canonical;
}

export function takerPublicKeyFor(signingKey: string): string {
  const publicKey = getStarkKey(signingKeyFelt(signingKey));
  return felt(publicKey, "taker authorization public key");
}

export function createTakerAuthorizationKey(): Readonly<{
  signingKey: string;
  publicKey: string;
}> {
  const bytes = utils.randomPrivateKey();
  const signingKey = `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  return Object.freeze({
    signingKey,
    publicKey: takerPublicKeyFor(signingKey),
  });
}

export function signTake(
  signingKey: string,
  message: string,
): Readonly<{ r: string; s: string }> {
  const signature = sign(
    felt(message, "Take authorization message", true),
    signingKeyFelt(signingKey),
  );
  return Object.freeze({ r: hex(signature.r), s: hex(signature.s) });
}

export function verifyTakeSignature(
  publicKey: string,
  message: string,
  r: string,
  s: string,
): boolean {
  try {
    const x = felt(publicKey, "taker authorization public key")
      .slice(2)
      .padStart(64, "0");
    const signature = new Signature(
      BigInt(felt(r, "Take signature r")),
      BigInt(felt(s, "Take signature s")),
    );
    const messageHash = felt(message, "Take authorization message", true);
    return (
      verify(signature, messageHash, `02${x}`) ||
      verify(signature, messageHash, `03${x}`)
    );
  } catch {
    return false;
  }
}
