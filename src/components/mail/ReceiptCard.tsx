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
        <span className={styles.sheetType}>PRIVATE TRANSFER RECEIPT</span>
        <span className={styles.proofStamp}>Paid</span>
      </div>
      <p className={styles.termsSentence}>
        Deal {receipt.dealId.slice(0, 12)}… closed; the {amount}{" "}
        {receipt.transfer.token.symbol} leg landed in transaction {receipt.txHash}.
      </p>
      <p className={styles.riskCopy}>
        The {wantSymbol} leg was never on this rail. Quietline has no proof that
        the counterparty paid it, and this is not an atomic swap.
      </p>
      <p className={styles.receiptWarning}>
        Receipt warning: <strong>{receipt.warning}</strong>
      </p>
      <code className={styles.fullHash}>{receipt.txHash}</code>
    </article>
  );
}
