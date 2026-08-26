import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { normalizeStarknetAddress } from "./address-book";
import {
  digestPaymentLinkRequest,
  normalizePaymentLinkChainId,
} from "./payment-link";
import type { PaymentRequestPayload } from "./otc";

export const CHECKOUT_REQUEST_DOMAIN =
  "app20/private-checkout-request/v1" as const;
export const MERCHANT_WEBHOOK_DOMAIN = "app20/merchant-webhook/v1" as const;
export const DRY_WAREHOUSE_REVIEW_DOMAIN =
  "app20/cross-chain-warehouse-review/v1" as const;
export const ADVISORY_PLAN_DOMAIN =
  "app20/advisory-operations-plan/v1" as const;
export const CHECKOUT_REQUEST_IS_AUTHORIZATION = false as const;
export const ADVISORY_PLAN_CAN_SUBMIT_VALUE = false as const;
export const CROSS_CHAIN_LIVE_FUNDING_ENABLED = false as const;
export const INTEGRATION_LIVE_SUBMISSION_IMPLEMENTED = false as const;
export const MERCHANT_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

const HEX32 = /^0x[0-9a-f]{64}$/;
const BARE_HEX32 = /^[0-9a-f]{64}$/;
const BARE_HEX64 = /^[0-9a-f]{128}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const U256_MAX = (1n << 256n) - 1n;
const VERIFIED_MERCHANT_WEBHOOK = Symbol("app20.verified-merchant-webhook");
const encoder = new TextEncoder();

type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export type PrivateCheckoutRequestV1 = Readonly<{
  domain: typeof CHECKOUT_REQUEST_DOMAIN;
  version: 1;
  checkoutId: string;
  merchantId: string;
  chainId: string;
  requester: string;
  token: string;
  amountBaseUnits: string;
  paymentRequestDigest: string;
  createdAt: number;
  expiresAt: number;
  returnOrigin: string;
  authority: "unsigned-request";
}>;

export type MerchantWebhookEventKind =
  | "checkout.confirmed"
  | "checkout.finalized"
  | "checkout.refunded"
  | "checkout.expired";

export type MerchantWebhookEventV1 = Readonly<{
  domain: typeof MERCHANT_WEBHOOK_DOMAIN;
  version: 1;
  eventId: string;
  idempotencyKey: string;
  event: MerchantWebhookEventKind;
  checkoutId: string;
  merchantId: string;
  chainId: string;
  receiptDigest: string;
  occurredAt: number;
  authority: "receipt-reference";
}>;

export type SignedMerchantWebhookV1 = Readonly<{
  version: 1;
  event: MerchantWebhookEventV1;
  eventDigest: string;
  keyId: string;
  publicKey: string;
  signature: string;
}>;

export type VerifiedMerchantWebhookV1 = SignedMerchantWebhookV1 & {
  readonly [VERIFIED_MERCHANT_WEBHOOK]: true;
};

export type IntegrationReleaseEvidence = Readonly<{
  protocolReviewAccepted: boolean;
  receiptVerificationIntegrated: boolean;
  idempotencyReplayStoreDurable: boolean;
  merchantKeyCustodyReviewed: boolean;
  sepoliaSoakComplete: boolean;
  mainnetApprovalReference: string | null;
}>;

export type IntegrationReleaseDecision = Readonly<{
  stage: "disabled" | "partner-dry" | "sepolia" | "mainnet-capped";
  enabled: boolean;
  liveSubmission: boolean;
  blocks: readonly string[];
}>;

export type DryWarehouseReviewV1 = Readonly<{
  domain: typeof DRY_WAREHOUSE_REVIEW_DOMAIN;
  version: 1;
  reviewId: string;
  makerId: string;
  purpose: "maker-inventory-restock";
  dry: true;
  directTakerRouting: false;
  quoteRequestDigest: string;
  publicBoundaryAcknowledged: true;
  createdAt: number;
  expiresAt: number;
  liveFundingAuthorized: false;
}>;

export type AdvisoryOperationsPlanV1 = Readonly<{
  domain: typeof ADVISORY_PLAN_DOMAIN;
  version: 1;
  planId: string;
  authority: "advisory";
  intentDigest: string;
  createdAt: number;
  expiresAt: number;
  recommendations: readonly {
    kind:
      | "explain-preflight"
      | "suggest-invitation-cohort"
      | "verify-quotes"
      | "draft-negotiation"
      | "release-losing-reservations"
      | "monitor-receipt";
    rationale: string;
  }[];
  canSign: false;
  canSubmit: false;
}>;

