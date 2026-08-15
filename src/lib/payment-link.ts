import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalizeStarknetAddress } from "./addresses";
import {
  isCanonicalStrkToken,
  isRandom32ByteId,
  parsePaymentRequestPayload,
  type PaymentRequestPayload,
} from "./otc";

export const PAYMENT_LINK_PATH = "/pay";
export const PAYMENT_LINK_VERSION = "qlp1" as const;
export const MAX_PAYMENT_LINK_FRAGMENT_LENGTH = 2_048;

const MAX_PAYMENT_LINK_PAYLOAD_BYTES = 1_450;
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_DATE_SECONDS = 8_640_000_000_000;
const CHECKSUM_DOMAIN = new TextEncoder().encode(
  "quietline/payment-link/v1\0",
);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

type EncodedPaymentRequest = [
  requestId: string,
  tokenSymbol: string,
  tokenAddress: string,
  tokenDecimals: number,
  amount: string,
  memo: string | null,
  expiresAt: number,
  requester: string,
  invoiceId: string | null,
];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (
    !value ||
    !BASE64URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    throw new Error("Payment link fragment is malformed.");
  }

  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat(
    (4 - (value.length % 4)) % 4,
  )}`;

  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (bytesToBase64Url(bytes) !== value) {
      throw new Error("Payment link fragment is malformed.");
    }
    return bytes;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Payment link")) {
      throw error;
    }
    throw new Error("Payment link fragment is malformed.");
  }
}

function checksum(payload: Uint8Array): Uint8Array {
  const input = new Uint8Array(CHECKSUM_DOMAIN.length + payload.length);
  input.set(CHECKSUM_DOMAIN);
  input.set(payload, CHECKSUM_DOMAIN.length);
  return sha256(input);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function normalizePaymentRequest(
  value: PaymentRequestPayload,
): PaymentRequestPayload {
  if (!isObject(value) || !isObject(value.token)) {
    throw new Error("Payment link request is malformed.");
  }
  if (!isCanonicalStrkToken(value.token)) {
    throw new Error(
      "Payment links require canonical STRK metadata (address, symbol, and 18 decimals).",
    );
  }
  if (!isRandom32ByteId(value.requestId)) {
    throw new Error("Payment link requestId must be a 32-byte hexadecimal id.");
  }
  if (
    value.invoiceId !== undefined &&
    !isRandom32ByteId(value.invoiceId)
  ) {
    throw new Error("Payment link invoiceId must be a 32-byte hexadecimal id.");
  }

  const parsed = parsePaymentRequestPayload(value);
  if (!parsed) throw new Error("Payment link request is malformed.");
  if (BigInt(parsed.amount) > MAX_UINT256) {
    throw new Error("Payment link amount exceeds the uint256 STRK limit.");
  }
  if (BigInt(parsed.requester) === 0n) {
    throw new Error("Payment link requester must be a non-zero Starknet address.");
  }
  if (parsed.expiresAt > MAX_DATE_SECONDS) {
    throw new Error("Payment link expiry is outside the displayable date range.");
  }

  return {
    requestId: parsed.requestId.toLowerCase(),
    token: parsed.token,
    amount: parsed.amount,
    expiresAt: parsed.expiresAt,
    requester: canonicalizeStarknetAddress(parsed.requester),
    ...(parsed.memo === undefined ? {} : { memo: parsed.memo }),
    ...(parsed.invoiceId === undefined
      ? {}
      : { invoiceId: parsed.invoiceId.toLowerCase() }),
  };
}

function requestTuple(request: PaymentRequestPayload): EncodedPaymentRequest {
  const normalized = normalizePaymentRequest(request);
  return [
    normalized.requestId.slice(2),
    normalized.token.symbol,
    canonicalizeStarknetAddress(normalized.token.address).slice(2),
    normalized.token.decimals,
    normalized.amount,
    normalized.memo ?? null,
    normalized.expiresAt,
    normalized.requester.slice(2),
    normalized.invoiceId?.slice(2) ?? null,
  ];
}

function serializeRequest(request: PaymentRequestPayload): Uint8Array {
  return textEncoder.encode(JSON.stringify(requestTuple(request)));
}

function requestFromTuple(value: unknown): PaymentRequestPayload {
  if (!Array.isArray(value) || value.length !== 9) {
    throw new Error("Payment link payload is malformed.");
  }

  const [
    requestId,
    tokenSymbol,
    tokenAddress,
    tokenDecimals,
    amount,
    memo,
    expiresAt,
    requester,
    invoiceId,
  ] = value;

  if (
    typeof requestId !== "string" ||
    typeof tokenSymbol !== "string" ||
    typeof tokenAddress !== "string" ||
    typeof tokenDecimals !== "number" ||
    typeof amount !== "string" ||
    (memo !== null && typeof memo !== "string") ||
    typeof expiresAt !== "number" ||
    typeof requester !== "string" ||
    (invoiceId !== null && typeof invoiceId !== "string")
  ) {
    throw new Error("Payment link payload is malformed.");
  }

  return normalizePaymentRequest({
    requestId: `0x${requestId}`,
    token: {
      symbol: tokenSymbol,
      address: `0x${tokenAddress}`,
      decimals: tokenDecimals,
    },
    amount,
    expiresAt,
    requester: `0x${requester}`,
    ...(memo === null ? {} : { memo }),
    ...(invoiceId === null ? {} : { invoiceId: `0x${invoiceId}` }),
  });
}

/**
 * Encode one unsigned payment request as a URL-safe fragment. The checksum
 * detects damaged links; it is deliberately not an authenticity proof.
 */
export function encodePaymentLinkFragment(
  request: PaymentRequestPayload,
): string {
  const payload = serializeRequest(request);
  if (payload.length > MAX_PAYMENT_LINK_PAYLOAD_BYTES) {
    throw new Error("Payment request is too large for a shareable link.");
  }

  const fragment = `#${PAYMENT_LINK_VERSION}.${bytesToBase64Url(
    payload,
  )}.${bytesToBase64Url(checksum(payload))}`;
  if (fragment.length > MAX_PAYMENT_LINK_FRAGMENT_LENGTH) {
    throw new Error("Payment request is too large for a shareable link.");
  }
  return fragment;
}

/** Decode and strictly validate an unsigned payment request URL fragment. */
export function decodePaymentLinkFragment(
  fragment: string,
): PaymentRequestPayload {
  if (typeof fragment !== "string" || !fragment.startsWith("#")) {
    throw new Error("Payment link fragment must start with #.");
  }
  if (fragment.length > MAX_PAYMENT_LINK_FRAGMENT_LENGTH) {
    throw new Error(
      `Payment link fragment is too large (maximum ${MAX_PAYMENT_LINK_FRAGMENT_LENGTH} characters).`,
    );
  }

  const encoded = fragment.slice(1);
  const separator = encoded.indexOf(".");
  const version = separator === -1 ? encoded : encoded.slice(0, separator);
  if (version !== PAYMENT_LINK_VERSION) {
    throw new Error("Unsupported payment link version.");
  }

  const parts = encoded.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Payment link fragment is malformed or truncated.");
  }

  const payload = base64UrlToBytes(parts[1]);
  if (payload.length > MAX_PAYMENT_LINK_PAYLOAD_BYTES) {
    throw new Error("Payment link payload is too large.");
  }
  const suppliedChecksum = base64UrlToBytes(parts[2]);
  if (!equalBytes(suppliedChecksum, checksum(payload))) {
    throw new Error(
      "Payment link integrity check failed; the link may be damaged or tampered with.",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(fatalTextDecoder.decode(payload));
  } catch {
    throw new Error("Payment link payload is not valid UTF-8 JSON.");
  }

  const request = requestFromTuple(decoded);
  if (!equalBytes(payload, serializeRequest(request))) {
    throw new Error("Payment link payload is not canonical.");
  }
  return request;
}

/** Build an absolute /pay URL with the request only in its fragment. */
export function createPaymentLink(
  request: PaymentRequestPayload,
  baseUrl: string,
): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("A valid HTTP(S) base URL is required for a payment link.");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("A valid HTTP(S) base URL is required for a payment link.");
  }

  const url = new URL(PAYMENT_LINK_PATH, base.origin);
  url.search = "";
  url.hash = encodePaymentLinkFragment(request).slice(1);
  return url.toString();
}
