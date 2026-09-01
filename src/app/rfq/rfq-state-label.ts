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

const V3_LABELS: Readonly<Record<RfqLifecycleState, string>> = Object.freeze({
  ...LABELS,
  requesting: "Asking makers to lock",
  quoted: "Locked quotes received",
  reviewing: "Ready for final Take review",
  "submission-unknown": "Take outcome unknown",
  settled: "Received atomically (locally observed)",
  refused: "No executable locked quote",
});

export function rfqStateLabel(
  state: RfqLifecycleState,
  mode: "v2" | "v3" = "v2",
): string {
  return mode === "v3" ? V3_LABELS[state] : LABELS[state];
}

export function rfqStateLabelForRecord(input: {
  state: RfqLifecycleState;
  mode: "v2" | "v3";
}): string {
  return rfqStateLabel(input.state, input.mode);
}
