import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import AddressBookField from "@/components/address-book/AddressBookField";
import { ScanProgress } from "@/components/mail/OperationProgress";
import type { ThreadActionState } from "@/components/mail/message";
import { MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE } from "@/lib/mail-authority-copy";
import type { CompositeDraft } from "@/lib/drafts";
import { chatTimeLabel } from "./ChatConversationRail";
import styles from "./chat.module.css";

function draftPreview(draft: CompositeDraft): string {
  const body = draft.body.replace(/\s+/g, " ").trim();
  if (body) return body;
  if (draft.attachments.length) {
    return draft.attachments
      .map((attachment) =>
        attachment.type === "payment_request"
          ? "Invoice"
          : attachment.type === "escrow_fund"
            ? "Escrow"
            : attachment.type === "offer"
              ? "Offer"
              : "Payment",
      )
      .join(" + ");
  }
  return "Blank document";
}

export type ChatMailboxToolsProps = {
  selfAddress: string;
  gate: "wallet" | "key" | null;
  keyLoaded: boolean;
  seedLoaded: boolean;
  helperConfigured: boolean;
  scanning: boolean;
  scanKind: "idle" | "scanning" | "ok" | "error";
  scanMessage: string;
  scanProgress: { pages: number; events: number; maxPages: number };
  scanCursorDescription: string | null;
  onScan: (direction: "newer" | "older") => void;
  drafts: readonly CompositeDraft[];
  onOpenDraft: (draft: CompositeDraft) => void;
  onDeleteDraft: (draftId: string) => void;
  onStartConversation: (address: string) => void;
  /** Opens the document composer: terms, invoices, escrow, several recipients. */
  onNewDocument: (recipient?: string) => void;
  actionStates: Readonly<Record<string, ThreadActionState>>;
  onContactBackup: () => void;
  onRfqHistoryBackup: () => void;
  rfqAutoBackupEnabled: boolean;
  onRfqAutoBackupChange: (enabled: boolean) => void;
  onLock: () => void;
  onForget: () => void;
};

/**
 * What used to be the mailbox sidebar: checking the chain for new records,
 * device-private drafts, encrypted self-backups and device safety. It sits
 * under the conversations because it is about the whole mailbox, not one
 * counterparty.
 */
