import {
  formatBaseUnits,
  type ReceiptPayload,
} from "@/lib/otc";
import styles from "./mail.module.css";

type ReceiptCardProps = {
  receipt: ReceiptPayload;
  wantSymbol?: string;
};

export default function ReceiptCard({
  receipt,
  wantSymbol = "quoted token",
}: ReceiptCardProps) {
  const amount = formatBaseUnits(
    receipt.transfer.amount,
    receipt.transfer.token.decimals,
  );

  return (
    <article className={styles.messageSheet}>
      <div className={styles.sheetHeading}>
        <span className={styles.sheetType}>PRIVATE TRANSFER CLAIM</span>
        <span className={styles.proofStamp}>Unverified counterparty claim</span>
      </div>
      <p className={styles.termsSentence}>
        A counterparty claims the {amount} <bdi>{receipt.transfer.token.symbol}</bdi>{" "}
        leg for deal {receipt.dealId.slice(0, 12)}… used transaction {receipt.txHash}.
      </p>
      <p className={styles.riskCopy}>
        This encrypted receipt and its MessagePosted transaction do not prove a
        transfer. Verify the STRK payment independently before releasing the{" "}
        <bdi>{wantSymbol}</bdi> leg; this is not an atomic swap.
      </p>
      <p className={styles.receiptWarning}>
        Counterparty claim warning: <strong>{receipt.warning}</strong>
      </p>
      <code className={styles.fullHash}>{receipt.txHash}</code>
    </article>
  );
}
