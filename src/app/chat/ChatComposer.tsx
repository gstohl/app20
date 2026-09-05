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
  onAttach,
  attachDisabled = false,
}: ChatComposerProps) {
  const disabled = Boolean(blocker) || sending;
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
        rows={3}
        maxLength={CHAT_LETTER_MAX_CHARS}
        placeholder={`Write an encrypted letter to ${contactName}…`}
        disabled={sending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composerRow}>
        <span className={styles.composerMeta}>
          {blocker ? (
            <>
              {blocker.message}
              {blocker.kind === "key" ? (
                <>
                  {" "}
                  <a href="#mailbox-key-setup">Set up a mailbox key</a>
                </>
              ) : null}
            </>
          ) : (
            <>
              {budget.plaintextBytes} / {budget.maxPlaintextBytes} bytes ·
              sealed on this device · 1 wallet approval · recipient count and
              timing are public
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
            {sending ? "Sending…" : "Send encrypted"}
          </button>
        </span>
      </div>
      {status ? (
        <p
          className={styles.composerStatus}
          data-kind={status.kind}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.message}
        </p>
      ) : null}
      <ProvingProgress
        active={sending}
        startedAt={status?.startedAt}
        label="Sealing and submitting the letter"
      />
    </form>
  );
}
