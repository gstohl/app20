import { canonicalizeStarknetFelt } from "@app20/domain";
import type { StarknetPool } from "./index";

export const PRIVATE_RFQ_DOMAIN = "app20/private-rfq/v1" as const;
export const MAKER_DIRECTORY_DOMAIN = "app20/maker-directory-epoch/v1" as const;
export const RFQ_TRANSPORT_DOMAIN = "app20/rfq-transport-envelope/v1" as const;
export const RFQ_TRANSPORT_AAD_DOMAIN = "app20/rfq-transport-aad/v1" as const;
export const RESERVATION_DOMAIN = "app20/maker-reservation/v1" as const;
export const RFQ_HPKE_SUITE =
  "HPKE-v1/DHKEM(P-256,HKDF-SHA256)/HKDF-SHA256/AES-256-GCM" as const;

const DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const P256_COORDINATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_U256 = (1n << 256n) - 1n;
const MAX_DIRECTORY_LIFETIME_SECONDS = 366 * 24 * 60 * 60;
const MAX_RFQ_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_ENVELOPE_LIFETIME_SECONDS = 60 * 60;
const MAX_RESERVATION_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_DIRECTORY_PUBLICATION_LEAD_SECONDS = 24 * 60 * 60;
const PADDING_BUCKETS = new Set([
  512, 1_024, 2_048, 4_096, 8_192, 16_384, 32_768, 65_536,
]);
const VERIFIED_DIRECTORY = Symbol("app20.verified-maker-directory");
const VERIFIED_DIRECTORIES = new WeakSet<object>();

export type P256PublicJwk = Readonly<{
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}>;

export type PrivateRfqV1 = Readonly<{
  version: 1;
  domain: typeof PRIVATE_RFQ_DOMAIN;
  rfqId: string;
  intentDigest: string;
  chainId: StarknetPool;
  registryRevision: string;
  directoryEpoch: number;
  settlementHelper: string;
  sellToken: string;
  sellAmountBaseUnits: bigint;
  buyToken: string;
  minBuyAmountBaseUnits: bigint;
  createdAt: number;
  responseDeadline: number;
  expiresAt: number;
}>;

export type MakerKeyWindow = Readonly<{
  keyId: string;
  publicKey: P256PublicJwk;
  validFrom: number;
  validUntil: number;
  revokedAt?: number;
}>;

export type MakerDirectoryEntryV1 = Readonly<{
  makerId: string;
  settlementAccount: string;
  settlementKeyCommitment: string;
  transportEndpoint: string;
  quoteKeys: readonly MakerKeyWindow[];
  transportKeys: readonly MakerKeyWindow[];
}>;

export type MakerDirectoryEpochBodyV1 = Readonly<{
  version: 1;
  domain: typeof MAKER_DIRECTORY_DOMAIN;
  chainId: StarknetPool;
  epoch: number;
  previousEpochDigest: string | null;
  registryRevision: string;
  issuedAt: number;
  validFrom: number;
  validUntil: number;
  authorityKeyId: string;
  makers: readonly MakerDirectoryEntryV1[];
}>;

export type SignedMakerDirectoryEpochV1 = MakerDirectoryEpochBodyV1 &
  Readonly<{ signature: string }>;

export type DirectoryAuthorityKey = Readonly<{
  keyId: string;
  publicKey: P256PublicJwk;
  validFrom: number;
  validUntil: number;
  revokedAt?: number;
}>;

export type VerifiedMakerDirectoryEpochV1 = Readonly<{
  [VERIFIED_DIRECTORY]: true;
  body: MakerDirectoryEpochBodyV1;
  digest: string;
  status: "future" | "active" | "historical";
  authorityKeyId: string;
}>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export type DirectoryVerificationResult =
  | Readonly<{ ok: true; verified: VerifiedMakerDirectoryEpochV1 }>
  | Readonly<{ ok: false; reason: string }>;

export type DirectoryVerificationOptions = Readonly<{
  now: number;
  expectedChainId: StarknetPool;
  expectedEpoch?: number;
  expectedPreviousEpochDigest?: string | null;
  authorityKeys: readonly DirectoryAuthorityKey[];
  verify: (
    canonical: string,
    signature: string,
    publicKey: P256PublicJwk,
  ) => Promise<boolean>;
}>;

export type RfqTransportAadV1 = Readonly<{
  version: 1;
  domain: typeof RFQ_TRANSPORT_AAD_DOMAIN;
  envelopeId: string;
  rfqDigest: string;
  directoryDigest: string;
  directoryEpoch: number;
  recipientMakerId: string;
  transportKeyId: string;
  createdAt: number;
  expiresAt: number;
  replayNonce: string;
  paddingBucketBytes: number;
}>;

