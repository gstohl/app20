"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MailKeypair } from "@/lib/mail";
import { deriveKeypair, publicKeyToFelts } from "@/lib/mail";
import { MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE } from "@/lib/mail-authority-copy";
import {
  inspectMailVault,
  persistPlaintextSeed,
  persistWrappedSeed,
  unwrapMailSeed,
} from "@/lib/mail-vault";
import { strk20ErrorMessage } from "@/lib/strk20";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import { exportMailSeed, restoreMailSeed } from "./seedBackup";
import { myFrontendProviders } from "@/utils/constants";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import styles from "./mail.module.css";

type OnboardProps = {
  helperAddress: string | null;
  onKeyReady: (keypair: MailKeypair, seed: Uint8Array) => void;
};

type SetupState = {
  kind: "idle" | "pending" | "ok" | "error";
  message?: string;
  transactionHash?: string;
};

function keysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === 2 &&
    right.length === 2 &&
    BigInt(left[0]) === BigInt(right[0]) &&
    BigInt(left[1]) === BigInt(right[1])
  );
}

export default function Onboard({ helperAddress, onKeyReady }: OnboardProps) {
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const [setup, setSetup] = useState<SetupState>({ kind: "idle" });
  const [backupPhrase, setBackupPhrase] = useState("");
  const [pending, setPending] = useState<{
    keypair: MailKeypair;
    seed: Uint8Array;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [restoreValue, setRestoreValue] = useState("");
  const [restoreNeedsConfirmation, setRestoreNeedsConfirmation] =
    useState(false);
  const [wrapExisting, setWrapExisting] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const vault =
    address && chainId
      ? inspectMailVault(window.localStorage, chainId, address)
      : { kind: "missing" as const };

  const disabled =
    setup.kind === "pending" ||
    pending !== null ||
    !walletAccount ||
    !address ||
    !chainId ||
    !helperAddress;

  const canWrap = useMemo(() => {
    if (!wrapExisting) return true;
    return passphrase.length >= 8 && passphrase === passphraseConfirm;
  }, [passphrase, passphraseConfirm, wrapExisting]);

  async function persistSeed(seed: Uint8Array) {
    if (!address || !chainId) {
      throw new Error("Connect a wallet first.");
    }
    if (wrapExisting) {
      if (passphrase.length < 8) {
        throw new Error("Passphrase must be at least 8 characters.");
      }
      if (passphrase !== passphraseConfirm) {
        throw new Error("Passphrase confirmation does not match.");
      }
      await persistWrappedSeed(
        window.localStorage,
        chainId,
        address,
        seed,
        passphrase,
      );
      return;
    }
    persistPlaintextSeed(window.localStorage, chainId, address, seed);
  }

  async function finishWithSeed(seed: Uint8Array, created: boolean) {
    if (!aliveRef.current) return;
    const keypair = deriveKeypair(seed);
    if (created) {
      setBackupPhrase(exportMailSeed(seed));
      setPending({ keypair, seed });
      setSetup({
        kind: "ok",
        message:
          "Device mail key is ready. Save its one-time backup before opening the mailbox.",
      });
      return;
    }
    onKeyReady(keypair, seed);
  }

  async function loadAndRegister() {
    if (!walletAccount || !address || !chainId) {
      setSetup({ kind: "error", message: "Connect a wallet first." });
      return;
    }
    if (!helperAddress) {
      setSetup({
        kind: "error",
        message: "No mail helper is configured for this network.",
      });
      return;
    }

    setSetup({
      kind: "pending",
      message: "Loading this device's mail key…",
    });

    try {
      const existing = inspectMailVault(window.localStorage, chainId, address);
      if (existing.kind === "passphrase") {
        throw new Error(
          "This mailbox is passphrase-wrapped. Unlock it below instead of creating another key.",
        );
      }

      let seed: Uint8Array;
      let created = false;
      if (existing.kind === "plaintext") {
        seed = existing.seed;
        if (wrapExisting) await persistSeed(seed);
      } else {
        seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
        created = true;
        await persistSeed(seed);
      }

      const keypair = deriveKeypair(seed);
      const publicKey = publicKeyToFelts(keypair.publicKey);
      const provider = myFrontendProviders[providerIndex];
      const registered = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [address],
      });
      if (!aliveRef.current) return;

      if (keysEqual(registered, publicKey)) {
        await finishWithSeed(seed, created || Boolean(backupPhrase));
        if (!created && !backupPhrase) {
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
          "A different device mail key is registered. Mail will not overwrite it; use the original device or its backup.",
        );
      }

      if (!selectedWallet) throw new Error("Wallet policy context is missing.");
      assertWalletOperationPolicy(
        selectedWallet,
        providerIndex as 0 | 2 | 3,
        "mail",
      );
      setSetup({
        kind: "pending",
        message: "Waiting for approval of the public key registration…",
      });
      const { transaction_hash: transactionHash } = await walletAccount.execute(
        {
          contractAddress: helperAddress,
          entrypoint: "register_pubkey",
          calldata: publicKey,
        },
      );

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

      if (!aliveRef.current) return;
      await finishWithSeed(seed, created);
      if (!aliveRef.current) return;
      if (created) {
        setSetup({
          kind: "ok",
          message:
            "Device mail key registered. Save its one-time backup before opening the mailbox.",
          transactionHash,
        });
      } else {
        setSetup({
          kind: "ok",
          message: "Device mail key registered and ready for local scans.",
          transactionHash,
        });
      }
    } catch (error: unknown) {
      if (!aliveRef.current) return;
      setSetup({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  async function unlockWrapped() {
    if (!address || !chainId) {
      setSetup({ kind: "error", message: "Connect a wallet first." });
      return;
    }
    const existing = inspectMailVault(window.localStorage, chainId, address);
    if (existing.kind !== "passphrase") {
      setSetup({
        kind: "error",
        message: "This mailbox is not passphrase-wrapped on this device.",
      });
      return;
    }
    setSetup({ kind: "pending", message: "Unlocking the mailbox vault…" });
    try {
      const seed = await unwrapMailSeed(existing.record, unlockPassphrase);
      if (!aliveRef.current) {
        seed.fill(0);
        return;
      }
      onKeyReady(deriveKeypair(seed), seed);
      setUnlockPassphrase("");
      setSetup({
        kind: "ok",
        message: "Mailbox vault unlocked for this session.",
      });
    } catch (error: unknown) {
      if (!aliveRef.current) return;
      setSetup({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  async function restoreBackup(overwriteConfirmed: boolean) {
    if (!address || !chainId) {
      setSetup({ kind: "error", message: "Connect a wallet first." });
      return;
    }
    if (!helperAddress) {
      setSetup({
        kind: "error",
        message:
          "Mailbox setup needs the mail helper deployed on this network. Shield and unshield still work without it.",
      });
      return;
    }

    setSetup({
      kind: "pending",
      message: "Checking this backup against the public mailbox directory…",
    });

    try {
      const restored = restoreMailSeed(restoreValue);
      const restoredPublicKey = publicKeyToFelts(restored.keypair.publicKey);
      const provider = myFrontendProviders[providerIndex];
      const registered = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [address],
      });
      const hasRegisteredKey =
        registered.length === 2 &&
        (BigInt(registered[0]) !== 0n || BigInt(registered[1]) !== 0n);

      if (!hasRegisteredKey) {
        throw new Error(
          "This wallet has no public mailbox key registered. Nothing was replaced; register a new mailbox key instead.",
        );
      }
      if (!keysEqual(registered, restoredPublicKey)) {
        throw new Error(
          "This backup belongs to a different mailbox key. Nothing was replaced; use the backup registered to this wallet address.",
        );
      }

      const existing = inspectMailVault(window.localStorage, chainId, address);
      const replacesSeed = existing.kind !== "missing";
      if (replacesSeed && !overwriteConfirmed) {
        setRestoreNeedsConfirmation(true);
        setSetup({
          kind: "idle",
          message:
            "Backup matches this wallet's public mailbox key. Confirm before replacing the local vault.",
        });
        return;
      }

      if (!aliveRef.current) return;
      await persistSeed(restored.seed);
      if (!aliveRef.current) return;
      onKeyReady(restored.keypair, restored.seed);
      setBackupPhrase("");
      setCopied(false);
      setRestoreValue("");
      setRestoreNeedsConfirmation(false);
      setSetup({
        kind: "ok",
        message:
          "Backup restored locally and matched this wallet's public mailbox key.",
      });
    } catch (error: unknown) {
      if (!aliveRef.current) return;
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

  // Setup is already a three-beat sequence in state; this only makes the
  // sequence visible. Registration is one action, so "Register" is current
  // while it is in flight and complete once a backup phrase exists.
  const activeStep = backupPhrase ? 2 : setup.kind === "pending" ? 1 : 0;
  const stepState = (index: number) =>
    index < activeStep
      ? "complete"
      : index === activeStep
        ? "current"
        : "upcoming";

  return (
    <section
      id="mailbox-key-setup"
      className={styles.card}
      aria-labelledby="onboard-title"
    >
      <div className={styles.cardNumber}>01</div>
      <div>
        <p className={styles.kicker}>PUBLIC SETUP / DEVICE-BOUND KEY</p>
        <h2 id="onboard-title" className={styles.cardTitle}>
          Set up a mailbox key
        </h2>
      </div>
      {vault.kind === "passphrase" ? null : (
        <ol className={styles.setupSteps} aria-label="Mailbox setup progress">
          <li data-state={stepState(0)}>
            <span aria-hidden="true">1</span>Device
          </li>
          <li data-state={stepState(1)}>
            <span aria-hidden="true">2</span>Register
          </li>
          <li data-state={stepState(2)}>
            <span aria-hidden="true">3</span>Backup
          </li>
        </ol>
      )}
      <p className={styles.copy}>
        Registration is a normal public Starknet transaction. It links this
        wallet address to a public mailbox key in the on-chain directory.
      </p>
      {helperAddress ? null : (
        <p className={styles.notice}>
          Mailbox registration needs a helper configured for this APP20 rail.
          Live-network helpers are intentionally unavailable, so register and
          restore stay disabled. Shield and unshield still work from the wallet
          rail — they talk to the live STRK20 pool, not this helper.
        </p>
      )}

      {vault.kind === "passphrase" ? (
        <div className={styles.restoreForm}>
          <p className={styles.notice}>
            This mailbox is passphrase-wrapped on this device. Unlock it for
            this session, or restore from backup if you forgot the passphrase.
          </p>
          <label className={styles.field}>
            Mailbox passphrase
            <input
              type="password"
              value={unlockPassphrase}
              onChange={(event) => setUnlockPassphrase(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => void unlockWrapped()}
            disabled={setup.kind === "pending" || unlockPassphrase.length === 0}
          >
            {setup.kind === "pending" ? "Unlocking…" : "Unlock mailbox"}
          </button>
        </div>
      ) : (
        <>
          <label className={styles.field}>
            <span>
              <input
                type="checkbox"
                checked={wrapExisting}
                onChange={(event) => setWrapExisting(event.target.checked)}
              />{" "}
              Encrypt this mailbox on this browser (optional)
            </span>
            <small>
              {wrapExisting
                ? "scrypt + AES-GCM wrap. Mail cannot open the mailbox or use its signing key until you unlock this session, and never stores the passphrase. A wallet signature cannot be the wrap key — Ready signatures are not a stable secret."
                : "The raw 32-byte mailbox seed is stored in the clear in this browser profile. Anyone with this profile can read your Mail correspondence and create payment requests that display as verified from you."}
            </small>
          </label>
          <p className={styles.finePrint}>
            Either way, the eight-group backup in step 3 is the only recovery if
            you clear this profile or forget the passphrase, and APP20 currently
            cannot revoke the Mail key if that backup is compromised.
          </p>
          {wrapExisting ? (
            <>
              <label className={styles.field}>
                New mailbox passphrase
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                />
              </label>
              <label className={styles.field}>
                Confirm passphrase
                <input
                  type="password"
                  value={passphraseConfirm}
                  onChange={(event) => setPassphraseConfirm(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                />
              </label>
            </>
          ) : null}
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => void loadAndRegister()}
            disabled={disabled || !canWrap}
          >
            {setup.kind === "pending"
              ? "Waiting…"
              : "Load device key & register"}
          </button>
        </>
      )}

      {backupPhrase ? (
        <div className={styles.backupBox}>
          <strong>Back up now — this phrase is shown once</strong>
          <code>{backupPhrase}</code>
          <p>
            {MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE} Store it secret and offline;
            Mail does not upload it. If you chose a passphrase, this backup is
            still required when you forget it.
          </p>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={copyBackupPhrase}
          >
            {copied ? "Copied" : "Copy backup phrase"}
          </button>
          {pending ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                const next = pending;
                setPending(null);
                onKeyReady(next.keypair, next.seed);
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
              Paste exactly eight groups of eight hexadecimal characters. Choose
              plaintext or passphrase wrap above before restoring. Whoever has
              this value can read your Mail correspondence and create payment
              requests that display as verified from you; APP20 currently cannot
              revoke the key if it is compromised.
            </small>
          </label>
          {restoreNeedsConfirmation ? (
            <div className={styles.restoreWarning} role="alert">
              <strong>Replace the existing mailbox vault?</strong>
              <p>
                This replaces the mailbox key on this device; mail encrypted to
                the old key becomes unreadable here.
              </p>
              <button
                className={styles.warningButton}
                type="button"
                onClick={() => void restoreBackup(true)}
              >
                Replace mailbox key
              </button>
            </div>
          ) : (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => void restoreBackup(false)}
              disabled={
                setup.kind === "pending" ||
                !address ||
                !chainId ||
                !helperAddress ||
                restoreValue.length === 0 ||
                !canWrap
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
          role={setup.kind === "error" ? "alert" : "status"}
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
