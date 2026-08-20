import styles from "./mail.module.css";

type ContactSnapshotCardProps = {
  onMerge?: () => void;
  busy?: boolean;
};

export default function ContactSnapshotCard({
  onMerge,
  busy = false,
}: ContactSnapshotCardProps) {
  return (
    <article
      className={styles.messageSheet}
      aria-label="Encrypted contact backup"
    >
      <div className={styles.sheetHeading}>
        <h3 className={styles.sheetType}>CONTACT BACKUP</h3>
        <span className={styles.proofStamp}>
          Self-mail · verify before restore
        </span>
      </div>
      <p className={styles.termsSentence}>
        This encrypted letter contains a versioned address-book snapshot scoped
        to one wallet, network, Mail helper, and mailbox key.
      </p>
      <p className={styles.riskCopy}>
        Connect the same wallet and restore the mailbox recovery phrase first.
        The wallet identifies the mailbox; it cannot decrypt contacts by itself.
        Mail is evidence and storage, never settlement authority.
      </p>
      {onMerge ? (
        <div className={styles.sheetActions}>
          <button type="button" disabled={busy} onClick={onMerge}>
            Merge verified contacts
          </button>
        </div>
      ) : (
        <p className={styles.actionWarning}>
          Unlock the mailbox to verify and restore this snapshot.
        </p>
      )}
    </article>
  );
}