export type EncryptedRfqEnvelopeV1 = Readonly<{
  version: 1;
  domain: typeof RFQ_TRANSPORT_DOMAIN;
  suite: typeof RFQ_HPKE_SUITE;
  aad: RfqTransportAadV1;
  aadDigest: string;
  encapsulatedKey: string;
  ciphertext: string;
  ciphertextBytes: number;
}>;

export interface EnvelopeReplayStore {
  consume(replayNonce: string): boolean;
}

export interface RfqEnvelopeOpener {
  /** Must perform RFC 9180 point validation, HPKE open, and AEAD authentication. */
  open(
    envelope: EncryptedRfqEnvelopeV1,
    transportKey: MakerKeyWindow,
  ): Promise<PrivateRfqV1>;
}

export type AcceptedEncryptedRfqEnvelope = Readonly<{
  transportKey: MakerKeyWindow;
  rfq: PrivateRfqV1;
}>;

export type ReservationState =
  | "reserved"
  | "selected"
  | "filling"
  | "released"
  | "consumed"
  | "expired"
  | "quarantined";

export type MakerReservationV1 = Readonly<{
  version: 1;
  domain: typeof RESERVATION_DOMAIN;
  reservationId: string;
  makerId: string;
  intentDigest: string;
  rfqDigest: string;
  asset: string;
  amountBaseUnits: bigint;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  fence: bigint;
  state: ReservationState;
  selectedQuoteDigest?: string;
  settlementAttemptId?: string;
  settlementTransactionHash?: string;
  terminalReason?: string;
}>;

export type ReservationCommand =
  | Readonly<{
      kind: "select";
      expectedFence: bigint;
      at: number;
      quoteDigest: string;
    }>
  | Readonly<{
      kind: "release";
      expectedFence: bigint;
      at: number;
      reason: string;
    }>
  | Readonly<{
      kind: "begin-fill";
      expectedFence: bigint;
      at: number;
      settlementAttemptId: string;
    }>
  | Readonly<{
      kind: "consume";
      expectedFence: bigint;
      at: number;
      settlementTransactionHash: string;
    }>
  | Readonly<{
      kind: "expire";
      expectedFence: bigint;
      at: number;
    }>
  | Readonly<{
      kind: "quarantine";
      expectedFence: bigint;
      at: number;
      reason: string;
    }>;

export class MakerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MakerProtocolError";
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new MakerProtocolError(`${label} is required.`);
  return normalized;
}

function requirePool(value: StarknetPool): StarknetPool {
  if (
    value !== "starknet:SN_MAIN" &&
    value !== "starknet:SN_SEPOLIA" &&
    value !== "starknet:APP20_LOCALNET"
  ) {
    throw new MakerProtocolError(
      "chainId must name a supported STRK20 deployment.",
    );
  }
  return value;
}

function requireFelt(value: string, label: string): string {
  try {
    const felt = canonicalizeStarknetFelt(value);
    if (felt === "0x0") throw new Error();
    return felt;
  } catch {
    throw new MakerProtocolError(`${label} must be a non-zero Starknet felt.`);
  }
}

function requireDigest(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new MakerProtocolError(`${label} must be a 32-byte hex digest.`);
  }
  return normalized;
}

function requireSignature(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SIGNATURE_PATTERN.test(normalized)) {
    throw new MakerProtocolError(
      "directory signature must be a 64-byte P-256 signature.",
    );
  }
  return normalized;
}

function base64UrlDecodedLength(value: string, label: string): number {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new MakerProtocolError(`${label} must be unpadded base64url.`);
  }
  return Math.floor((value.length * 6) / 8);
}

function requirePositiveU256(value: bigint, label: string): bigint {
  if (value <= 0n || value > MAX_U256) {
    throw new MakerProtocolError(`${label} must be a positive u256 value.`);
  }
  return value;
}

function requireTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MakerProtocolError(
      `${label} must be a positive unix-seconds timestamp.`,
    );
  }
  return value;
}

function requireSafeNonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MakerProtocolError(
      `${label} must be a non-negative safe integer.`,
    );
  }
  return value;
}

function requireP256PublicKey(
  value: P256PublicJwk,
  label: string,
): P256PublicJwk {
  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    !P256_COORDINATE_PATTERN.test(value.x) ||
    !P256_COORDINATE_PATTERN.test(value.y) ||
    "d" in value
  ) {
    throw new MakerProtocolError(
      `${label} must be a public P-256 JWK without private material.`,
    );
  }
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y };
}

