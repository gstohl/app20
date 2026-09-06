import type { FormEvent, KeyboardEvent } from "react";
import { ProvingProgress } from "@/components/mail/OperationProgress";
import {
  CHAT_LETTER_MAX_CHARS,
  type ChatLetterBudget,
  type ChatSendBlocker,
} from "./chat-send";
import styles from "./chat.module.css";

export type ChatComposerStatus = Readonly<{
  kind: "sending" | "ok" | "error";
  message: string;
  startedAt?: number;
  detail?: string;
  transactionHash?: string;
  retryBlocked?: boolean;
}> | null;

type ChatComposerProps = {
  contactName: string;
  value: string;
  onChange: (value: string) => void;
  blocker: ChatSendBlocker | null;
  sending: boolean;
  status: ChatComposerStatus;
  budget: ChatLetterBudget;
  onSend: () => void;
  onCheckDelivery?: () => void;
  /** Opens the document composer for this counterparty: terms, invoices, escrow. */
  onAttach: () => void;
  attachDisabled?: boolean;
};

export default function ChatComposer({
  contactName,
  value,
  onChange,
  blocker,
  sending,
  status,
  budget,
  onSend,
  onCheckDelivery,
  onAttach,
  attachDisabled = false,
}: ChatComposerProps) {
  const disabled = Boolean(blocker) || sending || Boolean(status?.retryBlocked);
  const canSend = !disabled && value.trim().length > 0 && budget.fits;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend) onSend();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <form
      className={styles.composer}
      aria-label={`Write to ${contactName}`}
      onSubmit={submit}
    >
      <label className={styles.srOnly} htmlFor="chat-composer">
        Message to {contactName}
      </label>
      <textarea
        id="chat-composer"
        className={styles.composerInput}
        value={value}
        rows={2}
        maxLength={CHAT_LETTER_MAX_CHARS}
        aria-describedby="chat-send-guidance"
        aria-invalid={!budget.fits || undefined}
        placeholder={`Write an encrypted message to ${contactName}…`}
        disabled={sending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composerRow}>
        <span id="chat-send-guidance" className={styles.composerMeta}>
          {blocker ? (
            <>
              {blocker.message}
              {blocker.kind === "key" ? (
                <>
                  {" "}
                  <a href="#mailbox-key-setup">Open chat key tools</a>
                </>
              ) : null}
            </>
          ) : (
            <>
              1 wallet approval · recipient count and timing are public
            </>
          )}
        </span>
        <span className={styles.composerActions}>
          <button
            type="button"
            className={styles.attachButton}
            disabled={attachDisabled || sending}
            onClick={onAttach}
          >
            Attach terms
          </button>
          <button type="submit" className={styles.sendButton} disabled={!canSend}>
            {sending ? "Please wait…" : status?.retryBlocked ? "Confirmation pending" : status?.kind === "error" ? "Retry send" : "Send encrypted"}
          </button>
        </span>
      </div>
      {!budget.fits ? (
        <p className={styles.composerStatus} data-kind="error" role="alert">
          Message is too large to send. Shorten it to fit {budget.maxPlaintextBytes} bytes.
        </p>
      ) : null}
      <details className={styles.sendDetails}>
        <summary>Sending details &amp; keyboard shortcut</summary>
        <p>Encrypted on this device. {budget.plaintextBytes} / {budget.maxPlaintextBytes} bytes.
          Press Ctrl+Enter or ⌘+Enter to send; Enter adds a new line.</p>
      </details>
      {status ? (
        <p
          className={styles.composerStatus}
          data-kind={status.kind}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.message}
        </p>
      ) : null}
      {status?.retryBlocked && onCheckDelivery ? (
        <button type="button" className={styles.attachButton} disabled={sending} onClick={onCheckDelivery}>
          {sending ? "Checking delivery…" : "Check delivery"}
        </button>
      ) : null}
      {status?.detail || status?.transactionHash ? (
        <details className={styles.sendDetails}>
          <summary>Delivery details</summary>
          {status.transactionHash ? <p>Transaction <code style={{ overflowWrap: "anywhere" }}>{status.transactionHash}</code></p> : null}
          {status.detail ? <p>{status.detail}</p> : null}
        </details>
      ) : null}
      <ProvingProgress
        active={sending}
        startedAt={status?.startedAt}
        label="Sealing and submitting the message"
      />
    </form>
  );
}
