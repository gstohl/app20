"use client";

import { useState } from "react";
import type { MailKeypair } from "@/lib/mail";
import { deriveKeypair, publicKeyToFelts } from "@/lib/mail";
import { MAIL_SEED_STORAGE_PREFIX } from "@/lib/local-mailbox-storage";
import { strk20ErrorMessage } from "@/lib/strk20";
import { exportMailSeed, restoreMailSeed } from "./seedBackup";
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

function seedStorageKey(chainId: string, address: string): string {
  return `${MAIL_SEED_STORAGE_PREFIX}/${chainId}/${address}`;
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
  const [pendingKeypair, setPendingKeypair] = useState<MailKeypair | null>(null);
  const [copied, setCopied] = useState(false);
  const [restoreValue, setRestoreValue] = useState("");
  const [restoreNeedsConfirmation, setRestoreNeedsConfirmation] =
    useState(false);

  const disabled =
    setup.kind === "pending" ||
    pendingKeypair !== null ||
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
      if (created) setBackupPhrase(exportMailSeed(seed));
      const keypair = deriveKeypair(seed);
      const publicKey = publicKeyToFelts(keypair.publicKey);
      const provider = myFrontendProviders[providerIndex];
      const registered = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [address],
      });

      if (keysEqual(registered, publicKey)) {
        if (backupPhrase) {
          setPendingKeypair(keypair);
          setSetup({
            kind: "ok",
            message:
              "Device mail key matched the public directory. Save its one-time backup before opening the mailbox.",
          });
        } else {
          onKeyReady(keypair);
          setSetup({
            kind: "ok",
            message: "Device mail key loaded and matched the public directory.",
          });
        }
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

      if (created) {
        setPendingKeypair(keypair);
        setSetup({
          kind: "ok",
          message:
            "Device mail key registered. Save its one-time backup before opening the mailbox.",
          transactionHash,
        });
      } else {
        onKeyReady(keypair);
        setSetup({
          kind: "ok",
          message: "Device mail key registered and ready for local scans.",
          transactionHash,
        });
      }
    } catch (error: unknown) {
      setSetup({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  function restoreBackup(overwriteConfirmed: boolean) {
    if (!address || !chainId) {
      setSetup({ kind: "error", message: "Connect a wallet first." });
      return;
    }

    try {
      const restored = restoreMailSeed(restoreValue);
      const key = seedStorageKey(chainId, address);
      const encoded = seedToHex(restored.seed);
      const existing = window.localStorage.getItem(key);
      const existingSeed = existing === null ? null : seedFromHex(existing);
      const sameSeed =
        existingSeed !== null && seedToHex(existingSeed) === encoded;
      const replacesSeed = existing !== null && !sameSeed;

      if (replacesSeed && !overwriteConfirmed) {
        setRestoreNeedsConfirmation(true);
        return;
      }

      if (!sameSeed) {
        window.localStorage.setItem(key, encoded);
      }
      const persisted = window.localStorage.getItem(key);
      const persistedSeed = persisted === null ? null : seedFromHex(persisted);
      if (persistedSeed === null || seedToHex(persistedSeed) !== encoded) {
        throw new Error("Quietline could not persist the restored mail key.");
      }

      onKeyReady(restored.keypair);
      setBackupPhrase("");
      setCopied(false);
      setRestoreValue("");
      setRestoreNeedsConfirmation(false);
      setSetup({
        kind: "ok",
        message:
          "Backup restored locally. The derived mailbox key is ready on this device.",
      });
    } catch (error: unknown) {
      setRestoreNeedsConfirmation(false);
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
        <strong>Not encrypted at rest:</strong> Quietline stores the raw
        32-byte mailbox seed as hexadecimal in this browser profile. Anyone who
        can access this profile—including another user of a shared machine—can
        read retained mail and derive any escrow claim keys. Disconnecting the
        wallet does not clear it. Use “Forget this device” when finished, and
        keep the offline backup private.
      </p>
      {helperAddress ? null : (
        <p className={styles.notice}>
          No helper deployment is configured for this network. Registration is
          disabled until VITE_MAIL_HELPER_* is set.
        </p>
      )}
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
          {pendingKeypair ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                const keypair = pendingKeypair;
                setPendingKeypair(null);
                onKeyReady(keypair);
              }}
            >
              I saved the backup — open mailbox
            </button>
          ) : null}
        </div>
      ) : null}

      <details className={styles.restoreDisclosure}>
        <summary>Restore from backup</summary>
        <div className={styles.restoreForm}>
          <label className={styles.field} htmlFor="mail-seed-backup">
            Backup value
            <textarea
              id="mail-seed-backup"
              rows={3}
              value={restoreValue}
              onChange={(event) => {
                setRestoreValue(event.target.value);
                setRestoreNeedsConfirmation(false);
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000"
            />
            <small>
              Paste exactly eight groups of eight hexadecimal characters. The
              backup stays in this browser and is never sent with a request.
            </small>
          </label>
          {restoreNeedsConfirmation ? (
            <div className={styles.restoreWarning} role="alert">
              <strong>Replace the existing mailbox key?</strong>
              <p>
                This replaces the mailbox key on this device; mail encrypted to
                the old key becomes unreadable here.
              </p>
              <button
                className={styles.warningButton}
                type="button"
                onClick={() => restoreBackup(true)}
              >
                Replace mailbox key
              </button>
            </div>
          ) : (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => restoreBackup(false)}
              disabled={
                setup.kind === "pending" ||
                !address ||
                !chainId ||
                restoreValue.length === 0
              }
            >
              Restore mailbox key
            </button>
          )}
        </div>
      </details>

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
