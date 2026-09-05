import type { ReactNode } from "react";
import { shortenFelt } from "@/components/mail/correspondent";
import { contactDisplayName, type ChatConversation } from "./chat-model";
import styles from "./chat.module.css";

/** Today shows a clock time; anything older shows the day. */
export function chatTimeLabel(
  at: number | undefined,
  now = Date.now(),
): { label: string; dateTime?: string } {
  if (at === undefined) return { label: "—" };
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return { label: "—" };
  const dateTime = date.toISOString();
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return {
      label: new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date),
      dateTime,
    };
  }
  return {
    label: new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date),
    dateTime,
  };
}

/** The second line under a name: where the name came from, or what the row is. */
function contactNote(conversation: ChatConversation): string {
  const { contact } = conversation;
  if (contact.kind === "self") return "Backups and self-addressed copies";
  if (contact.kind === "sealed") return "Unnamed thread · name it to file it";
  if (contact.label && contact.address) return shortenFelt(contact.address);
  switch (contact.nameSource) {
    case "address-book":
      return "Saved counterparty";
    case "alias":
      return "Local alias";
    default:
      return "Unnamed · address only";
  }
}

type ChatConversationRailProps = {
  conversations: readonly ChatConversation[];
  totalCount: number;
  selectedKey: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  needsActionOnly: boolean;
  onNeedsActionChange: (value: boolean) => void;
  needsActionCount: number;
  /** What blocks this mailbox, so the rail answers what the page answers. */
  gate: "wallet" | "key" | null;
  unattributedSent: number;
  onSelect: (key: string) => void;
  /** The mailbox tools, rendered under the conversations. */
  children?: ReactNode;
};

export default function ChatConversationRail({
  conversations,
  totalCount,
  selectedKey,
  search,
  onSearchChange,
  needsActionOnly,
  onNeedsActionChange,
  needsActionCount,
  gate,
  unattributedSent,
  onSelect,
  children,
}: ChatConversationRailProps) {
  const searching = search.trim().length > 0;
  const walletGate = gate === "wallet";
  return (
    <section className={styles.rail} aria-label="Conversations">
      <header className={styles.railHeading}>
        <div>
          <p className={styles.kicker}>
            {needsActionOnly ? "NEEDS ACTION" : "CONVERSATIONS"}
          </p>
          <h1>Chat</h1>
        </div>
        <span
          className={styles.railCount}
          aria-label={`${conversations.length} conversation${conversations.length === 1 ? "" : "s"} shown`}
        >
          {conversations.length}
        </span>
      </header>

      <div className={styles.railTools}>
        <input
          type="search"
          className={styles.railSearch}
          value={search}
          placeholder="Search counterparties and records"
          aria-label="Search conversations"
          disabled={walletGate}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.railFilter}
          aria-pressed={needsActionOnly}
          disabled={walletGate}
          onClick={() => onNeedsActionChange(!needsActionOnly)}
        >
          <span>Needs action only</span>
          <strong>{needsActionCount}</strong>
        </button>
      </div>

      <div className={styles.railScroll}>
        {!walletGate && totalCount ? (
          <div className={styles.railNote}>
            <strong>Encrypted records on this device</strong>
            <span>
              Letters, offers, invoices and escrows grouped by counterparty.
              The chain is read when you check for mail; nothing here is
              settlement authority.
            </span>
          </div>
        ) : null}

        {conversations.length ? (
          <ol className={styles.conversationList}>
            {conversations.map((conversation) => {
              const { contact, latest, unreadCount } = conversation;
              const name = contactDisplayName(contact);
              const selected = selectedKey === contact.key;
              const time = chatTimeLabel(latest?.at);
              const preview = latest
                ? latest.preview
                : "No records with this counterparty on this device yet.";
              return (
                <li key={contact.key}>
                  <button
                    type="button"
                    className={styles.conversationItem}
                    data-kind={contact.kind}
                    aria-current={selected ? "true" : undefined}
                    aria-label={`${unreadCount ? `${unreadCount} unread. ` : ""}${name}. ${
                      latest ? `${latest.label}. ` : ""
                    }${preview}`}
                    onClick={() => onSelect(contact.key)}
                  >
                    <span className={styles.conversationTop}>
                      <span className={styles.conversationName}>
                        <strong title={contact.address ?? undefined}>
                          <bdi>{name}</bdi>
                        </strong>
                        <small>{contactNote(conversation)}</small>
                      </span>
                      <time
                        className={styles.conversationTime}
                        dateTime={time.dateTime}
                      >
                        {time.label}
                      </time>
                    </span>
                    <span className={styles.conversationPreview}>
                      {latest?.direction === "outgoing" ? <em>You: </em> : null}
                      {preview}
                    </span>
                    <span className={styles.conversationMeta}>
                      {latest ? (
                        <em className={styles.typeBadge}>{latest.label}</em>
                      ) : null}
                      {conversation.needsAction ? (
                        <em className={styles.actionBadge}>Needs action</em>
                      ) : null}
                      {unreadCount ? (
                        <span className={styles.unread}>
                          {unreadCount} unread
                        </span>
                      ) : latest?.direction === "incoming" ? (
                        <span className={styles.opened}>Opened</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className={styles.railEmpty}>
            <span className={styles.railGlyph} aria-hidden="true">
              {searching ? "⌕" : walletGate ? "⚿" : "✉"}
            </span>
            {walletGate ? (
              <>
                <strong>Wallet required</strong>
                <span>
                  Chat is keyed to a wallet and reads only this device&apos;s
                  records for it. Connect one to open it.
                </span>
              </>
            ) : searching ? (
              <>
                <strong>No conversation matches</strong>
                <span>
                  Search reads only names, addresses and records already on
                  this device.
                </span>
              </>
            ) : needsActionOnly ? (
              <>
                <strong>Nothing needs your action</strong>
                <span>
                  No open offer, unpaid request or fillable escrow is waiting
                  on this wallet.
                </span>
              </>
            ) : (
              <>
                <strong>No conversations yet</strong>
                <span>
                  Check for mail, write to a new address below, or save a
                  wallet under Counterparties. Each becomes a conversation
                  here.
                </span>
              </>
            )}
          </div>
        )}

        {unattributedSent ? (
          <p className={styles.railFooter}>
            {unattributedSent} Sent cop{unattributedSent === 1 ? "y" : "ies"}{" "}
            from an earlier version carr{unattributedSent === 1 ? "ies" : "y"}{" "}
            no stored recipient and cannot be filed under a counterparty.
          </p>
        ) : null}

        {children}
      </div>
    </section>
  );
}
