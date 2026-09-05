import { MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE } from "@/lib/mail-authority-copy";
import type { BackupKind } from "@/lib/backup-snapshot";
import styles from "./mail.module.css";

type ContactSnapshotCardProps = {
  kind?: BackupKind;
  pointer?: boolean;
  onMerge?: () => void;
  busy?: boolean;
};

export default function ContactSnapshotCard({
  kind = "contacts",
  pointer = false,
  onMerge,
  busy = false,
}: ContactSnapshotCardProps) {
  const contacts = kind === "contacts";
  const label = contacts
    ? "Encrypted contact backup"
    : "Encrypted RFQ history backup";
  return (
    <article className={styles.messageSheet} aria-label={label}>
      <div className={styles.sheetHeading}>
        <h3 className={styles.sheetType}>
          {contacts ? "CONTACT BACKUP" : "RFQ HISTORY BACKUP"}
        </h3>
        <span className={styles.proofStamp}>
          Self-mail · verify before restore
        </span>
      </div>
      <p className={styles.termsSentence}>
        This encrypted letter contains a versioned{" "}
        {contacts ? "address-book" : "RFQ resume"} snapshot scoped to one
        wallet, network, Mail helper, and mailbox key.
        {pointer
          ? " The encrypted snapshot bytes are stored outside Mail. Only owner-MAC-authenticated pointers are accepted and CID-verified before decryption; older pointers without a valid MAC are ignored."
          : ""}
      </p>
      <p className={styles.riskCopy}>
        Connect the same wallet and restore the mailbox recovery phrase first.
        The wallet identifies the mailbox; it cannot decrypt this backup by
        itself. {MAIL_RECOVERY_PHRASE_AUTHORITY_NOTICE} Mail is evidence and
        storage, never settlement authority.
      </p>
      {onMerge ? (
        <div className={styles.sheetActions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy}
            onClick={onMerge}
          >
            {contacts
              ? "Merge verified contacts"
              : "Merge verified RFQ history"}
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