function canonicalKeyWindow(key: MakerKeyWindow, label: string) {
  const validFrom = requireTimestamp(key.validFrom, `${label}.validFrom`);
  const validUntil = requireTimestamp(key.validUntil, `${label}.validUntil`);
  if (validUntil <= validFrom) {
    throw new MakerProtocolError(`${label} validity window is empty.`);
  }
  if (key.revokedAt !== undefined) {
    requireTimestamp(key.revokedAt, `${label}.revokedAt`);
    if (key.revokedAt <= validFrom || key.revokedAt > validUntil) {
      throw new MakerProtocolError(
        `${label}.revokedAt must fall inside its validity window.`,
      );
    }
  }
  return {
    keyId: requireText(key.keyId, `${label}.keyId`),
    publicKey: requireP256PublicKey(key.publicKey, `${label}.publicKey`),
    validFrom,
    validUntil,
    ...(key.revokedAt === undefined ? {} : { revokedAt: key.revokedAt }),
  };
}

function canonicalKeyWindows(keys: readonly MakerKeyWindow[], label: string) {
  if (keys.length === 0) {
    throw new MakerProtocolError(`${label} requires at least one key.`);
  }
  const canonical = keys
    .map((key, index) => canonicalKeyWindow(key, `${label}[${index}]`))
    .sort((left, right) => left.keyId.localeCompare(right.keyId));
  if (new Set(canonical.map((key) => key.keyId)).size !== canonical.length) {
    throw new MakerProtocolError(`${label} key IDs must be unique.`);
  }
  return canonical;
}

function requireTransportEndpoint(
  value: string,
  chainId: StarknetPool,
): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new MakerProtocolError("transportEndpoint must be an absolute URL.");
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new MakerProtocolError(
      "transportEndpoint must not contain credentials, query, or fragment data.",
    );
  }
  const localHttp =
    chainId === "starknet:APP20_LOCALNET" &&
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost");
  if (endpoint.protocol !== "https:" && !localHttp) {
    throw new MakerProtocolError(
      "transportEndpoint requires HTTPS outside localnet.",
    );
  }
  return endpoint.toString().replace(/\/$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}

export function canonicalPrivateRfq(rfq: PrivateRfqV1): string {
  if (rfq.version !== 1 || rfq.domain !== PRIVATE_RFQ_DOMAIN) {
    throw new MakerProtocolError("Only private RFQ v1 is supported.");
  }
  const createdAt = requireTimestamp(rfq.createdAt, "createdAt");
  const responseDeadline = requireTimestamp(
    rfq.responseDeadline,
    "responseDeadline",
  );
  const expiresAt = requireTimestamp(rfq.expiresAt, "expiresAt");
  if (
    responseDeadline <= createdAt ||
    expiresAt <= responseDeadline ||
    expiresAt - createdAt > MAX_RFQ_LIFETIME_SECONDS
  ) {
    throw new MakerProtocolError(
      "RFQ deadlines must be ordered and bounded to 24 hours.",
    );
  }
  const sellToken = requireFelt(rfq.sellToken, "sellToken");
  const buyToken = requireFelt(rfq.buyToken, "buyToken");
  if (sellToken === buyToken) {
    throw new MakerProtocolError("sellToken and buyToken must differ.");
  }
  return JSON.stringify({
    chainId: requirePool(rfq.chainId),
    createdAt,
    directoryEpoch: requireSafeNonNegative(
      rfq.directoryEpoch,
      "directoryEpoch",
    ),
    domain: rfq.domain,
    expiresAt,
    intentDigest: requireDigest(rfq.intentDigest, "intentDigest"),
    minBuyAmountBaseUnits: requirePositiveU256(
      rfq.minBuyAmountBaseUnits,
      "minBuyAmountBaseUnits",
    ).toString(),
    buyToken,
    registryRevision: requireText(rfq.registryRevision, "registryRevision"),
    responseDeadline,
    rfqId: requireDigest(rfq.rfqId, "rfqId"),
    sellAmountBaseUnits: requirePositiveU256(
      rfq.sellAmountBaseUnits,
      "sellAmountBaseUnits",
    ).toString(),
    sellToken,
    settlementHelper: requireFelt(rfq.settlementHelper, "settlementHelper"),
    version: rfq.version,
  });
}

export async function digestPrivateRfq(rfq: PrivateRfqV1): Promise<string> {
  return sha256Hex(canonicalPrivateRfq(rfq));
}

function canonicalMakerEntry(
  entry: MakerDirectoryEntryV1,
  chainId: StarknetPool,
) {
  return {
    makerId: requireText(entry.makerId, "makerId"),
    quoteKeys: canonicalKeyWindows(
      entry.quoteKeys,
      `${entry.makerId}.quoteKeys`,
    ),
    settlementAccount: requireFelt(
      entry.settlementAccount,
      "settlementAccount",
    ),
    settlementKeyCommitment: requireDigest(
      entry.settlementKeyCommitment,
      "settlementKeyCommitment",
    ),
    transportEndpoint: requireTransportEndpoint(
      entry.transportEndpoint,
      chainId,
    ),
    transportKeys: canonicalKeyWindows(
      entry.transportKeys,
      `${entry.makerId}.transportKeys`,
    ),
  };
}

