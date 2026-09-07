import styles from "./chat.module.css";

export default function ChatSyncStatus({ scanning, lastCheckedAt, error, onRefresh }: {
  scanning: boolean;
  lastCheckedAt: number | null;
  error: boolean;
  onRefresh: () => void;
}) {
  return <div className={styles.syncBar}>
    <div>
      <span role="status">{scanning ? "Checking messages…" : error ? "Couldn’t update · retrying automatically" : "Updates every 60 seconds"}</span>
      {lastCheckedAt ? <small>Last checked <time dateTime={new Date(lastCheckedAt).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(lastCheckedAt)}</time></small> : null}
    </div>
    <button type="button" aria-label="Check for new messages" title="Check now · no wallet approval or gas" disabled={scanning} onClick={onRefresh}>Refresh</button>
  </div>;
}
