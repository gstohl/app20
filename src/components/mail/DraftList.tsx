"use client";

import type { CompositeDraft } from "@/lib/drafts";
import styles from "./mail.module.css";

function draftTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function preview(draft: CompositeDraft): string {
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

type DraftListProps = {
  drafts: CompositeDraft[];
  selectedDraftId: string | null;
  filterLabel: string;
  onSelect: (draftId: string) => void;
  onDelete: (draftId: string) => void;
};

export default function DraftList({
  drafts,
  selectedDraftId,
  filterLabel,
  onSelect,
  onDelete,
}: DraftListProps) {
  return (
    <section className={styles.conversationRail} aria-label="Draft list">
      <header className={styles.railHeading}>
        <div>
          <p className={styles.kicker}>DEVICE-PRIVATE</p>
          <h1>Drafts</h1>
        </div>
        <span className={styles.messageTotal}>{drafts.length}</span>
      </header>
      <div className={styles.railPrivacyNote}>
        <strong>{filterLabel} · local only</strong>
        <span>
          Drafts are stored in this browser profile. They are never uploaded or
          included in mailbox scans.
        </span>
      </div>
      {drafts.length ? (
        <ol className={styles.conversationList}>
          {drafts.map((draft) => (
            <li key={draft.id} className={styles.draftListItem}>
              <button
                className={`${styles.conversationItem} ${
                  selectedDraftId === draft.id
                    ? styles.conversationItemActive
                    : ""
                }`}
                type="button"
                aria-current={
                  selectedDraftId === draft.id ? "true" : undefined
                }
                onClick={() => onSelect(draft.id)}
              >
                <span className={styles.conversationTopline}>
                  <strong>{draft.recipient.trim() || "No recipient"}</strong>
                  <time>{draftTime(draft.updatedAt)}</time>
                </span>
                <span className={styles.conversationPreview}>
                  {preview(draft)}
                </span>
                <span className={styles.conversationMeta}>
                  <em className={styles.typeBadge}>
                    {draft.attachments.length
                      ? `${draft.attachments.length} attachment${
                          draft.attachments.length === 1 ? "" : "s"
                        }`
                      : "Letter"}
                  </em>
                  <span className={styles.readIndicator}>DRAFT</span>
                </span>
              </button>
              <button
                className={styles.draftDelete}
                type="button"
                onClick={() => onDelete(draft.id)}
                aria-label={`Delete draft to ${draft.recipient || "no recipient"}`}
              >
                Delete…
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.railEmptyState}>
          <span className={styles.emptyEnvelope} aria-hidden="true">
            ✎
          </span>
          <strong>No {filterLabel.toLowerCase()} drafts</strong>
          <span>Click New to start a device-private document.</span>
        </div>
      )}
    </section>
  );
}