export function canonicalMakerDirectoryEpoch(
  epoch: MakerDirectoryEpochBodyV1,
): string {
  if (epoch.version !== 1 || epoch.domain !== MAKER_DIRECTORY_DOMAIN) {
    throw new MakerProtocolError("Only maker directory epoch v1 is supported.");
  }
  const chainId = requirePool(epoch.chainId);
  const epochNumber = requireSafeNonNegative(epoch.epoch, "epoch");
  const issuedAt = requireTimestamp(epoch.issuedAt, "issuedAt");
  const validFrom = requireTimestamp(epoch.validFrom, "validFrom");
  const validUntil = requireTimestamp(epoch.validUntil, "validUntil");
  if (
    issuedAt > validFrom ||
    validFrom - issuedAt > MAX_DIRECTORY_PUBLICATION_LEAD_SECONDS
  ) {
    throw new MakerProtocolError(
      "Directory issuedAt must be at most 24 hours before validFrom.",
    );
  }
  if (
    validUntil <= validFrom ||
    validUntil - validFrom > MAX_DIRECTORY_LIFETIME_SECONDS
  ) {
    throw new MakerProtocolError(
      "Directory validity must be positive and at most 366 days.",
    );
  }
  if (epochNumber === 0 && epoch.previousEpochDigest !== null) {
    throw new MakerProtocolError(
      "Directory epoch zero must not name a predecessor.",
    );
  }
  if (epochNumber > 0 && epoch.previousEpochDigest === null) {
    throw new MakerProtocolError(
      "Non-zero directory epochs require a predecessor digest.",
    );
  }
  const makers = epoch.makers
    .map((maker) => canonicalMakerEntry(maker, chainId))
    .sort((left, right) => left.makerId.localeCompare(right.makerId));
  if (makers.length === 0) {
    throw new MakerProtocolError(
      "Directory epoch requires at least one maker.",
    );
  }
  if (new Set(makers.map((maker) => maker.makerId)).size !== makers.length) {
    throw new MakerProtocolError("Directory maker IDs must be unique.");
  }
  return JSON.stringify({
    authorityKeyId: requireText(epoch.authorityKeyId, "authorityKeyId"),
    chainId,
    domain: epoch.domain,
    epoch: epochNumber,
    issuedAt,
    makers,
    previousEpochDigest:
      epoch.previousEpochDigest === null
        ? null
        : requireDigest(epoch.previousEpochDigest, "previousEpochDigest"),
    registryRevision: requireText(epoch.registryRevision, "registryRevision"),
    validFrom,
    validUntil,
    version: epoch.version,
  });
}

export async function digestMakerDirectoryEpoch(
  epoch: MakerDirectoryEpochBodyV1,
): Promise<string> {
  return sha256Hex(canonicalMakerDirectoryEpoch(epoch));
}

function canonicalAuthorityKey(
  key: DirectoryAuthorityKey,
): DirectoryAuthorityKey {
  return canonicalKeyWindow(key, `authorityKeys.${key.keyId}`);
}

export async function verifyMakerDirectoryEpoch(
  epoch: SignedMakerDirectoryEpochV1,
  options: DirectoryVerificationOptions,
): Promise<DirectoryVerificationResult> {
  try {
    const now = requireTimestamp(options.now, "now");
    const canonical = canonicalMakerDirectoryEpoch(epoch);
    if (epoch.chainId !== options.expectedChainId) {
      return {
        ok: false,
        reason: "Directory chain does not match the active chain.",
      };
    }
    if (
      options.expectedEpoch !== undefined &&
      epoch.epoch !== options.expectedEpoch
    ) {
      return {
        ok: false,
        reason: "Directory epoch is not the expected epoch.",
      };
    }
    if (options.expectedPreviousEpochDigest !== undefined) {
      const expected =
        options.expectedPreviousEpochDigest === null
          ? null
          : requireDigest(
              options.expectedPreviousEpochDigest,
              "expectedPreviousEpochDigest",
            );
      const actual =
        epoch.previousEpochDigest === null
          ? null
          : requireDigest(epoch.previousEpochDigest, "previousEpochDigest");
      if (expected !== actual) {
        return {
          ok: false,
          reason: "Directory predecessor digest does not match.",
        };
      }
    }
    const matching = options.authorityKeys
      .map(canonicalAuthorityKey)
      .filter((key) => key.keyId === epoch.authorityKeyId);
    if (matching.length !== 1) {
      return {
        ok: false,
        reason: "Directory authority key is unknown or ambiguous.",
      };
    }
    const authority = matching[0];
    if (!authority) {
      return { ok: false, reason: "Directory authority key is unavailable." };
    }
    if (
      epoch.issuedAt < authority.validFrom ||
      epoch.issuedAt >= authority.validUntil ||
      (authority.revokedAt !== undefined &&
        epoch.issuedAt >= authority.revokedAt)
    ) {
      return {
        ok: false,
        reason:
          "Directory was not signed during the authority key's valid history.",
      };
    }
    const signature = requireSignature(epoch.signature);
    if (!(await options.verify(canonical, signature, authority.publicKey))) {
      return { ok: false, reason: "Directory signature verification failed." };
    }
    let status: VerifiedMakerDirectoryEpochV1["status"];
    if (now < epoch.validFrom) status = "future";
    else if (now < epoch.validUntil) status = "active";
    else status = "historical";
    const verified = deepFreeze({
      [VERIFIED_DIRECTORY]: true as const,
      body: deepFreeze(JSON.parse(canonical) as MakerDirectoryEpochBodyV1),
      digest: await sha256Hex(canonical),
      status,
      authorityKeyId: authority.keyId,
    });
    VERIFIED_DIRECTORIES.add(verified);
    return { ok: true, verified };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : "Directory verification failed.",
    };
  }
}