export class MerchantWebhookReplayStore {
  readonly #eventDigests = new Map<string, string>();
  readonly #idempotencyDigests = new Map<string, string>();
  readonly #checkoutLifecycle = new Map<
    string,
    { event: MerchantWebhookEventKind; eventDigest: string }
  >();

  consume(webhook: VerifiedMerchantWebhookV1): boolean {
    const priorEvent = this.#eventDigests.get(webhook.event.eventId);
    const priorIdempotency = this.#idempotencyDigests.get(
      webhook.event.idempotencyKey,
    );
    if (
      (priorEvent !== undefined && priorEvent !== webhook.eventDigest) ||
      (priorIdempotency !== undefined &&
        priorIdempotency !== webhook.eventDigest)
    ) {
      throw new Error("Merchant webhook idempotency key equivocated.");
    }
    if (priorEvent !== undefined || priorIdempotency !== undefined) {
      return false;
    }
    const checkoutKey = `${webhook.event.merchantId}:${webhook.event.checkoutId}:${webhook.event.chainId}`;
    const priorLifecycle = this.#checkoutLifecycle.get(checkoutKey);
    if (
      priorLifecycle &&
      (priorLifecycle.event !== "checkout.confirmed" ||
        webhook.event.event === "checkout.confirmed")
    ) {
      throw new Error("Merchant checkout lifecycle equivocated or replayed.");
    }
    this.#eventDigests.set(webhook.event.eventId, webhook.eventDigest);
    this.#idempotencyDigests.set(
      webhook.event.idempotencyKey,
      webhook.eventDigest,
    );
    this.#checkoutLifecycle.set(checkoutKey, {
      event: webhook.event.event,
      eventDigest: webhook.eventDigest,
    });
    return true;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string, label: string): Uint8Array {
  if (!/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label} must be lowercase even-length hex.`);
  }
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Canonical integration numbers must be safe integers.");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digestText(value: string): string {
  return `sha256:${bytesToHex(sha256(encoder.encode(value)))}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join(",") !==
    [...expected].sort((left, right) => left.localeCompare(right)).join(",")
  ) {
    throw new Error(`${label} schema is unsupported.`);
  }
}

