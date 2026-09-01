import { describe, expect, it, vi } from "vitest";
import { ensureAllowance, readAllowance, readBalance } from "../src/tokens.js";

function providerReturning(result: unknown) {
  return {
    callContract: vi.fn(async () => result),
    waitForTransaction: vi.fn(async () => undefined),
  };
}

describe("token provider calls", () => {
  it("reads Cairo 1 balance_of as a u256 felt pair", async () => {
    const provider = providerReturning(["0x2", "0x1"]);
    await expect(readBalance(provider as never, "0x1", "0xabc")).resolves.toBe(
      2n + (1n << 128n),
    );
    expect(provider.callContract).toHaveBeenCalledWith({
      contractAddress: "0x1",
      entrypoint: "balance_of",
      calldata: ["0xabc"],
    });
  });

  it("falls back to balanceOf when balance_of is missing", async () => {
    const provider = {
      callContract: vi.fn(async (call: { entrypoint: string }) => {
        if (call.entrypoint === "balance_of") throw new Error("not found");
        return ["0xa", "0x0"];
      }),
    };
    await expect(readBalance(provider as never, "0x1", "0xabc")).resolves.toBe(
      10n,
    );
    expect(provider.callContract).toHaveBeenCalledTimes(2);
  });

  it("reads allowance without constructing an ERC-20 Contract wrapper", async () => {
    const provider = providerReturning(["0x5", "0x0"]);
    await expect(
      readAllowance(provider as never, "0x1", "0xabc", "0xpool"),
    ).resolves.toBe(5n);
    expect(provider.callContract).toHaveBeenCalledWith({
      contractAddress: "0x1",
      entrypoint: "allowance",
      calldata: ["0xabc", "0xpool"],
    });
  });

  it("skips approve when the current allowance already covers the amount", async () => {
    const provider = providerReturning(["0x10", "0x0"]);
    const account = {
      address: "0xabc",
      provider,
      execute: vi.fn(),
    };
    await expect(
      ensureAllowance(account as never, "0x1", "0xpool", 5n),
    ).resolves.toBeUndefined();
    expect(account.execute).not.toHaveBeenCalled();
  });

  it("approves through the account when allowance is insufficient", async () => {
    const provider = providerReturning(["0x1", "0x0"]);
    const account = {
      address: "0xabc",
      provider,
      execute: vi.fn(async () => ({ transaction_hash: "0xtx" })),
    };
    await expect(
      ensureAllowance(account as never, "0x1", "0xpool", 5n),
    ).resolves.toBe("0xtx");
    expect(account.execute).toHaveBeenCalledOnce();
    expect(provider.waitForTransaction).toHaveBeenCalledWith("0xtx");
  });
});
