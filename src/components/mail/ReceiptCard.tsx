import {
  formatBaseUnits,
  type ReceiptPayload,
} from "@/lib/otc";
import styles from "./mail.module.css";

type ReceiptCardProps = {
  receipt: ReceiptPayload;
  wantSymbol?: string;
  standalonePayment?: boolean;
  locallySubmitted?: boolean;
};

export default function ReceiptCard({
  receipt,
  wantSymbol = "quoted token",
  standalonePayment = false,
  locallySubmitted = false,
}: ReceiptCardProps) {
  const amount = formatBaseUnits(
    receipt.transfer.amount,
    receipt.transfer.token.decimals,
  );

  return (
    <article className={styles.messageSheet}>
      <div className={styles.sheetHeading}>
        <span className={styles.sheetType}>
          {standalonePayment ? "PRIVATE PAYMENT MEMO" : "PRIVATE TRANSFER CLAIM"}
        </span>
        <span className={styles.proofStamp}>
          {locallySubmitted ? "Locally submitted" : "Unverified counterparty claim"}
        </span>
      </div>
      <p className={styles.termsSentence}>
        {locallySubmitted ? "This device submitted" : "A counterparty claims"} the{" "}
        {amount} <bdi>{receipt.transfer.token.symbol}</bdi>{" "}
        {standalonePayment ? "payment" : "leg"} in transaction {receipt.txHash}.
      </p>
      <p className={styles.riskCopy}>
        {locallySubmitted
          ? "The local sent copy reflects this wallet's confirmed submission, but it is not counterparty-verifiable public settlement proof."
          : "This encrypted memo and its MessagePosted transaction do not independently prove a private transfer. Verify payment independently."}
        {standalonePayment ? null : (
          <>
            {" "}Do not release the <bdi>{wantSymbol}</bdi> leg without
            verification; this is not an atomic swap.
          </>
        )}
      </p>
      {standalonePayment ? null : (
        <p className={styles.receiptWarning}>
          Counterparty claim warning: <strong>{receipt.warning}</strong>
        </p>
      )}
      <code className={styles.fullHash}>{receipt.txHash}</code>
    </article>
  );
}