function resolveMakerKey(
  epoch: MakerDirectoryEpochBodyV1,
  makerId: string,
  keyId: string,
  at: number,
  purpose: "quote" | "transport",
): MakerKeyWindow {
  canonicalMakerDirectoryEpoch(epoch);
  const timestamp = requireTimestamp(at, "key resolution time");
  const maker = epoch.makers.find(
    (candidate) => candidate.makerId.trim() === requireText(makerId, "makerId"),
  );
  if (!maker)
    throw new MakerProtocolError(
      "Maker is not present in this directory epoch.",
    );
  const keys = purpose === "quote" ? maker.quoteKeys : maker.transportKeys;
  const key = keys.find(
    (candidate) => candidate.keyId.trim() === requireText(keyId, "keyId"),
  );
  if (!key)
    throw new MakerProtocolError(`Maker ${purpose} key is not in this epoch.`);
  if (
    timestamp < key.validFrom ||
    timestamp >= key.validUntil ||
    (key.revokedAt !== undefined && timestamp >= key.revokedAt)
  ) {
    throw new MakerProtocolError(
      `Maker ${purpose} key is not valid at the requested time.`,
    );
  }
  return canonicalKeyWindow(key, `${maker.makerId}.${purpose}Key`);
}

function requireVerifiedDirectory(
  directory: VerifiedMakerDirectoryEpochV1,
): void {
  if (
    directory[VERIFIED_DIRECTORY] !== true ||
    !VERIFIED_DIRECTORIES.has(directory)
  ) {
    throw new MakerProtocolError(
      "Maker directory must come from signature verification.",
    );
  }
}

export function resolveMakerQuoteKeyAt(
  directory: VerifiedMakerDirectoryEpochV1,
  makerId: string,
  keyId: string,
  at: number,
): MakerKeyWindow {
  requireVerifiedDirectory(directory);
  return resolveMakerKey(directory.body, makerId, keyId, at, "quote");
}

export function resolveMakerTransportKeyAt(
  directory: VerifiedMakerDirectoryEpochV1,
  makerId: string,
  keyId: string,
  at: number,
): MakerKeyWindow {
  requireVerifiedDirectory(directory);
  return resolveMakerKey(directory.body, makerId, keyId, at, "transport");
}

export function canonicalRfqTransportAad(aad: RfqTransportAadV1): string {
  if (aad.version !== 1 || aad.domain !== RFQ_TRANSPORT_AAD_DOMAIN) {
    throw new MakerProtocolError("Only RFQ transport AAD v1 is supported.");
  }
  const createdAt = requireTimestamp(aad.createdAt, "aad.createdAt");
  const expiresAt = requireTimestamp(aad.expiresAt, "aad.expiresAt");
  if (
    expiresAt <= createdAt ||
    expiresAt - createdAt > MAX_ENVELOPE_LIFETIME_SECONDS
  ) {
    throw new MakerProtocolError(
      "RFQ transport lifetime must be positive and at most one hour.",
    );
  }
  if (!PADDING_BUCKETS.has(aad.paddingBucketBytes)) {
    throw new MakerProtocolError(
      "paddingBucketBytes must use a reviewed padding bucket.",
    );
  }
  return JSON.stringify({
    createdAt,
    directoryDigest: requireDigest(aad.directoryDigest, "aad.directoryDigest"),
    directoryEpoch: requireSafeNonNegative(
      aad.directoryEpoch,
      "aad.directoryEpoch",
    ),
    domain: aad.domain,
    envelopeId: requireDigest(aad.envelopeId, "aad.envelopeId"),
    expiresAt,
    paddingBucketBytes: aad.paddingBucketBytes,
    recipientMakerId: requireText(aad.recipientMakerId, "aad.recipientMakerId"),
    replayNonce: requireDigest(aad.replayNonce, "aad.replayNonce"),
    rfqDigest: requireDigest(aad.rfqDigest, "aad.rfqDigest"),
    transportKeyId: requireText(aad.transportKeyId, "aad.transportKeyId"),
    version: aad.version,
  });
}

