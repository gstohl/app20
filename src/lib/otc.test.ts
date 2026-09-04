import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import { decodeEnvelope, encodeEnvelope } from "./envelope";
import {
  ONE_SIDED_WARNING,
  acceptPayloadForOffer,
  claimOtcAccept,
  claimPayment,
  confirmOtcAccept,
  createDealId,
  expireStoredDeals,
  formatBaseUnits,
  loadOtcState,
  markOtcAcceptOutcome,
  markOtcAcceptSubmitted,
  markPaymentOutcome,
  markPaymentSubmitted,
  normalizeTokenRef,
  otcStorageKey,
  parseAcceptPayload,
  isPositiveBaseUnitAmount,
  parseDecimalToBaseUnits,
  parseOfferPayload,
  parsePaymentRequestPayload,
  parseReceiptPayload,
  receiptForTransfer,
  recordDealEvent,
  recordPaymentRequest,
  recordUnverifiedPaymentClaim,
  releaseOtcAccept,
  releasePayment,
  transitionDeal,
  type OfferPayload,
  type PaymentRequestPayload,
} from "./otc";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const dealId = `0x${"11".repeat(32)}`;
const offerer = "0x1234";
const strk = { symbol: "STRK", address: addrSTRK, decimals: 18 };
const usdc = { symbol: "USDC", address: "0x53c", decimals: 6 };

function offer(overrides: Partial<OfferPayload> = {}): OfferPayload {
  return {
    dealId,
    give: { token: strk, amount: "10000000000000000" },
    want: { token: usdc, amount: "2500000" },
    offerer,
    expiresAt: 2_000_000_000,
    ...overrides,
  };
}

describe("OTC payloads", () => {
  it("encodes and decodes offer to accept to receipt", () => {
    const decodedOffer = decodeEnvelope(encodeEnvelope("offer", offer()));
    expect(decodedOffer.type).toBe("offer");
    const parsedOffer = parseOfferPayload(decodedOffer.payload);
    expect(parsedOffer).not.toBeNull();

    const accept = acceptPayloadForOffer(parsedOffer!);
    const decodedAccept = decodeEnvelope(encodeEnvelope("accept", accept));
    const parsedAccept = parseAcceptPayload(decodedAccept.payload);
    expect(parsedAccept).toEqual(accept);

    const receipt = receiptForTransfer(dealId, accept.transfer, "0x9876");
    const decodedReceipt = decodeEnvelope(encodeEnvelope("receipt", receipt));
    expect(parseReceiptPayload(decodedReceipt.payload)).toEqual({
      ...receipt,
      warning: ONE_SIDED_WARNING,
    });
  });

  it("generates 32-byte hexadecimal deal ids", () => {
    expect(createDealId()).toMatch(/^0x[0-9a-f]{64}$/);
    expect(createDealId()).not.toBe(createDealId());
  });

  it("refuses a non-STRK give leg", () => {
    const nonStrk = offer({
      give: { token: usdc, amount: "1000000" },
    });
    expect(() => acceptPayloadForOffer(nonStrk)).toThrow(/only STRK/i);
  });

  it("parses and formats decimal amounts without floating point", () => {
    expect(parseDecimalToBaseUnits("0.01", 18)).toBe("10000000000000000");
    expect(parseDecimalToBaseUnits("2.5", 6)).toBe("2500000");
    expect(formatBaseUnits("2500000", 6)).toBe("2.5");
    // Grouping is display-only and never touches the fraction.
    expect(formatBaseUnits((25_000n * 10n ** 18n).toString(), 18)).toBe(
      "25,000",
    );
    expect(formatBaseUnits("1234567890123", 6)).toBe("1,234,567.890123");
    expect(formatBaseUnits("999", 0)).toBe("999");
    expect(formatBaseUnits("1000", 0)).toBe("1,000");
    expect(() => parseDecimalToBaseUnits("0.0000001", 6)).toThrow(/6 decimal/i);
    expect(isPositiveBaseUnitAmount(((1n << 256n) - 1n).toString())).toBe(true);
    expect(isPositiveBaseUnitAmount((1n << 256n).toString())).toBe(false);
    expect(() => parseDecimalToBaseUnits((1n << 256n).toString(), 0)).toThrow(
      /uint256/i,
    );
  });

  it("canonicalizes addresses and strips controls from symbols and notes", () => {
    const parsedOffer = parseOfferPayload({
      ...offer(),
      offerer: `0x${"0".repeat(20)}1234`,
      want: {
        token: { ...usdc, symbol: "US\u202eDC" },
        amount: "2500000",
      },
      note: "Pay\u2066 now\u0000please",
    });

    expect(parsedOffer).toMatchObject({
      offerer: "0x1234",
      want: { token: { address: "0x53c", symbol: "USDC" } },
      note: "Pay now please",
    });

    const parsedAccept = parseAcceptPayload({
      dealId,
      transfer: {
        token: strk,
        amount: "1",
        to: `0x${"0".repeat(20)}1234`,
      },
    });
    expect(parsedAccept?.transfer.to).toBe("0x1234");
  });

  it("rejects adversarial STRK decimals and normalizes STRK for display", () => {
    const maliciousToken = { symbol: "STRK", address: addrSTRK, decimals: 36 };
    const amount = "100000000000000000000";
    const crafted = offer({
      give: { token: maliciousToken, amount },
    });

    const normalized = normalizeTokenRef(maliciousToken);
    expect(normalized).toEqual({
      symbol: "STRK",
      address: addrSTRK,
      decimals: 18,
    });
    expect(formatBaseUnits(amount, normalized.decimals)).toBe("100");
    expect(parseOfferPayload(crafted)).toBeNull();
    expect(() => acceptPayloadForOffer(crafted)).toThrow(/canonical metadata/i);

    expect(
      parsePaymentRequestPayload({
        requestId: `0x${"55".repeat(32)}`,
        token: maliciousToken,
        amount,
        expiresAt: 0,
        requester: "0x4567",
      }),
    ).toBeNull();
  });
});

