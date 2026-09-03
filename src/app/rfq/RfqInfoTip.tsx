"use client";

import { useId, type ReactNode } from "react";
import styles from "./rfq.module.css";

export type RfqInfoTipProps = Readonly<{
  label: string;
  children: ReactNode;
  indicator?: ReactNode;
}>;

export default function RfqInfoTip({
  label,
  children,
  indicator = "i",
}: RfqInfoTipProps) {
  const descriptionId = useId();

  return (
    <span className={styles.infoTip}>
      <button
        type="button"
        className={styles.infoTipButton}
        aria-label={label}
        aria-describedby={descriptionId}
      >
        {indicator}
      </button>
      <span id={descriptionId} className={styles.infoTipBubble} role="tooltip">
        {children}
      </span>
    </span>
  );
}
