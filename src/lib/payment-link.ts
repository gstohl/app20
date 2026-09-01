import { sha256 } from "@noble/hashes/sha2.js";
import { constants } from "starknet";
import {
  LOCALNET_CHAIN_ID,
  addrSTRK,
  localnetWalletEnabled,
} from "../utils/constants";
import { canonicalizeStarknetAddress, feltEquals } from "./addresses";
import {
  createMailSenderAuth,
  parseMailSenderAuth,
  verifyMailSenderAuth,
  type MailSenderAuth,
} from "./mail-auth";
import {
  createRequestId,
  isRandom32ByteId,
  parseDecimalToBaseUnits,
  parsePaymentRequestPayload,
  type PaymentRequestPayload,
} from "./otc";
import {
  resolveCanonicalToken,
  type App20TokenNetwork,
} from "./token-registry";

export const PAYMENT_LINK_PATH = "/pay";
export const PAYMENT_LINK_VERSION = "app20p2" as const;
export const SIGNED_PAYMENT_LINK_VERSION = "app20p3" as const;
export const PAYMENT_LINK_SIGNATURE_DOMAIN =
  "app20/payment-link-signature/v1" as const;
export const MAX_PAYMENT_LINK_FRAGMENT_LENGTH = 2_048;
export const DEFAULT_PAYMENT_LINK_EXPIRY_HOURS = "72";
export const MAX_PAYMENT_LINK_EXPIRY_HOURS = 24 * 365;

export type PaymentLinkRequestInput = {
  amount: string;
  memo?: string;
  expiryHours: string;
  requester: string;
  chainId: string;
  token?: "STRK" | "USDC";
};

export type PaymentLinkRequestOptions = {
  atSeconds?: number;
  requestId?: string;
};

export type PaymentLinkAuthenticity =
  | { kind: "unsigned" }
  | {
      kind: "verified";
      mailboxPublicKey: string;
      authPublicKey: string;
    };

export type DecodedPaymentLink = {
  request: PaymentRequestPayload;
  authenticity: PaymentLinkAuthenticity;
};

const MAX_PAYMENT_LINK_PAYLOAD_BYTES = 1_450;
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_DATE_SECONDS = 8_640_000_000_000;
const CHECKSUM_DOMAIN = new TextEncoder().encode("app20/payment-link/v2\0");
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
  chainId: string,
  invoiceId: string | null,
];

