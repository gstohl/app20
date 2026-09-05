"use client";

import { useState } from "react";
import { publicRecipientCount } from "@/lib/mail-recipient-count";
import type { LocalMailMessage } from "./message";
import styles from "./mail.module.css";

const CIPHERTEXT_PREVIEW_FELTS = 4;

type CopyState = "idle" | "copied" | "error";

function isoBlockTimestamp(timestamp: number | undefined): string | null {
  if (timestamp === undefined) return null;
  try {
    const value = new Date(timestamp * 1_000).toISOString();
    return value;
  } catch {
    return null;
  }
}

export function ChainRecordPanel({ message }: { message: LocalMailMessage }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const { record } = message;
  const timestamp = isoBlockTimestamp(message.blockTimestamp);
  const recipientCount =
    message.recipientCount ?? publicRecipientCount(message.record);
  const preview = record.ciphertextFelts.slice(0, CIPHERTEXT_PREVIEW_FELTS);
  const hiddenFeltCount = record.ciphertextFelts.length - preview.length;

  async function copyAllCiphertext() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(record.ciphertextFelts),
      );
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <details className={styles.chainDisclosure}>
      <summary>
        <span>What the chain sees</span>
        <span className={styles.chainToggleHint}>PUBLIC EVIDENCE</span>
      </summary>
      <aside
        className={styles.chainRecord}
        aria-label={`Public on-chain record for message ${message.index}`}
      >
        <div className={styles.chainRecordHeading}>
          <div>
            <span className={styles.chainEyebrow}>MESSAGEPOSTED / PUBLIC</span>
            <h3>Opaque event data</h3>
          </div>
          <span className={styles.chainEvidenceBadge}>ON-CHAIN EVIDENCE</span>
        </div>

        <dl className={styles.chainFields}>
          <div className={styles.chainField}>
            <dt>Message index</dt>
            <dd>
              <code>{message.index}</code>
            </dd>
          </div>
          <div className={styles.chainField}>
            <dt>Recipient count</dt>
            <dd>
              <code>{recipientCount}</code>
              <small>PUBLIC FORMAT METADATA</small>
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Transaction hash</dt>
            <dd>
              <code>{message.transactionHash}</code>
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Block timestamp</dt>
            <dd>
              {timestamp && message.blockTimestamp !== undefined ? (
                <>
                  <time dateTime={timestamp}>{timestamp}</time>
                  <small>UNIX {message.blockTimestamp}</small>
                </>
              ) : (
                <span className={styles.sealedValue}>NOT AVAILABLE</span>
              )}
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Ephemeral public key</dt>
            <dd className={styles.feltPair}>
              {record.ephemeralPub.map((felt, index) => (
                <code key={`${index}:${felt}`}>{felt}</code>
              ))}
            </dd>
          </div>
          <div className={styles.chainField}>
            <dt>View tag</dt>
            <dd>
              <code>
                {record.viewTag} / 0x
                {record.viewTag.toString(16).padStart(2, "0")}
              </code>
            </dd>
          </div>
          <div className={styles.chainField}>
            <dt>Nonce</dt>
            <dd className={styles.feltPair}>
              {record.nonce.map((felt, index) => (
                <code key={`${index}:${felt}`}>{felt}</code>
              ))}
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Ciphertext felts</dt>
            <dd>
              <ol className={styles.ciphertextPreview}>
                {preview.map((felt, index) => (
                  <li key={`${index}:${felt}`}>
                    <span>{index.toString().padStart(2, "0")}</span>
                    <code>{felt}</code>
                  </li>
                ))}
                {hiddenFeltCount > 0 ? (
                  <li className={styles.truncatedFelts}>
                    … {hiddenFeltCount} more felt
                    {hiddenFeltCount === 1 ? "" : "s"} in the public record
                  </li>
                ) : null}
              </ol>
              <div className={styles.ciphertextActions}>
                <span>
                  {record.ciphertextFelts.length} FELT
                  {record.ciphertextFelts.length === 1 ? "" : "S"} TOTAL
                </span>
                <button
                  className={styles.chainCopyButton}
                  type="button"
                  onClick={copyAllCiphertext}
                >
                  {copyState === "copied"
                    ? "Copied all"
                    : copyState === "error"
                      ? "Copy failed"
                      : `Copy all ${record.ciphertextFelts.length}`}
                </button>
              </div>
              <span className={styles.copyStatus} aria-live="polite">
                {copyState === "copied"
                  ? "Complete ciphertext JSON copied."
                  : copyState === "error"
                    ? "Clipboard access was denied."
                    : ""}
              </span>
            </dd>
          </div>
        </dl>

        <div className={styles.absentFields}>
          <span>
            <b>Sender address</b>
            <code>ABSENT</code>
          </span>
          <span>
            <b>Recipient identities</b>
            <code>ABSENT</code>
          </span>
        </div>
        <p className={styles.addressAbsence}>
          Recipient count is public in the ciphertext format. No sender or
          recipient address appears anywhere in this MessagePosted record.
        </p>
      </aside>
    </details>
  );
}
