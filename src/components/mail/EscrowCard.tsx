import { canonicalizeStarknetAddress } from "@/lib/addresses";
import {
  formatBaseUnits,
  normalizeTokenRef,
} from "@/lib/otc";
import type {
  EscrowContractStatus,
  EscrowFundPayload,
} from "@/lib/escrow";
import { ProvingProgress } from "./OperationProgress";
import styles from "./mail.module.css";

type EscrowCardProps = {
  fund: EscrowFundPayload;
  status?: EscrowContractStatus;
  termsVerified?: boolean;
  ownDeal?: boolean;
  busy?: boolean;
  actionMessage?: string;
  actionStartedAt?: number;
  onFill?: () => void;
  /** Present only for a compiler that can sign after creating the payout note. */
  onClaim?: () => void;
  /** Present only for a compiler that can sign after creating the payout note. */
  onTimeout?: () => void;
};

const STATUS_LABELS: Record<EscrowContractStatus, string> = {
  empty: "Not funded on-chain",
  funded: "Leg A held by contract",
  filled: "Filled · maker claim pending",
  settled: "Settled on-chain",
  timed_out: "Maker refunded on-chain",
};

function expiryLabel(deadline: number): string {
  return `Deadline ${new Date(deadline * 1_000).toLocaleString()}`;
}

export default function EscrowCard({
  fund,
  status,
  termsVerified = false,
  ownDeal = false,
  busy = false,
  actionMessage,
  actionStartedAt,
  onFill,
  onClaim,
  onTimeout,
}: EscrowCardProps) {
  const legAToken = normalizeTokenRef(fund.legA.token);
  const legBToken = normalizeTokenRef(fund.legB.token);
  const legAAmount = formatBaseUnits(fund.legA.amount, legAToken.decimals);
  const legBAmount = formatBaseUnits(fund.legB.amount, legBToken.decimals);
  const expired = fund.deadline <= Math.floor(Date.now() / 1_000);
  const canFill = status === "funded" && termsVerified && !expired && !ownDeal;
  const payoutNeedsCompatibleWallet =
    ownDeal && (status === "filled" || (status === "funded" && expired));

  return (
    <article className={`${styles.messageSheet} ${styles.dealSheet}`}>
      <div className={styles.sheetHeading}>
        <span className={styles.sheetType}>OTC ESCROW / CONTRACT-BACKED</span>
        <span className={styles.proofStamp}>
          {status ? STATUS_LABELS[status] : "Checking contract state"}
        </span>
      </div>

      <p className={styles.termsSentence}>
        The maker deposits <strong>{legAAmount} <bdi>{legAToken.symbol}</bdi></strong>{" "}
        as leg A. The taker must deposit at least <strong>{legBAmount}{" "}
        <bdi>{legBToken.symbol}</bdi></strong> as leg B before the contract releases
        leg A to the taker.
      </p>

      <div className={styles.addressProof}>
        <strong>QuietlineEscrow contract</strong>
        <code>{canonicalizeStarknetAddress(fund.escrowAddress)}</code>
        <strong>Claimed maker address · unauthenticated</strong>
        <code>{canonicalizeStarknetAddress(fund.maker)}</code>
        <span>Deal {fund.dealId.slice(0, 14)}…</span>
      </div>

      <p className={styles.riskCopy}>
        Unlike Quietline&apos;s one-sided v1 deals, settlement does not rely only
        on an accept memo: the contract will not let the taker take leg A
        without depositing leg B. <strong>This is not a single-transaction atomic
        swap.</strong> Fill releases leg A first; the maker claims leg B afterward
        with a destination-bound signature.
      </p>
      <p className={styles.actionWarning}>
        Escrow withdrawals into the contract, contract events, and OPEN-note
        payouts expose token amounts publicly. Escrow stays off the mainnet
        scoring path until reviewed.
      </p>
      <p className={styles.sheetMeta}>{expiryLabel(fund.deadline)}</p>
      <p className={styles.authWarning}>
        The maker address is an unauthenticated envelope claim and is not stored
        by the contract. The per-deal claim public key and settlement terms are
        what Quietline verifies on-chain.
      </p>
      {fund.note ? (
        <p className={styles.offerNote}>
          <bdi>{fund.note}</bdi>
        </p>
      ) : null}

      {!termsVerified && status && status !== "empty" ? (
        <p className={styles.actionWarning}>
          Quietline refused to match this encrypted announcement to the contract
          terms. Do not fill it.
        </p>
      ) : null}
      {status === "empty" ? (
        <p className={styles.actionWarning}>
          No matching Fund exists at this contract. This encrypted announcement
          alone does not prove that leg A moved.
        </p>
      ) : null}
      {status ? null : (
        <p className={styles.actionWarning}>
          The message is an unauthenticated coordination payload until the deal
          is read from QuietlineEscrow.
        </p>
      )}
      {expired && status === "funded" ? (
        <p className={styles.actionWarning}>
          The fill deadline passed. The contract no longer accepts Fill.
        </p>
      ) : null}

      {canFill && onFill ? (
        <button
          className={styles.primaryButton}
          type="button"
          onClick={onFill}
          disabled={busy}
        >
          {busy
            ? "Waiting for wallet…"
            : `Deposit ${legBAmount} ${legBToken.symbol} & receive leg A`}
        </button>
      ) : null}

      {ownDeal && status === "filled" && onClaim ? (
        <button
          className={styles.primaryButton}
          type="button"
          onClick={onClaim}
          disabled={busy}
        >
          {busy ? "Preparing claim…" : `Claim ${legBToken.symbol} leg`}
        </button>
      ) : null}
      {ownDeal && status === "funded" && expired && onTimeout ? (
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onTimeout}
          disabled={busy}
        >
          {busy ? "Preparing refund…" : `Refund ${legAToken.symbol} leg`}
        </button>
      ) : null}

      {payoutNeedsCompatibleWallet &&
      ((status === "filled" && !onClaim) ||
        (status === "funded" && expired && !onTimeout)) ? (
        <p className={styles.actionWarning}>
          {status === "filled" ? "Claiming" : "Refunding"} is unavailable through
          this wallet. The signature must bind the payout note, and the Wallet
          API does not expose that note before it assembles the transaction.
          Funds are not lost: they remain claimable once a compatible signing
          path exists.
        </p>
      ) : null}

      <ProvingProgress
        active={busy}
        startedAt={actionStartedAt}
        label="Preparing contract-backed escrow action"
      />
      {actionMessage ? (
        <p className={styles.inlineStatus} role="status">
          {actionMessage}
        </p>
      ) : null}
    </article>
  );
}
