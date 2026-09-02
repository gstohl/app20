import { describe, expect, it, vi } from "vitest";
import {
  Strk20NotSubmittedError,
  Strk20WalletSubmissionUnknownError,
  submitActions,
} from "@/lib/strk20";
import { runLocalnetTakeOrchestration } from "./localnet-take-orchestration";

const target = Object.freeze({ dealId: "0x77" });

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    account: { strk20InvokeTransaction: vi.fn() },
    provider: {},
    actions: [],
    target,
    attemptId: "take-exact",
    policy: () => undefined,
    ...overrides,
  } as never;
}

function seam(overrides: Record<string, unknown> = {}) {
  return {
    prepareBeforeLease: async () => prepared(),
    persistPreparedAttempt: vi.fn().mockResolvedValue(undefined),
    prepareLease: vi.fn().mockResolvedValue(undefined),
    authorizeWalletSubmission: vi.fn().mockResolvedValue(undefined),
    markUnknown: vi.fn().mockResolvedValue(undefined),
    abandonLease: vi.fn().mockResolvedValue(undefined),
    submit: vi
      .fn()
      .mockResolvedValue({ transactionHash: "0xabc", receipt: {} }),
    ...overrides,
  } as never;
}

describe("localnet Take orchestration", () => {
  it("persists and authorizes around the exact wallet-boundary unknown fence", async () => {
    const order: string[] = [];
    const orchestration = seam({
      persistPreparedAttempt: vi.fn(async () => order.push("persist")),
      prepareLease: vi.fn(async () => order.push("prepare")),
      authorizeWalletSubmission: vi.fn(async () => order.push("authorize")),
      markUnknown: vi.fn(async () => order.push("unknown")),
      submit: vi.fn(async (_account, _provider, _actions, options) => {
        order.push("submit-start");
        await options.beforeWalletSubmission();
        order.push("wallet");
        return { transactionHash: "0xabc", receipt: {} };
      }),
    });
    await runLocalnetTakeOrchestration(orchestration);
    expect(order).toEqual([
      "persist",
      "prepare",
      "authorize",
      "submit-start",
      "unknown",
      "authorize",
      "wallet",
    ]);
  });

  it("replays the same Take prepare after a lost response", async () => {
    const prepareLease = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce(undefined);
    await runLocalnetTakeOrchestration(seam({ prepareLease }));
    expect(prepareLease.mock.calls).toEqual([
      [target, "take-exact"],
      [target, "take-exact"],
    ]);
  });

  it("abandons a known pre-wallet policy failure but never abandons after entry", async () => {
    const abandonLease = vi.fn().mockResolvedValue(undefined);
    await expect(
      runLocalnetTakeOrchestration(
        seam({
          abandonLease,
          prepareBeforeLease: async () =>
            prepared({
              policy: () => {
                throw new Error("stale lock");
              },
            }),
          submit: async (
            _account: unknown,
            _provider: unknown,
            _actions: unknown,
            options: { policy: () => void },
          ) => {
            try {
              options.policy();
            } catch (error) {
              throw new Strk20NotSubmittedError(error);
            }
            throw new Error("unreachable");
          },
        }),
      ),
    ).rejects.toMatchObject({
      name: "LocalnetTakeKnownNotSubmittedError",
      disposition: "lease-abandoned",
    });
    expect(abandonLease).toHaveBeenCalledWith(target, "take-exact");

    const account = {
      strk20InvokeTransaction: vi
        .fn()
        .mockRejectedValue(new Error("wallet rejected")),
    };
    const afterBoundary = seam({
      prepareBeforeLease: async () => prepared({ account }),
      abandonLease,
      submit: submitActions,
    });
    await expect(
      runLocalnetTakeOrchestration(afterBoundary),
    ).rejects.toBeInstanceOf(Strk20WalletSubmissionUnknownError);
    expect(account.strk20InvokeTransaction).toHaveBeenCalledOnce();
    expect(abandonLease).toHaveBeenCalledTimes(1);
  });
});