export async function digestRfqTransportAad(
  aad: RfqTransportAadV1,
): Promise<string> {
  return sha256Hex(canonicalRfqTransportAad(aad));
}

export async function assertEncryptedRfqEnvelope(
  envelope: EncryptedRfqEnvelopeV1,
): Promise<void> {
  if (
    envelope.version !== 1 ||
    envelope.domain !== RFQ_TRANSPORT_DOMAIN ||
    envelope.suite !== RFQ_HPKE_SUITE
  ) {
    throw new MakerProtocolError(
      "RFQ envelope must use the reviewed v1 HPKE suite.",
    );
  }
  if (
    base64UrlDecodedLength(envelope.encapsulatedKey, "encapsulatedKey") !== 65
  ) {
    throw new MakerProtocolError(
      "RFQ encapsulated P-256 key must be 65 bytes.",
    );
  }
  const ciphertextBytes = base64UrlDecodedLength(
    envelope.ciphertext,
    "ciphertext",
  );
  if (
    !Number.isSafeInteger(envelope.ciphertextBytes) ||
    envelope.ciphertextBytes <= 16 ||
    envelope.ciphertextBytes !== ciphertextBytes ||
    ciphertextBytes !== envelope.aad.paddingBucketBytes
  ) {
    throw new MakerProtocolError(
      "RFQ ciphertext must fill its declared padding bucket.",
    );
  }
  const expectedAadDigest = await digestRfqTransportAad(envelope.aad);
  if (requireDigest(envelope.aadDigest, "aadDigest") !== expectedAadDigest) {
    throw new MakerProtocolError(
      "RFQ envelope AAD digest does not match its header.",
    );
  }
}

export function createMemoryEnvelopeReplayStore(): EnvelopeReplayStore {
  const consumed = new Set<string>();
  return {
    consume(replayNonce) {
      const canonical = requireDigest(replayNonce, "replayNonce");
      if (consumed.has(canonical)) return false;
      consumed.add(canonical);
      return true;
    },
  };
}

export async function acceptEncryptedRfqEnvelope(
  envelope: EncryptedRfqEnvelopeV1,
  now: number,
  directory: VerifiedMakerDirectoryEpochV1,
  replayStore: EnvelopeReplayStore,
  opener: RfqEnvelopeOpener,
): Promise<AcceptedEncryptedRfqEnvelope> {
  await assertEncryptedRfqEnvelope(envelope);
  requireVerifiedDirectory(directory);
  if (
    (await sha256Hex(canonicalMakerDirectoryEpoch(directory.body))) !==
    directory.digest
  ) {
    throw new MakerProtocolError(
      "Verified maker directory body no longer matches its signed digest.",
    );
  }
  const timestamp = requireTimestamp(now, "now");
  if (
    timestamp < envelope.aad.createdAt ||
    timestamp >= envelope.aad.expiresAt
  ) {
    throw new MakerProtocolError(
      "RFQ envelope is not active at the requested time.",
    );
  }
  if (
    timestamp < directory.body.validFrom ||
    timestamp >= directory.body.validUntil
  ) {
    throw new MakerProtocolError("Verified maker directory is not active.");
  }
  if (directory.body.epoch !== envelope.aad.directoryEpoch) {
    throw new MakerProtocolError(
      "RFQ envelope names a different directory epoch.",
    );
  }
  if (
    envelope.aad.createdAt < directory.body.validFrom ||
    envelope.aad.createdAt >= directory.body.validUntil
  ) {
    throw new MakerProtocolError(
      "RFQ envelope was not created in the verified directory window.",
    );
  }
  if (
    requireDigest(directory.digest, "verified directory digest") !==
    requireDigest(envelope.aad.directoryDigest, "directoryDigest")
  ) {
    throw new MakerProtocolError(
      "RFQ envelope directory digest does not match.",
    );
  }
  const key = resolveMakerTransportKeyAt(
    directory,
    envelope.aad.recipientMakerId,
    envelope.aad.transportKeyId,
    envelope.aad.createdAt,
  );
  let rfq: PrivateRfqV1;
  try {
    rfq = await opener.open(envelope, key);
  } catch {
    throw new MakerProtocolError(
      "RFQ envelope HPKE authentication or decryption failed.",
    );
  }
  const rfqDigest = await digestPrivateRfq(rfq);
  if (
    rfqDigest !== requireDigest(envelope.aad.rfqDigest, "rfqDigest") ||
    rfq.chainId !== directory.body.chainId ||
    rfq.directoryEpoch !== directory.body.epoch ||
    rfq.registryRevision !== directory.body.registryRevision ||
    envelope.aad.createdAt < rfq.createdAt ||
    envelope.aad.expiresAt > rfq.responseDeadline ||
    envelope.aad.expiresAt > rfq.expiresAt
  ) {
    throw new MakerProtocolError(
      "Decrypted RFQ does not match the authenticated envelope context.",
    );
  }
  if (!replayStore.consume(envelope.aad.replayNonce)) {
    throw new MakerProtocolError("RFQ envelope replay was refused.");
  }
  return deepFreeze({ transportKey: key, rfq: deepFreeze(rfq) });
}

