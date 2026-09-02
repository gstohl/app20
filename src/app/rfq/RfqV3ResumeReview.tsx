import { useEffect, useMemo, useRef, useState } from "react";
import RfqFinalReview, {
  type RfqFinalReviewV3DisplayTerms,
} from "./RfqFinalReview";
import {
  takeAuthorizationFromLifecycle,
  validateV3FinalReview,
  type RfqFinalReviewSnapshot,
} from "./rfq-final-review";
import type { RfqLifecycleRecord } from "./rfq-lifecycle";
import { readV3FinalReviewSnapshot } from "./ui/v3-take-controller";
import { useRfqPresentationClock } from "./ui/rfq-presentation-clock";

function displayTerms(
  record: RfqLifecycleRecord,
): RfqFinalReviewV3DisplayTerms {
  if (
    record.mode !== "v3" ||
    record.state !== "reviewing" ||
    !record.terms?.buyAmount ||
    !record.fills ||
    !record.requestDigest
  ) {
    throw new Error("The resumable RFQ v3 exact review is unavailable.");
  }
  return Object.freeze({
    mode: "v3",
    rfqId: record.rfqId,
    sellAddress: record.terms.sellAddress,
    exactSellAmount: BigInt(record.terms.sellAmount),
    buyAddress: record.terms.buyAddress,
    totalBuyAmount: BigInt(record.terms.buyAmount),
    floorBuyAmount: BigInt(record.terms.minBuyAmount ?? "0"),
    fills: Object.freeze(
      record.fills.map((fill) =>
        Object.freeze({
          makerId: fill.makerId,
          lockId: fill.lockId,
          amountA: BigInt(fill.amountA),
          amountB: BigInt(fill.amountB),
          lockExpiresAt: fill.lockExpiresAt,
        }),
      ),
    ),
    takeAuthorization: takeAuthorizationFromLifecycle(record),
    feeBps: 0,
    app20FeeAmount: 0n,
    sellSymbol: record.terms.sellSymbol,
    sellDecimals: record.terms.sellDecimals,
    buySymbol: record.terms.buySymbol,
    buyDecimals: record.terms.buyDecimals,
    requestDigest: record.requestDigest,
  });
}

export default function RfqV3ResumeReview({
  record,
  busy,
  operationBlocker,
  onAccept,
  onClose,
}: Readonly<{
  record: RfqLifecycleRecord;
  busy?: boolean;
  operationBlocker?: string;
  onAccept: (
    record: RfqLifecycleRecord,
    snapshot: RfqFinalReviewSnapshot,
  ) => void;
  onClose: () => void;
}>) {
  const [snapshot, setSnapshot] = useState<RfqFinalReviewSnapshot>();
  const [snapshotError, setSnapshotError] = useState<string>();
  const focusRef = useRef<HTMLElement>(null);
  const now = useRfqPresentationClock();
  const terms = useMemo(() => displayTerms(record), [record]);

  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    setSnapshotError(undefined);
    void readV3FinalReviewSnapshot(record)
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSnapshotError(
          error instanceof Error
            ? error.message
            : "Fresh private balance is unavailable.",
        );
      });
    const frame = window.requestAnimationFrame(() => focusRef.current?.focus());
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [record]);

  const blockers = useMemo(() => {
    const items = operationBlocker ? [operationBlocker] : [];
    if (!snapshot) {
      items.push(snapshotError ?? "Reading a fresh private sell balance…");
      return Object.freeze(items);
    }
    return Object.freeze([
      ...items,
      ...validateV3FinalReview({
        initial: snapshot,
        current: snapshot,
        terms,
        now,
      }).blockers,
    ]);
  }, [now, operationBlocker, snapshot, snapshotError, terms]);

  return (
    <RfqFinalReview
      terms={terms}
      snapshot={snapshot}
      blockers={blockers}
      disabled={busy || !snapshot}
      declineDisabled={busy}
      declineLabel="Return to active RFQs"
      onAccept={() => {
        if (snapshot) onAccept(record, snapshot);
      }}
      onDecline={onClose}
      focusRef={focusRef}
    />
  );
}
