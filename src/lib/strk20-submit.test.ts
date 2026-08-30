import { describe, expect, it, vi } from "vitest";
import type { WALLET_API } from "@starknet-io/types-js";
import {
  InsufficientPrivateStrkBalanceError,
  Strk20DeterministicSubmissionRejectedError,
  Strk20NotSubmittedError,
  Strk20WalletSubmissionUnknownError,
  assertPrivateStrk20BatchBalance,
  strk20ErrorMessage,
  submitActions,
  transactionStateFromError,
} from "./strk20";

const actions: WALLET_API.STRK20_ACTION[] = [];

describe("submitActions wallet boundary", () => {
  it("reports an attested local note-selection rejection as deterministically not submitted", async () => {
    const reason =
      "Insufficient balance for token 0x4718f5a: need 123456789012345685 more (total available: 0)";
    const rejection = Object.assign(new Error(reason), {
      app20SubmissionOutcome: "not-submitted",
      code: "APP20_LOCALNET_PRE_SUBMISSION_INSUFFICIENT_BALANCE",
      httpStatus: 400,
    });
    const account = {
      strk20InvokeTransaction: vi.fn().mockRejectedValue(rejection),
    };

    let caught: unknown;
    try {
      await submitActions(account as never, {} as never, actions, {
        policy: () => undefined,
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Strk20DeterministicSubmissionRejectedError);
    expect(transactionStateFromError(caught)).toBe("reverted");
    expect(strk20ErrorMessage(caught)).toContain(reason);
    expect(strk20ErrorMessage(caught)).toMatch(
      /No transaction was submitted.*Shield funds first.*retry explicitly/i,
    );
  });

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
    ).rejects.toMatchObject({
      name: Strk20WalletSubmissionUnknownError.name,
      message:
        "The wallet submission call was entered, but no transaction hash was returned. Its outcome is unknown; reconcile before retrying.",
    });
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

  it("does not trust matching insufficient-balance text without the local attestation", async () => {
    const account = {
      strk20InvokeTransaction: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Insufficient balance for token 0x4718f5a: need 1 more (total available: 0)",
          ),
        ),
    };
    await expect(
      submitActions(account as never, {} as never, actions, {
        policy: () => undefined,
      }),
    ).rejects.toBeInstanceOf(Strk20WalletSubmissionUnknownError);
  });

  it("refuses a payment and helper-withdrawal batch above private balance", async () => {
    const invoke = vi.fn();
    const account = {
      strk20Balances: vi
        .fn()
        .mockResolvedValue([{ token: "0x4718f5a", balance: "0x0" }]),
      strk20InvokeTransaction: invoke,
    };

    await expect(
      assertPrivateStrk20BatchBalance(account as never, "0x4718f5a", [
        "123456789012345678",
        7n,
      ]),
    ).rejects.toMatchObject({
      name: InsufficientPrivateStrkBalanceError.name,
      required: 123456789012345685n,
      message: expect.stringMatching(
        /Shield STRK first.*Nothing was submitted/i,
      ),
    });
    expect(account.strk20Balances).toHaveBeenCalledWith(["0x4718f5a"]);
    expect(invoke).not.toHaveBeenCalled();
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
