import { afterEach, describe, expect, it } from "vitest";
import { clearChatSession, rememberChatSession, restoreChatSession } from "./chat-session";

afterEach(clearChatSession);
const keypair = { publicKey: new Uint8Array([1, 2]), privateKey: new Uint8Array([3, 4]) };
describe("unlocked Chat session", () => {
  it("reuses only the explicitly unlocked account without sharing mutable key bytes", () => {
    rememberChatSession({ scope: "mainnet:alice", keypair, seed: new Uint8Array([5, 6]) });
    const restored = restoreChatSession("mainnet:alice")!;
    restored.seed.fill(0); restored.keypair.privateKey.fill(0);
    expect(restoreChatSession("mainnet:alice")?.seed).toEqual(new Uint8Array([5, 6]));
    expect(keypair.privateKey).toEqual(new Uint8Array([3, 4]));
  });
  it("drops access on an account or network mismatch and on explicit locking", () => {
    rememberChatSession({ scope: "mainnet:alice", keypair, seed: new Uint8Array([5]) });
    expect(restoreChatSession("mainnet:bob")).toBeNull();
    expect(restoreChatSession("mainnet:alice")).toBeNull();
    rememberChatSession({ scope: "mainnet:alice", keypair, seed: new Uint8Array([5]) });
    clearChatSession();
    expect(restoreChatSession("mainnet:alice")).toBeNull();
  });
});
