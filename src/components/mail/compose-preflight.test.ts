import { describe, expect, it } from "vitest";
import { createMailSenderAuth } from "@/lib/mail-auth";
import { deriveKeypair } from "@/lib/mail";
import { envelopeByteLength } from "@/lib/envelope";
import {
  COMPOSE_PREVIEW_SENDER_AUTH,
  composerInvoiceTokenOptions,
} from "./Compose";

function seed(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

describe("compose ciphertext preflight", () => {
  it("offers registry-shaped USDC only on the localnet composer", () => {
    expect(composerInvoiceTokenOptions(0, "0x123")).toEqual([
      expect.objectContaining({ symbol: "STRK", decimals: 18 }),
    ]);
    expect(composerInvoiceTokenOptions(2, "0x123")).toEqual([
      expect.objectContaining({ symbol: "STRK", decimals: 18 }),
    ]);
    expect(composerInvoiceTokenOptions(3, "0x123")).toEqual([
      expect.objectContaining({ symbol: "STRK", decimals: 18 }),
      {
        symbol: "USDC",
        address: `0x${"123".padStart(64, "0")}`,
        decimals: 6,
      },
    ]);
    expect(composerInvoiceTokenOptions(3, "0x0")).toHaveLength(1);
  });

  it("keeps preview senderAuth the same encoded length as a real Mail signature", () => {
    const mailbox = deriveKeypair(seed(9));
    const real = createMailSenderAuth(seed(9), mailbox.publicKey, {
      documentId: `0x${"11".repeat(32)}`,
      conversationId: `0x${"22".repeat(32)}`,
      inReplyTo: "",
      body: "hello from the composer",
    });
    const payload = (senderAuth: typeof real) => ({
      body: "hello from the composer",
      documentId: `0x${"11".repeat(32)}`,
      conversationId: `0x${"22".repeat(32)}`,
      senderAuth,
    });

    expect(
      envelopeByteLength("text", payload(COMPOSE_PREVIEW_SENDER_AUTH)),
    ).toBe(envelopeByteLength("text", payload(real)));
  });

  it("does not spend a signing round-trip just to size a preview document", () => {
    const started = performance.now();
    for (let index = 0; index < 200; index += 1) {
      envelopeByteLength("text", {
        body: `draft ${index}`,
        documentId: `0x${"11".repeat(32)}`,
        conversationId: `0x${"22".repeat(32)}`,
        senderAuth: COMPOSE_PREVIEW_SENDER_AUTH,
      });
    }
    expect(performance.now() - started).toBeLessThan(50);
  });
});
