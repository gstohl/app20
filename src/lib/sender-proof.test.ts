import { describe, expect, it } from "vitest";
import { deriveKeypair } from "./mail";
import { createMailSenderAuth } from "./mail-auth";
import { evaluateSenderProof, senderProofLabel } from "./sender-proof";

function seed(byte: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, () => byte);
}

describe("sender proof states", () => {
  it("treats a local assignment as a label, not a proof", () => {
    const proof = evaluateSenderProof({
      type: "text",
      payload: { body: "hi" },
      assignedAddress: "0xb0b",
    });
    expect(proof).toEqual({ kind: "assignment_only", address: "0xb0b" });
    expect(senderProofLabel(proof)).toMatch(/local label/i);
  });

  it("never treats the unregistered Mail auth key as a wallet-directory proof", () => {
    const mailbox = deriveKeypair(seed(9));
    const subject = {
      documentId: `0x${"11".repeat(32)}`,
      conversationId: `0x${"22".repeat(32)}`,
      inReplyTo: "",
      body: "hello",
    };
    const auth = createMailSenderAuth(seed(9), mailbox.publicKey, subject);
    const signed = evaluateSenderProof({
      type: "text",
      payload: { ...subject, senderAuth: auth },
    });
    expect(signed.kind).toBe("unbound_signature");
    const stillUnbound = evaluateSenderProof({
      type: "text",
      payload: { ...subject, senderAuth: auth },
      directoryAddress: "0xa11ce",
      directoryMailboxKey: mailbox.publicKey,
    });
    expect(stillUnbound).toMatchObject({
      kind: "unbound_signature",
      claimedMailboxPublicKey: auth.mailboxPublicKey,
    });
    expect(senderProofLabel(stillUnbound)).toMatch(/does not prove/i);
  });
});
