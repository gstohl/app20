import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { WalletAccountV6 } from "starknet";
import type { PrivacyOperation } from "@app20/privacy-adapters";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { feltEquals } from "@/lib/addresses";
import { useWalletMode } from "@/app/rfq/walletMode";
import { assertWalletSubmissionPolicy } from "@/lib/wallet-policy";

export type ReadyExecutionSnapshot = {
  address: string;
  chainId: string;
  providerIndex: 0 | 2 | 3;
  wallet: WalletWithStarknetFeatures;
  account: WalletAccountV6;
};

export function readyExecutionDrift(
  started: Pick<ReadyExecutionSnapshot, "address" | "chainId" | "providerIndex">,
  current: Pick<ReadyExecutionSnapshot, "address" | "chainId" | "providerIndex">,
): string | null {
  if (!feltEquals(current.address, started.address)) {
    return "The connected account changed. The action was cancelled.";
  }
  if (!feltEquals(current.chainId, started.chainId)) {
    return "The wallet chain changed. The action was cancelled.";
  }
  if (current.providerIndex !== started.providerIndex) {
    return "The network changed because the selected provider changed. The action was cancelled.";
  }
  return null;
}

export function assertReadyRailSelected(mode = useWalletMode.getState().mode): void {
  if (mode !== "ready") {
    throw new Error("Switch explicitly to the Ready rail before using its signer.");
  }
}

export function snapshotReadyExecution(): ReadyExecutionSnapshot {
  assertReadyRailSelected();
  const wallet = useStoreWallet.getState();
  const providerIndex =
    useFrontendProvider.getState().currentFrontendProviderIndex;
  if (
    !wallet.isConnected ||
    !wallet.address ||
    !wallet.chain ||
    !wallet.myWalletAccount ||
    !wallet.StarknetWalletObject
  ) {
    throw new Error("Connect a Ready wallet first.");
  }
  if (providerIndex !== 0 && providerIndex !== 2 && providerIndex !== 3) {
    throw new Error("Unsupported network.");
  }
  if (!feltEquals(wallet.myWalletAccount.address, wallet.address)) {
    throw new Error(
      "The Ready signer no longer matches the connected account. Disconnect and connect again.",
    );
  }
  return {
    address: wallet.address,
    chainId: wallet.chain,
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
  if (
    current.wallet !== started.wallet ||
    current.account !== started.account
  ) {
    throw new Error("The wallet session changed. The action was cancelled.");
  }
  assertWalletSubmissionPolicy(
    current.wallet,
    current.providerIndex,
    operation,
  );
  return current;
}