export default function ChatMailboxTools({
  selfAddress,
  gate,
  keyLoaded,
  seedLoaded,
  helperConfigured,
  scanning,
  scanKind,
  scanMessage,
  scanProgress,
  scanCursorDescription,
  onScan,
  drafts,
  onOpenDraft,
  onDeleteDraft,
  onStartConversation,
  onNewDocument,
  actionStates,
  onContactBackup,
  onRfqHistoryBackup,
  rfqAutoBackupEnabled,
  onRfqAutoBackupChange,
  onLock,
  onForget,
}: ChatMailboxToolsProps) {
  const [newAddress, setNewAddress] = useState("");
  const backupBusy =
    actionStates["contacts:backup"]?.pending ||
    actionStates["rfq-resume:backup"]?.pending;

  function startConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newAddress.trim()) return;
    onStartConversation(newAddress);
    setNewAddress("");
  }

  return (
    <div className={styles.tools} aria-label="Mailbox tools">
      <section className={styles.toolsSection} aria-labelledby="chat-scan-title">
        <div className={styles.toolsHead}>
          <strong id="chat-scan-title">Check for mail</strong>
          <span className={styles.toolsKeyState}>
            {gate === "wallet"
              ? "NO WALLET"
              : keyLoaded
                ? "KEY LOADED"
                : "KEY NOT LOADED"}
          </span>
        </div>
        <div className={styles.toolsActions}>
          <button
            type="button"
            onClick={() => onScan("newer")}
            disabled={!keyLoaded || scanning}
          >
            {scanning ? "Checking…" : "Check for new mail"}
          </button>
          <button
            type="button"
            onClick={() => onScan("older")}
            disabled={!keyLoaded || scanning}
          >
            Load older mail
          </button>
        </div>
        <ScanProgress
          scanning={scanning}
          pages={scanProgress.pages}
          maxPages={scanProgress.maxPages}
          events={scanProgress.events}
          phase={scanMessage}
        />
        {gate ? (
          <p className={styles.toolsNote}>
            {gate === "wallet"
              ? "Connect a wallet before checking for mail."
              : "Load this device's mailbox key before checking for mail."}
          </p>
        ) : null}
        {scanCursorDescription ? (
          <p className={styles.toolsNote}>{scanCursorDescription}</p>
        ) : null}
        {!scanning && scanMessage ? (
          <p
            className={styles.toolsNote}
            data-kind={scanKind === "error" ? "error" : undefined}
            role={scanKind === "error" ? "alert" : "status"}
          >
            {scanMessage}
          </p>
        ) : null}
      </section>

      <details className={styles.toolsDisclosure}>
        <summary>Write to a new address</summary>
        <form className={styles.toolsForm} onSubmit={startConversation}>
          <AddressBookField
            selfAddress={selfAddress}
            inputAriaLabel="New conversation address"
            value={newAddress}
            onChange={setNewAddress}
            placeholder="0x… or saved label"
            disabled={gate === "wallet"}
            bookActions={false}
          />
          <div className={styles.toolsActions} data-variant="plain">
            <button type="submit" disabled={gate === "wallet" || !newAddress.trim()}>
              Open conversation
            </button>
            <button
              type="button"
              disabled={gate === "wallet"}
              onClick={() => onNewDocument(newAddress.trim() || undefined)}
            >
              New document
            </button>
          </div>
        </form>
      </details>

      <details className={styles.toolsDisclosure}>
        <summary>
          Drafts <strong>{drafts.length}</strong>
        </summary>
        {drafts.length ? (
          <ul className={styles.draftList} aria-label="Device-private drafts">
            {drafts.map((draft) => {
              const time = chatTimeLabel(draft.updatedAt);
              return (
                <li key={draft.id}>
                  <button
                    type="button"
                    className={styles.draftOpen}
                    onClick={() => onOpenDraft(draft)}
                    aria-label={`Open draft: ${draftPreview(draft)}`}
                  >
                    <span>{draftPreview(draft)}</span>
                    <small>
                      {draft.recipient ? draft.recipient.split(/[\n,;]+/)[0] : "No recipient"} ·{" "}
                      <time dateTime={time.dateTime}>{time.label}</time>
                    </small>
                  </button>
                  <button
                    type="button"
                    className={styles.draftDelete}
                    onClick={() => onDeleteDraft(draft.id)}
                    aria-label={`Delete draft: ${draftPreview(draft)}`}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.toolsNote}>
            Drafts stay in this browser profile, not encrypted at rest, until
            they are sent or deleted.
          </p>
        )}
      </details>

      <details className={styles.toolsDisclosure}>
        <summary>Encrypted mailbox recovery</summary>
        <div className={styles.toolsBody}>
          <p className={styles.toolsNote}>
            Post authenticated contact or RFQ-history self-mail. Oversized
            ciphertext uses a verified CID pointer. The same wallet locates it;
            the mailbox recovery phrase decrypts it. Wallet alone is not enough.{" "}
            {MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE}
          </p>
          <button
            type="button"
            disabled={!keyLoaded || !seedLoaded || !helperConfigured || backupBusy}
            onClick={onContactBackup}
          >
            {actionStates["contacts:backup"]?.pending
              ? "Backing up…"
              : "Back up contacts to this mailbox"}
          </button>
          {actionStates["contacts:backup"]?.message ? (
            <p className={styles.toolsNote} role="status">
              {actionStates["contacts:backup"].message}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!keyLoaded || !seedLoaded || !helperConfigured || backupBusy}
            onClick={onRfqHistoryBackup}
          >
            {actionStates["rfq-resume:backup"]?.pending
              ? "Backing up…"
              : "Back up RFQ history"}
          </button>
          {actionStates["rfq-resume:backup"]?.message ? (
            <p className={styles.toolsNote} role="status">
              {actionStates["rfq-resume:backup"].message}
            </p>
          ) : null}
          <label className={styles.toolsCheck}>
            <input
              type="checkbox"
              checked={rfqAutoBackupEnabled}
              disabled={gate === "wallet"}
              onChange={(event) => onRfqAutoBackupChange(event.target.checked)}
            />{" "}
            Automatically back up RFQ history after settlement (opt in)
          </label>
          <p className={styles.toolsNote}>
            Restore from the backups filed under <em>This mailbox</em> above.
          </p>
        </div>
      </details>

      <details className={styles.toolsDisclosure}>
        <summary>Device safety</summary>
        <div className={styles.toolsBody}>
          <p className={styles.toolsNote}>
            Disconnecting is not logout: drafts, Sent copies, and aliases stay
            in this browser profile.
          </p>
          <button type="button" onClick={onLock}>
            Lock mailbox this session
          </button>
          <button type="button" className={styles.toolsDanger} onClick={onForget}>
            Forget this device
          </button>
        </div>
      </details>

      <p className={styles.railFooter}>
        <Link to="/contacts">Counterparties</Link> keeps the labels;{" "}
        <a href="https://github.com/gstohl/app20" target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </p>
    </div>
  );
}
