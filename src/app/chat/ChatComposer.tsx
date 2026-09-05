import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ProvingProgress } from "@/components/mail/OperationProgress";
import {
  CHAT_LETTER_MAX_CHARS,
  type ChatLetterBudget,
  type ChatSendBlocker,
} from "./chat-send";
import styles from "./chat.module.css";

export type ChatKeyState =
  | { kind: "ready" }
  | { kind: "missing" }
  | { kind: "locked"; busy: boolean; error?: string };

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
  keyState: ChatKeyState;
  onUnlock: (passphrase: string) => void;
  sending: boolean;
  status: ChatComposerStatus;
  budget: ChatLetterBudget;
  onSend: () => void;
};

export default function ChatComposer({
  contactName,
  value,
  onChange,
  blocker,
  keyState,
  onUnlock,
  sending,
  status,
  budget,
  onSend,
}: ChatComposerProps) {
  const [passphrase, setPassphrase] = useState("");
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
      {keyState.kind === "locked" ? (
        <div className={styles.unlockForm}>
          <span>
            This mailbox is passphrase-wrapped on this device. Unlock it for
            this tab to sign and send.
            {keyState.error ? ` ${keyState.error}` : ""}
          </span>
          <input
            type="password"
            aria-label="Mailbox passphrase"
            autoComplete="current-password"
            value={passphrase}
            disabled={keyState.busy}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <button
            type="button"
            disabled={keyState.busy || passphrase.length < 8}
            onClick={() => {
              onUnlock(passphrase);
              setPassphrase("");
            }}
          >
            {keyState.busy ? "Unlocking…" : "Unlock for this tab"}
          </button>
        </div>
      ) : null}
      <div className={styles.composerRow}>
        <span className={styles.composerMeta}>
          {blocker ? (
            <>
              {blocker.message}
              {blocker.kind === "key" && keyState.kind === "missing" ? (
                <>
                  {" "}
                  <Link to="/mail/inbox">Set one up in Mailbox</Link>
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
        <button type="submit" className={styles.sendButton} disabled={!canSend}>
          {sending ? "Sending…" : "Send encrypted"}
        </button>
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
