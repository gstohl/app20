import { describe, expect, it, vi } from "vitest";
import { Strk20Privy } from "../src/client.js";
import type { StarknetWalletInfo } from "../src/types.js";

const wallet: StarknetWalletInfo = {
  walletId: "wallet-1",
  publicKey: "0x123",
  privyAddress: "0x456",
  address: "0x456",
  chainType: "starknet",
  raw: {} as never,
};

describe("Strk20Privy.deployAccount", () => {
  it("uses an explicit zero tip on sparse testnets and waits for acceptance", async () => {
    const client = new Strk20Privy({
      network: "sepolia",
      rpcUrl: "https://rpc.invalid",
      privyAppId: "app-id",
      privyAppSecret: "app-secret",
    });
    const deployAccount = vi.fn(async () => ({
      transaction_hash: "0xdeployed",
      contract_address: wallet.address,
    }));
    vi.spyOn(client, "accountFor").mockReturnValue({ deployAccount } as never);
    vi.spyOn(client, "isDeployed").mockResolvedValue(false);
    const waitForTransaction = vi
      .spyOn(client.provider, "waitForTransaction")
      .mockResolvedValue(undefined as never);

    await client.deployAccount(wallet);

    expect(deployAccount).toHaveBeenCalledWith(
      expect.objectContaining({ contractAddress: wallet.address }),
      { tip: 0n, skipValidate: false },
    );
    expect(waitForTransaction).toHaveBeenCalledWith("0xdeployed");
  });
});
