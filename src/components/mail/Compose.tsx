"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { publicKeyFromFelts, encryptMail } from "@/lib/mail";
import {
  buildMailActions,
  parseOptionalStrkAmount,
} from "@/lib/mail-actions";
import { strk20ErrorMessage, submitActions } from "@/lib/strk20";
import {
  addrSTRK,
  myFrontendProviders,
} from "@/utils/constants";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { validateAndParseAddress } from "starknet";
import styles from "./mail.module.css";

type ComposeProps = {
  helperAddress: string | null;
  keyReady: boolean;
  networkName: string;
  onSent: () => void;
};

type SendState = {
  kind: "idle" | "pending" | "ok" | "error";
  message?: string;
  transactionHash?: string;
};

export default function Compose({
  helperAddress,
  keyReady,
  networkName,
  onSent,
}: ComposeProps) {
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const senderAddress = useStoreWallet((state) => state.address);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex
  );
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState("");
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });

  let disabledReason = "";
  if (!helperAddress) {
    disabledReason = `No QuietlineMail helper is configured on ${networkName}. Sending is disabled.`;
  } else if (!isConnected || !walletAccount || !senderAddress) {
    disabledReason = "Connect Ready before sending mail.";
  } else if (!isStrk20Capable) {
    disabledReason = "This wallet does not declare STRK20 Wallet API 0.10 support.";
  } else if (!keyReady) {
    disabledReason = "Register this tab's mail key before sending.";
  }

  const sendDisabled = Boolean(disabledReason) || sendState.kind === "pending";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!helperAddress) {
      setSendState({
        kind: "error",
        message: `No QuietlineMail helper is configured on ${networkName}.`,
      });
      return;
    }
    if (!walletAccount || !senderAddress || !isStrk20Capable || !keyReady) {
      setSendState({
        kind: "error",
        message: disabledReason || "Mail sending is not ready.",
      });
      return;
    }

    setSendState({ kind: "pending", message: "Looking up the recipient key…" });

    try {
      const recipientAddress = validateAndParseAddress(recipient.trim());
      const attachmentAmount = parseOptionalStrkAmount(attachment);
      const provider = myFrontendProviders[providerIndex];
      const registeredKey = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "get_pubkey",
        calldata: [recipientAddress],
      });
      if (
        registeredKey.length !== 2 ||
        (BigInt(registeredKey[0]) === 0n && BigInt(registeredKey[1]) === 0n)
      ) {
        throw new Error(
          "The recipient has not registered a Quietline mail public key."
        );
      }

      setSendState({ kind: "pending", message: "Encrypting locally…" });
      const record = await encryptMail(
        publicKeyFromFelts(registeredKey),
        body
      );
      const actions = buildMailActions({
        helperAddress,
        tokenAddress: addrSTRK,
        senderAddress,
        recipientAddress,
        record,
        attachmentAmount,
      });

      const { transactionHash } = await submitActions(
        walletAccount,
        provider,
        actions,
        {
          onSubmitted: (hash) => {
            setSendState({
              kind: "pending",
              message: "Private action submitted. Waiting for confirmation…",
              transactionHash: hash,
            });
          },
        }
      );

      setSendState({
        kind: "ok",
        message: attachmentAmount
          ? "Encrypted mail and private STRK transfer confirmed atomically."
          : "Encrypted mail confirmed.",
        transactionHash,
      });
      setBody("");
      setAttachment("");
      onSent();
    } catch (error: unknown) {
      setSendState({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  return (
    <section className={styles.card} aria-labelledby="compose-title">
      <div className={styles.cardNumber}>02</div>
      <div>
        <p className={styles.kicker}>PRIVATE DELIVERY</p>
        <h2 id="compose-title" className={styles.cardTitle}>
          Compose
        </h2>
      </div>

      <div className={styles.disclosureGrid}>
        <p>
          <strong>Private</strong>
          Body, recipient link, and attached transfer inside STRK20.
        </p>
        <p>
          <strong>Public</strong>
          Ciphertext, helper use, transaction timing, and any open-note dust.
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>Recipient Starknet address</span>
          <input
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            required
          />
        </label>
        <label className={styles.field}>
          <span>Message</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a private note"
            rows={6}
            maxLength={4096}
            required
          />
          <small>{body.length} / 4096 characters; encrypted as UTF-8</small>
        </label>
        <label className={styles.field}>
          <span>Attach STRK (optional)</span>
          <input
            value={attachment}
            onChange={(event) => setAttachment(event.target.value)}
            placeholder="0.1"
            inputMode="decimal"
          />
          <small>
            Sent as a private in-pool transfer in the same atomic action batch.
          </small>
        </label>

        {disabledReason ? (
          <p className={styles.notice}>{disabledReason}</p>
        ) : null}
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={sendDisabled}
        >
          {sendState.kind === "pending"
            ? "Sending through Ready…"
            : "Encrypt & send"}
        </button>
      </form>

      {sendState.message ? (
        <div
          className={`${styles.status} ${
            sendState.kind === "error" ? styles.statusError : ""
          }`}
          role="status"
        >
          {sendState.message}
          {sendState.transactionHash ? (
            <span className={styles.mono}>
              {sendState.transactionHash.slice(0, 10)}…
              {sendState.transactionHash.slice(-6)}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
