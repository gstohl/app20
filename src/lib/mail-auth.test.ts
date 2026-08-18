import { describe, expect, it } from "vitest";
import { deriveKeypair } from "./mail";
import {
  createMailSenderAuth,
  deriveMailAuthKeypair,
  mailboxPublicKeyHex,
  parseMailSenderAuth,
  verifyMailSenderAuth,
} from "./mail-auth";

function seed(byte: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, () => byte);
}

describe("mailbox-key sender authentication", () => {
  it("verifies a signature over the conversation subject", () => {
    const mailbox = deriveKeypair(seed(7));
    const subject = {
      documentId: `0x${"11".repeat(32)}`,
      conversationId: `0x${"22".repeat(32)}`,
      inReplyTo: "",
      body: "hello",
    };
    const auth = createMailSenderAuth(seed(7), mailbox.publicKey, subject);
    expect(verifyMailSenderAuth(auth, subject)).toBe(true);
    expect(verifyMailSenderAuth(auth, { ...subject, body: "tampered" })).toBe(
      false,
    );
  });

  it("uses a sibling Ed25519 key, not the x25519 mailbox key", () => {
    const mailbox = deriveKeypair(seed(8));
    const auth = deriveMailAuthKeypair(seed(8));
    expect(mailboxPublicKeyHex(auth.publicKey)).not.toBe(
      mailboxPublicKeyHex(mailbox.publicKey),
    );
    expect(parseMailSenderAuth({ version: 2 })).toBeNull();
  });
});
