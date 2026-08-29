"use client";

import { useState } from "react";
import styles from "./rfq.module.css";

export const LOCAL_IDENTIFIER_AUTHORITY =
    "Local reference · not settlement authority" as const;
export const LOCALNET_VERIFIED_IDENTIFIER_AUTHORITY =
    "Localnet chain-verified value · same-devnet fixture only" as const;

function shorten(value: string): string {
    return value.length > 22
        ? `${value.slice(0, 12)}…${value.slice(-8)}`
        : value;
}

export default function CopyableId({
    value,
    label,
    authority = LOCAL_IDENTIFIER_AUTHORITY,
}: {
    value: string;
    label: string;
    authority?:
        | typeof LOCAL_IDENTIFIER_AUTHORITY
        | typeof LOCALNET_VERIFIED_IDENTIFIER_AUTHORITY;
}) {
    const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
        "idle",
    );
    const short = shorten(value);
    const accessibleName = `Copy ${label} ${value}; authority: ${authority}`;
    return (
        <span className={styles.copyableId}>
            <span>{label}: </span>
            <code title={value} aria-label={`${label} ${value}`}>
                {short}
            </code>{" "}
            <small>Authority: {authority}</small>{" "}
            <button
                type="button"
                aria-label={accessibleName}
                onClick={() => {
                    void navigator.clipboard.writeText(value).then(
                        () => setCopyState("copied"),
                        () => setCopyState("failed"),
                    );
                }}
            >
                Copy {label} {short}
            </button>
            <span aria-live="polite">
                {copyState === "copied"
                    ? `${label} ${short} copied`
                    : copyState === "failed"
                      ? `${label} ${short} copy failed`
                      : ""}
            </span>
        </span>
    );
}
