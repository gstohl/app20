"use client";

import { useState } from "react";
import type { MailKeypair } from "@/lib/mail";
import { deriveKeypairFromSource, publicKeyToFelts } from "@/lib/mail";
import { strk20ErrorMessage } from "@/lib/strk20";
import { myFrontendProviders } from "@/utils/constants";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import styles from "./mail.module.css";

type OnboardProps = {
  helperAddress: string | null;
  onKeyReady: (keypair: MailKeypair) => void;
};

type SetupState = {
  kind: "idle" | "pending" | "ok" | "error";
  message?: string;
  transactionHash?: string;
};

function sessionSeedSource(): Uint8Array {
  // Phase 2 injection point: replace this session-only source with
  // deriveSeedFromSignature(SNIP-12 signature, message hash) once the wallet
  // signing UX is finalized. The crypto module is already signature-ready.
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export default function Onboard({
  helperAddress,
  onKeyReady,
}: OnboardProps) {
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const address = useStoreWallet((state) => state.address);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex
  );
  const [setup, setSetup] = useState<SetupState>({ kind: "idle" });

  const disabled =
    setup.kind === "pending" || !walletAccount || !address || !helperAddress;

  async function deriveAndRegister() {
    if (!walletAccount || !address) {
      setSetup({ kind: "error", message: "Connect a wallet first." });
      return;
    }
    if (!helperAddress) {
      setSetup({
        kind: "error",
        message: "No QuietlineMail helper is configured for this network.",
      });
      return;
    }

    setSetup({
      kind: "pending",
      message: "Deriving a session key and waiting for wallet approval…",
    });

    try {
      const keypair = await deriveKeypairFromSource(sessionSeedSource);
      const publicKey = publicKeyToFelts(keypair.publicKey);
      const { transaction_hash: transactionHash } = await walletAccount.execute({
        contractAddress: helperAddress,
        entrypoint: "register_pubkey",
        calldata: publicKey,
      });

      setSetup({
        kind: "pending",
        message: "Registration submitted. Waiting for confirmation…",
        transactionHash,
      });

      const provider = myFrontendProviders[providerIndex];
      await provider.waitForTransaction(transactionHash, {
        retries: 120,
        retryInterval: 3_000,
      });
      const stored = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [address],
      });
      if (
        stored.length !== 2 ||
        BigInt(stored[0]) !== BigInt(publicKey[0]) ||
        BigInt(stored[1]) !== BigInt(publicKey[1])
      ) {
        throw new Error("The helper did not return the registered public key.");
      }

      onKeyReady(keypair);
      setSetup({
        kind: "ok",
        message: "Session mail key registered and ready for local scans.",
        transactionHash,
      });
    } catch (error: unknown) {
      setSetup({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  return (
    <section className={styles.card} aria-labelledby="onboard-title">
      <div className={styles.cardNumber}>01</div>
      <div>
        <p className={styles.kicker}>PUBLIC SETUP</p>
        <h2 id="onboard-title" className={styles.cardTitle}>
          Register a mail key
        </h2>
      </div>
      <p className={styles.copy}>
        Registration is a normal public Starknet transaction. It links this
        wallet address to a mail public key in the on-chain directory.
      </p>
      <p className={styles.finePrint}>
        Phase 2 uses a fresh in-memory key for this tab. Deterministic SNIP-12
        derivation and safe persistence are not enabled yet; reloading loses
        access to this session key.
      </p>
      {!helperAddress ? (
        <p className={styles.notice}>
          No helper deployment is configured for this network. Registration is
          disabled until NEXT_PUBLIC_MAIL_HELPER_* is set.
        </p>
      ) : null}
      <button
        className={styles.primaryButton}
        type="button"
        onClick={deriveAndRegister}
        disabled={disabled}
      >
        {setup.kind === "pending"
          ? "Waiting for wallet…"
          : "Derive & register session key"}
      </button>
      {setup.message ? (
        <div
          className={`${styles.status} ${
            setup.kind === "error" ? styles.statusError : ""
          }`}
          role="status"
        >
          {setup.message}
          {setup.transactionHash ? (
            <span className={styles.mono}>
              {setup.transactionHash.slice(0, 10)}…
              {setup.transactionHash.slice(-6)}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
