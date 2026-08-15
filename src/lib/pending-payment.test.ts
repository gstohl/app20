import { describe, expect, it } from "vitest";
import { addrSTRK } from "../utils/constants";
import type { PaymentRequestPayload } from "./otc";
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
  };
}

describe("pending payment", () => {
  it("stores one validated request and consumes it exactly once", () => {
    const storage = new MemorySessionStorage();
    const pending = request("a");

    expect(storePendingPayment(storage, pending)).toEqual(pending);
    expect(loadPendingPayment(storage)).toEqual(pending);
    expect(consumePendingPayment(storage)).toEqual(pending);
    expect(consumePendingPayment(storage)).toBeNull();
  });

  it("replaces the one pending request", () => {
    const storage = new MemorySessionStorage();
    const first = request("a");
    const second = request("b");

    storePendingPayment(storage, first);
    storePendingPayment(storage, second);

    expect(consumePendingPayment(storage)).toEqual(second);
  });

  it("clears explicitly", () => {
    const storage = new MemorySessionStorage();
    storePendingPayment(storage, request("c"));

    clearPendingPayment(storage);

    expect(loadPendingPayment(storage)).toBeNull();
  });

  it("discards malformed session data", () => {
    const storage = new MemorySessionStorage();
    storage.setItem(PENDING_PAYMENT_STORAGE_KEY, "not-a-payment-link");

    expect(loadPendingPayment(storage)).toBeNull();
    expect(storage.getItem(PENDING_PAYMENT_STORAGE_KEY)).toBeNull();
  });

  it("refuses to store non-canonical STRK metadata", () => {
    const storage = new MemorySessionStorage();

    expect(() =>
      storePendingPayment(storage, {
        ...request("d"),
        token: { symbol: "STRK", address: addrSTRK, decimals: 6 },
      }),
    ).toThrow(/canonical STRK/i);
    expect(storage.getItem(PENDING_PAYMENT_STORAGE_KEY)).toBeNull();
  });
});