describe("OTC local state", () => {
  it("closes only after a locally verified accept with a matching receipt", () => {
    const offered = transitionDeal(
      undefined,
      { type: "offer", payload: offer() },
      1_900_000_000,
    );
    expect(offered.status).toBe("offered");

    const accept = acceptPayloadForOffer(offered.offer);
    const accepted = transitionDeal(
      offered,
      { type: "accept", payload: accept },
      1_900_000_001,
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      settlementVerified: false,
    });

    const locallyVerified = {
      ...accepted,
      acceptTxHash: "0xaaa",
      settlementVerified: true,
    };
    const receipt = receiptForTransfer(dealId, accept.transfer, "0xaaa");
    const closed = transitionDeal(
      locallyVerified,
      { type: "receipt", payload: receipt },
      1_900_000_002,
    );
    expect(closed).toMatchObject({
      status: "closed",
      receipt,
      acceptTxHash: "0xaaa",
      settlementVerified: true,
    });

    expect(() =>
      transitionDeal(
        locallyVerified,
        {
          type: "receipt",
          payload: receiptForTransfer(dealId, accept.transfer, "0xbbb"),
        },
        1_900_000_003,
      ),
    ).toThrow(/verified accept transaction/i);
  });

  it("keeps decrypted accept and receipt envelopes as unverified claims", () => {
    const offered = transitionDeal(
      undefined,
      { type: "offer", payload: offer() },
      1_900_000_000,
    );
    const accept = acceptPayloadForOffer(offered.offer);
    const acceptClaimed = transitionDeal(
      offered,
      { type: "accept_claim", payload: accept },
      1_900_000_001,
    );

    expect(acceptClaimed).toMatchObject({
      status: "offered",
      counterpartyAcceptClaim: accept,
    });
    expect(acceptClaimed.accept).toBeUndefined();
    expect(acceptClaimed.acceptTxHash).toBeUndefined();

    const receipt = receiptForTransfer(dealId, accept.transfer, "0xaaa");
    const receiptClaimed = transitionDeal(
      acceptClaimed,
      { type: "receipt_claim", payload: receipt },
      1_900_000_002,
    );
    expect(receiptClaimed).toMatchObject({
      status: "offered",
      counterpartyReceiptClaim: receipt,
    });
    expect(receiptClaimed.acceptTxHash).toBeUndefined();

    expect(() =>
      transitionDeal(
        {
          ...acceptClaimed,
          status: "accepted",
          accept,
          acceptTxHash: "0xbbb",
          settlementVerified: true,
        },
        { type: "receipt_claim", payload: receipt },
        1_900_000_003,
      ),
    ).toThrow(/transaction hash.*recorded accept/i);
  });

  it("persists under the chain and self scoped v1 key", () => {
    const storage = new MemoryStorage();
    recordDealEvent(
      storage,
      "SN_SEPOLIA",
      "0xB0B",
      { type: "offer", payload: offer() },
      1_900_000_000,
    );

    expect(otcStorageKey("SN_SEPOLIA", "0xB0B")).toBe(
      "app20/otc/v1/SN_SEPOLIA/0xB0B",
    );
    expect(
      loadOtcState(storage, "SN_SEPOLIA", "0xB0B").deals[dealId],
    ).toMatchObject({ status: "offered" });
    expect(loadOtcState(storage, "SN_MAIN", "0xB0B").deals).toEqual({});
  });

  it("reserves accept synchronously and refuses a second transfer", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xb0b"] as const;
    recordDealEvent(
      ...scope,
      { type: "offer", payload: offer() },
      1_900_000_000,
    );
    const accept = acceptPayloadForOffer(offer());

    const reserved = claimOtcAccept(...scope, accept, 1_900_000_001);
    expect(reserved).toMatchObject({
      status: "accepted",
      acceptOperation: { state: "reserved" },
      acceptPending: true,
      settlementVerified: false,
    });
    expect(reserved.acceptOperation?.attemptId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => claimOtcAccept(...scope, accept, 1_900_000_002)).toThrow(
      /no second transfer/i,
    );
    expect(
      markOtcAcceptSubmitted(...scope, dealId, "0xabc", 1_900_000_003),
    ).toMatchObject({
      acceptOperation: { state: "submitted", transactionHash: "0xabc" },
      acceptPending: true,
      settlementVerified: false,
    });
    expect(
      confirmOtcAccept(...scope, dealId, "0xabc", 1_900_000_004),
    ).toMatchObject({
      status: "accepted",
      acceptOperation: { state: "confirmed", transactionHash: "0xabc" },
      acceptPending: false,
      acceptTxHash: "0xabc",
      settlementVerified: true,
    });
  });

  it("keeps unknown accepts blocked and releases only proven reverts", () => {
    const unknownStorage = new MemoryStorage();
    const unknownScope = [unknownStorage, "SN_SEPOLIA", "0xb0b"] as const;
    recordDealEvent(
      ...unknownScope,
      { type: "offer", payload: offer() },
      1_900_000_000,
    );
    const accept = acceptPayloadForOffer(offer());
    claimOtcAccept(...unknownScope, accept, 1_900_000_001);
    markOtcAcceptSubmitted(...unknownScope, dealId, "0xabc", 1_900_000_002);
    expect(
      markOtcAcceptOutcome(
        ...unknownScope,
        dealId,
        "0xabc",
        "unknown",
        1_900_000_003,
      ),
    ).toMatchObject({
      status: "accepted",
      acceptOperation: { state: "unknown", transactionHash: "0xabc" },
      settlementVerified: false,
    });
    expect(() =>
      claimOtcAccept(...unknownScope, accept, 1_900_000_004),
    ).toThrow(/no second transfer/i);

    const revertedStorage = new MemoryStorage();
    const revertedScope = [revertedStorage, "SN_SEPOLIA", "0xb0b"] as const;
    recordDealEvent(
      ...revertedScope,
      { type: "offer", payload: offer() },
      1_900_000_000,
    );
    const firstAttempt = claimOtcAccept(...revertedScope, accept, 1_900_000_001)
      .acceptOperation?.attemptId;
    markOtcAcceptSubmitted(...revertedScope, dealId, "0xdef", 1_900_000_002);
    expect(
      markOtcAcceptOutcome(
        ...revertedScope,
        dealId,
        "0xdef",
        "reverted",
        1_900_000_003,
      ),
    ).toMatchObject({
      status: "offered",
      acceptOperation: { state: "reverted", transactionHash: "0xdef" },
      settlementVerified: false,
    });
    const retry = claimOtcAccept(...revertedScope, accept, 1_900_000_004);
    expect(retry).toMatchObject({
      acceptOperation: { state: "reserved" },
    });
    expect(retry.acceptOperation?.attemptId).not.toBe(firstAttempt);
  });

  it("rejects a duplicate deal id whose canonical terms differ", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xb0b"] as const;
    recordDealEvent(
      ...scope,
      { type: "offer", payload: offer() },
      1_900_000_000,
    );
    expect(() =>
      recordDealEvent(
        ...scope,
        {
          type: "offer",
          payload: offer({
            give: { token: strk, amount: "20000000000000000" },
          }),
        },
        1_900_000_001,
      ),
    ).toThrow(/conflicting OTC terms/i);
    expect(loadOtcState(...scope).deals[dealId].offer.give.amount).toBe(
      "10000000000000000",
    );
  });

  it("expires an unaccepted offer and refuses acceptance", () => {
    const storage = new MemoryStorage();
    const expiring = offer({ expiresAt: 100 });
    recordDealEvent(
      storage,
      "SN_SEPOLIA",
      "0xb0b",
      { type: "offer", payload: expiring },
      99,
    );
    const state = expireStoredDeals(storage, "SN_SEPOLIA", "0xb0b", 100);
    expect(state.deals[dealId].status).toBe("expired");
    expect(() =>
      claimOtcAccept(
        storage,
        "SN_SEPOLIA",
        "0xb0b",
        {
          dealId,
          transfer: {
            token: strk,
            amount: expiring.give.amount,
            to: offerer,
          },
        },
        101,
      ),
    ).toThrow(/expired/i);
  });

  it("expires an offered deal at reservation time instead of leaving a stuck fence", () => {
    const storage = new MemoryStorage();
    const expiring = offer({ expiresAt: 100 });
    recordDealEvent(
      storage,
      "SN_SEPOLIA",
      "0xb0b",
      { type: "offer", payload: expiring },
      99,
    );
    expect(() =>
      claimOtcAccept(
        storage,
        "SN_SEPOLIA",
        "0xb0b",
        {
          dealId,
          transfer: {
            token: strk,
            amount: expiring.give.amount,
            to: offerer,
          },
        },
        100,
      ),
    ).toThrow(/expired/i);
    const stored = loadOtcState(storage, "SN_SEPOLIA", "0xb0b").deals[dealId];
    expect(stored.status).toBe("expired");
    expect(stored.acceptPending).toBeUndefined();
    expect(stored.acceptOperation).toBeUndefined();
    expect(
      releaseOtcAccept(storage, "SN_SEPOLIA", "0xb0b", dealId, 101)?.status,
    ).toBe("expired");
  });

  it("moves an offered deal to declined as a terminal state", () => {
    const offered = transitionDeal(
      undefined,
      { type: "offer", payload: offer() },
      1_900_000_000,
    );
    const declined = transitionDeal(
      offered,
      { type: "decline", payload: { dealId, reason: "No thanks" } },
      1_900_000_001,
    );
    expect(declined.status).toBe("declined");
    expect(() =>
      transitionDeal(
        declined,
        { type: "accept", payload: acceptPayloadForOffer(offer()) },
        1_900_000_002,
      ),
    ).toThrow(/declined/i);
  });
});

