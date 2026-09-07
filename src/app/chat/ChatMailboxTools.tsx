import { useRef, useState, type FormEvent } from "react";
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
  actionStates,
  onContactBackup,
  onRfqHistoryBackup,
  rfqAutoBackupEnabled,
  onRfqAutoBackupChange,
  onLock,
  onForget,
}: ChatMailboxToolsProps) {
  const backupBusy =
    actionStates["contacts:backup"]?.pending ||
    actionStates["rfq-resume:backup"]?.pending;


  return (
    <details className={styles.tools} aria-label="Chat tools">
      <summary className={styles.settingsSummary}>Chat settings{drafts.length ? ` · ${drafts.length} draft${drafts.length === 1 ? "" : "s"}` : ""}</summary>
      <details className={styles.toolsDisclosure}>
        <summary>Message history</summary>
        <div className={styles.toolsBody}>
        <p className={styles.toolsNote}>New messages are checked every 60 seconds while Chat is open and unlocked. You can also load earlier conversations here.</p>
        <div className={styles.toolsActions}>
          <button
            type="button"
            onClick={() => onScan("older")}
            disabled={!keyLoaded || !helperConfigured || scanning}
          >
            Load older messages
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
              ? "Connect a wallet before checking for messages."
              : "Unlock Chat to check your messages."}
          </p>
        ) : null}
        {scanCursorDescription ? <details><summary>History details</summary><p className={styles.toolsNote}>{scanCursorDescription}</p></details> : null}
        {!scanning && scanMessage ? (
          <p
            className={styles.toolsNote}
            data-kind={scanKind === "error" ? "error" : undefined}
            role={scanKind === "error" ? "alert" : "status"}
          >
            {scanMessage}
          </p>
        ) : null}
        </div>
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
        <summary>Encrypted chat recovery</summary>
        <div className={styles.toolsBody}>
          <p className={styles.toolsNote}>
            Save an encrypted backup of your contacts or trading history.
            Restoring needs this wallet and your chat recovery phrase.
            Creating a backup needs wallet approval and network fees.
          </p>
          <details><summary>Recovery phrase access</summary><p className={styles.toolsNote}>{MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE}</p></details>
          <button
            type="button"
            disabled={!keyLoaded || !seedLoaded || !helperConfigured || backupBusy}
            onClick={onContactBackup}
          >
            {actionStates["contacts:backup"]?.pending
              ? "Backing up…"
              : "Back up contacts to this chat"}
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
            Back up trading history after each settlement (uses gas)
          </label>
          <p className={styles.toolsNote}>
            Restore from the backups filed under <em>This chat</em> above.
          </p>
        </div>
      </details>

      <details className={styles.toolsDisclosure}>
        <summary>Device safety</summary>
        <div className={styles.toolsBody}>
          <p className={styles.toolsNote}>
            Lock Chat when you step away. Your drafts, sent messages and contact
            names stay in this browser until you choose Forget this device.
          </p>
          <button type="button" onClick={onLock}>
            Lock Chat
          </button>
          <button type="button" className={styles.toolsDanger} onClick={onForget}>
            Forget this device
          </button>
        </div>
      </details>

      <p className={styles.railFooter}>
        <Link to="/contacts">Manage contacts</Link>
      </p>
    </details>
  );
}


export function ChatNewConversation({ selfAddress, gate, onStartConversation, onNewDocument }: {
  selfAddress: string;
  gate: "wallet" | "key" | null;
  onStartConversation: (address: string) => boolean;
  onNewDocument: (recipient?: string) => void;
}) {
  const [newAddress, setNewAddress] = useState("");
  const formRef = useRef<HTMLDetailsElement>(null);
  function startConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newAddress.trim()) return;
    if (onStartConversation(newAddress)) {
      setNewAddress("");
      if (formRef.current) formRef.current.open = false;
    }
  }

  return (
      <details ref={formRef} id="chat-new-conversation" className={styles.toolsDisclosure}>
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

  );
}
