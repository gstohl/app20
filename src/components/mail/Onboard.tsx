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
  const [setupMode, setSetupMode] = useState<"create" | "restore">("create");
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
          "Device chat key is ready. Save its one-time backup before opening the chat.",
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
        message: "No chat service is configured for this network.",
      });
      return;
    }

    setSetup({
      kind: "pending",
      message: "Loading this device's chat key…",
    });

    try {
      const existing = inspectMailVault(window.localStorage, chainId, address);
      if (existing.kind === "passphrase") {
        throw new Error(
          "This chat is passphrase-wrapped. Unlock it below instead of creating another key.",
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
            message: "Device chat key loaded and matched the public directory.",
          });
        }
        return;
      }
      if (
        registered.length === 2 &&
        (BigInt(registered[0]) !== 0n || BigInt(registered[1]) !== 0n)
      ) {
        throw new Error(
          "A different device chat key is registered. Chat will not overwrite it; use the original device or its backup.",
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
            "Device chat key registered. Save its one-time backup before opening the chat.",
          transactionHash,
        });
      } else {
        setSetup({
          kind: "ok",
          message: "Device chat key registered and ready for local scans.",
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
        message: "This chat is not passphrase-wrapped on this device.",
      });
      return;
    }
    setSetup({ kind: "pending", message: "Unlocking the chat vault…" });
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
        message: "Chat vault unlocked for this session.",
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
          "Chat setup needs the chat service deployed on this network. Shield and unshield still work without it.",
      });
      return;
    }

    setSetup({
      kind: "pending",
      message: "Checking this backup against the public chat directory…",
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
          "This wallet has no public chat key registered. Nothing was replaced; register a new chat key instead.",
        );
      }
      if (!keysEqual(registered, restoredPublicKey)) {
        throw new Error(
          "This backup belongs to a different chat key. Nothing was replaced; use the backup registered to this wallet address.",
        );
      }

      const existing = inspectMailVault(window.localStorage, chainId, address);
      const replacesSeed = existing.kind !== "missing";
      if (replacesSeed && !overwriteConfirmed) {
        setRestoreNeedsConfirmation(true);
        setSetup({
          kind: "idle",
          message:
            "Backup matches this wallet's public chat key. Confirm before replacing the local vault.",
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
          "Backup restored locally and matched this wallet's public chat key.",
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
        <p className={styles.kicker}>{vault.kind === "missing" ? "CHAT SETUP" : "CHAT ACCESS"}</p>
        <h2 id="onboard-title" className={styles.cardTitle}>
          {pending ? "Save your chat backup" : vault.kind === "missing" ? "Set up encrypted chat" : "Open encrypted chat"}
        </h2>
      </div>
      {vault.kind === "missing" && !pending ? (
        <div className={styles.setupChoices} role="group" aria-label="Chat setup method">
          <button type="button" aria-pressed={setupMode === "create"} disabled={disabled}
            onClick={() => setSetupMode("create")}>Set up Chat</button>
          <button type="button" aria-pressed={setupMode === "restore"} disabled={disabled}
            onClick={() => setSetupMode("restore")}>Restore chat access</button>
        </div>
      ) : null}
      {(vault.kind !== "missing" && !pending) || (setupMode === "restore" && !pending) ? null : (
        <ol className={styles.setupSteps} aria-label="Chat setup progress">
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
        {pending ? "Keep this backup private. You need it to restore chat access on another device."
          : vault.kind === "missing" && setupMode === "restore" ? "Restore your chat key from a backup to read your encrypted messages."
          : vault.kind === "missing"
          ? "Create a device key and register its public key to receive encrypted messages. Registration is a public Starknet transaction."
          : "Your chat key is saved on this device. Load it to read and send messages. We check its registration; no new transaction is needed when it already matches."}
      </p>
      {address && chainId ? null : (
        <p className={styles.notice}>
          Connect a wallet before registering: a chat key is bound to the
          wallet address that will send from it, which is why the button below
          is disabled.
        </p>
      )}
      {helperAddress ? null : (
        <p className={styles.notice}>
          Chat registration needs a helper configured for this APP20 rail.
          Live-network helpers are intentionally unavailable, so register and
          restore stay disabled. Shield and unshield still work from the wallet
          rail — they talk to the live STRK20 pool, not this helper.
        </p>
      )}

      {pending ? null : vault.kind === "passphrase" ? (
        <div className={styles.restoreForm}>
          <p className={styles.notice}>
            Your chat key is protected with a passphrase. Unlock it for
            this session, or restore from backup if you forgot the passphrase.
          </p>
          <label className={styles.field}>
            Chat passphrase
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
            {setup.kind === "pending" ? "Unlocking…" : "Unlock chat"}
          </button>
        </div>
      ) : (
        <>
          <details open={vault.kind === "missing" || undefined}>
            <summary>Chat key protection and recovery</summary>
            <label className={styles.field}>
              <span>
                <input
                  type="checkbox"
                  checked={wrapExisting}
                  onChange={(event) => setWrapExisting(event.target.checked)}
                />{" "}
                Protect your chat key with a passphrase (optional)
              </span>
              {wrapExisting ? (
                <small>
                  Your key is encrypted on this device. APP20 cannot read messages or use your
                  signing key until you unlock this session, and never stores the
                  passphrase. A wallet signature cannot be the wrap key — Ready
                  signatures are not a stable secret.
                </small>
              ) : null}
            </label>
            {wrapExisting ? null : (
              <p className={styles.actionWarning}>
                Leaving this off stores the raw 32-byte chat seed in the clear
                in this browser profile. Anyone with the profile can read your
                messages and create payment requests that display as
                verified from you.
              </p>
            )}
            <p className={styles.finePrint}>
              Your chat backup is the only recovery if
              you clear this profile or forget the passphrase, and APP20 currently
              cannot revoke the Chat key if that backup is compromised.
            </p>
            {wrapExisting ? (
              <>
                <label className={styles.field}>
                  New chat passphrase
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
          </details>
          {vault.kind === "missing" && setupMode === "restore" ? null : <button
            className={styles.primaryButton}
            type="button"
            onClick={() => void loadAndRegister()}
            disabled={disabled || !canWrap}
          >
            {setup.kind === "pending"
              ? "Waiting…"
              : vault.kind === "plaintext" ? "Open chat" : "Enable encrypted chat"}
          </button>}
        </>
      )}

      {backupPhrase ? (
        <div className={styles.backupBox}>
          <strong>Back up now — this phrase is shown once</strong>
          <code>{backupPhrase}</code>
          <p>
            {MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE} Store it secret and offline;
            Chat does not upload it. If you chose a passphrase, this backup is
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
              I saved the backup — open chat
            </button>
          ) : null}
        </div>
      ) : null}

      {pending ? null : <details className={styles.restoreDisclosure}
        open={setupMode === "restore"}
        onToggle={(event) => setSetupMode(event.currentTarget.open ? "restore" : "create")}>
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
              this value can read your messages and create payment
              requests that display as verified from you; APP20 currently cannot
              revoke the key if it is compromised.
            </small>
          </label>
          {restoreNeedsConfirmation ? (
            <div className={styles.restoreWarning} role="alert">
              <strong>Replace the existing chat vault?</strong>
              <p>
                This replaces the chat key on this device; messages encrypted to
                the old key become unreadable here.
              </p>
              <button
                className={styles.warningButton}
                type="button"
                onClick={() => void restoreBackup(true)}
              >
                Replace chat key
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
              Restore chat key
            </button>
          )}
        </div>
      </details>}

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
