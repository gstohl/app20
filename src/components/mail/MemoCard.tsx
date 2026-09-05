import { formatBaseUnits, type AcceptPayload, type DeclinePayload } from "@/lib/otc";
import styles from "./mail.module.css";

export type MemoCardProps =
  | { kind: "accept"; accept: AcceptPayload; isPayment: boolean }
  | { kind: "decline"; decline: DeclinePayload }
  | {
      kind: "escrow";
      operation: "fill" | "claim" | "timeout";
      update: { dealId: string };
    };

/**
 * A counterparty's answer to a deal: an accept or payment memo, a decline,
 * or an escrow notice. Each is a coordination claim carried by encrypted
 * mail, never proof that value moved or that a contract changed state.
 */
export default function MemoCard(props: MemoCardProps) {
  if (props.kind === "accept") {
    const { accept, isPayment } = props;
    const amount = formatBaseUnits(
      accept.transfer.amount,
      accept.transfer.token.decimals,
    );
    return (
      <article
        className={styles.messageSheet}
        aria-label={`${isPayment ? "Payment memo" : "OTC accept memo"}: ${amount} ${accept.transfer.token.symbol}`}
      >
        <div className={styles.sheetHeading}>
          <h3 className={styles.sheetType}>
            {isPayment ? "PAYMENT MEMO" : "OTC ACCEPT MEMO"}
          </h3>
          <span className={styles.proofStamp}>Unverified counterparty claim</span>
        </div>
        <p className={styles.termsSentence}>
          A counterparty claims they sent {amount}{" "}
          <bdi>{accept.transfer.token.symbol}</bdi> for{" "}
          {isPayment ? "request" : "deal"} {accept.dealId.slice(0, 12)}…
        </p>
        <p className={styles.riskCopy}>
          This decrypted memo and its MessagePosted transaction do not prove
          that value moved. Verify settlement independently before releasing
          any quoted consideration.
        </p>
      </article>
    );
  }
  if (props.kind === "decline") {
    const { decline } = props;
    return (
      <article
        className={styles.messageSheet}
        aria-label={`OTC response: deal ${decline.dealId.slice(0, 12)} declined`}
      >
        <div className={styles.sheetHeading}>
          <h3 className={styles.sheetType}>OTC RESPONSE</h3>
          <span className={styles.proofStamp}>Declined</span>
        </div>
        <p className={styles.termsSentence}>
          Deal {decline.dealId.slice(0, 12)}… was declined.
        </p>
        {decline.reason ? (
          <p className={styles.offerNote}>
            <bdi>{decline.reason}</bdi>
          </p>
        ) : null}
      </article>
    );
  }
  const { operation, update } = props;
  const label = operation.toUpperCase();
  return (
    <article
      className={styles.messageSheet}
      aria-label={`Escrow ${operation} notice for deal ${update.dealId.slice(0, 12)}`}
    >
      <div className={styles.sheetHeading}>
        <h3 className={styles.sheetType}>ESCROW {label} NOTICE</h3>
        <span className={styles.proofStamp}>Unverified coordination memo</span>
      </div>
      <p className={styles.termsSentence}>
        A counterparty posted an encrypted {operation} notice for deal{" "}
        {update.dealId.slice(0, 12)}…
      </p>
      <p className={styles.riskCopy}>
        This message does not prove a state transition. The escrow contract is
        read before another asset action is offered.
      </p>
    </article>
  );
}
