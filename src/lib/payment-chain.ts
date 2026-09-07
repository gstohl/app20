import { constants } from "starknet";
import { LOCALNET_CHAIN_ID, localnetWalletEnabled } from "../utils/constants";
import { feltEquals } from "./addresses";

export function normalizePaymentLinkChainId(chainId: string): string {
  if (
    chainId === "SN_MAIN" ||
    feltEquals(chainId, constants.StarknetChainId.SN_MAIN)
  ) {
    return "SN_MAIN";
  }
  if (
    chainId === "SN_SEPOLIA" ||
    feltEquals(chainId, constants.StarknetChainId.SN_SEPOLIA)
  ) {
    return "SN_SEPOLIA";
  }
  if (localnetWalletEnabled && feltEquals(chainId, LOCALNET_CHAIN_ID)) {
    return LOCALNET_CHAIN_ID;
  }
  throw new Error("Payment links require Mainnet or Sepolia.");
}

export function paymentLinkChainIdsEqual(left: string, right: string): boolean {
  try {
    return (
      normalizePaymentLinkChainId(left) === normalizePaymentLinkChainId(right)
    );
  } catch {
    return false;
  }
}