function assertReservation(reservation: MakerReservationV1): void {
  if (reservation.version !== 1 || reservation.domain !== RESERVATION_DOMAIN) {
    throw new MakerProtocolError("Only maker reservation v1 is supported.");
  }
  requireDigest(reservation.reservationId, "reservationId");
  requireText(reservation.makerId, "makerId");
  requireDigest(reservation.intentDigest, "intentDigest");
  requireDigest(reservation.rfqDigest, "rfqDigest");
  requireFelt(reservation.asset, "asset");
  requirePositiveU256(reservation.amountBaseUnits, "amountBaseUnits");
  const createdAt = requireTimestamp(reservation.createdAt, "createdAt");
  const expiresAt = requireTimestamp(reservation.expiresAt, "expiresAt");
  const updatedAt = requireTimestamp(reservation.updatedAt, "updatedAt");
  if (
    expiresAt <= createdAt ||
    expiresAt - createdAt > MAX_RESERVATION_LIFETIME_SECONDS ||
    updatedAt < createdAt
  ) {
    throw new MakerProtocolError(
      "Reservation timestamps are inconsistent or exceed 24 hours.",
    );
  }
  if (reservation.fence <= 0n || reservation.fence > MAX_U256) {
    throw new MakerProtocolError(
      "Reservation fence must be a positive u256 value.",
    );
  }
  if (
    reservation.state === "selected" ||
    reservation.state === "filling" ||
    reservation.state === "consumed"
  ) {
    requireDigest(reservation.selectedQuoteDigest ?? "", "selectedQuoteDigest");
  }
  if (reservation.state === "filling" || reservation.state === "consumed") {
    requireDigest(reservation.settlementAttemptId ?? "", "settlementAttemptId");
  }
  if (reservation.state === "consumed") {
    requireFelt(
      reservation.settlementTransactionHash ?? "",
      "settlementTransactionHash",
    );
  }
  if (
    (reservation.state === "released" || reservation.state === "quarantined") &&
    !reservation.terminalReason?.trim()
  ) {
    throw new MakerProtocolError(
      `${reservation.state} reservation requires a reason.`,
    );
  }
}

export function createMakerReservation(
  input: Readonly<{
    reservationId: string;
    makerId: string;
    intentDigest: string;
    rfqDigest: string;
    asset: string;
    amountBaseUnits: bigint;
    createdAt: number;
    expiresAt: number;
    fence: bigint;
  }>,
): MakerReservationV1 {
  const reservation: MakerReservationV1 = {
    version: 1,
    domain: RESERVATION_DOMAIN,
    reservationId: requireDigest(input.reservationId, "reservationId"),
    makerId: requireText(input.makerId, "makerId"),
    intentDigest: requireDigest(input.intentDigest, "intentDigest"),
    rfqDigest: requireDigest(input.rfqDigest, "rfqDigest"),
    asset: requireFelt(input.asset, "asset"),
    amountBaseUnits: requirePositiveU256(
      input.amountBaseUnits,
      "amountBaseUnits",
    ),
    createdAt: requireTimestamp(input.createdAt, "createdAt"),
    expiresAt: requireTimestamp(input.expiresAt, "expiresAt"),
    updatedAt: requireTimestamp(input.createdAt, "createdAt"),
    fence: requirePositiveU256(input.fence, "fence"),
    state: "reserved",
  };
  assertReservation(reservation);
  return reservation;
}

