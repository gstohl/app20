import { mailboxKeysEqual, verifyMailSenderAuth } from "./mail-auth";
import {
  conversationFieldsFromPayload,
  type MailConversationFields,
} from "./mail-thread";

export type SenderProof =
  | { kind: "unsigned" }
  | { kind: "invalid_signature" }
  | { kind: "mailbox_signed"; mailboxPublicKey: string }
  | {
      kind: "directory_bound";
      address: string;
      mailboxPublicKey: string;
    }
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
    if (
      input.directoryMailboxKey &&
      input.directoryAddress &&
      mailboxKeysEqual(
        fields.senderAuth.mailboxPublicKey,
        input.directoryMailboxKey,
      )
    ) {
      return {
        kind: "directory_bound",
        address: input.directoryAddress,
        mailboxPublicKey: fields.senderAuth.mailboxPublicKey,
      };
    }
    return {
      kind: "mailbox_signed",
      mailboxPublicKey: fields.senderAuth.mailboxPublicKey,
    };
  }
  if (input.assignedAddress) {
    return { kind: "assignment_only", address: input.assignedAddress };
  }
  return { kind: "unsigned" };
}

export function senderProofLabel(proof: SenderProof): string {
  switch (proof.kind) {
    case "directory_bound":
      return `Mailbox key matches the public directory for ${proof.address}`;
    case "mailbox_signed":
      return "Signed by a Quietline mailbox key. That is not yet a wallet address.";
    case "invalid_signature":
      return "This letter claims a mailbox signature, but the signature is invalid.";
    case "assignment_only":
      return `Assigned on this device to ${proof.address}. That is a local label, not a proof.`;
    default:
      return "Sealed letter. No sender is present unless a later letter is signed.";
  }
}
