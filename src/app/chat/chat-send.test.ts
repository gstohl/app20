import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import { deriveKeypair } from "@/lib/mail";
import { mailboxPublicKeyHex, verifyMailSenderAuth } from "@/lib/mail-auth";
import {
  CHAT_LETTER_MAX_CHARS,
  buildChatLetter,
  chatLetterBudget,
  chatSendBlocker,
  previewChatLetterBudget,
} from "./chat-send";

const SEED = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const DOCUMENT = `0x${"ab".repeat(32)}`;
const CONVERSATION = `0x${"cd".repeat(32)}`;

const READY = {
  helperAddress: "0x123",
  networkName: "LOCALNET (DEV)",
  connected: true,
  hasWalletAccount: true,
  senderAddress: "0xa11ce",
  isStrk20Capable: true,
  keyReady: true,
};

describe("chat send readiness", () => {
  it("blocks in the same order Mailbox's composer does", () => {
    expect(chatSendBlocker({ ...READY, helperAddress: null })).toMatchObject({
      kind: "network",
      message: expect.stringMatching(/Mail is unavailable on LOCALNET \(DEV\)/),
    });
    expect(chatSendBlocker({ ...READY, connected: false })).toMatchObject({
      kind: "wallet",
      message: expect.stringMatching(/Connect a privacy-enabled wallet/),
    });
    expect(chatSendBlocker({ ...READY, hasWalletAccount: false })?.kind).toBe(
      "wallet",
    );
    expect(chatSendBlocker({ ...READY, isStrk20Capable: false })).toMatchObject({
      kind: "capability",
      message: expect.stringMatching(/STRK20 Wallet API/),
    });
    expect(chatSendBlocker({ ...READY, keyReady: false })).toMatchObject({
      kind: "key",
      message: expect.stringMatching(/mail key/),
    });
    expect(chatSendBlocker(READY)).toBeNull();
  });
});

describe("chat letter", () => {
  it("builds a signed text envelope Mailbox can decode and verify", () => {
    const letter = buildChatLetter({
      body: "Hello from the desk",
      documentId: DOCUMENT,
      conversationId: CONVERSATION,
      inReplyTo: "",
      mailSeed: SEED,
    });
    expect(letter.type).toBe("text");
    expect(letter.documentId).toBe(DOCUMENT);
    expect(letter.payload).toMatchObject({
      body: "Hello from the desk",
      documentId: DOCUMENT,
      conversationId: CONVERSATION,
    });
    expect(letter.payload).not.toHaveProperty("inReplyTo");
    const decoded = decodeEnvelope(encodeEnvelope(letter.type, letter.payload));
    expect(decoded.type).toBe("text");
    const senderAuth = (
      decoded as { payload: { senderAuth: Parameters<typeof verifyMailSenderAuth>[0] } }
    ).payload.senderAuth;
    expect(senderAuth.mailboxPublicKey).toBe(
      mailboxPublicKeyHex(deriveKeypair(SEED).publicKey),
    );
    expect(
      verifyMailSenderAuth(senderAuth, {
        documentId: DOCUMENT,
        conversationId: CONVERSATION,
        inReplyTo: "",
        body: "Hello from the desk",
      }),
    ).toBe(true);
    expect(
      verifyMailSenderAuth(senderAuth, {
        documentId: DOCUMENT,
        conversationId: CONVERSATION,
        inReplyTo: "",
        body: "Hello from the desk!",
      }),
    ).toBe(false);
  });

  it("threads a reply and stays unsigned without a mailbox seed", () => {
    const letter = buildChatLetter({
      body: "Re: terms",
      documentId: DOCUMENT,
      conversationId: CONVERSATION,
      inReplyTo: `0x${"ef".repeat(32)}`,
    });
    expect(letter.payload).toMatchObject({ inReplyTo: `0x${"ef".repeat(32)}` });
    expect(letter.payload).not.toHaveProperty("senderAuth");
  });

  it("mints ids when none are supplied and refuses empty or oversized bodies", () => {
    const letter = buildChatLetter({ body: "ok" });
    expect(letter.documentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(letter.conversationId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(letter.documentId).not.toBe(letter.conversationId);
    expect(() => buildChatLetter({ body: "   " })).toThrow(/Write a message/);
    expect(() =>
      buildChatLetter({ body: "x".repeat(CHAT_LETTER_MAX_CHARS + 1) }),
    ).toThrow(/characters/);
  });

  it("projects the same ciphertext budget for the stand-in and the real signature", () => {
    const body = "A short letter about a quote.";
    const preview = previewChatLetterBudget(body, true);
    const real = chatLetterBudget(
      buildChatLetter({
        body,
        documentId: DOCUMENT,
        conversationId: CONVERSATION,
        mailSeed: SEED,
      }),
    );
    expect(preview.plaintextBytes).toBe(real.plaintextBytes);
    expect(preview.fits).toBe(true);
    expect(previewChatLetterBudget(body, false).plaintextBytes).toBeLessThan(
      preview.plaintextBytes,
    );
    expect(previewChatLetterBudget("y".repeat(4_000), true).fits).toBe(false);
  });
});
