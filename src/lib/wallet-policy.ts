import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import {
  adapterKindForWalletFeatureId,
  assertNetworkPolicy,
  assertSubmittableNetworkPolicy,
  isReadyWalletFeatureId,
  type PrivacyOperation,
} from "@app20/privacy-adapters";
import {
  LOCALNET_PROVIDER_INDEX,
  localnetWalletEnabled,
} from "@/utils/constants";

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSelectablePrivacyWallet(
  wallet: WalletWithStarknetFeatures,
): boolean {
  const id = wallet.features["starknet:walletApi"].id;
  return (
    isReadyWalletFeatureId(id) ||
    (localnetWalletEnabled && normalized(id).includes("localnet"))
  );
}

export function assertWalletOperationPolicy(
  wallet: WalletWithStarknetFeatures,
  providerIndex: 0 | 2 | 3,
  operation: PrivacyOperation,
): void {
  const network =
    providerIndex === LOCALNET_PROVIDER_INDEX
      ? "localnet"
      : providerIndex === 0
        ? "mainnet"
        : "sepolia";
  const adapter =
    network === "localnet"
      ? "localnet"
      : adapterKindForWalletFeatureId(
          wallet.features["starknet:walletApi"].id,
        );
  assertNetworkPolicy({
    network,
    adapter,
    operation,
    submissionMode: "live",
  });
}

export function assertWalletSubmissionPolicy(
  wallet: WalletWithStarknetFeatures,
  providerIndex: 0 | 2 | 3,
  operation: PrivacyOperation,
): void {
  const network =
    providerIndex === LOCALNET_PROVIDER_INDEX
      ? "localnet"
      : providerIndex === 0
        ? "mainnet"
        : "sepolia";
  const adapter =
    network === "localnet"
      ? "localnet"
      : adapterKindForWalletFeatureId(
          wallet.features["starknet:walletApi"].id,
        );
  assertSubmittableNetworkPolicy({
    network,
    adapter,
    operation,
    submissionMode: "live",
  });
}
