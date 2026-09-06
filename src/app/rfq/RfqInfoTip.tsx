"use client";

import { useId, useState, type ReactNode } from "react";
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
  const [dismissed, setDismissed] = useState(false);

  return (
    <span className={styles.infoTip} data-dismissed={dismissed}
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setDismissed(true); event.stopPropagation(); }
      }}
    >
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
