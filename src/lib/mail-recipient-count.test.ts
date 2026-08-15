import { describe, expect, it } from "vitest";
import {
  MULTI_RECIPIENT_VIEW_TAG,
  deriveKeypair,
  encryptMailForRecipients,
  packBytesToFelts,
} from "./mail";
import { publicRecipientCount } from "./mail-recipient-count";

function recipient(byte: number) {
  return deriveKeypair(new Uint8Array(32).fill(byte));
}

describe("publicRecipientCount", () => {
  it("reports one for the legacy-compatible single-recipient format", async () => {
    const record = await encryptMailForRecipients(
      [recipient(1).publicKey],
      "one recipient",
    );

    expect(publicRecipientCount(record)).toBe(1);
  });

  it("reports the public slot count for multi-recipient ciphertext", async () => {
    const recipients = [recipient(2), recipient(3), recipient(4)];
    const record = await encryptMailForRecipients(
      recipients.map(({ publicKey }) => publicKey),
      "same letter",
    );

    expect(publicRecipientCount(record)).toBe(3);
  });

  it("does not trust a malformed record that only uses the reserved view tag", () => {
    expect(
      publicRecipientCount({
        ephemeralPub: ["0x1", "0x2"],
        viewTag: MULTI_RECIPIENT_VIEW_TAG,
        nonce: ["0x3", "0x4"],
        ciphertextFelts: packBytesToFelts(
          new Uint8Array([0x51, 0x4c, 0x4d, 0x01, 0x42]),
        ),
      }),
    ).toBe(1);
  });
});