type EncodedPaymentLinkSignature = [
  version: 1,
  mailboxPublicKey: string,
  authPublicKey: string,
  signature: string,
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
  if (!value || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
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

export function normalizePaymentLinkChainId(chainId: string): string {
  if (
    chainId === "SN_MAIN" ||
    feltEquals(chainId, constants.StarknetChainId.SN_MAIN)
  ) {
    return "SN_MAIN";
  }
  if (
    chainId === "SN_SEPOLIA" ||
    feltEquals(chainId, constants.StarknetChainId.SN_SEPOLIA)
  ) {
    return "SN_SEPOLIA";
  }
  if (localnetWalletEnabled && feltEquals(chainId, LOCALNET_CHAIN_ID)) {
    return LOCALNET_CHAIN_ID;
  }
  throw new Error("Payment links require Mainnet or Sepolia.");
}

export function paymentLinkChainIdsEqual(left: string, right: string): boolean {
  try {
    return (
      normalizePaymentLinkChainId(left) === normalizePaymentLinkChainId(right)
    );
  } catch {
    return false;
  }
}

export function paymentLinkNetworkLabel(chainId: string): string {
  const normalized = normalizePaymentLinkChainId(chainId);
  if (normalized === "SN_MAIN") return "Mainnet";
  if (normalized === "SN_SEPOLIA") return "Sepolia";
  return "Localnet (dev)";
}

function paymentLinkTokenNetwork(chainId: string): App20TokenNetwork {
  const normalized = normalizePaymentLinkChainId(chainId);
  if (normalized === "SN_MAIN") return "mainnet";
  if (normalized === "SN_SEPOLIA") return "sepolia";
  return "localnet";
}

export function paymentLinkSupportsUsdc(chainId: string): boolean {
  try {
    return paymentLinkTokenNetwork(chainId) === "localnet";
  } catch {
    return false;
  }
}

function normalizePaymentRequest(
  value: PaymentRequestPayload,
): PaymentRequestPayload {
  if (!isObject(value) || !isObject(value.token)) {
    throw new Error("Payment link request is malformed.");
  }
  if (!isRandom32ByteId(value.requestId)) {
    throw new Error("Payment link requestId must be a 32-byte hexadecimal id.");
  }
  if (value.invoiceId !== undefined && !isRandom32ByteId(value.invoiceId)) {
    throw new Error("Payment link invoiceId must be a 32-byte hexadecimal id.");
  }
  if (typeof value.chainId !== "string") {
    throw new Error("Payment links must name their Starknet network.");
  }
  const chainId = normalizePaymentLinkChainId(value.chainId);
  const network = paymentLinkTokenNetwork(chainId);
  const tokenAddress = value.token.address;
  const tokenResolution =
    typeof tokenAddress === "string"
      ? resolveCanonicalToken(network, tokenAddress)
      : null;
  const token = tokenResolution?.ok ? tokenResolution.token : null;
  const tokenAllowed =
    token !== null &&
    (token.key === "strk" ||
      (network === "localnet" && token.key === "usdc")) &&
    value.token.symbol === token.symbol &&
    value.token.decimals === token.decimals;
  if (!tokenAllowed || !token) {
    throw new Error(
      network === "localnet"
        ? "Localnet payment links require registry-resolved STRK or USDC metadata."
        : "Payment links require canonical STRK metadata (address, symbol, and 18 decimals) on public networks.",
    );
  }

  if (
    typeof value.amount === "string" &&
    /^(?:0|[1-9]\d*)$/.test(value.amount) &&
    BigInt(value.amount) > MAX_UINT256
  ) {
    throw new Error("Payment link amount exceeds the uint256 token limit.");
  }

  const parsed = parsePaymentRequestPayload(value);
  if (!parsed) throw new Error("Payment link request is malformed.");
  if (BigInt(parsed.requester) === 0n) {
    throw new Error(
      "Payment link requester must be a non-zero Starknet address.",
    );
  }
  if (parsed.expiresAt > MAX_DATE_SECONDS) {
    throw new Error(
      "Payment link expiry is outside the displayable date range.",
    );
  }

  return {
    requestId: parsed.requestId.toLowerCase(),
    token: {
      address: token.key === "strk" ? addrSTRK : token.address,
      symbol: token.symbol,
      decimals: token.decimals,
    },
    amount: parsed.amount,
    expiresAt: parsed.expiresAt,
    requester: canonicalizeStarknetAddress(parsed.requester),
    chainId,
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
    normalized.chainId ?? "",
    normalized.invoiceId?.slice(2) ?? null,
  ];
}

function serializeRequest(request: PaymentRequestPayload): Uint8Array {
  return textEncoder.encode(JSON.stringify(requestTuple(request)));
}

export function digestPaymentLinkRequest(
  request: PaymentRequestPayload,
): string {
  return `sha256:${Array.from(checksum(serializeRequest(request)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function paymentLinkAuthSubject(request: PaymentRequestPayload): {
  documentId: string;
  conversationId: string;
  inReplyTo: string;
  body: string;
} {
  const normalized = normalizePaymentRequest(request);
  return {
    documentId: normalized.requestId,
    conversationId: PAYMENT_LINK_SIGNATURE_DOMAIN,
    inReplyTo: normalized.invoiceId ?? "",
    body: digestPaymentLinkRequest(normalized),
  };
}

/** Sign all canonical request terms with the requester's derived Mail auth key. */
export function signPaymentLinkRequest(
  request: PaymentRequestPayload,
  mailboxSeed: Uint8Array,
  mailboxPublicKey: Uint8Array,
): MailSenderAuth {
  return createMailSenderAuth(
    mailboxSeed,
    mailboxPublicKey,
    paymentLinkAuthSubject(request),
  );
}

/** Verify a Mail signature over the complete canonical payment request. */
export function verifyPaymentLinkRequestSignature(
  request: PaymentRequestPayload,
  value: unknown,
): PaymentLinkAuthenticity | null {
  const auth = parseMailSenderAuth(value);
  if (!auth || !verifyMailSenderAuth(auth, paymentLinkAuthSubject(request))) {
    return null;
  }
  return {
    kind: "verified",
    mailboxPublicKey: auth.mailboxPublicKey,
    authPublicKey: auth.authPublicKey,
  };
}

/** Build one canonical, unsigned reviewed-token request from user-entered fields. */
export function createPaymentLinkRequest(
  input: PaymentLinkRequestInput,
  options: PaymentLinkRequestOptions = {},
): PaymentRequestPayload {
  const expiryText = input.expiryHours.trim();
  if (!/^\d+$/.test(expiryText)) {
    throw new Error("Expiry must be a whole number of hours.");
  }
  const expiryHours = Number(expiryText);
  if (
    !Number.isSafeInteger(expiryHours) ||
    expiryHours < 0 ||
    expiryHours > MAX_PAYMENT_LINK_EXPIRY_HOURS
  ) {
    throw new Error(
      `Expiry must be between 0 and ${MAX_PAYMENT_LINK_EXPIRY_HOURS} hours.`,
    );
  }

  const atSeconds = options.atSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(atSeconds) || atSeconds < 0) {
    throw new Error("The current time is outside the supported date range.");
  }

  const memo = input.memo?.trim() ?? "";
  if (memo.length > 512) {
    throw new Error("Payment link memo must be at most 512 characters.");
  }
  const chainId = normalizePaymentLinkChainId(input.chainId);
  const network = paymentLinkTokenNetwork(chainId);
  const requestedSymbol = input.token ?? "STRK";
  const resolution = resolveCanonicalToken(
    network,
    requestedSymbol.toLowerCase(),
  );
  if (
    !resolution.ok ||
    (resolution.token.key === "usdc" && network !== "localnet")
  ) {
    throw new Error(
      "USDC payment links are available only for the registry-resolved localnet token; public networks remain STRK-only.",
    );
  }
  const token = resolution.token;

  return normalizePaymentRequest({
    requestId: options.requestId ?? createRequestId(),
    token: {
      symbol: token.symbol,
      address: token.key === "strk" ? addrSTRK : token.address,
      decimals: token.decimals,
    },
    amount: parseDecimalToBaseUnits(input.amount, token.decimals),
    expiresAt: expiryHours === 0 ? 0 : atSeconds + expiryHours * 60 * 60,
    requester: input.requester,
    chainId,
    ...(memo ? { memo } : {}),
  });
}

function requestFromTuple(value: unknown): PaymentRequestPayload {
  if (!Array.isArray(value) || value.length !== 10) {
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
    chainId,
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
    typeof chainId !== "string" ||
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
    chainId,
    ...(memo === null ? {} : { memo }),
    ...(invoiceId === null ? {} : { invoiceId: `0x${invoiceId}` }),
  });
}

function signatureTuple(auth: MailSenderAuth): EncodedPaymentLinkSignature {
  const normalized = parseMailSenderAuth(auth);
  if (!normalized) throw new Error("Payment link Mail signature is malformed.");
  return [
    normalized.version,
    normalized.mailboxPublicKey,
    normalized.authPublicKey,
    normalized.signature,
  ];
}

function signatureFromTuple(value: unknown): MailSenderAuth | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value[0] !== 1 ||
    typeof value[1] !== "string" ||
    typeof value[2] !== "string" ||
    typeof value[3] !== "string"
  ) {
    return null;
  }
  return parseMailSenderAuth({
    version: value[0],
    mailboxPublicKey: value[1],
    authPublicKey: value[2],
    signature: value[3],
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

/** Encode a signed request. Neither the Mail seed nor any private key is serialized. */
export function encodeSignedPaymentLinkFragment(
  request: PaymentRequestPayload,
  auth: MailSenderAuth,
): string {
  const payload = serializeRequest(request);
  if (payload.length > MAX_PAYMENT_LINK_PAYLOAD_BYTES) {
    throw new Error("Payment request is too large for a shareable link.");
  }
  const proof = textEncoder.encode(JSON.stringify(signatureTuple(auth)));
  const fragment = `#${SIGNED_PAYMENT_LINK_VERSION}.${bytesToBase64Url(
    payload,
  )}.${bytesToBase64Url(checksum(payload))}.${bytesToBase64Url(proof)}`;
  if (fragment.length > MAX_PAYMENT_LINK_FRAGMENT_LENGTH) {
    throw new Error(
      "Payment request is too large for a signed shareable link.",
    );
  }
  return fragment;
}

/** Sign and encode a payment request using the requester's Mail identity. */
export function createSignedPaymentLinkFragment(
  request: PaymentRequestPayload,
  mailboxSeed: Uint8Array,
  mailboxPublicKey: Uint8Array,
): string {
  return encodeSignedPaymentLinkFragment(
    request,
    signPaymentLinkRequest(request, mailboxSeed, mailboxPublicKey),
  );
}

/** Decode a legacy unsigned or Mail-signed link and report its authenticity. */
export function decodePaymentLink(fragment: string): DecodedPaymentLink {
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
  if (
    version !== PAYMENT_LINK_VERSION &&
    version !== SIGNED_PAYMENT_LINK_VERSION
  ) {
    throw new Error("Unsupported payment link version.");
  }

  const parts = encoded.split(".");
  const expectedParts = version === SIGNED_PAYMENT_LINK_VERSION ? 4 : 3;
  if (parts.length !== expectedParts || parts.some((part) => !part)) {
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

  if (version === PAYMENT_LINK_VERSION) {
    return { request, authenticity: { kind: "unsigned" } };
  }

  let proofValue: unknown;
  let proofBytes: Uint8Array;
  try {
    proofBytes = base64UrlToBytes(parts[3]);
    proofValue = JSON.parse(fatalTextDecoder.decode(proofBytes));
  } catch {
    throw new Error(
      "Payment link signature verification failed; the request must not be trusted.",
    );
  }
  const auth = signatureFromTuple(proofValue);
  const authenticity = verifyPaymentLinkRequestSignature(request, auth);
  if (
    !auth ||
    !authenticity ||
    !equalBytes(
      proofBytes,
      textEncoder.encode(JSON.stringify(signatureTuple(auth))),
    )
  ) {
    throw new Error(
      "Payment link signature verification failed; the request terms may have been tampered with.",
    );
  }
  return { request, authenticity };
}

/** Decode and strictly validate a payment request URL fragment. */
export function decodePaymentLinkFragment(
  fragment: string,
): PaymentRequestPayload {
  return decodePaymentLink(fragment).request;
}

function paymentLinkUrl(fragment: string, baseUrl: string): string {
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
  url.hash = fragment.slice(1);
  return url.toString();
}

/** Build an absolute /pay URL with the request only in its fragment. */
export function createPaymentLink(
  request: PaymentRequestPayload,
  baseUrl: string,
): string {
  return paymentLinkUrl(encodePaymentLinkFragment(request), baseUrl);
}

/** Build an absolute Mail-signed /pay URL without exposing secret key material. */
export function createSignedPaymentLink(
  request: PaymentRequestPayload,
  baseUrl: string,
  mailboxSeed: Uint8Array,
  mailboxPublicKey: Uint8Array,
): string {
  return paymentLinkUrl(
    createSignedPaymentLinkFragment(request, mailboxSeed, mailboxPublicKey),
    baseUrl,
  );
}
