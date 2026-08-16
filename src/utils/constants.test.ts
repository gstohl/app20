import { constants } from "starknet";
import { describe, expect, it } from "vitest";
import {
  LOCALNET_CHAIN_ID,
  isStrk20Chain,
  localnetWalletEnabled,
  providerIndexForChain,
  strk20PoolForProviderIndex,
  strk20PoolMainnet,
  strk20PoolSepolia,
} from "./constants";

describe("STRK20 network gating", () => {
  it("keeps mainnet and Sepolia enabled in an ordinary build", () => {
    expect(isStrk20Chain(constants.StarknetChainId.SN_MAIN)).toBe(true);
    expect(isStrk20Chain(constants.StarknetChainId.SN_SEPOLIA)).toBe(true);
    expect(providerIndexForChain(constants.StarknetChainId.SN_MAIN)).toBe(0);
    expect(providerIndexForChain(constants.StarknetChainId.SN_SEPOLIA)).toBe(2);
    expect(strk20PoolForProviderIndex(0)).toBe(strk20PoolMainnet);
    expect(strk20PoolForProviderIndex(2)).toBe(strk20PoolSepolia);
  });

  it("rejects the localnet-only chain when the dev wallet flag is off", () => {
    expect(localnetWalletEnabled).toBe(false);
    expect(isStrk20Chain(LOCALNET_CHAIN_ID)).toBe(false);
  });
});
