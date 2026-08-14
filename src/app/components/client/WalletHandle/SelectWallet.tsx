"use client";

import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { validateAndParseAddress, walletV6, WalletAccountV6 } from "starknet";
import { useEffect, useState } from "react";
import { detectStrk20Capability } from "@/lib/strk20";
import {
  isStrk20Chain,
  myFrontendProviders,
  providerIndexForChain,
} from "@/utils/constants";
import styles from "../../../uni.module.css";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function SelectWallet({
  variant = "ctaBig",
}: {
  variant?: "nav" | "ctaBig";
}) {
  const setMyWallet = useStoreWallet(
    (state) => state.setMyStarknetWalletObject
  );
  const setMyWalletAccount = useStoreWallet(
    (state) => state.setMyWalletAccount
  );
  const isConnected = useStoreWallet((state) => state.isConnected);
  const setConnected = useStoreWallet((state) => state.setConnected);
  const disconnect = useStoreWallet((state) => state.disconnect);
  const address = useStoreWallet((state) => state.address);
  const setWalletApi = useStoreWallet((state) => state.setWalletApiList);
  const setStrk20Capable = useStoreWallet(
    (state) => state.setStrk20Capable
  );
  const setChain = useStoreWallet((state) => state.setChain);
  const setAddressAccount = useStoreWallet(
    (state) => state.setAddressAccount
  );
  const setCurrentFrontendProviderIndex = useFrontendProvider(
    (state) => state.setCurrentFrontendProviderIndex
  );

  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);

  // Create one v6 discovery store and disable EIP-1193 adapters so MetaMask is
  // not probed. The selected wallet is the only one that receives a request.
  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    setWallets(store.getWallets().slice());
    const unsubscribe = store.subscribe((next) => setWallets(next.slice()));
    return unsubscribe;
  }, []);

  const pickable = wallets.filter(
    (wallet) => !normalizeId(wallet.name).includes("metamask")
  );

  async function handleSelectedWallet(
    selectedWallet: WalletWithStarknetFeatures
  ) {
    // Determine the wallet's write chain before constructing WalletAccountV6.
    // Reads must use the matching provider: mainnet index 0, Sepolia index 2.
    const chainId = String(await walletV6.requestChainId(selectedWallet));
    if (!isStrk20Chain(chainId)) {
      throw new Error("Switch Ready to Sepolia or Mainnet before connecting.");
    }
    const providerIndex = providerIndexForChain(chainId);
    const provider = myFrontendProviders[providerIndex];

    const walletAccount = await WalletAccountV6.connect(
      provider,
      selectedWallet
    );
    const accounts = await walletV6.requestAccounts(selectedWallet);
    const permissions = await walletV6.getPermissions(selectedWallet);
    const connected = permissions.includes("accounts") && accounts.length > 0;

    if (!connected) {
      throw new Error("The wallet did not authorize an account.");
    }

    const capability = await detectStrk20Capability(selectedWallet);
    const address = validateAndParseAddress(accounts[0]);

    setMyWallet(selectedWallet);
    setMyWalletAccount(walletAccount);
    setAddressAccount(address);
    setChain(chainId);
    setCurrentFrontendProviderIndex(providerIndex);
    setWalletApi(capability.walletApiVersions);
    setStrk20Capable(capability.supported);
    setConnected(true);
  }

  function openPicker() {
    setError("");
    setPickerOpen(true);
  }

  async function selectWallet(wallet: WalletWithStarknetFeatures) {
    setError("");
    setConnectingWallet(wallet.name);
    try {
      await handleSelectedWallet(wallet);
      setPickerOpen(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Wallet connection failed.";
      setError(message);
    } finally {
      setConnectingWallet(null);
    }
  }

  const shortAddr = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "";

  const picker = pickerOpen ? (
    <div
      className={styles.modalOverlay}
      onClick={() => !connectingWallet && setPickerOpen(false)}
    >
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>Connect a wallet</span>
          <button
            className={styles.modalClose}
            onClick={() => setPickerOpen(false)}
            aria-label="Close"
            disabled={Boolean(connectingWallet)}
          >
            ×
          </button>
        </div>

        {pickable.length ? (
          <div className={styles.walletList}>
            {pickable.map((wallet) => (
              <button
                key={wallet.name}
                className={styles.walletRow}
                onClick={() => selectWallet(wallet)}
                disabled={Boolean(connectingWallet)}
              >
                <img className={styles.walletIcon} src={wallet.icon} alt="" />
                <span className={styles.walletName}>{wallet.name}</span>
                <span className={styles.walletGo}>
                  {connectingWallet === wallet.name ? "…" : "→"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.walletHint}>
            No Starknet wallet detected. Install{" "}
            <a
              href="https://www.ready.co/"
              target="_blank"
              rel="noreferrer"
            >
              Ready
            </a>{" "}
            to use Quietline privacy actions.
          </div>
        )}

        {error ? <div className={styles.errorText}>{error}</div> : null}
      </div>
    </div>
  ) : null;

  if (variant === "nav") {
    if (isConnected && address) {
      return (
        <button
          className={styles.addrPill}
          onClick={disconnect}
          title="Disconnect"
        >
          <span className={styles.addrDot} />
          {shortAddr}
          <span className={styles.addrDisconnect}>Disconnect</span>
        </button>
      );
    }

    return (
      <>
        <button className={styles.connectPill} onClick={openPicker}>
          Connect Ready
        </button>
        {picker}
      </>
    );
  }

  return (
    <>
      <button className={styles.btnCta} onClick={openPicker}>
        Connect Ready
      </button>
      {picker}
    </>
  );
}