export function transitionMakerReservation(
  reservation: MakerReservationV1,
  command: ReservationCommand,
): MakerReservationV1 {
  assertReservation(reservation);
  if (command.expectedFence !== reservation.fence) {
    throw new MakerProtocolError("Reservation fence is stale.");
  }
  if (
    reservation.state === "released" ||
    reservation.state === "consumed" ||
    reservation.state === "expired" ||
    reservation.state === "quarantined"
  ) {
    throw new MakerProtocolError(
      "Terminal reservation state cannot transition.",
    );
  }
  const at = requireTimestamp(command.at, "transition time");
  if (at < reservation.updatedAt) {
    throw new MakerProtocolError(
      "Reservation transition time moved backwards.",
    );
  }
  const nextFence = requirePositiveU256(reservation.fence + 1n, "next fence");
  let next: MakerReservationV1;
  switch (command.kind) {
    case "select":
      if (reservation.state !== "reserved" || at >= reservation.expiresAt) {
        throw new MakerProtocolError(
          "Only an active reserved quote can be selected.",
        );
      }
      next = {
        ...reservation,
        updatedAt: at,
        fence: nextFence,
        state: "selected",
        selectedQuoteDigest: requireDigest(command.quoteDigest, "quoteDigest"),
      };
      break;
    case "release":
      if (reservation.state === "filling") {
        throw new MakerProtocolError(
          "An in-flight fill can only be consumed or quarantined.",
        );
      }
      if (at >= reservation.expiresAt) {
        throw new MakerProtocolError(
          "Expired reservations must use the expire transition.",
        );
      }
      next = {
        ...reservation,
        updatedAt: at,
        fence: nextFence,
        state: "released",
        terminalReason: requireText(command.reason, "release reason"),
      };
      break;
    case "begin-fill":
      if (reservation.state !== "selected" || at >= reservation.expiresAt) {
        throw new MakerProtocolError(
          "Only an active selected reservation can begin filling.",
        );
      }
      next = {
        ...reservation,
        updatedAt: at,
        fence: nextFence,
        state: "filling",
        settlementAttemptId: requireDigest(
          command.settlementAttemptId,
          "settlementAttemptId",
        ),
      };
      break;
    case "consume":
      if (reservation.state !== "filling") {
        throw new MakerProtocolError("Only an in-flight fill can be consumed.");
      }
      next = {
        ...reservation,
        updatedAt: at,
        fence: nextFence,
        state: "consumed",
        settlementTransactionHash: requireFelt(
          command.settlementTransactionHash,
          "settlementTransactionHash",
        ),
      };
      break;
    case "expire":
      if (reservation.state !== "reserved" || at < reservation.expiresAt) {
        throw new MakerProtocolError(
          "Only an elapsed unselected reservation can expire.",
        );
      }
      next = {
        ...reservation,
        updatedAt: at,
        fence: nextFence,
        state: "expired",
      };
      break;
    case "quarantine":
      next = {
        ...reservation,
        updatedAt: at,
        fence: nextFence,
        state: "quarantined",
        terminalReason: requireText(command.reason, "quarantine reason"),
      };
      break;
    default: {
      const unsupported: never = command;
      throw new MakerProtocolError(
        `Unsupported reservation transition: ${String(unsupported)}`,
      );
    }
  }
  assertReservation(next);
  return next;
}

export function canonicalMakerReservation(
  reservation: MakerReservationV1,
): string {
  assertReservation(reservation);
  return JSON.stringify({
    amountBaseUnits: reservation.amountBaseUnits.toString(),
    asset: requireFelt(reservation.asset, "asset"),
    createdAt: reservation.createdAt,
    domain: reservation.domain,
    expiresAt: reservation.expiresAt,
    fence: reservation.fence.toString(),
    intentDigest: requireDigest(reservation.intentDigest, "intentDigest"),
    makerId: requireText(reservation.makerId, "makerId"),
    reservationId: requireDigest(reservation.reservationId, "reservationId"),
    rfqDigest: requireDigest(reservation.rfqDigest, "rfqDigest"),
    ...(reservation.selectedQuoteDigest === undefined
      ? {}
      : {
          selectedQuoteDigest: requireDigest(
            reservation.selectedQuoteDigest,
            "selectedQuoteDigest",
          ),
        }),
    ...(reservation.settlementAttemptId === undefined
      ? {}
      : {
          settlementAttemptId: requireDigest(
            reservation.settlementAttemptId,
            "settlementAttemptId",
          ),
        }),
    ...(reservation.settlementTransactionHash === undefined
      ? {}
      : {
          settlementTransactionHash: requireFelt(
            reservation.settlementTransactionHash,
            "settlementTransactionHash",
          ),
        }),
    state: reservation.state,
    ...(reservation.terminalReason === undefined
      ? {}
      : {
          terminalReason: requireText(
            reservation.terminalReason,
            "terminalReason",
          ),
        }),
    updatedAt: reservation.updatedAt,
    version: reservation.version,
  });
}

export async function digestMakerReservation(
  reservation: MakerReservationV1,
): Promise<string> {
  return sha256Hex(canonicalMakerReservation(reservation));
}
