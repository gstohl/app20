import { describe, expect, it } from "vitest";
import {
  ADVISORY_PLAN_CAN_SUBMIT_VALUE,
  ADVISORY_PLAN_DOMAIN,
  CHECKOUT_REQUEST_IS_AUTHORIZATION,
  CROSS_CHAIN_LIVE_FUNDING_ENABLED,
  INTEGRATION_LIVE_SUBMISSION_IMPLEMENTED,
  MERCHANT_WEBHOOK_DOMAIN,
  MerchantWebhookReplayStore,
  canonicalPrivateCheckoutRequest,
  createDryWarehouseReview,
  createPrivateCheckoutRequest,
  evaluateIntegrationRelease,
  normalizeAdvisoryOperationsPlan,
  normalizePrivateCheckoutRequest,
  privateCheckoutRequestDigest,
  signMerchantWebhook,
  verifyMerchantWebhook,
  verifyPrivateCheckoutRequest,
  type MerchantWebhookEventV1,
} from "./merchant-integration";
import { normalizeStarknetAddress } from "./address-book";
import type { PaymentRequestPayload } from "./otc";
import { addrSTRK } from "../utils/constants";

const now = 2_000_000_000;
const checkoutId = `0x${"11".repeat(32)}`;
const receiptDigest = `sha256:${"22".repeat(32)}`;
const merchantKey = Uint8Array.from({ length: 32 }, () => 7);

const paymentRequest: PaymentRequestPayload = {
  requestId: `0x${"31".repeat(32)}`,
  token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
  amount: "1250000000000000000",
  requester: "0xa11ce",
  chainId: "SN_SEPOLIA",
  expiresAt: now + 3_600,
};

function webhook(
  overrides: Partial<MerchantWebhookEventV1> = {},
): MerchantWebhookEventV1 {
  return {
    domain: MERCHANT_WEBHOOK_DOMAIN,
    version: 1,
    eventId: `0x${"41".repeat(32)}`,
    idempotencyKey: `0x${"42".repeat(32)}`,
    event: "checkout.finalized",
    checkoutId,
    merchantId: "merchant-a",
    chainId: "SN_SEPOLIA",
    receiptDigest,
    occurredAt: now,
    authority: "receipt-reference",
    ...overrides,
  };
}

const completeEvidence = {
  protocolReviewAccepted: true,
  receiptVerificationIntegrated: true,
  idempotencyReplayStoreDurable: true,
  merchantKeyCustodyReviewed: true,
  sepoliaSoakComplete: true,
  mainnetApprovalReference: "approval-2026-08-25",
};

describe("private checkout request", () => {
  it("creates a canonical unsigned request that cannot authorize payment", () => {
    const request = createPrivateCheckoutRequest({
      checkoutId,
      merchantId: "merchant-a",
      paymentRequest,
      createdAt: now,
      expiresAt: now + 1_800,
      returnOrigin: "https://merchant.example",
    });

    expect(request).toMatchObject({
      checkoutId,
      merchantId: "merchant-a",
      chainId: "SN_SEPOLIA",
      requester: normalizeStarknetAddress("0xa11ce"),
      token: normalizeStarknetAddress(addrSTRK),
      amountBaseUnits: "1250000000000000000",
      returnOrigin: "https://merchant.example",
      authority: "unsigned-request",
    });
    expect(privateCheckoutRequestDigest(request)).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(canonicalPrivateCheckoutRequest(request)).not.toContain("signature");
    expect(CHECKOUT_REQUEST_IS_AUTHORIZATION).toBe(false);
    expect(verifyPrivateCheckoutRequest(request, paymentRequest)).toEqual(
      request,
    );
    expect(
      verifyPrivateCheckoutRequest(request, {
        ...paymentRequest,
        amount: "1250000000000000001",
      }),
    ).toBeNull();
    expect(() =>
      normalizePrivateCheckoutRequest({ ...request, authority: "authorized" }),
    ).toThrow(/authority/i);
    expect(() =>
      canonicalPrivateCheckoutRequest({
        ...request,
        unexpectedRelationship: "counterparty-a",
      } as typeof request),
    ).toThrow(/schema/i);
  });

  it("rejects relationship data in return URLs and request-lifetime expansion", () => {
    const base = {
      checkoutId,
      merchantId: "merchant-a",
      paymentRequest,
      createdAt: now,
      expiresAt: now + 1_800,
    };
    expect(() =>
      createPrivateCheckoutRequest({
        ...base,
        returnOrigin:
          "https://merchant.example/order/secret?counterparty=alice",
      }),
    ).toThrow(/origin|relationship/i);
    expect(() =>
      createPrivateCheckoutRequest({
        ...base,
        expiresAt: paymentRequest.expiresAt + 1,
        returnOrigin: "https://merchant.example",
      }),
    ).toThrow(/lifetime/i);
  });
});

