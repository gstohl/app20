import { describe, expect, it } from "vitest";
import { loadSentMail, saveSentMail } from "./sent-mail";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("device-private Sent index", () => {
  it("persists delivery state and every transaction hash", () => {
    const storage = new MemoryStorage();
    const documentId = `0x${"61".repeat(32)}`;
    saveSentMail(storage, "SN_SEPOLIA", "0xa11ce", {
      version: 1,
      documentId,
      type: "text",
      payload: { body: "sent copy" },
      plaintext: "sent copy",
      record: {
        ephemeralPub: ["0x1", "0x2"],
        viewTag: 3,
        nonce: ["0x4", "0x5"],
        ciphertextFelts: ["0x6"],
      },
      transactionHash: "0x222",
      transactionHashes: ["0x111", "0x222"],
      recipientCount: 1,
      deliveryState: "confirmed",
      createdAt: 100,
    });

    expect(loadSentMail(storage, "SN_SEPOLIA", "0xa11ce")).toMatchObject([
      {
        documentId,
        transactionHash: "0x222",
        transactionHashes: ["0x111", "0x222"],
        deliveryState: "confirmed",
      },
    ]);
    expect(loadSentMail(storage, "SN_MAIN", "0xa11ce")).toEqual([]);
  });
});
