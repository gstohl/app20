import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { LOCALNET_PROVIDER_INDEX } from "@/utils/constants";
import {
  canonicalRfqAccount,
  canonicalRfqChainId,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

export type LocalnetRecoveryContext = Readonly<{
  account: string;
  chainId: string;
  providerIndex: number;
}>;

export function recoveryContextMatches(
  record: Pick<RfqLifecycleRecord, "account" | "chainId">,
  context: LocalnetRecoveryContext,
): boolean {
  try {
    return (
      context.providerIndex === LOCALNET_PROVIDER_INDEX &&
      canonicalRfqAccount(context.account) === record.account &&
      canonicalRfqChainId(context.chainId) === record.chainId
    );
  } catch {
    return false;
  }
}

export function snapshotLocalnetRecoveryContext(
  record: Pick<RfqLifecycleRecord, "account" | "chainId">,
): LocalnetRecoveryContext {
  const wallet = useStoreWallet.getState();
  const providerIndex =
    useFrontendProvider.getState().currentFrontendProviderIndex;
  if (!wallet.isConnected || !wallet.address || !wallet.chain) {
    throw new Error("Reconnect the wallet and chain bound to this resume record.");
  }
  const snapshot = Object.freeze({
    account: canonicalRfqAccount(wallet.address),
    chainId: canonicalRfqChainId(wallet.chain),
    providerIndex,
  });
  if (!recoveryContextMatches(record, snapshot)) {
    throw new Error(
      "The current account, wallet chain, or provider does not match this local resume record.",
    );
  }
  return snapshot;
}

export function assertLocalnetRecoveryContextUnchanged(
  started: LocalnetRecoveryContext,
  record: Pick<RfqLifecycleRecord, "account" | "chainId">,
): void {
  const current = snapshotLocalnetRecoveryContext(record);
  if (
    current.account !== started.account ||
    current.chainId !== started.chainId ||
    current.providerIndex !== started.providerIndex
  ) {
    throw new Error(
      "The account, wallet chain, or provider changed before local recovery submission.",
    );
  }
}