describe("signed merchant webhooks", () => {
  const expectedContext = {
    merchantId: "merchant-a",
    checkoutId,
    chainId: "SN_SEPOLIA",
    now,
    verifiedReceiptDigests: new Set([
      receiptDigest,
      `sha256:${"44".repeat(32)}`,
    ]),
  };

  it("verifies exact event bytes against a pinned merchant key", async () => {
    const signed = signMerchantWebhook(webhook(), {
      keyId: "merchant-a/webhook/v1",
      privateKey: merchantKey,
    });
    const trusted = new Map([[signed.keyId, signed.publicKey]]);

    await expect(
      verifyMerchantWebhook(signed, trusted, expectedContext),
    ).resolves.toMatchObject(signed);
    await expect(
      verifyMerchantWebhook(
        {
          ...signed,
          event: {
            ...signed.event,
            receiptDigest: `sha256:${"99".repeat(32)}`,
          },
        },
        trusted,
        expectedContext,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyMerchantWebhook(signed, new Map(), expectedContext),
    ).resolves.toBeNull();
    await expect(
      verifyMerchantWebhook(signed, trusted, {
        ...expectedContext,
        checkoutId: `0x${"98".repeat(32)}`,
      }),
    ).resolves.toBeNull();
    const future = signMerchantWebhook(webhook({ occurredAt: now + 1 }), {
      keyId: "merchant-a/webhook/v1",
      privateKey: merchantKey,
    });
    await expect(
      verifyMerchantWebhook(future, trusted, expectedContext),
    ).resolves.toBeNull();
  });

  it("deduplicates exact retries and rejects idempotency equivocation", async () => {
    const first = signMerchantWebhook(webhook(), {
      keyId: "merchant-a/webhook/v1",
      privateKey: merchantKey,
    });
    const second = signMerchantWebhook(
      webhook({
        eventId: `0x${"43".repeat(32)}`,
        receiptDigest: `sha256:${"44".repeat(32)}`,
      }),
      { keyId: "merchant-a/webhook/v1", privateKey: merchantKey },
    );
    const trusted = new Map([[first.keyId, first.publicKey]]);
    const verifiedFirst = await verifyMerchantWebhook(
      first,
      trusted,
      expectedContext,
    );
    const verifiedSecond = await verifyMerchantWebhook(
      second,
      trusted,
      expectedContext,
    );
    if (!verifiedFirst || !verifiedSecond) {
      throw new Error("Test setup did not produce verified webhooks.");
    }
    const store = new MerchantWebhookReplayStore();

    expect(store.consume(verifiedFirst)).toBe(true);
    expect(store.consume(verifiedFirst)).toBe(false);
    expect(() => store.consume(verifiedSecond)).toThrow(/equivocated/i);

    const terminalReplay = signMerchantWebhook(
      webhook({
        eventId: `0x${"45".repeat(32)}`,
        idempotencyKey: `0x${"46".repeat(32)}`,
        receiptDigest: `sha256:${"44".repeat(32)}`,
      }),
      { keyId: "merchant-a/webhook/v1", privateKey: merchantKey },
    );
    const verifiedTerminalReplay = await verifyMerchantWebhook(
      terminalReplay,
      trusted,
      expectedContext,
    );
    if (!verifiedTerminalReplay) {
      throw new Error("Test setup did not produce a terminal webhook.");
    }
    expect(() => store.consume(verifiedTerminalReplay)).toThrow(
      /lifecycle equivocated/i,
    );
  });
});

describe("integration release gates", () => {
  it("keeps partner review non-submitting and fails closed on missing evidence", () => {
    expect(
      evaluateIntegrationRelease("partner-dry", completeEvidence),
    ).toMatchObject({ enabled: true, liveSubmission: false, blocks: [] });
    expect(
      evaluateIntegrationRelease("sepolia", {
        ...completeEvidence,
        receiptVerificationIntegrated: false,
      }),
    ).toMatchObject({ enabled: false, liveSubmission: false });
    expect(
      evaluateIntegrationRelease("sepolia", completeEvidence),
    ).toMatchObject({
      enabled: false,
      liveSubmission: false,
      blocks: ["Live integration submission is not implemented in this build."],
    });
    expect(INTEGRATION_LIVE_SUBMISSION_IMPLEMENTED).toBe(false);
    expect(
      evaluateIntegrationRelease("mainnet-capped", {
        ...completeEvidence,
        mainnetApprovalReference: null,
      }).blocks,
    ).toContain("Explicit Mainnet approval is missing.");
  });

  it("keeps cross-chain warehouse routing structurally dry and behind maker inventory", () => {
    const review = createDryWarehouseReview({
      reviewId: `0x${"51".repeat(32)}`,
      makerId: "maker-a",
      quoteRequest: { dry: true },
      quoteRequestDigest: `sha256:${"52".repeat(32)}`,
      publicBoundaryAcknowledged: true,
      createdAt: now,
      expiresAt: now + 300,
    });
    expect(review).toMatchObject({
      purpose: "maker-inventory-restock",
      dry: true,
      directTakerRouting: false,
      liveFundingAuthorized: false,
    });
    expect(CROSS_CHAIN_LIVE_FUNDING_ENABLED).toBe(false);
  });

  it("accepts only non-signing, non-submitting advisory plans", () => {
    const plan = normalizeAdvisoryOperationsPlan({
      domain: ADVISORY_PLAN_DOMAIN,
      version: 1,
      planId: `0x${"61".repeat(32)}`,
      authority: "advisory",
      intentDigest: `sha256:${"62".repeat(32)}`,
      createdAt: now,
      expiresAt: now + 300,
      recommendations: [
        {
          kind: "verify-quotes",
          rationale: "Verify every invited maker signature before ranking.",
        },
      ],
      canSign: false,
      canSubmit: false,
    });
    expect(plan.canSubmit).toBe(false);
    expect(ADVISORY_PLAN_CAN_SUBMIT_VALUE).toBe(false);
    expect(() =>
      normalizeAdvisoryOperationsPlan({
        ...plan,
        canSubmit: true,
      }),
    ).toThrow(/authority/i);
    expect(() =>
      normalizeAdvisoryOperationsPlan({
        ...plan,
        calldata: ["0x1"],
      }),
    ).toThrow(/schema/i);
  });
});
