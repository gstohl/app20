"use client";
import { useEffect, useRef } from "react";
import { rfqCountdownView } from "./ui/rfq-countdown-view";
import { useRfqPresentationClock } from "./ui/rfq-presentation-clock";

export default function RfqCountdown({
  expiresAt,
  onExpire,
  now,
}: {
  expiresAt: number;
  onExpire?: () => void;
  now?: number;
}) {
  const clock = useRfqPresentationClock(now === undefined);
  const current = now ?? clock;
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const view = rfqCountdownView(expiresAt, current);

  useEffect(() => {
    expiredRef.current = false;
  }, [expiresAt]);

  useEffect(() => {
    if (view.remaining === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current?.();
    }
  }, [expiresAt, view.remaining]);

  return (
    <span role="timer" aria-live={view.ariaLive}>
      {view.iso} · {view.label}
    </span>
  );
}
