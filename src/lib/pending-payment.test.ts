import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import { deriveKeypair } from "./mail";
import type { PaymentRequestPayload } from "./otc";
import {
  createSignedPaymentLinkFragment,
  encodePaymentLinkFragment,
} from "./payment-link";
import {
  PENDING_PAYMENT_STORAGE_KEY,
  clearPendingPayment,
  consumePendingPayment,
  loadPendingPayment,
  storePendingPayment,
} from "./pending-payment";

class MemorySessionStorage {
  readonly values = new Map<string, string>();

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

function request(byte: string): PaymentRequestPayload {
  return {
    requestId: `0x${byte.repeat(64)}`,
    token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
    amount: "10000000000000000",
    memo: "Invoice 7",
    expiresAt: 2_000_000_000,
    requester: "0x4567",
    chainId: "SN_SEPOLIA",
  };
}

function signedFragment(value: PaymentRequestPayload): string {
  const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const mailbox = deriveKeypair(seed);
  try {
    return createSignedPaymentLinkFragment(value, seed, mailbox.publicKey);
  } finally {
    seed.fill(0);
    mailbox.privateKey.fill(0);
  }
}

function tamperSignatureMetadata(fragment: string): string {
  const parts = fragment.split(".");
  const proof = JSON.parse(Buffer.from(parts[3], "base64url").toString("utf8"));
  proof[2] = "00".repeat(32);
  parts[3] = Buffer.from(JSON.stringify(proof)).toString("base64url");
  return parts.join(".");
}

describe("pending payment", () => {
  it("carries a verified Mail signature through storage and consumes it once", () => {
    const storage = new MemorySessionStorage();
    const pending = request("a");
    const fragment = signedFragment(pending);

    expect(storePendingPayment(storage, fragment)).toMatchObject({
      request: pending,
      authenticity: { kind: "verified" },
    });
    expect(loadPendingPayment(storage)).toMatchObject({
      request: pending,
      authenticity: { kind: "verified" },
    });
    expect(consumePendingPayment(storage)).toMatchObject({
      request: pending,
      authenticity: { kind: "verified" },
    });
    expect(consumePendingPayment(storage)).toBeNull();
  });

  it("keeps absent authenticity metadata visibly unsigned", () => {
    const storage = new MemorySessionStorage();
    const pending = request("b");

    storePendingPayment(storage, encodePaymentLinkFragment(pending));

    expect(loadPendingPayment(storage)).toEqual({
      request: pending,
      authenticity: { kind: "unsigned" },
    });
  });

  it("refuses tampered authenticity metadata instead of fabricating verification", () => {
    const storage = new MemorySessionStorage();
    const fragment = signedFragment(request("c"));

    expect(() =>
      storePendingPayment(storage, tamperSignatureMetadata(fragment)),
    ).toThrow(/signature verification failed/i);
    expect(storage.getItem(PENDING_PAYMENT_STORAGE_KEY)).toBeNull();

    storePendingPayment(storage, fragment);
    storage.setItem(
      PENDING_PAYMENT_STORAGE_KEY,
      tamperSignatureMetadata(fragment),
    );
    expect(loadPendingPayment(storage)).toBeNull();
    expect(storage.getItem(PENDING_PAYMENT_STORAGE_KEY)).toBeNull();
  });

  it("replaces the one pending request", () => {
    const storage = new MemorySessionStorage();
    const first = request("d");
    const second = request("e");

    storePendingPayment(storage, encodePaymentLinkFragment(first));
    storePendingPayment(storage, encodePaymentLinkFragment(second));

    expect(consumePendingPayment(storage)?.request).toEqual(second);
  });

  it("clears explicitly", () => {
    const storage = new MemorySessionStorage();
    storePendingPayment(storage, encodePaymentLinkFragment(request("f")));

    clearPendingPayment(storage);

    expect(loadPendingPayment(storage)).toBeNull();
  });

  it("discards malformed session data", () => {
    const storage = new MemorySessionStorage();
    storage.setItem(PENDING_PAYMENT_STORAGE_KEY, "not-a-payment-link");

    expect(loadPendingPayment(storage)).toBeNull();
    expect(storage.getItem(PENDING_PAYMENT_STORAGE_KEY)).toBeNull();
  });
});
