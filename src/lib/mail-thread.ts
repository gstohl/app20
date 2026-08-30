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

type ThreadAssemblyMessage = {
  id: string;
  documentId?: string;
  localConversationId?: string;
  direction?: "incoming" | "outgoing";
  index?: unknown;
  record?: unknown;
  transactionHash?: unknown;
  blockNumber?: unknown;
  blockTimestamp?: unknown;
  eventIndex?: unknown;
  threadProvenance?: "device_sent_and_on_chain";
  envelope: { type: string; payload?: unknown };
};

function stableDocumentId(message: ThreadAssemblyMessage): string | undefined {
  const fields = conversationFieldsFromPayload(
    message.envelope.type,
    message.envelope.type === "unsupported" ? null : message.envelope.payload,
  );
  return fields.documentId ?? parseConversationId(message.documentId);
}

function collapseSelfMailCopies<Message extends ThreadAssemblyMessage>(
  messages: readonly Message[],
): Message[] {
  const collapsed: Message[] = [];
  const positions = new Map<string, number>();

  for (const message of messages) {
    const documentId = stableDocumentId(message);
    const position = documentId ? positions.get(documentId) : undefined;
    if (position === undefined) {
      collapsed.push(message);
      if (documentId) positions.set(documentId, collapsed.length - 1);
      continue;
    }

    const existing = collapsed[position];
    const existingHasSentCopy =
      existing.direction === "outgoing" ||
      existing.threadProvenance === "device_sent_and_on_chain";
    const messageHasSentCopy =
      message.direction === "outgoing" ||
      message.threadProvenance === "device_sent_and_on_chain";
    if (existingHasSentCopy === messageHasSentCopy) {
      // Never collapse two independently observed messages merely because
      // their payloads (or bodies) happen to be equal.
      collapsed.push(message);
      continue;
    }

    const sent = (existingHasSentCopy ? existing : message) as Message;
    const chain = (existingHasSentCopy ? message : existing) as Message;
    collapsed[position] = {
      ...chain,
      ...sent,
      id: sent.id,
      documentId: sent.documentId ?? chain.documentId,
      direction: "outgoing",
      index: chain.index ?? sent.index,
      record: chain.record ?? sent.record,
      transactionHash: chain.transactionHash ?? sent.transactionHash,
      blockNumber: chain.blockNumber ?? sent.blockNumber,
      blockTimestamp: chain.blockTimestamp ?? sent.blockTimestamp,
      eventIndex: chain.eventIndex ?? sent.eventIndex,
      threadProvenance: "device_sent_and_on_chain",
    } as Message;
  }

  return collapsed;
}

export function assembleConversation<Message extends ThreadAssemblyMessage>(
  messagesNewestFirst: readonly Message[],
  selectedMessageId: string | null,
): Message[] {
  if (!selectedMessageId) return [];
  const selected = messagesNewestFirst.find(
    (message) => message.id === selectedMessageId,
  );
  if (!selected) return [];
  const conversationId = conversationKeyForMessage(selected);
  const chronologicalFallback = collapseSelfMailCopies(
    messagesNewestFirst
      .filter(
        (message) => conversationKeyForMessage(message) === conversationId,
      )
      .slice()
      .reverse(),
  );
  const documentIds = new Set(
    chronologicalFallback.flatMap((message) => {
      const documentId = stableDocumentId(message);
      return documentId ? [documentId] : [];
    }),
  );
  const emittedDocumentIds = new Set<string>();
  const remaining = [...chronologicalFallback];
  const assembled: Message[] = [];
  while (remaining.length) {
    const readyIndex = remaining.findIndex((message) => {
      const fields = conversationFieldsFromPayload(
        message.envelope.type,
        message.envelope.type === "unsupported"
          ? null
          : message.envelope.payload,
      );
      return (
        !fields.inReplyTo ||
        !documentIds.has(fields.inReplyTo) ||
        emittedDocumentIds.has(fields.inReplyTo)
      );
    });
    // Malformed reply cycles retain the honest mailbox-time fallback rather
    // than dropping a locally substantiated record.
    const index = readyIndex < 0 ? 0 : readyIndex;
    const [message] = remaining.splice(index, 1);
    assembled.push(message);
    const documentId = stableDocumentId(message);
    if (documentId) emittedDocumentIds.add(documentId);
  }
  return assembled;
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
