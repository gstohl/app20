import {
  rfqHasFundingEvidence,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

const OPEN_REQUEST_STATES = new Set([
  "requesting",
  "quoted",
  "reviewing",
  "submission-unknown",
  "funded",
  "cancel-pending",
  "expired",
  "quarantined",
]);

export function sameMarketRequestFence(
  records: readonly RfqLifecycleRecord[],
  pairId: string,
): string | undefined {
  const blocked = records.some((record) => {
    if (
      record.state === "quarantined" &&
      (!record.terms?.pairId || !record.requestDigest)
    )
      return true;
    if (record.terms?.pairId !== pairId) return false;
    if (
      record.recoverySource === "server-derived" &&
      record.terms.minBuyAmount === undefined &&
      record.state !== "settled" &&
      record.state !== "refunded"
    )
      return true;
    const release = record.attempts["reservation-release"];
    return (
      (OPEN_REQUEST_STATES.has(record.state) &&
        !(record.state === "expired" && rfqHasFundingEvidence(record))) ||
      release?.state === "preparing" ||
      release?.state === "wallet-boundary-unknown" ||
      release?.state === "submitted-unknown"
    );
  });
  return blocked
    ? "An earlier request or reservation release for this market is unresolved. Open Active and verify/release it before starting another RFQ."
    : undefined;
}
