import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import {
  claimPayment,
  confirmPayment,
  loadOtcState,
  markPaymentSubmitted,
  markPaymentOutcome,
  receiptForTransfer,
  recordPaymentRequest,
  type PaymentRequestPayload,
} from "./otc";
import { createPaymentLink, createSignedPaymentLinkFragment, decodePaymentLink, encodePaymentLinkFragment } from "./payment-link";
import { deriveKeypair } from "./mail";
import { importPendingPaymentIntoMailbox } from "./payment-link-handoff";
import { loadPendingPayment, storePendingPayment } from "./pending-payment";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const request: PaymentRequestPayload = {
  requestId: `0x${"52".repeat(32)}`,
  token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
  amount: "1250000000000000000",
  memo: "Invoice-link integration",
  expiresAt: 2_000_000_000,
  requester: "0x4567",
  chainId: "SN_SEPOLIA",
};

describe("payment-link mailbox handoff", () => {
  it("decodes, waits for explicit handoff, imports once, and cannot pay twice", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const chainId = "SN_SEPOLIA";
    const payer = "0xb0b";

    const link = createPaymentLink(request, "https://app20.example/");
    const fragment = new URL(link).hash;

    // /pay only stages the reviewed request. Opening the link creates no local
    // payment record and cannot submit or reserve a transfer.
    storePendingPayment(session, fragment);
    expect(loadOtcState(local, chainId, payer).payments).toEqual({});
    expect(loadPendingPayment(session)?.request).toEqual(request);

    const imported = importPendingPaymentIntoMailbox(
      session,
      local,
      chainId,
      payer,
      1_900_000_000,
    );
    expect(imported).toMatchObject({
      request,
      status: "requested",
      origin: "payment_link",
    });
    expect(imported).not.toHaveProperty("paymentPending");
    expect(imported).not.toHaveProperty("paymentTxHash");
    expect(loadPendingPayment(session)).toBeNull();
    expect(
      importPendingPaymentIntoMailbox(
        session,
        local,
        chainId,
        payer,
        1_900_000_001,
      ),
    ).toBeNull();

    const reserved = claimPayment(
      local,
      chainId,
      payer,
      request,
      1_900_000_002,
    );
    expect(reserved).toMatchObject({ status: "paid", paymentPending: true });

    const transfer = {
      token: request.token,
      amount: request.amount,
      to: request.requester,
    };
    const transactionHash = "0xabc";
    markPaymentSubmitted(
      local,
      chainId,
      payer,
      request.requestId,
      transactionHash,
      1_900_000_003,
    );
    confirmPayment(
      local,
      chainId,
      payer,
      request.requestId,
      transactionHash,
      receiptForTransfer(request.requestId, transfer, transactionHash),
      1_900_000_004,
    );
    expect(
      loadOtcState(local, chainId, payer).payments[request.requestId],
    ).toMatchObject({
      status: "paid",
      paymentPending: false,
      paymentVerified: true,
      paymentTxHash: transactionHash,
      origin: "payment_link",
    });
    expect(() =>
      claimPayment(local, chainId, payer, request, 1_900_000_005),
    ).toThrow(/already paid; no second transfer/i);
  });

  it.each(["link-first", "document-first", "document-reserved-first", "document-unknown-first"])("preserves the verified signed request with %s reconciliation", order => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const mailbox = deriveKeypair(seed);
    try {
      const fragment = createSignedPaymentLinkFragment(request, seed, mailbox.publicKey);
      const session = new MemoryStorage();
      const local = new MemoryStorage();
      const scope = [local, "0x534e5f5345504f4c4941", "0xb0b"] as const;
      const historical = { ...request };
      delete historical.chainId;
      if (order !== "link-first") recordPaymentRequest(...scope, historical, 1_900_000_000);
      const alreadyAttempted = order === "document-reserved-first" || order === "document-unknown-first";
      if (alreadyAttempted) claimPayment(...scope, historical, 1_900_000_000);
      if (order === "document-unknown-first") markPaymentOutcome(...scope, request.requestId, undefined, "unknown", 1_900_000_000);
      const priorOperation = loadOtcState(...scope).payments[request.requestId]?.paymentOperation;
      storePendingPayment(session, fragment);
      const pending = loadPendingPayment(session)!;
      const reviewed = structuredClone(pending);
      expect(pending.authenticity.kind).toBe("verified");
      importPendingPaymentIntoMailbox(session, ...scope, 1_900_000_000);
      recordPaymentRequest(...scope, historical, 1_900_000_001);
      const stored = loadOtcState(...scope).payments[request.requestId];
      expect(stored.request).toEqual(reviewed.request);
      expect(stored.linkAuthenticity).toEqual(reviewed.authenticity);
      if (alreadyAttempted) {
        expect(stored).toMatchObject({ status: "paid", paymentPending: true, paymentOperation: priorOperation });
        expect(() => claimPayment(...scope, historical, 1_900_000_002)).toThrow(/no second transfer/i);
      } else {
        expect(claimPayment(...scope, historical, 1_900_000_002).request).toEqual(reviewed.request);
      }
      expect(pending).toEqual(reviewed);
      expect(decodePaymentLink(fragment)).toEqual(reviewed);
      expect(request.chainId).toBe("SN_SEPOLIA");
    } finally {
      seed.fill(0);
      mailbox.privateKey.fill(0);
    }
  });

  it("keeps the tab handoff until the wallet is on the bound network", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const payer = "0xb0b";
    storePendingPayment(session, encodePaymentLinkFragment(request));

    expect(() =>
      importPendingPaymentIntoMailbox(session, local, "SN_MAIN", payer),
    ).toThrow(/another Starknet network.*remains pending/i);
    expect(loadPendingPayment(session)?.request).toEqual(request);
    expect(loadOtcState(local, "SN_MAIN", payer).payments).toEqual({});

    expect(
      importPendingPaymentIntoMailbox(session, local, "SN_SEPOLIA", payer),
    ).toMatchObject({ request, origin: "payment_link" });
    expect(loadPendingPayment(session)).toBeNull();
  });

  it("keeps the tab handoff when mailbox persistence fails", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    storePendingPayment(session, encodePaymentLinkFragment(request));
    local.setItem = () => {
      throw new Error("storage denied");
    };

    expect(() =>
      importPendingPaymentIntoMailbox(session, local, "SN_SEPOLIA", "0xb0b"),
    ).toThrow(/storage denied/i);
    expect(loadPendingPayment(session)?.request).toEqual(request);
  });
});
