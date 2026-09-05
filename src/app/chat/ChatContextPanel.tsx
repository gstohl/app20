import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { AliasRecord } from "@/lib/aliases";
import { storeDeskHandoff } from "@/lib/desk-handoff";
import { ChatRecordFull, type ChatRecordActions } from "./ChatRecordCard";
import {
  contactDisplayName,
  type ChatContactContext,
  type ChatContextEntry,
  type ChatContextSection,
  type ChatConversation,
} from "./chat-model";
import styles from "./chat.module.css";

const SECTION_LABELS: Readonly<Record<ChatContextSection, string>> = {
  rfq: "Open RFQ",
  payment: "Pending payment",
  escrow: "Escrow",
};

function identityNote(conversation: ChatConversation): string {
  const { contact } = conversation;
  if (contact.kind === "self") {
    return "Backups and self-addressed copies this wallet posted to its own mailbox. Restore one from the conversation; post new ones from the mailbox tools.";
  }
  if (contact.kind === "sealed") {
    return "MessagePosted carries no sender. Name the thread from the conversation to file it under a counterparty; until then it stays here.";
  }
  switch (contact.nameSource) {
    case "address-book":
      return "Saved counterparty. The label is device-encrypted and is never authentication.";
    case "alias":
      return "Local alias. A label on this device, never authentication.";
    default:
      return "No local name. This address came from a Sent copy, a name assigned on this device, or an unauthenticated payload claim.";
  }
}

function expiryLabel(at: number): string {
  if (at === 0) return "No expiry";
  return new Date(at * 1_000).toLocaleString();
}

function safeOfferIndex(index: string | undefined): number | undefined {
  const value = Number(index);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function ContextSection({
  title,
  entries,
  empty,
  selectedEntryId,
  onSelectEntry,
}: {
  title: string;
  entries: readonly ChatContextEntry[];
  empty: ReactNode;
  selectedEntryId: string | null;
  onSelectEntry: (id: string) => void;
}) {
  return (
    <section className={styles.contextSection} aria-label={title}>
      <div className={styles.contextSectionHead}>
        <h3>{title}</h3>
        <span>{entries.length}</span>
      </div>
      {entries.length ? (
        <ul className={styles.contextList}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={styles.contextEntry}
                data-tone={entry.tone}
                aria-pressed={selectedEntryId === entry.id}
                onClick={() => onSelectEntry(entry.id)}
              >
                <span className={styles.contextEntryTop}>
                  <strong>
                    {entry.title}
                    {entry.direction === "workspace"
                      ? ""
                      : entry.direction === "outgoing"
                        ? " · sent"
                        : " · received"}
                  </strong>
                  <em>{entry.open ? "open" : "closed"}</em>
                </span>
                <span className={styles.contextEntryTerms}>{entry.terms}</span>
                <span className={styles.contextEntryStatus}>{entry.status}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.contextEmpty}>{empty}</p>
      )}
    </section>
  );
}

type ChatContextPanelProps = {
  conversation: ChatConversation;
  context: ChatContactContext;
  selectedEntry: ChatContextEntry | null;
  onSelectEntry: (id: string | null) => void;
  onLocate: (itemId: string) => void;
  selfAddress: string;
  chainId: string;
  handoffsEnabled: boolean;
  aliases: readonly AliasRecord[];
  /** The value actions the mailbox desk offers, so a record acts from here too. */
  actions: ChatRecordActions;
  onClose: () => void;
};

