"use client";

import { useEffect, useState } from "react";
import styles from "./mail.module.css";

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useElapsedSeconds(active: boolean, startedAt?: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  if (!active || startedAt === undefined) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1_000));
}

export function ProvingProgress({
  active,
  startedAt,
  label = "Preparing privacy proof",
}: {
  active: boolean;
  startedAt?: number;
  label?: string;
}) {
  const elapsed = useElapsedSeconds(active, startedAt);
  if (!active) return null;

  return (
    <div className={styles.provingProgress} aria-busy="true">
      <div className={styles.progressHeading}>
        <span role="status" aria-live="polite">
          {label}
        </span>
        <span className={styles.progressTime} aria-hidden="true">
          {formatElapsed(elapsed)} elapsed
        </span>
      </div>
      <div className={styles.progressTrack} aria-hidden="true">
        <span />
      </div>
      <p>
        Indeterminate: elapsed time is not completion percentage. The wallet
        may spend 30 seconds or longer proving; after a hash appears, Quietline
        waits separately for successful execution.
      </p>
    </div>
  );
}

export function ScanProgress({
  scanning,
  pages,
  maxPages,
  events,
}: {
  scanning: boolean;
  pages: number;
  maxPages: number;
  events: number;
}) {
  const [startedAt, setStartedAt] = useState<number>();

  useEffect(() => {
    if (scanning) setStartedAt(Date.now());
    else setStartedAt(undefined);
  }, [scanning]);

  const elapsed = useElapsedSeconds(scanning, startedAt);
  if (!scanning) return null;

  const progress = Math.min(100, (Math.max(0.25, pages) / maxPages) * 100);
  return (
    <div className={styles.scanProgress} aria-busy="true">
      <div className={styles.progressHeading}>
        <span role="status" aria-live="polite">
          Checking sealed envelopes
        </span>
        <span className={styles.progressTime} aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
      </div>
      <div className={styles.envelopeProgress} aria-hidden="true">
        <span style={{ width: `${progress}%` }}>✉ ✉ ✉</span>
      </div>
      <p>
        Page {Math.max(1, pages)} of at most {maxPages} · {events} public sealed
        record{events === 1 ? "" : "s"} checked so far
      </p>
    </div>
  );
}
