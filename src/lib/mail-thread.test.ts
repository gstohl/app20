import { describe, expect, it } from "vitest";
import {
  assembleConversation,
  conversationFieldsFromPayload,
  conversationKeyForMessage,
  nextConversationFields,
  parseConversationId,
} from "./mail-thread";

describe("conversation tags", () => {
  it("accepts only 32-byte hex conversation ids", () => {
    expect(parseConversationId(`0x${"ab".repeat(32)}`)).toBe(
      `0x${"ab".repeat(32)}`,
    );
    expect(parseConversationId("thread-1")).toBeUndefined();
  });

  it("reuses a parent conversation id when starting a reply", () => {
    const parent = {
      id: "incoming:1",
      documentId: `0x${"11".repeat(32)}`,
      envelope: {
        type: "text",
        payload: {
          body: "hi",
          conversationId: `0x${"22".repeat(32)}`,
          documentId: `0x${"33".repeat(32)}`,
        },
      },
    };
    expect(conversationKeyForMessage(parent)).toBe(`0x${"22".repeat(32)}`);
    expect(nextConversationFields(parent)).toEqual({
      conversationId: `0x${"22".repeat(32)}`,
      inReplyTo: `0x${"33".repeat(32)}`,
    });
  });

  it("assembles both the local Sent side and incoming side chronologically", () => {
    const conversationId = `0x${"44".repeat(32)}`;
    const sent = {
      id: "sent:alice",
      documentId: `0x${"55".repeat(32)}`,
      direction: "outgoing" as const,
      envelope: {
        type: "text",
        payload: {
          body: "Alice opens",
          conversationId,
          documentId: `0x${"55".repeat(32)}`,
        },
      },
    };
    const reply = {
      id: "incoming:bob",
      documentId: `0x${"66".repeat(32)}`,
      direction: "incoming" as const,
      envelope: {
        type: "text",
        payload: {
          body: "Bob replies",
          conversationId,
          documentId: `0x${"66".repeat(32)}`,
          inReplyTo: `0x${"55".repeat(32)}`,
        },
      },
    };
    const unrelated = {
      id: "incoming:other",
      envelope: { type: "text", payload: { body: "Unrelated" } },
    };

    // Mailbox state is newest-first. Selecting the Inbox reply must not drop
    // the matching device-local Sent copy merely because it lives in Sent.
    expect(
      assembleConversation([reply, unrelated, sent], reply.id).map(
        (message) => message.id,
      ),
    ).toEqual([sent.id, reply.id]);

    // Client and block clocks can disagree. The explicit reply link remains
    // authoritative even when the mailbox-time fallback arrives reversed.
    expect(
      assembleConversation([sent, reply], reply.id).map(
        (message) => message.id,
      ),
    ).toEqual([sent.id, reply.id]);
  });

  it("collapses a device-local Sent copy with its decrypted self-mail event", () => {
    const conversationId = `0x${"77".repeat(32)}`;
    const documentId = `0x${"88".repeat(32)}`;
    const payload = {
      body: "One self-addressed letter",
      conversationId,
      documentId,
    };
    const sent = {
      id: `sent:${documentId}`,
      documentId,
      index: "local",
      direction: "outgoing" as const,
      recipients: ["0xabc"],
      record: { source: "sent ciphertext" },
      transactionHash: "0xtx",
      envelope: { type: "text", payload },
    };
    const opened = {
      id: "0xtx:3",
      index: "7",
      record: { source: "decrypted event ciphertext" },
      transactionHash: "0xtx",
      blockNumber: 42,
      envelope: { type: "text", payload },
    };

    const assembled = assembleConversation([opened, sent], opened.id);

    expect(assembled).toHaveLength(1);
    expect(assembled[0]).toMatchObject({
      id: sent.id,
      direction: "outgoing",
      index: opened.index,
      record: opened.record,
      blockNumber: 42,
      recipients: sent.recipients,
      threadProvenance: "device_sent_and_on_chain",
    });
  });

  it("keeps genuinely distinct messages whose bodies are identical", () => {
    const conversationId = `0x${"99".repeat(32)}`;
    const firstDocumentId = `0x${"aa".repeat(32)}`;
    const secondDocumentId = `0x${"bb".repeat(32)}`;
    const message = (id: string, documentId: string) => ({
      id,
      documentId,
      envelope: {
        type: "text",
        payload: {
          body: "Identical legitimate body",
          conversationId,
          documentId,
        },
      },
    });
    const first = message("incoming:first", firstDocumentId);
    const second = message("incoming:second", secondDocumentId);

    expect(
      assembleConversation([second, first], second.id).map((item) => item.id),
    ).toEqual([first.id, second.id]);
  });

  it("returns no thread when the selected mailbox record is unavailable", () => {
    expect(assembleConversation([], "missing")).toEqual([]);
    expect(assembleConversation([], null)).toEqual([]);
  });

  it("starts a new conversation when the parent has no tag", () => {
    const fields = nextConversationFields({
      id: "incoming:2",
      envelope: { type: "text", payload: { body: "untagged" } },
    });
    expect(parseConversationId(fields.conversationId)).toBe(
      fields.conversationId,
    );
    expect(fields.inReplyTo).toBe("");
    expect(conversationFieldsFromPayload("text", { body: "untagged" })).toEqual(
      {},
    );
  });
});
