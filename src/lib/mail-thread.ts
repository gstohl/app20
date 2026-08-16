import { parseMailSenderAuth, type MailSenderAuth } from "./mail-auth";

const DOCUMENT_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type MailConversationFields = {
  documentId?: string;
  conversationId?: string;
  inReplyTo?: string;
  senderAuth?: MailSenderAuth;
};

export function randomConversationId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function parseConversationId(value: unknown): string | undefined {
  return typeof value === "string" && DOCUMENT_ID_PATTERN.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function conversationFieldsFromPayload(
  type: string,
  payload: unknown,
): MailConversationFields {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const fields: MailConversationFields = {};
  const documentId = parseConversationId(record.documentId);
  const conversationId = parseConversationId(record.conversationId);
  const inReplyTo = parseConversationId(record.inReplyTo);
  const senderAuth = parseMailSenderAuth(record.senderAuth);
  if (documentId) fields.documentId = documentId;
  if (conversationId) fields.conversationId = conversationId;
  if (inReplyTo) fields.inReplyTo = inReplyTo;
  if (senderAuth) fields.senderAuth = senderAuth;
  void type;
  return fields;
}

export function conversationKeyForMessage(message: {
  id: string;
  documentId?: string;
  localConversationId?: string;
  envelope: { type: string; payload?: unknown };
}): string {
  const fields = conversationFieldsFromPayload(
    message.envelope.type,
    message.envelope.type === "unsupported" ? null : message.envelope.payload,
  );
  return (
    fields.conversationId ??
    message.localConversationId ??
    fields.documentId ??
    message.documentId ??
    message.id
  );
}

export function nextConversationFields(parent?: {
  id: string;
  documentId?: string;
  localConversationId?: string;
  envelope: { type: string; payload?: unknown };
}): Required<Pick<MailConversationFields, "conversationId" | "inReplyTo">> {
  if (!parent) {
    return { conversationId: randomConversationId(), inReplyTo: "" };
  }
  const fields = conversationFieldsFromPayload(
    parent.envelope.type,
    parent.envelope.type === "unsupported" ? null : parent.envelope.payload,
  );
  return {
    conversationId:
      fields.conversationId ??
      parent.localConversationId ??
      fields.documentId ??
      parent.documentId ??
      randomConversationId(),
    inReplyTo: fields.documentId ?? parent.documentId ?? "",
  };
}
