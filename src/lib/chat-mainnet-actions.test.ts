import { addrSTRK } from "./tokens";
import { describe, expect, it } from "vitest";
import { buildMessageOnlyChatActions, computeActionId, POOL_ADDRESS_PLACEHOLDER } from "./strk20";

const input = {
  helperAddress: "0x123", senderAddress: "0x789", tokenAddress: "0x456", actionId: computeActionId("composite-document", "0x789"),
  record: { ephemeralPub: ["0x11", "0x22"] as [string, string], viewTag: 3, nonce: ["0x44", "0x55"] as [string, string], ciphertextFelts: ["0x66"] },
};
describe("mainnet message-only candidate", () => {
  it("binds the message to the proof without withdrawing funds or opening a recovery note", () => {
    const actions = buildMessageOnlyChatActions(input);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({type:"transfer",token:addrSTRK,recipient:"0x789",amount:"0x1"});
    expect(actions[1]).toEqual({
      type: "compute_and_invoke", contract: "0x123",
      compute_calldata: [addrSTRK, "0x0", "0x11", "0x22", "0x3", "0x44", "0x55", "0x1", "0x66", input.actionId],
      invoke_calldata: [addrSTRK, POOL_ADDRESS_PLACEHOLDER, "0x0", "0x11", "0x22", "0x3", "0x44", "0x55", "0x1", "0x66", input.actionId],
    });
    expect(JSON.stringify(actions)).not.toContain("openNoteIds");
  });
  it("refuses an unprotected message", () => {
    expect(() => buildMessageOnlyChatActions({ ...input, actionId: "0x0" })).toThrow(/replay-protected/);
  });
});
