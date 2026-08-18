import { describe, expect, it } from "vitest";
import {
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
