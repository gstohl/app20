import { describe, expect, it, vi } from "vitest";
import {
  Strk20NotSubmittedError,
  Strk20WalletSubmissionUnknownError,
  submitActions,
} from "@/lib/strk20";
import {
  LocalnetFundingKnownNotSubmittedError,
  LocalnetFundingPrewalletRecoveryPendingError,
  runLocalnetFundingOrchestration,
} from "./localnet-funding-orchestration";

const target = Object.freeze({ dealId: "0x77" });

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    account: { strk20InvokeTransaction: vi.fn() },
    provider: {},
    actions: [],
    target,
    attemptId: "funding-exact",
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
    submit: vi.fn().mockResolvedValue({ transactionHash: "0xf11", receipt: {} }),
    ...overrides,
  } as never;
}

describe("production localnet funding orchestration", () => {
  it.each([
    "quote expiry",
    "account/provider drift",
    "nonce storage failure",
    "action construction failure",
  ])("does not acquire a server lease for %s", async (message) => {
    const prepareLease = vi.fn();
    const persistPreparedAttempt = vi.fn();
    const orchestration = seam({
      prepareBeforeLease: async () => {
        throw new Error(message);
      },
      prepareLease,
      persistPreparedAttempt,
    });
    await expect(runLocalnetFundingOrchestration(orchestration)).rejects.toThrow(
      message,
    );
    expect(prepareLease).not.toHaveBeenCalled();
    expect(persistPreparedAttempt).not.toHaveBeenCalled();
  });

  it.each(["quote expired", "account/provider drift", "operations policy stale"])(
    "abandons the exact pending lease when final policy fails: %s",
    async (message) => {
      const abandonLease = vi.fn().mockResolvedValue(undefined);
      const wallet = vi.fn();
      const orchestration = seam({
        prepareBeforeLease: async () =>
          prepared({
            policy: () => {
              throw new Error(message);
            },
          }),
        abandonLease,
        submit: async (_account: unknown, _provider: unknown, _actions: unknown, options: never) => {
          try {
            (options as { policy: () => void }).policy();
          } catch (error) {
            throw new Strk20NotSubmittedError(error);
          }
          wallet();
          throw new Error("unreachable");
        },
      });
      await expect(runLocalnetFundingOrchestration(orchestration)).rejects.toBeInstanceOf(
        Strk20NotSubmittedError,
      );
      expect(abandonLease).toHaveBeenCalledExactlyOnceWith(
        target,
        "funding-exact",
      );
      expect(wallet).not.toHaveBeenCalled();
    },
  );

  it("replays the exact prepare after response loss without creating another attempt", async () => {
    const prepareLease = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(undefined);
    const orchestration = seam({ prepareLease });
    await runLocalnetFundingOrchestration(orchestration);
    expect(prepareLease).toHaveBeenCalledTimes(2);
    expect(prepareLease.mock.calls).toEqual([
      [target, "funding-exact"],
      [target, "funding-exact"],
    ]);
  });

  it("returns known-not-submitted when exact prepare rejection proves no lease", async () => {
    const rejected = new Error("server rejected exact preparation");
    const orchestration = seam({
      prepareLease: vi.fn().mockRejectedValue(rejected),
      abandonLease: vi.fn().mockRejectedValue(rejected),
      leaseDefinitelyNotAcquired: (error: unknown) => error === rejected,
    });
    await expect(
      runLocalnetFundingOrchestration(orchestration),
    ).rejects.toMatchObject({
      name: "LocalnetFundingKnownNotSubmittedError",
      disposition: "no-attempt",
    });
  });

  it("attempts exact abandonment when both prepare responses are lost", async () => {
    const abandonLease = vi.fn().mockResolvedValue(undefined);
    const orchestration = seam({
      prepareLease: vi.fn().mockRejectedValue(new Error("prepare response lost")),
      abandonLease,
    });
    await expect(
      runLocalnetFundingOrchestration(orchestration),
    ).rejects.toBeInstanceOf(LocalnetFundingKnownNotSubmittedError);
    expect(abandonLease).toHaveBeenCalledExactlyOnceWith(
      target,
      "funding-exact",
    );
  });

  it("keeps preparing when both exact abandonment responses are lost", async () => {
    const orchestration = seam({
      prepareLease: vi.fn().mockRejectedValue(new Error("prepare response lost")),
      abandonLease: vi.fn().mockRejectedValue(new Error("abandon response lost")),
    });
    await expect(
      runLocalnetFundingOrchestration(orchestration),
    ).rejects.toBeInstanceOf(LocalnetFundingPrewalletRecoveryPendingError);
  });

  it("returns known-not-submitted after abandonment commits and its first response is lost", async () => {
    const abandonLease = vi
      .fn()
      .mockRejectedValueOnce(new Error("abandon response lost"))
      .mockResolvedValueOnce(undefined);
    const orchestration = seam({
      abandonLease,
      submit: async (_account: unknown, _provider: unknown, _actions: unknown, options: never) => {
        try {
          (options as { policy: () => void }).policy();
        } catch (error) {
          throw new Strk20NotSubmittedError(error);
        }
        throw new Strk20NotSubmittedError(new Error("policy stale"));
      },
      prepareBeforeLease: async () =>
        prepared({
          policy: () => {
            throw new Error("policy stale");
          },
        }),
    });
    await expect(
      runLocalnetFundingOrchestration(orchestration),
    ).rejects.toBeInstanceOf(LocalnetFundingKnownNotSubmittedError);
    expect(abandonLease).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["account", "account", "0xbob"],
    ["provider", "provider", 2],
    ["wallet identity", "identity", "bob"],
  ] as const)(
    "re-runs the full policy after a deferred unknown fence and blocks %s drift",
    async (_label, field, changed) => {
      const live: { account: string; provider: number; identity: string } = {
        account: "0xalice",
        provider: 3,
        identity: "alice",
      };
      let releaseFence!: () => void;
      const fence = new Promise<void>((resolve) => {
        releaseFence = resolve;
      });
      const markUnknown = vi.fn(async () => fence);
      const wallet = vi.fn().mockResolvedValue({ transaction_hash: "0x1" });
      const account = { strk20InvokeTransaction: wallet };
      const policy = vi.fn(() => {
        if (
          live.account !== "0xalice" ||
          live.provider !== 3 ||
          live.identity !== "alice"
        )
          throw new Error("execution identity changed");
      });
      const abandonLease = vi.fn();
      const pending = runLocalnetFundingOrchestration(
        seam({
          prepareBeforeLease: async () => prepared({ account, policy }),
          markUnknown,
          abandonLease,
          submit: submitActions,
        }),
      );
      await vi.waitFor(() => expect(markUnknown).toHaveBeenCalledOnce());
      (live[field] as string | number) = changed;
      releaseFence();

      await expect(pending).rejects.toBeInstanceOf(
        Strk20WalletSubmissionUnknownError,
      );
      expect(policy).toHaveBeenCalledTimes(2);
      expect(wallet).not.toHaveBeenCalled();
      expect(abandonLease).not.toHaveBeenCalled();
    },
  );

  it("keeps a generic wallet rejection funding-unknown after the boundary starts", async () => {
    const account = {
      strk20InvokeTransaction: vi.fn().mockRejectedValue(new Error("wallet rejected")),
    };
    const markUnknown = vi.fn().mockResolvedValue(undefined);
    const abandonLease = vi.fn().mockResolvedValue(undefined);
    const orchestration = seam({
      prepareBeforeLease: async () => prepared({ account }),
      markUnknown,
      abandonLease,
      submit: submitActions,
    });
    await expect(runLocalnetFundingOrchestration(orchestration)).rejects.toBeInstanceOf(
      Strk20WalletSubmissionUnknownError,
    );
    expect(markUnknown).toHaveBeenCalledExactlyOnceWith(
      target,
      "funding-exact",
    );
    expect(account.strk20InvokeTransaction).toHaveBeenCalledOnce();
    expect(abandonLease).not.toHaveBeenCalled();
  });
});
