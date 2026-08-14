"use client";

import styles from "./mail.module.css";

export type LocalMailMessage = {
  id: string;
  index: string;
  plaintext: string;
  transactionHash: string;
  blockNumber?: number;
  eventIndex?: number;
};

type ThreadProps = {
  messages: LocalMailMessage[];
  canScan: boolean;
  scanning: boolean;
  scanMessage: string;
  onScan: () => void;
};

export default function Thread({
  messages,
  canScan,
  scanning,
  scanMessage,
  onScan,
}: ThreadProps) {
  return (
    <section className={`${styles.card} ${styles.threadCard}`}>
      <div className={styles.threadHeading}>
        <div>
          <p className={styles.kicker}>LOCAL PLAINTEXT ONLY</p>
          <h2 className={styles.cardTitle}>Inbox</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onScan}
          disabled={!canScan || scanning}
        >
          {scanning ? "Scanning…" : "Scan public events"}
        </button>
      </div>

      <p className={styles.copy}>
        Quietline downloads public ciphertext events and trial-decrypts them in
        this tab. Only successful local decryptions enter this list; newest are
        shown first. No plaintext is uploaded or persisted by this page.
      </p>

      {scanMessage ? (
        <p className={styles.scanMessage} role="status">
          {scanMessage}
        </p>
      ) : null}

      {messages.length ? (
        <ol className={styles.threadList}>
          {messages.map((message) => (
            <li className={styles.message} key={message.id}>
              <div className={styles.messageMeta}>
                <span>Message #{message.index}</span>
                <span>
                  {message.blockNumber === undefined
                    ? "confirmed event"
                    : `block ${message.blockNumber}`}
                </span>
              </div>
              <p>{message.plaintext}</p>
              <span className={styles.localLabel}>decrypted on this device</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.emptyState}>
          <strong>No locally decrypted mail yet.</strong>
          <span>
            Register this tab&apos;s key, then scan after someone sends to that
            registered public key.
          </span>
        </div>
      )}
    </section>
  );
}