describe("payment request idempotency", () => {
  const request: PaymentRequestPayload = {
    requestId: `0x${"22".repeat(32)}`,
    token: strk,
    amount: "1000000000000000",
    memo: "Invoice 7",
    expiresAt: 2_000_000_000,
    requester: "0x4567",
  };

  it("decodes the requester needed for a private payment", () => {
    const decoded = decodeEnvelope(encodeEnvelope("payment_request", request));
    expect(parsePaymentRequestPayload(decoded.payload)).toEqual(request);
  });

  it("refuses a second payment claim", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xb0b"] as const;
    recordPaymentRequest(...scope, request, 1_900_000_000);
    const reserved = claimPayment(...scope, request, 1_900_000_001);
    expect(reserved).toMatchObject({
      status: "paid",
      paymentOperation: { state: "reserved" },
      paymentPending: true,
    });
    expect(reserved.paymentOperation?.attemptId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => claimPayment(...scope, request, 1_900_000_002)).toThrow(
      /no second transfer/i,
    );
  });

  it("rejects duplicate request ids and reservation terms that conflict", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xb0b"] as const;
    recordPaymentRequest(...scope, request, 1_900_000_000);
    const conflicting = { ...request, amount: "2000000000000000" };
    expect(() =>
      recordPaymentRequest(...scope, conflicting, 1_900_000_001),
    ).toThrow(/conflicting payment terms/i);
    expect(() => claimPayment(...scope, conflicting, 1_900_000_002)).toThrow(
      /do not match the locally reviewed record/i,
    );
    expect(
      loadOtcState(...scope).payments[request.requestId].request.amount,
    ).toBe(request.amount);
  });

  it("moves payment reserved to submitted to confirmed, never verifying unknown", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xb0b"] as const;
    recordPaymentRequest(...scope, request, 1_900_000_000);
    claimPayment(...scope, request, 1_900_000_001);
    expect(
      markPaymentSubmitted(...scope, request.requestId, "0xabc", 1_900_000_002),
    ).toMatchObject({
      paymentOperation: { state: "submitted", transactionHash: "0xabc" },
      paymentVerified: false,
    });
    expect(
      markPaymentOutcome(
        ...scope,
        request.requestId,
        "0xabc",
        "unknown",
        1_900_000_003,
      ),
    ).toMatchObject({
      status: "paid",
      paymentOperation: { state: "unknown" },
      paymentPending: true,
      paymentVerified: false,
    });
  });

  it("stores an encrypted payment memo only as an unverified claim", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xa11ce"] as const;
    recordPaymentRequest(...scope, request, 1_900_000_000);
    const transfer = {
      token: request.token,
      amount: request.amount,
      to: request.requester,
    };
    const claim = { dealId: request.requestId, transfer };

    expect(
      recordUnverifiedPaymentClaim(...scope, claim, 1_900_000_001),
    ).toMatchObject({
      status: "requested",
      counterpartyPaymentClaim: claim,
    });
    const stored = recordUnverifiedPaymentClaim(...scope, claim, 1_900_000_002);
    expect(stored.status).toBe("requested");
    expect(stored.paymentTxHash).toBeUndefined();
    expect(stored.receipt).toBeUndefined();
  });

  it("releases a reserved payment without leaving a reserved operation fence", () => {
    const storage = new MemoryStorage();
    const scope = [storage, "SN_SEPOLIA", "0xb0b"] as const;
    recordPaymentRequest(...scope, request, 1_900_000_000);
    claimPayment(...scope, request, 1_900_000_001);
    const released = releasePayment(...scope, request.requestId, 1_900_000_002);
    expect(released).toMatchObject({
      status: "requested",
      paymentPending: false,
      paymentVerified: false,
    });
    expect(released).not.toHaveProperty("paymentOperation");
    expect(
      claimPayment(...scope, request, 1_900_000_003).paymentOperation?.state,
    ).toBe("reserved");
  });

  it("refuses non-STRK and expired payment requests", () => {
    const storage = new MemoryStorage();
    const nonStrk = { ...request, token: usdc };
    recordPaymentRequest(
      storage,
      "SN_SEPOLIA",
      "0xb0b",
      nonStrk,
      1_900_000_000,
    );
    expect(() =>
      claimPayment(storage, "SN_SEPOLIA", "0xb0b", nonStrk, 1_900_000_001),
    ).toThrow(/only STRK/i);

    const expired = {
      ...request,
      requestId: `0x${"33".repeat(32)}`,
      expiresAt: 100,
    };
    recordPaymentRequest(storage, "SN_SEPOLIA", "0xb0b", expired, 99);
    expect(() =>
      claimPayment(storage, "SN_SEPOLIA", "0xb0b", expired, 100),
    ).toThrow(/expired/i);
  });
});
