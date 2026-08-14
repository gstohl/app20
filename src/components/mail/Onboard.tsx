"use client";

import { useState } from "react";
import type { MailKeypair } from "@/lib/mail";
import { deriveKeypair, publicKeyToFelts } from "@/lib/mail";
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

const MAIL_SEED_PREFIX = "quietline/mailseed/v1";

function seedStorageKey(chainId: string, address: string): string {
  return `${MAIL_SEED_PREFIX}/${chainId}/${address}`;
}

function seedToHex(seed: Uint8Array): string {
  return Array.from(seed, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function seedFromHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []
  );
}

function formatBackupPhrase(seed: Uint8Array): string {
  return seedToHex(seed).match(/.{1,8}/g)?.join(" ") ?? "";
}

function loadOrCreateSeed(
  chainId: string,
  address: string
): { seed: Uint8Array; created: boolean } {
  const key = seedStorageKey(chainId, address);
  const existing = window.localStorage.getItem(key);
  if (existing !== null) {
    const seed = seedFromHex(existing);
    if (!seed) {
      throw new Error(
        "The saved Quietline device key is invalid. Refusing to overwrite it."
      );
    }
    return { seed, created: false };
  }

  const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const encoded = seedToHex(seed);
  window.localStorage.setItem(key, encoded);
  if (window.localStorage.getItem(key) !== encoded) {
    throw new Error("Quietline could not persist the device mail key.");
  }
  return { seed, created: true };
}

function keysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === 2 &&
    right.length === 2 &&
    BigInt(left[0]) === BigInt(right[0]) &&
    BigInt(left[1]) === BigInt(right[1])
  );
}

export default function Onboard({
  helperAddress,
  onKeyReady,
}: OnboardProps) {
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex
  );
  const [setup, setSetup] = useState<SetupState>({ kind: "idle" });
  const [backupPhrase, setBackupPhrase] = useState("");
  const [copied, setCopied] = useState(false);

  const disabled =
    setup.kind === "pending" ||
    !walletAccount ||
    !address ||
    !chainId ||
    !helperAddress;

  async function loadAndRegister() {
    if (!walletAccount || !address || !chainId) {
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
      message: "Loading this device's mail key…",
    });

    try {
      const { seed, created } = loadOrCreateSeed(chainId, address);
      if (created) setBackupPhrase(formatBackupPhrase(seed));
      const keypair = deriveKeypair(seed);
      const publicKey = publicKeyToFelts(keypair.publicKey);
      const provider = myFrontendProviders[providerIndex];
      const registered = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [address],
      });

      if (keysEqual(registered, publicKey)) {
        onKeyReady(keypair);
        setSetup({
          kind: "ok",
          message: "Device mail key loaded and matched the public directory.",
        });
        return;
      }
      if (
        registered.length === 2 &&
        (BigInt(registered[0]) !== 0n || BigInt(registered[1]) !== 0n)
      ) {
        throw new Error(
          "A different device mail key is registered. Quietline will not overwrite it; use the original device or its backup."
        );
      }

      setSetup({
        kind: "pending",
        message: "Waiting for approval of the public key registration…",
      });
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
      await provider.waitForTransaction(transactionHash, {
        retries: 120,
        retryInterval: 3_000,
      });
      const stored = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [address],
      });
      if (!keysEqual(stored, publicKey)) {
        throw new Error("The helper did not return the registered public key.");
      }

      onKeyReady(keypair);
      setSetup({
        kind: "ok",
        message: "Device mail key registered and ready for local scans.",
        transactionHash,
      });
    } catch (error: unknown) {
      setSetup({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  async function copyBackupPhrase() {
    try {
      await navigator.clipboard.writeText(backupPhrase);
      setCopied(true);
    } catch {
      setSetup({
        kind: "error",
        message: "Clipboard access failed. Copy the backup phrase manually.",
      });
    }
  }

  return (
    <section className={styles.card} aria-labelledby="onboard-title">
      <div className={styles.cardNumber}>01</div>
      <div>
        <p className={styles.kicker}>PUBLIC SETUP / DEVICE-BOUND KEY</p>
        <h2 id="onboard-title" className={styles.cardTitle}>
          Register a mail key
        </h2>
      </div>
      <p className={styles.copy}>
        Registration is a normal public Starknet transaction. It links this
        wallet address to a mail public key in the on-chain directory.
      </p>
      <p className={styles.finePrint}>
        Quietline generates 32 random bytes once per network and address, then
        stores the seed in this browser profile. Wallet signatures are not used
        as a key source because signer output is not guaranteed deterministic.
        Signature-based wrapping and recovery are a later stretch.
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
        onClick={loadAndRegister}
        disabled={disabled}
      >
        {setup.kind === "pending"
          ? "Waiting…"
          : "Load device key & register"}
      </button>

      {backupPhrase ? (
        <div className={styles.backupBox}>
          <strong>Back up now — this phrase is shown once</strong>
          <code>{backupPhrase}</code>
          <p>
            Anyone with this phrase can read mail encrypted to this key. Store
            it offline; Quietline does not upload it.
          </p>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={copyBackupPhrase}
          >
            {copied ? "Copied" : "Copy backup phrase"}
          </button>
        </div>
      ) : null}

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
