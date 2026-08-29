import type { RfqLifecycleState } from "./rfq-lifecycle";

const LABELS: Readonly<Record<RfqLifecycleState, string>> = Object.freeze({
  draft: "Draft",
  requesting: "Asking makers",
  quoted: "Quotes received",
  reviewing: "Awaiting your review",
  "submission-unknown": "Funding outcome unknown",
  funded: "Funded · waiting for the maker",
  filled: "Maker filled",
  claimable: "Ready to claim",
  settled: "Received (locally observed)",
  expired: "Expired",
  refundable: "Ready to refund",
  refunded: "Refunded (locally observed)",
  refused: "No maker took it",
  "cancel-pending": "Cancelling",
  cancelled: "Cancelled",
  reorged: "Reorg-invalidated",
  quarantined: "Quarantined",
});

export function rfqStateLabel(state: RfqLifecycleState): string {
  return LABELS[state];
}
