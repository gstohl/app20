import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { WalletAccountV6 } from "starknet";
import type { PrivacyOperation } from "@app20/privacy-adapters";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { feltEquals } from "@/lib/addresses";
import { assertWalletSubmissionPolicy } from "@/lib/wallet-policy";

export type ReadyExecutionSnapshot = {
  address: string;
  providerIndex: 0 | 2 | 3;
  wallet: WalletWithStarknetFeatures;
  account: WalletAccountV6;
};

export function readyExecutionDrift(
  started: Pick<ReadyExecutionSnapshot, "address" | "providerIndex">,
  current: Pick<ReadyExecutionSnapshot, "address" | "providerIndex">,
): string | null {
  if (!feltEquals(current.address, started.address)) {
    return "The connected account changed. The action was cancelled.";
  }
  if (current.providerIndex !== started.providerIndex) {
    return "The wallet network changed. The action was cancelled.";
  }
  return null;
}

export function snapshotReadyExecution(): ReadyExecutionSnapshot {
  const wallet = useStoreWallet.getState();
  const providerIndex =
    useFrontendProvider.getState().currentFrontendProviderIndex;
  if (
    !wallet.isConnected ||
    !wallet.address ||
    !wallet.myWalletAccount ||
    !wallet.StarknetWalletObject
  ) {
    throw new Error("Connect a Ready wallet first.");
  }
  if (
    providerIndex !== 0 &&
    providerIndex !== 2 &&
    providerIndex !== 3
  ) {
    throw new Error("Unsupported network.");
  }
  if (!feltEquals(wallet.myWalletAccount.address, wallet.address)) {
    throw new Error(
      "The Ready signer no longer matches the connected account. Disconnect and connect again.",
    );
  }
  return {
    address: wallet.address,
    providerIndex,
    wallet: wallet.StarknetWalletObject,
    account: wallet.myWalletAccount,
  };
}

export function assertReadyExecutionUnchanged(
  started: ReadyExecutionSnapshot,
  operation: PrivacyOperation,
): ReadyExecutionSnapshot {
  const current = snapshotReadyExecution();
  const drift = readyExecutionDrift(started, current);
  if (drift) throw new Error(drift);
  if (current.wallet !== started.wallet || current.account !== started.account) {
    throw new Error("The wallet session changed. The action was cancelled.");
  }
  assertWalletSubmissionPolicy(
    current.wallet,
    current.providerIndex,
    operation,
  );
  return current;
}
