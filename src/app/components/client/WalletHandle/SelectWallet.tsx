"use client";

import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { validateAndParseAddress, walletV6, WalletAccountV6 } from "starknet";
import { useEffect, useRef, useState } from "react";
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
    (state) => state.setMyStarknetWalletObject,
  );
  const setMyWalletAccount = useStoreWallet(
    (state) => state.setMyWalletAccount,
  );
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const setConnected = useStoreWallet((state) => state.setConnected);
  const disconnect = useStoreWallet((state) => state.disconnect);
  const address = useStoreWallet((state) => state.address);
  const setWalletApi = useStoreWallet((state) => state.setWalletApiList);
  const setStrk20Capable = useStoreWallet((state) => state.setStrk20Capable);
  const setStrk20Capability = useStoreWallet(
    (state) => state.setStrk20Capability,
  );
  const setConnectionNotice = useStoreWallet(
    (state) => state.setConnectionNotice,
  );
  const setChain = useStoreWallet((state) => state.setChain);
  const setAddressAccount = useStoreWallet((state) => state.setAddressAccount);
  const setCurrentFrontendProviderIndex = useFrontendProvider(
    (state) => state.setCurrentFrontendProviderIndex,
  );

  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstWalletRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pickerWasOpen = useRef(false);

  // Create one v6 discovery store and disable EIP-1193 adapters so MetaMask is
  // not probed. The selected wallet is the only one that receives a request.
  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    setWallets(store.getWallets().slice());
    const unsubscribe = store.subscribe((next) => setWallets(next.slice()));
    return unsubscribe;
  }, []);

  // Keep the app store in sync with wallet-standard account changes. Extension
  // wallets can use this for normal account switching; the dev-only localnet
  // wallet uses it to move between Alice and Bob without bypassing WalletAccountV6.
  useEffect(() => {
    if (!selectedWallet || !isConnected) return;

    return walletV6.subscribeWalletEvent(selectedWallet, (change) => {
      if (!change.accounts) return;
      const [account] = change.accounts;
      if (!account) {
        disconnect();
        setConnectionNotice(
          "The wallet removed account access. Connect again to reopen this mailbox.",
        );
        return;
      }

      const standardChain = account.chains[0];
      const chainId = standardChain?.startsWith("starknet:")
        ? standardChain.slice("starknet:".length)
        : "";
      if (!chainId || !isStrk20Chain(chainId)) {
        disconnect();
        setConnectionNotice(
          "The wallet switched to an unsupported network. Switch it to Starknet Sepolia or Mainnet, then connect again.",
        );
        return;
      }

      try {
        const providerIndex = providerIndexForChain(chainId);
        setAddressAccount(validateAndParseAddress(account.address));
        setChain(chainId);
        setCurrentFrontendProviderIndex(providerIndex);
      } catch {
        disconnect();
        setConnectionNotice(
          "Quietline could not read the wallet's switched account. Reconnect on Starknet Sepolia or Mainnet.",
        );
      }
    });
  }, [
    disconnect,
    isConnected,
    selectedWallet,
    setAddressAccount,
    setChain,
    setConnectionNotice,
    setCurrentFrontendProviderIndex,
  ]);

  const pickable = wallets.filter(
    (wallet) => !normalizeId(wallet.name).includes("metamask"),
  );

  useEffect(() => {
    if (!pickerOpen) {
      if (pickerWasOpen.current) {
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
      pickerWasOpen.current = false;
      return;
    }

    pickerWasOpen.current = true;
    const frame = requestAnimationFrame(() => {
      (firstWalletRef.current ?? closeRef.current)?.focus();
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !connectingWallet) {
        event.preventDefault();
        setPickerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href]",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [connectingWallet, pickerOpen, pickable.length]);

  async function handleSelectedWallet(
    selectedWallet: WalletWithStarknetFeatures,
  ) {
    // Determine the wallet's write chain before constructing WalletAccountV6.
    // Reads must use the matching provider: mainnet index 0, Sepolia index 2.
    const chainId = String(await walletV6.requestChainId(selectedWallet));
    if (!isStrk20Chain(chainId)) {
      throw new Error(
        "Switch the selected wallet to Starknet Sepolia or Mainnet before connecting.",
      );
    }
    const providerIndex = providerIndexForChain(chainId);
    const provider = myFrontendProviders[providerIndex];

    const walletAccount = await WalletAccountV6.connect(
      provider,
      selectedWallet,
    );
    const accounts = await walletV6.requestAccounts(selectedWallet);
    const permissions = await walletV6.getPermissions(selectedWallet);
    const connected = permissions.includes("accounts") && accounts.length > 0;

    if (!connected) {
      throw new Error("The wallet did not authorize an account.");
    }

    const capability = await detectStrk20Capability(
      selectedWallet,
      walletAccount,
    );
    const address = validateAndParseAddress(accounts[0]);

    setMyWallet(selectedWallet);
    setMyWalletAccount(walletAccount);
    setAddressAccount(address);
    setChain(chainId);
    setCurrentFrontendProviderIndex(providerIndex);
    setWalletApi(capability.walletApiVersions);
    setStrk20Capability(capability);
    setStrk20Capable(capability.supported);
    setConnectionNotice("");
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
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHead}>
          <span id="wallet-picker-title" className={styles.modalTitle}>
            Connect a wallet
          </span>
          <button
            ref={closeRef}
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
            {pickable.map((wallet, index) => (
              <button
                ref={index === 0 ? firstWalletRef : undefined}
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
            No Starknet Wallet Standard extension was detected. Examples include{" "}
            <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
              Ready
            </a>{" "}
            and{" "}
            <a href="https://www.xverse.app/" target="_blank" rel="noreferrer">
              Xverse
            </a>
            . Privacy actions require the installed wallet to expose the
            dapp-facing STRK20 API.
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
          onClick={() => {
            disconnect();
            setConnectionNotice("");
          }}
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
        <button
          ref={triggerRef}
          className={styles.connectPill}
          onClick={openPicker}
        >
          Connect wallet
        </button>
        {picker}
      </>
    );
  }

  return (
    <>
      <button ref={triggerRef} className={styles.btnCta} onClick={openPicker}>
        Connect a wallet
      </button>
      {picker}
    </>
  );
}
