import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Strk20RevertedError, Strk20WalletSubmissionUnknownError, Strk20WaitTimeoutError } from "@/lib/strk20";
import ChatComposer from "./ChatComposer";
import { chatSendFailure, checkChatDelivery, previewChatLetterBudget, type PendingChatLetter } from "./chat-send";

const pending: PendingChatLetter = {
  documentId: "0x123", draftId: "0x123", type: "text", payload: { body: "Hello" },
  plaintext: "Hello", record: { ephemeralPub: ["0x1", "0x2"], viewTag: 3, nonce: ["0x4", "0x5"], ciphertextFelts: ["0x6"] },
  transactionHash: "0xabc", transactionHashes: ["0xabc"], recipients: ["0xb0b"], recipientCount: 1,
};

function composer(error: ReturnType<typeof chatSendFailure>) {
  return renderToStaticMarkup(<ChatComposer contactName="Bob" value="Hello" onChange={() => undefined}
    blocker={null} sending={false} budget={previewChatLetterBudget("Hello", false)}
    onSend={() => undefined} onAttach={() => undefined} onCheckDelivery={error.pendingLetter ? () => undefined : undefined}
    status={{ kind: "error", message: error.message, detail: error.detail,
      transactionHash: error.submittedTransactionHash, retryBlocked: error.outcome === "unknown" }} />);
}

describe("Chat delivery recovery", () => {
  it("retains a declined draft with an explicit retry and accessible error", () => {
    const failure = chatSendFailure(new Error("User rejected request"));
    expect(failure.outcome).toBe("retryable");
    const html = composer(failure);
    expect(html).toContain("Wallet request declined");
    expect(html).toContain("Hello</textarea>");
    expect(html).toMatch(/type="submit"[^>]*>Retry send/);
    expect(html).toContain('role="alert"');
  });

  it("blocks a second send on timeout and offers checking the original transaction", () => {
    const failure = chatSendFailure(new Strk20WaitTimeoutError("0xabc", 10000), pending);
    const html = composer(failure);
    expect(failure.outcome).toBe("unknown");
    expect(html).toMatch(/type="submit"[^>]*disabled=""[^>]*>Confirmation pending/);
    expect(html).toContain("Check delivery");
    expect(html).toContain("0xabc");
    expect(html).not.toContain("stable action id");
  });

  it("does not mistake a lost wallet response without a hash for a safe retry", () => {
    const failure = chatSendFailure(new Strk20WalletSubmissionUnknownError(new Error("network lost")));
    expect(failure.outcome).toBe("unknown");
    expect(failure.message).toContain("Check your wallet activity");
    expect(composer(failure)).not.toContain(">Check delivery<");
  });

  it("allows retry only after a proven revert", () => {
    const failure = chatSendFailure(new Strk20RevertedError("0xabc"), pending);
    expect(failure.outcome).toBe("retryable");
    expect(failure.pendingLetter).toBeUndefined();
    expect(composer(failure)).toContain(">Retry send<");
  });

  it("recovers the original sent copy by reading confirmation without a wallet call", async () => {
    const waitForTransaction = vi.fn().mockResolvedValue({ execution_status: "SUCCEEDED" });
    const result = await checkChatDelivery({ waitForTransaction } as never, pending);
    expect(waitForTransaction).toHaveBeenCalledWith("0xabc", expect.any(Object));
    expect(result.envelope).toEqual({ ...pending, deliveryState: "confirmed" });
    expect(result.transactionHash).toBe("0xabc");
  });

  it("never files an unknown or reverted receipt as confirmed", async () => {
    for (const execution_status of ["REVERTED", "UNKNOWN"]) {
      await expect(checkChatDelivery({ waitForTransaction: vi.fn().mockResolvedValue({ execution_status }) } as never, pending)).rejects.toThrow();
    }
  });
});
