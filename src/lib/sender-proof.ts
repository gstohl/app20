import { verifyMailSenderAuth } from "./mail-auth.js";
import {
  conversationFieldsFromPayload,
  type MailConversationFields,
} from "./mail-thread.js";

export type SenderProof =
  | { kind: "unsigned" }
  | { kind: "invalid_signature" }
  | { kind: "unbound_signature"; claimedMailboxPublicKey: string }
  | { kind: "assignment_only"; address: string };

export function evaluateSenderProof(input: {
  type: string;
  payload: unknown;
  assignedAddress?: string;
  directoryMailboxKey?: Uint8Array | null;
  directoryAddress?: string;
}): SenderProof {
  const fields: MailConversationFields = conversationFieldsFromPayload(
    input.type,
    input.payload,
  );
  if (fields.senderAuth) {
    const authentic = verifyMailSenderAuth(fields.senderAuth, {
      documentId: fields.documentId ?? "",
      conversationId: fields.conversationId ?? "",
      inReplyTo: fields.inReplyTo ?? "",
      body:
        input.payload &&
        typeof input.payload === "object" &&
        "body" in input.payload &&
        typeof input.payload.body === "string"
          ? input.payload.body
          : "",
    });
    if (!authentic) return { kind: "invalid_signature" };
    return {
      kind: "unbound_signature",
      claimedMailboxPublicKey: fields.senderAuth.mailboxPublicKey,
    };
  }
  if (input.assignedAddress) {
    return { kind: "assignment_only", address: input.assignedAddress };
  }
  return { kind: "unsigned" };
}

export function senderProofLabel(proof: SenderProof): string {
  switch (proof.kind) {
    case "unbound_signature":
      return "Valid signature from an unregistered Mail auth key. It does not prove a mailbox or wallet address.";
    case "invalid_signature":
      return "This letter claims a mailbox signature, but the signature is invalid.";
    case "assignment_only":
      return `Assigned on this device to ${proof.address}. That is a local label, not a proof.`;
    default:
      return "Sealed letter. No sender is present unless a later letter is signed.";
  }
}
