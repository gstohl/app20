"use client";

import { publicRecipientCount } from "@/lib/mail-recipient-count";
import type { LocalMailMessage } from "./Thread";
import { ScanProgress } from "./OperationProgress";
import styles from "./mail.module.css";

type ScanKind = "idle" | "scanning" | "ok" | "error";

type ConversationListProps = {
  messages: LocalMailMessage[];
  selectedMessageId: string | null;
  canScan: boolean;
  scanning: boolean;
  scanKind: ScanKind;
  scanMessage: string;
  scanProgress: { pages: number; events: number; maxPages: number };
  onSelect: (messageId: string) => void;
  onCompose: () => void;
  onScan: () => void;
  onScanOlder: () => void;
};

function envelopeLabel(message: LocalMailMessage): string {
  switch (message.envelope.type) {
    case "text":
      return "Private letter";
    case "offer":
      return "Deal offer";
    case "accept":
      return "Settlement memo";
    case "decline":
      return "Deal response";
    case "receipt":
      return "Transfer claim";
    case "payment_request":
      return "Invoice";
    default:
      return "Unsupported record";
  }
}

function messagePreview(message: LocalMailMessage): string {
  if (message.envelope.type === "text") {
    const body = message.plaintext.replace(/\s+/g, " ").trim();
    return body || "Empty decrypted letter";
  }
  return message.direction === "outgoing"
    ? "Confirmed encrypted document"
    : "Decrypted structured document";
}

export default function ConversationList({
  messages,
  selectedMessageId,
  canScan,
  scanning,
  scanKind,
  scanMessage,
  scanProgress,
  onSelect,
  onCompose,
  onScan,
  onScanOlder,
}: ConversationListProps) {
  return (
    <aside className={styles.conversationRail} aria-label="Conversation list">
      <div className={styles.railHeading}>
        <div>
          <p className={styles.kicker}>SEALED CORRESPONDENCE</p>
          <h1>Inbox</h1>
        </div>
        <button
          className={styles.composeButton}
          type="button"
          onClick={onCompose}
        >
          New letter
        </button>
      </div>

      <div className={styles.scanConsole}>
        <div className={styles.scanActions}>
          <button
            className={styles.scanButton}
            type="button"
            onClick={onScan}
            disabled={!canScan || scanning}
          >
            {scanning ? "Checking envelopes…" : "Check sealed envelopes"}
          </button>
          <button
            className={styles.scanOlderButton}
            type="button"
            onClick={onScanOlder}
            disabled={!canScan || scanning}
          >
            Older
          </button>
        </div>
        <ScanProgress
          scanning={scanning}
          pages={scanProgress.pages}
          maxPages={scanProgress.maxPages}
          events={scanProgress.events}
        />
        {!scanning && scanMessage ? (
          <p
            className={`${styles.scanMessage} ${
              scanKind === "error" ? styles.scanMessageError : ""
            }`}
            role={scanKind === "error" ? "alert" : "status"}
          >
            {scanMessage}
          </p>
        ) : null}
      </div>

      <div className={styles.railPrivacyNote}>
        <strong>Device-private list</strong>
        <span>
          Sender identities are absent and v1 mail is not authenticated, so
          sealed records are listed separately rather than inventing contacts.
        </span>
      </div>

      {messages.length ? (
        <ol className={styles.conversationList}>
          {messages.map((message) => {
            const recipientCount =
              message.recipientCount ?? publicRecipientCount(message.record);
            const selected = selectedMessageId === message.id;
            return (
              <li key={message.id}>
                <button
                  className={`${styles.conversationItem} ${
                    selected ? styles.conversationItemActive : ""
                  }`}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(message.id)}
                >
                  <span className={styles.conversationTopline}>
                    <strong>{envelopeLabel(message)}</strong>
                    <span>{message.direction === "outgoing" ? "SENT" : "OPENED"}</span>
                  </span>
                  <span className={styles.conversationPreview}>
                    {messagePreview(message)}
                  </span>
                  <span className={styles.conversationMeta}>
                    {recipientCount} recipient{recipientCount === 1 ? "" : "s"} ·
                    count public
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.railEmptyState}>
          <span className={styles.emptyEnvelope} aria-hidden="true">✉</span>
          <strong>No opened envelopes</strong>
          <span>
            Load this device&apos;s mail key, then check the public sealed-record
            rail.
          </span>
        </div>
      )}
    </aside>
  );
}
