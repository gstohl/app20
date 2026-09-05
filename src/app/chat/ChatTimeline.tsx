import type { AliasRecord } from "@/lib/aliases";
import ChatRecordCard from "./ChatRecordCard";
import {
  contactDisplayName,
  type ChatConversation,
  type ChatItem,
} from "./chat-model";
import styles from "./chat.module.css";

export function chatEntryDomId(itemId: string): string {
  return `chat-item-${itemId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function fullTime(at: number | undefined): { label: string; dateTime?: string } {
  if (at === undefined) return { label: "Time not recorded" };
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return { label: "Time not recorded" };
  return {
    label: new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date),
    dateTime: date.toISOString(),
  };
}

function provenanceLabel(item: ChatItem): string {
  switch (item.provenance) {
    case "device-sent":
      return "Sent copy on this device";
    case "payment-link":
      return item.message?.linkAuthenticity?.kind === "verified"
        ? "Imported link · Mail-key signature verified"
        : "Imported link · unverified";
    default:
      return "Saved by Mailbox from decrypted mail";
  }
}

type ChatTimelineProps = {
  conversation: ChatConversation;
  aliases: readonly AliasRecord[];
  highlightId: string | null;
};

export default function ChatTimeline({
  conversation,
  aliases,
  highlightId,
}: ChatTimelineProps) {
  const name = contactDisplayName(conversation.contact);
  if (!conversation.items.length) {
    return (
      <div className={styles.timelineEmpty}>
        <strong>No records with {name} on this device yet.</strong>
        <p>
          A letter sent from here is sealed to their registered mailbox key and
          kept as a Sent copy in this browser profile. Records they send you
          appear after Mailbox checks for mail.
        </p>
      </div>
    );
  }

  function renderContent(item: ChatItem) {
    const cards = item.records.length ? (
      <div className={styles.cardStack}>
        {item.records.map((record) => (
          <ChatRecordCard
            key={record.id}
            record={record}
            own={item.direction === "outgoing"}
            aliases={aliases}
            linkAuthenticity={item.message?.linkAuthenticity}
          />
        ))}
      </div>
    ) : null;
    if (item.kind === "letter" || item.kind === "document") {
      return (
        <div className={styles.bubble}>
          {item.body.trim() ? (
            <p className={styles.letterBody}>{item.body}</p>
          ) : (
            <p className={styles.memo}>No message body</p>
          )}
          {cards}
        </div>
      );
    }
    if (cards) return cards;
    return (
      <div className={styles.bubble}>
        <p className={styles.memo}>{item.preview}</p>
        {item.body.trim() ? (
          <p className={styles.letterBody}>{item.body}</p>
        ) : null}
      </div>
    );
  }

  return (
    <ol className={styles.timeline} aria-label={`Conversation with ${name}`}>
      {conversation.items.map((item) => {
        const time = fullTime(item.at);
        return (
          <li
            key={item.id}
            id={chatEntryDomId(item.id)}
            className={styles.entry}
            data-direction={item.direction}
            data-highlight={highlightId === item.id ? "true" : undefined}
          >
            <div className={styles.entryMeta}>
              <b>{item.direction === "outgoing" ? "You" : name}</b>
              <span>{item.label}</span>
              <time dateTime={time.dateTime}>{time.label}</time>
              <span>{provenanceLabel(item)}</span>
              {item.otherRecipients ? (
                <span>
                  +{item.otherRecipients} other recipient
                  {item.otherRecipients === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {renderContent(item)}
          </li>
        );
      })}
    </ol>
  );
}