function text(value: unknown, label: string, maximumLength = 128): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function hex32(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!HEX32.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!DIGEST.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe-integer timestamp.`);
  }
  return Number(value);
}

function amount(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error("Checkout amount must be canonical decimal base units.");
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > U256_MAX) {
    throw new Error("Checkout amount must fit a positive u256.");
  }
  return value;
}

function origin(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Checkout return origin is invalid.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Checkout return origin is invalid.");
  }
  if (
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && parsed.hostname === "localhost")) ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "Checkout return value must be an HTTPS origin without relationship data.",
    );
  }
  return parsed.origin;
}

export function createPrivateCheckoutRequest(input: {
  checkoutId: string;
  merchantId: string;
  paymentRequest: PaymentRequestPayload;
  createdAt: number;
  expiresAt: number;
  returnOrigin: string;
}): PrivateCheckoutRequestV1 {
  const createdAt = timestamp(input.createdAt, "Checkout creation time");
  const expiresAt = timestamp(input.expiresAt, "Checkout expiry");
  if (
    expiresAt <= createdAt ||
    (input.paymentRequest.expiresAt !== 0 &&
      expiresAt > input.paymentRequest.expiresAt)
  ) {
    throw new Error("Checkout expiry exceeds the payment request lifetime.");
  }
  if (
    typeof input.paymentRequest.token?.address !== "string" ||
    typeof input.paymentRequest.requester !== "string" ||
    typeof input.paymentRequest.chainId !== "string"
  ) {
    throw new Error("Checkout payment request is incomplete.");
  }
  return {
    domain: CHECKOUT_REQUEST_DOMAIN,
    version: 1,
    checkoutId: hex32(input.checkoutId, "Checkout id"),
    merchantId: text(input.merchantId, "Merchant id"),
    chainId: normalizePaymentLinkChainId(input.paymentRequest.chainId),
    requester: normalizeStarknetAddress(input.paymentRequest.requester),
    token: normalizeStarknetAddress(input.paymentRequest.token.address),
    amountBaseUnits: amount(input.paymentRequest.amount),
    paymentRequestDigest: digestPaymentLinkRequest(input.paymentRequest),
    createdAt,
    expiresAt,
    returnOrigin: origin(input.returnOrigin),
    authority: "unsigned-request",
  };
}

export function normalizePrivateCheckoutRequest(
  value: unknown,
): PrivateCheckoutRequestV1 {
  const request = record(value, "Private checkout request");
  exactKeys(
    request,
    [
      "domain",
      "version",
      "checkoutId",
      "merchantId",
      "chainId",
      "requester",
      "token",
      "amountBaseUnits",
      "paymentRequestDigest",
      "createdAt",
      "expiresAt",
      "returnOrigin",
      "authority",
    ],
    "Private checkout request",
  );
  if (
    request.domain !== CHECKOUT_REQUEST_DOMAIN ||
    request.version !== 1 ||
    request.authority !== "unsigned-request"
  ) {
    throw new Error(
      "Private checkout request domain, version, or authority is invalid.",
    );
  }
  const createdAt = timestamp(request.createdAt, "Checkout creation time");
  const expiresAt = timestamp(request.expiresAt, "Checkout expiry");
  if (expiresAt <= createdAt) {
    throw new Error("Checkout expiry is invalid.");
  }
  return {
    domain: CHECKOUT_REQUEST_DOMAIN,
    version: 1,
    checkoutId: hex32(request.checkoutId, "Checkout id"),
    merchantId: text(request.merchantId, "Merchant id"),
    chainId: normalizePaymentLinkChainId(
      text(request.chainId, "Checkout chain id", 80),
    ),
    requester: normalizeStarknetAddress(String(request.requester ?? "")),
    token: normalizeStarknetAddress(String(request.token ?? "")),
    amountBaseUnits: amount(request.amountBaseUnits),
    paymentRequestDigest: digest(
      request.paymentRequestDigest,
      "Payment request digest",
    ),
    createdAt,
    expiresAt,
    returnOrigin: origin(request.returnOrigin),
    authority: "unsigned-request",
  };
}

export function verifyPrivateCheckoutRequest(
  value: unknown,
  paymentRequest: PaymentRequestPayload,
): PrivateCheckoutRequestV1 | null {
  try {
    const request = normalizePrivateCheckoutRequest(value);
    if (
      request.paymentRequestDigest !==
        digestPaymentLinkRequest(paymentRequest) ||
      request.chainId !==
        normalizePaymentLinkChainId(String(paymentRequest.chainId ?? "")) ||
      request.requester !==
        normalizeStarknetAddress(paymentRequest.requester) ||
      request.token !==
        normalizeStarknetAddress(paymentRequest.token.address) ||
      request.amountBaseUnits !== amount(paymentRequest.amount) ||
      (paymentRequest.expiresAt !== 0 &&
        request.expiresAt > paymentRequest.expiresAt)
    ) {
      return null;
    }
    return request;
  } catch {
    return null;
  }
}

export function canonicalPrivateCheckoutRequest(
  request: PrivateCheckoutRequestV1,
): string {
  return canonicalJson({ ...normalizePrivateCheckoutRequest(request) });
}

export function privateCheckoutRequestDigest(
  request: PrivateCheckoutRequestV1,
): string {
  return digestText(canonicalPrivateCheckoutRequest(request));
}

function normalizeWebhookEvent(value: unknown): MerchantWebhookEventV1 {
  const event = record(value, "Merchant webhook event");
  exactKeys(
    event,
    [
      "domain",
      "version",
      "eventId",
      "idempotencyKey",
      "event",
      "checkoutId",
      "merchantId",
      "chainId",
      "receiptDigest",
      "occurredAt",
      "authority",
    ],
    "Merchant webhook event",
  );
  if (
    event.domain !== MERCHANT_WEBHOOK_DOMAIN ||
    event.version !== 1 ||
    event.authority !== "receipt-reference" ||
    ![
      "checkout.confirmed",
      "checkout.finalized",
      "checkout.refunded",
      "checkout.expired",
    ].includes(String(event.event))
  ) {
    throw new Error(
      "Merchant webhook event domain, version, or kind is invalid.",
    );
  }
  return {
    domain: MERCHANT_WEBHOOK_DOMAIN,
    version: 1,
    eventId: hex32(event.eventId, "Webhook event id"),
    idempotencyKey: hex32(event.idempotencyKey, "Webhook idempotency key"),
    event: event.event as MerchantWebhookEventKind,
    checkoutId: hex32(event.checkoutId, "Webhook checkout id"),
    merchantId: text(event.merchantId, "Webhook merchant id"),
    chainId: normalizePaymentLinkChainId(
      text(event.chainId, "Webhook chain id", 80),
    ),
    receiptDigest: digest(event.receiptDigest, "Webhook receipt digest"),
    occurredAt: timestamp(event.occurredAt, "Webhook occurrence time"),
    authority: "receipt-reference",
  };
}

export function merchantWebhookEventDigest(
  event: MerchantWebhookEventV1,
): string {
  return digestText(canonicalJson({ ...normalizeWebhookEvent(event) }));
}

function webhookSignatureMessage(
  eventDigest: string,
  keyId: string,
): Uint8Array {
  return sha256(
    encoder.encode(
      canonicalJson({
        domain: MERCHANT_WEBHOOK_DOMAIN,
        version: 1,
        eventDigest,
        keyId,
      }),
    ),
  );
}

export function signMerchantWebhook(
  value: MerchantWebhookEventV1,
  input: { keyId: string; privateKey: Uint8Array },
): SignedMerchantWebhookV1 {
  if (input.privateKey.length !== 32) {
    throw new Error("Merchant webhook signing key must be 32 bytes.");
  }
  const event = normalizeWebhookEvent(value);
  const eventDigest = merchantWebhookEventDigest(event);
  const keyId = text(input.keyId, "Merchant webhook key id");
  const publicKey = ed25519.getPublicKey(input.privateKey);
  return {
    version: 1,
    event,
    eventDigest,
    keyId,
    publicKey: bytesToHex(publicKey),
    signature: bytesToHex(
      ed25519.sign(
        webhookSignatureMessage(eventDigest, keyId),
        input.privateKey,
      ),
    ),
  };
}

export async function verifyMerchantWebhook(
  value: unknown,
  trustedKeys: ReadonlyMap<string, string>,
  expected: {
    merchantId: string;
    checkoutId: string;
    chainId: string;
    now: number;
    verifiedReceiptDigests: ReadonlySet<string>;
  },
): Promise<VerifiedMerchantWebhookV1 | null> {
  try {
    const webhook = record(value, "Signed merchant webhook");
    exactKeys(
      webhook,
      ["version", "event", "eventDigest", "keyId", "publicKey", "signature"],
      "Signed merchant webhook",
    );
    if (
      webhook.version !== 1 ||
      typeof webhook.keyId !== "string" ||
      typeof webhook.publicKey !== "string" ||
      typeof webhook.signature !== "string"
    ) {
      return null;
    }
    const event = normalizeWebhookEvent(webhook.event);
    const eventDigest = merchantWebhookEventDigest(event);
    const keyId = text(webhook.keyId, "Merchant webhook key id");
    const publicKey = webhook.publicKey.toLowerCase();
    const signature = webhook.signature.toLowerCase();
    const now = timestamp(expected.now, "Webhook verification time");
    if (
      digest(webhook.eventDigest, "Merchant webhook digest") !== eventDigest ||
      event.merchantId !== text(expected.merchantId, "Expected merchant id") ||
      event.checkoutId !== hex32(expected.checkoutId, "Expected checkout id") ||
      event.chainId !== normalizePaymentLinkChainId(expected.chainId) ||
      event.occurredAt > now ||
      now - event.occurredAt > MERCHANT_WEBHOOK_MAX_AGE_SECONDS ||
      !expected.verifiedReceiptDigests.has(event.receiptDigest) ||
      !BARE_HEX32.test(publicKey) ||
      !BARE_HEX64.test(signature) ||
      trustedKeys.get(keyId)?.toLowerCase() !== publicKey ||
      !ed25519.verify(
        hexToBytes(signature, "Merchant webhook signature"),
        webhookSignatureMessage(eventDigest, keyId),
        hexToBytes(publicKey, "Merchant webhook public key"),
      )
    ) {
      return null;
    }
    return {
      version: 1,
      event,
      eventDigest,
      keyId,
      publicKey,
      signature,
      [VERIFIED_MERCHANT_WEBHOOK]: true,
    };
  } catch {
    return null;
  }
}

export function evaluateIntegrationRelease(
  stage: IntegrationReleaseDecision["stage"],
  evidence: IntegrationReleaseEvidence,
): IntegrationReleaseDecision {
  const blocks: string[] = [];
  if (stage === "disabled") blocks.push("Integration release is disabled.");
  if (!evidence.protocolReviewAccepted) {
    blocks.push("Protocol review is not accepted.");
  }
  if (!evidence.receiptVerificationIntegrated) {
    blocks.push("Chain-derived receipt verification is not integrated.");
  }
  if (!evidence.idempotencyReplayStoreDurable) {
    blocks.push("Webhook replay storage is not durable.");
  }
  if (!evidence.merchantKeyCustodyReviewed) {
    blocks.push("Merchant webhook key custody is not reviewed.");
  }
  if (stage === "sepolia" || stage === "mainnet-capped") {
    if (!evidence.sepoliaSoakComplete) {
      blocks.push("Sepolia soak evidence is incomplete.");
    }
    if (!INTEGRATION_LIVE_SUBMISSION_IMPLEMENTED) {
      blocks.push(
        "Live integration submission is not implemented in this build.",
      );
    }
  }
  if (stage === "mainnet-capped" && !evidence.mainnetApprovalReference) {
    blocks.push("Explicit Mainnet approval is missing.");
  }
  const enabled = blocks.length === 0;
  return {
    stage,
    enabled,
    liveSubmission: false,
    blocks,
  };
}

export function createDryWarehouseReview(input: {
  reviewId: string;
  makerId: string;
  quoteRequest: { dry: true };
  quoteRequestDigest: string;
  publicBoundaryAcknowledged: true;
  createdAt: number;
  expiresAt: number;
}): DryWarehouseReviewV1 {
  if (input.quoteRequest.dry !== true) {
    throw new Error("Cross-chain warehouse review must remain dry.");
  }
  const createdAt = timestamp(
    input.createdAt,
    "Warehouse review creation time",
  );
  const expiresAt = timestamp(input.expiresAt, "Warehouse review expiry");
  if (expiresAt <= createdAt) {
    throw new Error("Warehouse review expiry is invalid.");
  }
  return {
    domain: DRY_WAREHOUSE_REVIEW_DOMAIN,
    version: 1,
    reviewId: hex32(input.reviewId, "Warehouse review id"),
    makerId: text(input.makerId, "Warehouse review maker id"),
    purpose: "maker-inventory-restock",
    dry: true,
    directTakerRouting: false,
    quoteRequestDigest: digest(
      input.quoteRequestDigest,
      "Warehouse quote-request digest",
    ),
    publicBoundaryAcknowledged: true,
    createdAt,
    expiresAt,
    liveFundingAuthorized: false,
  };
}

export function normalizeAdvisoryOperationsPlan(
  value: unknown,
): AdvisoryOperationsPlanV1 {
  const plan = record(value, "Advisory operations plan");
  exactKeys(
    plan,
    [
      "domain",
      "version",
      "planId",
      "authority",
      "intentDigest",
      "createdAt",
      "expiresAt",
      "recommendations",
      "canSign",
      "canSubmit",
    ],
    "Advisory operations plan",
  );
  if (
    plan.domain !== ADVISORY_PLAN_DOMAIN ||
    plan.version !== 1 ||
    plan.authority !== "advisory" ||
    plan.canSign !== false ||
    plan.canSubmit !== false ||
    !Array.isArray(plan.recommendations)
  ) {
    throw new Error("Advisory operations plan authority is invalid.");
  }
  const createdAt = timestamp(plan.createdAt, "Advisory plan creation time");
  const expiresAt = timestamp(plan.expiresAt, "Advisory plan expiry");
  if (expiresAt <= createdAt)
    throw new Error("Advisory plan expiry is invalid.");
  const recommendations = plan.recommendations.map((candidate) => {
    const recommendation = record(candidate, "Advisory recommendation");
    exactKeys(recommendation, ["kind", "rationale"], "Advisory recommendation");
    if (
      ![
        "explain-preflight",
        "suggest-invitation-cohort",
        "verify-quotes",
        "draft-negotiation",
        "release-losing-reservations",
        "monitor-receipt",
      ].includes(String(recommendation.kind))
    ) {
      throw new Error("Advisory recommendation kind is unsupported.");
    }
    return {
      kind: recommendation.kind as AdvisoryOperationsPlanV1["recommendations"][number]["kind"],
      rationale: text(recommendation.rationale, "Advisory rationale", 1_000),
    };
  });
  if (recommendations.length === 0 || recommendations.length > 20) {
    throw new Error(
      "Advisory operations plan recommendation count is invalid.",
    );
  }
  return {
    domain: ADVISORY_PLAN_DOMAIN,
    version: 1,
    planId: hex32(plan.planId, "Advisory plan id"),
    authority: "advisory",
    intentDigest: digest(plan.intentDigest, "Advisory intent digest"),
    createdAt,
    expiresAt,
    recommendations,
    canSign: false,
    canSubmit: false,
  };
}
