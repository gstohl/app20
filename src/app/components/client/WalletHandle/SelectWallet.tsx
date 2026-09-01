"use client";

import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { validateAndParseAddress, walletV6, WalletAccountV6 } from "starknet";
import { useEffect, useRef, useState } from "react";
import { detectStrk20Capability } from "@/lib/strk20";
import {
  assertWalletOperationPolicy,
  isSelectablePrivacyWallet,
} from "@/lib/wallet-policy";
import {
  chainIdFromStandardAccount,
  createWalletDiscoveryCoordinator,
  describeWalletConnectError,
} from "@/lib/wallet-connect";
import {
  isStrk20Chain,
  myFrontendProviders,
  providerIndexForChain,
} from "@/utils/constants";
import styles from "../../../uni.module.css";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

const walletDiscovery = createWalletDiscoveryCoordinator(async () => {
  const { createStore } = await import("@starknet-io/get-starknet-discovery");
  return createStore({ eip1193Adapters: [] });
});

const DISCOVERY_LOAD_ERROR =
  "Wallet discovery could not load. Close this dialog and try connecting again.";

export default function SelectWallet({
  variant = "ctaBig",
}: {
  variant?: "nav" | "ctaBig";
}) {
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);

  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [discoveryState, setDiscoveryState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstWalletRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pickerWasOpen = useRef(false);

  // Discovery includes the optional virtual-wallet/module-federation runtime.
  // Load it only after explicit connect intent so unrelated routes never fetch
  // or execute that dependency chain. EIP-1193 adapters remain disabled and
  // the selected wallet is still the only wallet that receives a request.
  // createStore registers window listeners with no cleanup, so the coordinator
  // reuses one store and this effect only subscribes while the picker is open.
  useEffect(() => {
    if (!pickerOpen) return;
    let received = false;
    const stop = walletDiscovery.subscribe({
      onWallets: (next) => {
        received = true;
        setWallets(next);
        setDiscoveryState("ready");
      },
      onError: () => {
        setDiscoveryState("error");
        setError(DISCOVERY_LOAD_ERROR);
      },
    });
    if (!received) setDiscoveryState("loading");
    return stop;
  }, [pickerOpen]);

  // Keep the app store in sync with wallet-standard account changes. Extension
  // wallets can use this for normal account switching; the dev-only localnet
  // wallet uses it to move between Alice and Bob without bypassing WalletAccountV6.
  useEffect(() => {
    if (!selectedWallet || !isConnected) return;

    return walletV6.subscribeWalletEvent(selectedWallet, (change) => {
      if (!change.accounts) return;
      const walletStore = useStoreWallet.getState();
      const [account] = change.accounts;
      if (!account) {
        walletStore.disconnect(
          "The wallet removed account access. Connect again to reopen this mailbox.",
        );
        return;
      }

      const chainId = chainIdFromStandardAccount(account) ?? "";
      if (!chainId || !isStrk20Chain(chainId)) {
        walletStore.disconnect(
          "The wallet switched to an unsupported network. Switch it to Starknet Sepolia or Mainnet, then connect again.",
        );
        return;
      }

      try {
        const providerIndex = providerIndexForChain(chainId);
        assertWalletOperationPolicy(selectedWallet, providerIndex, "connect");
        walletStore.applyAccountSwitch({
          address: validateAndParseAddress(account.address),
          chain: chainId,
        });
        useFrontendProvider
          .getState()
          .setCurrentFrontendProviderIndex(providerIndex);
      } catch (error) {
        walletStore.disconnect(
          error instanceof Error
            ? error.message
            : "APP20 could not read the switched account. Reconnect on an allowed network.",
        );
      }
    });
  }, [isConnected, selectedWallet]);

  const pickable = wallets.filter(isSelectablePrivacyWallet);

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
    if (!isSelectablePrivacyWallet(selectedWallet)) {
      throw new Error(
        "APP20 accepts Ready Wallet Standard on live networks. Use the separate Privy rail on Sepolia.",
      );
    }
    // Authorize first. Ready refuses wallet_requestChainId with
    // "Not preauthorized" until this origin has been approved.
    const { accounts: standardAccounts } = await walletV6.standardConnect(
      selectedWallet,
      false,
    );
    const [standardAccount] = standardAccounts;
    if (!standardAccount) {
      throw new Error("The wallet did not authorize an account.");
    }

    const chainId = chainIdFromStandardAccount(standardAccount);
    if (!chainId || !isStrk20Chain(chainId)) {
      throw new Error(
        "Switch the selected wallet to Starknet Sepolia or Mainnet before connecting.",
      );
    }
    const providerIndex = providerIndexForChain(chainId);
    try {
      assertWalletOperationPolicy(selectedWallet, providerIndex, "connect");
    } catch (error) {
      await selectedWallet.features["standard:disconnect"]
        .disconnect()
        .catch(() => undefined);
      throw error;
    }
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

    useStoreWallet.getState().applyConnectedWallet({
      wallet: selectedWallet,
      walletAccount,
      address,
      chain: chainId,
      capability,
    });
    useFrontendProvider
      .getState()
      .setCurrentFrontendProviderIndex(providerIndex);
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
      setError(describeWalletConnectError(error));
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

        {discoveryState === "loading" ? (
          <div className={styles.walletHint} role="status">
            Loading available wallets…
          </div>
        ) : pickable.length ? (
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
        ) : discoveryState === "ready" ? (
          <div className={styles.walletHint}>
            Ready Wallet Standard was not detected. Install{" "}
            <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
              Ready
            </a>{" "}
            for the Mainnet rail, or use the separate Privy rail on Sepolia.
            Privacy actions still require the dapp-facing STRK20 API.
          </div>
        ) : null}

        {error ? (
          <div className={styles.errorText} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  if (variant === "nav") {
    if (isConnected && address) {
      return (
        <button
          className={styles.addrPill}
          onClick={() => {
            useStoreWallet.getState().disconnect();
          }}
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
        >
          <span className={styles.addrDot} />
          <span className={styles.addrAddress}>{shortAddr}</span>
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