export default function ChatContextPanel({
  conversation,
  context,
  selectedEntry,
  onSelectEntry,
  onLocate,
  selfAddress,
  chainId,
  handoffsEnabled,
  aliases,
  actions,
  onClose,
}: ChatContextPanelProps) {
  const { contact } = conversation;
  const name = contactDisplayName(contact);
  const identityAddress =
    contact.kind === "self" ? selfAddress : (contact.address ?? null);
  const selectedItem = selectedEntry?.itemId
    ? (conversation.items.find((item) => item.id === selectedEntry.itemId) ??
      null)
    : null;
  const handoff = () => {
    if (!contact.address) return;
    try {
      storeDeskHandoff(window.sessionStorage, "rfq", contact.address, {
        account: selfAddress,
        chainId,
      });
    } catch {
      // A refused session store only loses the prefilled counterparty.
    }
  };

  return (
    <aside className={styles.context} aria-label="Contact context" id="chat-context">
      <header className={styles.contextHead}>
        <div>
          <p className={styles.kicker}>CONTACT CONTEXT</p>
          <strong>{selectedEntry ? "Record detail" : "At a glance"}</strong>
        </div>
        <button
          type="button"
          className={styles.contextClose}
          aria-label="Close contact context"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className={styles.contextScroll}>
        {selectedEntry ? (
          <section className={styles.detail} aria-label="Record detail">
            <button
              type="button"
              className={styles.detailBack}
              onClick={() => onSelectEntry(null)}
            >
              ← Back to {name}
            </button>
            <div>
              <p className={styles.kicker}>
                {SECTION_LABELS[selectedEntry.section].toUpperCase()}
              </p>
              <strong>{selectedEntry.title}</strong>
            </div>
            <dl className={styles.detailFacts}>
              <div>
                <dt>Terms</dt>
                <dd>{selectedEntry.terms}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selectedEntry.status}</dd>
              </div>
              <div>
                <dt>Side</dt>
                <dd>
                  {selectedEntry.direction === "workspace"
                    ? "Multi-maker request from the RFQ workspace"
                    : selectedEntry.direction === "outgoing"
                      ? `Sent by this wallet to ${name}`
                      : `Received from ${name}`}
                </dd>
              </div>
              {selectedEntry.record ? (
                <div>
                  <dt>Expiry</dt>
                  <dd>{expiryLabel(selectedEntry.record.facts.expiresAt)}</dd>
                </div>
              ) : null}
              {selectedEntry.rfq ? (
                <>
                  <div>
                    <dt>RFQ id</dt>
                    <dd>
                      <code>{selectedEntry.rfq.rfqId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Makers</dt>
                    <dd>
                      {[
                        selectedEntry.rfq.selectedQuote?.solverId,
                        ...(selectedEntry.rfq.fills ?? []).map(
                          (fill) => fill.makerId,
                        ),
                      ]
                        .filter(Boolean)
                        .join(", ") || "Not selected"}
                    </dd>
                  </div>
                  <div>
                    <dt>Authority</dt>
                    <dd>{selectedEntry.rfq.authority}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {selectedEntry.record?.needsAction ? (
              <p className={styles.recordAction}>
                <span>{selectedEntry.record.needsAction}</span>
              </p>
            ) : null}
            <div className={styles.detailActions}>
              {selectedEntry.itemId ? (
                <button
                  type="button"
                  onClick={() => onLocate(selectedEntry.itemId!)}
                >
                  Show in conversation
                </button>
              ) : null}
              {selectedEntry.rfq ? (
                <Link to="/rfq" hash="records">
                  Open in RFQ workspace
                </Link>
              ) : null}
            </div>
            {selectedEntry.record ? (
              <div className={styles.recordFull}>
                <ChatRecordFull
                  record={selectedEntry.record}
                  aliases={aliases}
                  linkAuthenticity={selectedItem?.message?.linkAuthenticity}
                  actions={{
                    ...actions,
                    offerIndex: safeOfferIndex(selectedItem?.message?.index),
                  }}
                />
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <section className={styles.identity} aria-label="Wallet identity">
              <p className={styles.kicker}>
                {contact.kind === "counterparty"
                  ? "WALLET IDENTITY"
                  : contact.kind === "self"
                    ? "YOUR MAILBOX"
                    : "SEALED THREAD"}
              </p>
              <h2>
                <bdi>{name}</bdi>
              </h2>
              {identityAddress ? <code>{identityAddress}</code> : null}
              <p className={styles.identityNote}>{identityNote(conversation)}</p>
              <div className={styles.identityActions}>
                {handoffsEnabled && contact.kind === "counterparty" ? (
                  <Link to="/rfq" hash="desk" onClick={handoff}>
                    New RFQ
                  </Link>
                ) : null}
                {contact.kind === "counterparty" ? (
                  <Link to="/contacts">
                    {contact.saved ? "Counterparties" : "Save to Counterparties"}
                  </Link>
                ) : null}
              </div>
            </section>

            <ContextSection
              title="Open RFQs"
              entries={context.rfqs}
              empty={
                <>
                  No open offer with {name}. Multi-maker requests stay in the{" "}
                  <Link to="/rfq" hash="records">
                    RFQ workspace
                  </Link>
                  ; one appears here only when a maker id matches this contact.
                </>
              }
              selectedEntryId={null}
              onSelectEntry={onSelectEntry}
            />
            <ContextSection
              title="Pending payments"
              entries={context.payments}
              empty={<>No payment request is waiting between you and {name}.</>}
              selectedEntryId={null}
              onSelectEntry={onSelectEntry}
            />
            <ContextSection
              title="Escrows"
              entries={context.escrows}
              empty={
                <>
                  No escrow announcement with {name} on this device. Escrow
                  state is read from the contract when this mailbox checks for
                  mail, never proven by a message.
                </>
              }
              selectedEntryId={null}
              onSelectEntry={onSelectEntry}
            />
          </>
        )}
      </div>
    </aside>
  );
}
