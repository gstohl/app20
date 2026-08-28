import { describe, expect, it, vi } from "vitest";
import type { WALLET_API } from "@starknet-io/types-js";
import {
  Strk20NotSubmittedError,
  Strk20WalletSubmissionUnknownError,
  submitActions,
  transactionStateFromError,
} from "./strk20";

const actions: WALLET_API.STRK20_ACTION[] = [];

describe("submitActions wallet boundary", () => {
  it("classifies a wallet call response loss without a hash as unknown", async () => {
    let fenced = false;
    const account = {
      strk20InvokeTransaction: vi.fn().mockImplementation(async () => {
        expect(fenced).toBe(true);
        throw new Error("response lost");
      }),
    };
    await expect(
      submitActions(account as never, {} as never, actions, {
        policy: () => undefined,
        beforeWalletSubmission: () => {
          fenced = true;
        },
      }),
    ).rejects.toBeInstanceOf(Strk20WalletSubmissionUnknownError);
    try {
      await submitActions(account as never, {} as never, actions, {
        policy: () => undefined,
        beforeWalletSubmission: () => {
          fenced = true;
        },
      });
    } catch (error: unknown) {
      expect(transactionStateFromError(error)).toBe("unknown");
    }
  });

  it("keeps an explicit pre-wallet policy rejection typed as not submitted", async () => {
    const account = { strk20InvokeTransaction: vi.fn() };
    await expect(
      submitActions(account as never, {} as never, actions, {
        policy: () => {
          throw new Error("review changed");
        },
      }),
    ).rejects.toBeInstanceOf(Strk20NotSubmittedError);
    expect(account.strk20InvokeTransaction).not.toHaveBeenCalled();
  });
});
