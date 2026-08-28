"use client";
import { useEffect, useRef, useState } from "react";

export default function RfqCountdown({ expiresAt, onExpire }: { expiresAt: number; onExpire?: () => void }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    const tick = () => setNow(Math.floor(Date.now() / 1_000));
    tick();
    const delay = Math.max(0, 1_000 - (Date.now() % 1_000));
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 1_000);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [expiresAt]);

  const remaining = Math.max(0, expiresAt - now);
  useEffect(() => {
    if (remaining === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpire?.();
    }
  }, [onExpire, remaining]);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <span role="timer" aria-live={remaining === 0 || remaining === 60 ? "polite" : "off"}>
      {new Date(expiresAt * 1_000).toISOString()} · {remaining ? `${minutes}m ${seconds}s remaining` : "expired"}
    </span>
  );
}
