import type { ProviderInterface } from "starknet";
import { describe, expect, it, vi } from "vitest";
import {
  InsufficientPublicStrkBalanceError,
  MainnetPreflightDeclinedError,
  PoolFeeUnavailableError,
  assertPublicBalanceCovers,
  authorizeStrk20ValueAction,
  formatMainnetPreflight,
  readLivePoolFee,
  readPublicStrkBalance,
  type ValueActionPreflight,
} from "./mainnet-safety";

const STRK = 10n ** 18n;
const poolAddress = "0x123";
const accountAddress = "0x456";

function providerWith(fee: bigint, balance: bigint): ProviderInterface {
  return {
    callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
      if (entrypoint === "get_fee_amount") return [fee.toString()];
      if (entrypoint === "balance_of") {
        const low = balance & (2n ** 128n - 1n);
        const high = balance >> 128n;
        return [low.toString(), high.toString()];
      }
      throw new Error(`Unexpected ${entrypoint}`);
    }),
  } as unknown as ProviderInterface;
}

describe("mainnet value safety", () => {
  it("reads the live pool fee and full uint256 public STRK balance", async () => {
    const balance = (3n << 128n) + 17n;
    const provider = providerWith(4n * STRK, balance);

    await expect(readLivePoolFee(provider, poolAddress)).resolves.toBe(
      4n * STRK,
    );
    await expect(readPublicStrkBalance(provider, accountAddress)).resolves.toBe(
      balance,
    );
    expect(provider.callContract).toHaveBeenNthCalledWith(1, {
      contractAddress: poolAddress,
      entrypoint: "get_fee_amount",
      calldata: [],
    });
  });

  it("requires an explicit mainnet confirmation with exact live values", async () => {
    const present = vi.fn<(preflight: ValueActionPreflight) => boolean>(
      () => true,
    );
    const result = await authorizeStrk20ValueAction({
      provider: providerWith(4n * STRK, 10n * STRK),
      poolAddress,
      accountAddress,
      network: "MAINNET",
      action: "Shield",
      amount: STRK / 10n,
      presentMainnet: present,
    });

    expect(result.requiredPublicBalance).toBe(4_100_000_000_000_000_000n);
    expect(result.sufficientBalance).toBe(true);
    expect(present).toHaveBeenCalledOnce();
    const message = formatMainnetPreflight(present.mock.calls[0][0]);
    expect(message).toContain("Starknet Mainnet (SN_MAIN)");
    expect(message).toContain("Exact amount: 0.1 STRK");
    expect(message).toContain("Amount in base units: 100000000000000000");
    expect(message).toContain("pool.get_fee_amount");
    expect(message).toContain("4 STRK (4000000000000000000 base units)");
    expect(message).toContain("shield and unshield legs are PUBLIC on-chain");
    expect(message).toContain("moves real funds");
  });

  it("blocks mainnet when the user declines the explicit gate", async () => {
    await expect(
      authorizeStrk20ValueAction({
        provider: providerWith(1n, 100n),
        poolAddress,
        accountAddress,
        network: "MAINNET",
        action: "Private transfer",
        amount: 1n,
        presentMainnet: () => false,
      }),
    ).rejects.toBeInstanceOf(MainnetPreflightDeclinedError);
  });

  it("shows fee-read failure on mainnet and blocks rather than guessing", async () => {
    const present = vi.fn<(preflight: ValueActionPreflight) => boolean>(
      () => false,
    );
    const provider = {
      callContract: vi.fn(async () => {
        throw new Error("RPC unavailable");
      }),
    } as unknown as ProviderInterface;

    await expect(
      authorizeStrk20ValueAction({
        provider,
        poolAddress,
        accountAddress,
        network: "MAINNET",
        action: "Unshield",
        amount: STRK / 10n,
        presentMainnet: present,
      }),
    ).rejects.toBeInstanceOf(PoolFeeUnavailableError);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        poolFeeError: "RPC unavailable",
        sufficientBalance: false,
      }),
    );
    expect(present.mock.calls[0][0].poolFee).toBeUndefined();
    expect(formatMainnetPreflight(present.mock.calls[0][0])).toContain(
      "UNAVAILABLE — live get_fee_amount read failed",
    );
  });

  it("refuses when public STRK does not cover amount plus live pool fee", async () => {
    const present = vi.fn<(preflight: ValueActionPreflight) => boolean>(
      () => false,
    );
    await expect(
      authorizeStrk20ValueAction({
        provider: providerWith(4n * STRK, 4n * STRK),
        poolAddress,
        accountAddress,
        network: "MAINNET",
        action: "Shield",
        amount: STRK / 10n,
        presentMainnet: present,
      }),
    ).rejects.toBeInstanceOf(InsufficientPublicStrkBalanceError);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredPublicBalance: 4_100_000_000_000_000_000n,
        sufficientBalance: false,
      }),
    );
    expect(() =>
      assertPublicBalanceCovers(4n * STRK, STRK / 10n, 4n * STRK),
    ).toThrow(/amount \+ live pool fee/i);
  });

  it("keeps Sepolia confirmation-free while retaining the live guard", async () => {
    const present = vi.fn<(preflight: ValueActionPreflight) => boolean>(
      () => true,
    );
    await expect(
      authorizeStrk20ValueAction({
        provider: providerWith(2n, 10n),
        poolAddress,
        accountAddress,
        network: "SEPOLIA",
        action: "Shield",
        amount: 3n,
        presentMainnet: present,
      }),
    ).resolves.toEqual(expect.objectContaining({ sufficientBalance: true }));
    expect(present).not.toHaveBeenCalled();
  });
});
