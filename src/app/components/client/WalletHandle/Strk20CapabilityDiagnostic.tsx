"use client";

import { useId, useState } from "react";
import {
  formatStrk20CapabilityDiagnostic,
  MIN_STRK20_WALLET_API,
  STRK20_REQUIRED_ACCOUNT_METHODS,
  type Strk20Capability,
} from "@/lib/strk20";
import styles from "../../../uni.module.css";

type CopyState = "idle" | "copied" | "error";

function declaredVersions(values: string[]): string {
  return values.length ? JSON.stringify(values) : "[] (none declared)";
}

export default function Strk20CapabilityDiagnostic({
  capability,
  compact = false,
}: {
  capability: Strk20Capability;
  compact?: boolean;
}) {
  const headingId = useId();
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function copyDiagnostic() {
    try {
      await navigator.clipboard.writeText(
        formatStrk20CapabilityDiagnostic(capability),
      );
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section
      className={`${styles.capabilityDiagnostic} ${
        compact ? styles.capabilityDiagnosticCompact : ""
      }`}
      aria-labelledby={headingId}
    >
      <div className={styles.capabilityDiagnosticHeading}>
        <div>
          <strong id={headingId}>Dapp privacy API not available</strong>
          <p>
            {capability.walletName} connected for account access, but Mail
            will keep privacy and mail actions disabled. In-wallet privacy is
            not the same as the dapp-facing STRK20 Wallet API.
          </p>
        </div>
        <button type="button" onClick={copyDiagnostic}>
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy failed"
              : "Copy diagnostic"}
        </button>
      </div>

      <dl className={styles.capabilityFacts}>
        <div>
          <dt>Wallet</dt>
          <dd>{capability.walletName}</dd>
        </div>
        <div>
          <dt>Wallet Standard version</dt>
          <dd>{capability.walletVersion ?? "Not exposed"}</dd>
        </div>
        <div>
          <dt>Required</dt>
          <dd>Wallet API/spec ≥ {MIN_STRK20_WALLET_API}</dd>
        </div>
        <div>
          <dt>Version gate</dt>
          <dd>{capability.versionSupported ? "Met" : "Not met"}</dd>
        </div>
        <div className={styles.capabilityFactWide}>
          <dt>walletApiVersions</dt>
          <dd>
            <code>{declaredVersions(capability.walletApiVersions)}</code>
          </dd>
        </div>
        <div className={styles.capabilityFactWide}>
          <dt>specVersions</dt>
          <dd>
            <code>{declaredVersions(capability.specVersions)}</code>
          </dd>
        </div>
        {STRK20_REQUIRED_ACCOUNT_METHODS.map((method) => (
          <div key={method} className={styles.capabilityFactWide}>
            <dt>{method}</dt>
            <dd>
              <code>
                {capability.accountMethods[method] ? "present" : "missing"}
              </code>
            </dd>
          </div>
        ))}
      </dl>

      {capability.versionSupported ? null : (
        <p className={styles.capabilityReason}>
          No declared API/spec version satisfies ≥ {MIN_STRK20_WALLET_API}.
          The wallet may not implement dapp-facing STRK20 yet.
        </p>
      )}
      {capability.missingMethods.length ? (
        <p className={styles.capabilityReason}>
          Missing connected-account method
          {capability.missingMethods.length === 1 ? "" : "s"}: {" "}
          <code>{capability.missingMethods.join(", ")}</code>.
        </p>
      ) : null}
      {capability.declarationErrors.walletApi ? (
        <p className={styles.capabilityQueryError}>
          walletApiVersions query failed: {capability.declarationErrors.walletApi}
        </p>
      ) : null}
      {capability.declarationErrors.specs ? (
        <p className={styles.capabilityQueryError}>
          specVersions query failed: {capability.declarationErrors.specs}
        </p>
      ) : null}

      <p className={styles.capabilityHelp}>
        Wallets such as {" "}
        <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
          Ready
        </a>{" "}
        and {" "}
        <a href="https://www.xverse.app/" target="_blank" rel="noreferrer">
          Xverse
        </a>{" "}
        can appear in the picker. Availability still depends on what the
        installed version declares and exposes to dapps.
      </p>
      <span className={styles.capabilityCopyStatus} aria-live="polite">
        {copyState === "copied"
          ? "Capability diagnostic copied."
          : copyState === "error"
            ? "Clipboard access failed. The values above remain selectable."
            : ""}
      </span>
    </section>
  );
}
