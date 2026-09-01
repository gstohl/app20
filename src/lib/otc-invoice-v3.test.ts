import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/constants")>();
  return {
    ...actual,
    localnetWalletEnabled: true,
    localnetUsdcToken: "0x53c",
  };
});

import { LOCALNET_CHAIN_ID } from "../utils/constants";
import {
  createPaymentLinkRequest,
  decodePaymentLinkFragment,
  encodePaymentLinkFragment,
} from "./payment-link";
import {
  claimMatureInvoicePayment,
  claimPayment,
  confirmPayment,
  invoicePaymentMaturity,
  loadOtcState,
  markPaymentOutcome,
  markPaymentSubmitted,
  receiptForTransfer,
  recordInvoiceTakeSettled,
  recordPaymentRequest,
  releasePayment,
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

const request: PaymentRequestPayload = {
  requestId: `0x${"55".repeat(32)}`,
  token: { symbol: "USDC", address: "0x53c", decimals: 6 },
  amount: "2500000",
  memo: "Invoice 55",
  expiresAt: 2_000_000_000,
  requester: "0x4567",
  chainId: LOCALNET_CHAIN_ID,
};

const ACCOUNT = "0xb0b";
const NOW = 1_900_000_000;

function setup() {
  const storage = new MemoryStorage();
  recordPaymentRequest(storage, LOCALNET_CHAIN_ID, ACCOUNT, request, NOW);
  return storage;
}

describe("pay-any-token invoice lifecycle", () => {
  it("round-trips registry-resolved localnet USDC payment links", () => {
    const created = createPaymentLinkRequest(
      {
        amount: "2.5",
        expiryHours: "1",
        requester: request.requester,
        chainId: LOCALNET_CHAIN_ID,
        token: "USDC",
      },
      { atSeconds: NOW, requestId: request.requestId },
    );
    expect(created).toMatchObject({
      token: { symbol: "USDC", address: "0x53c", decimals: 6 },
      amount: "2500000",
    });
    expect(
      decodePaymentLinkFragment(encodePaymentLinkFragment(created)),
    ).toEqual(created);
    expect(() =>
      createPaymentLinkRequest({
        amount: "2.5",
        expiryHours: "1",
        requester: request.requester,
        chainId: "SN_SEPOLIA",
        token: "USDC",
      }),
    ).toThrow(/public networks remain STRK-only/i);
  });

  it("records the settled take and gates USDC completion on note maturity", () => {
    const storage = setup();
    const awaiting = recordInvoiceTakeSettled(
      storage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      {
        requestId: request.requestId,
        takeTransactionHash: "0xabc",
        takeBlock: 100,
        buyToken: "0x53c",
        amount: request.amount,
      },
      NOW + 1,
    );
    expect(awaiting).toMatchObject({
      status: "requested",
      paymentOperation: {
        state: "awaiting-note-maturity",
        takeTransactionHash: "0xabc",
        takeBlock: 100,
        amount: request.amount,
      },
    });
    expect(invoicePaymentMaturity(awaiting, 109)).toEqual({
      mature: false,
      matureAtBlock: 110,
      blocksRemaining: 1,
    });
    expect(invoicePaymentMaturity(awaiting, 110)).toEqual({
      mature: true,
      matureAtBlock: 110,
      blocksRemaining: 0,
    });
    expect(() =>
      claimPayment(storage, LOCALNET_CHAIN_ID, ACCOUNT, request, NOW + 2),
    ).toThrow(/maturity/i);
    expect(() =>
      claimMatureInvoicePayment(
        storage,
        LOCALNET_CHAIN_ID,
        ACCOUNT,
        request,
        109,
        NOW + 2,
      ),
    ).toThrow(/matures at block 110/i);
    expect(
      claimMatureInvoicePayment(
        storage,
        LOCALNET_CHAIN_ID,
        ACCOUNT,
        request,
        110,
        NOW + 2,
      ),
    ).toMatchObject({
      status: "paid",
      paymentOperation: {
        state: "reserved",
        takeTransactionHash: "0xabc",
      },
    });
  });

  it("moves mature invoice payment reserved to submitted to confirmed", () => {
    const storage = setup();
    recordInvoiceTakeSettled(
      storage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      {
        requestId: request.requestId,
        takeTransactionHash: "0xabc",
        takeBlock: 100,
        buyToken: "0x53c",
        amount: request.amount,
      },
      NOW + 1,
    );
    claimMatureInvoicePayment(
      storage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      request,
      110,
      NOW + 2,
    );
    const submitted = markPaymentSubmitted(
      storage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      request.requestId,
      "0xdef",
      NOW + 3,
    );
    expect(submitted.paymentOperation).toMatchObject({
      state: "submitted",
      takeTransactionHash: "0xabc",
      transactionHash: "0xdef",
    });
    const transfer = {
      token: submitted.request.token,
      amount: submitted.request.amount,
      to: submitted.request.requester,
    };
    expect(
      confirmPayment(
        storage,
        LOCALNET_CHAIN_ID,
        ACCOUNT,
        request.requestId,
        "0xdef",
        receiptForTransfer(request.requestId, transfer, "0xdef"),
        NOW + 4,
      ),
    ).toMatchObject({
      status: "paid",
      paymentOperation: { state: "confirmed", takeTransactionHash: "0xabc" },
      paymentVerified: true,
    });
  });

  it("returns a pre-submission release or proven revert to awaiting maturity", () => {
    const releasedStorage = setup();
    recordInvoiceTakeSettled(releasedStorage, LOCALNET_CHAIN_ID, ACCOUNT, {
      requestId: request.requestId,
      takeTransactionHash: "0xabc",
      takeBlock: 100,
      buyToken: "0x53c",
      amount: request.amount,
    });
    claimMatureInvoicePayment(
      releasedStorage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      request,
      110,
    );
    expect(
      releasePayment(
        releasedStorage,
        LOCALNET_CHAIN_ID,
        ACCOUNT,
        request.requestId,
      ),
    ).toMatchObject({
      status: "requested",
      paymentOperation: { state: "awaiting-note-maturity" },
    });

    const revertedStorage = setup();
    recordInvoiceTakeSettled(revertedStorage, LOCALNET_CHAIN_ID, ACCOUNT, {
      requestId: request.requestId,
      takeTransactionHash: "0xabc",
      takeBlock: 100,
      buyToken: "0x53c",
      amount: request.amount,
    });
    claimMatureInvoicePayment(
      revertedStorage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      request,
      110,
    );
    markPaymentSubmitted(
      revertedStorage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      request.requestId,
      "0xdef",
    );
    expect(
      markPaymentOutcome(
        revertedStorage,
        LOCALNET_CHAIN_ID,
        ACCOUNT,
        request.requestId,
        "0xdef",
        "reverted",
      ),
    ).toMatchObject({
      status: "requested",
      paymentOperation: { state: "awaiting-note-maturity" },
    });
  });

  it("is idempotent only for the exact settled take and rejects public USDC", () => {
    const storage = setup();
    const input = {
      requestId: request.requestId,
      takeTransactionHash: "0xabc",
      takeBlock: 100,
      buyToken: "0x53c",
      amount: request.amount,
    };
    const first = recordInvoiceTakeSettled(
      storage,
      LOCALNET_CHAIN_ID,
      ACCOUNT,
      input,
    );
    expect(
      recordInvoiceTakeSettled(storage, LOCALNET_CHAIN_ID, ACCOUNT, input),
    ).toEqual(first);
    expect(() =>
      recordInvoiceTakeSettled(storage, LOCALNET_CHAIN_ID, ACCOUNT, {
        ...input,
        takeTransactionHash: "0xabd",
      }),
    ).toThrow(/different settled take/i);

    const publicStorage = new MemoryStorage();
    recordPaymentRequest(publicStorage, "SN_SEPOLIA", ACCOUNT, request, NOW);
    expect(() =>
      claimPayment(publicStorage, "SN_SEPOLIA", ACCOUNT, request, NOW + 1),
    ).toThrow(/only STRK.*public networks/i);
    expect(
      loadOtcState(publicStorage, "SN_SEPOLIA", ACCOUNT).payments,
    ).toHaveProperty(request.requestId);
  });
});
