import styles from "./rfq.module.css";

export default function RfqEnvironmentBanner({
  providerIndex,
  runtimeEpoch,
}: {
  providerIndex: number;
  runtimeEpoch?: string;
}) {
  const copy =
    providerIndex === 3
      ? "LOCALNET DEMO"
      : providerIndex === 2
        ? "SEPOLIA RFQ DISABLED"
        : "MAINNET RFQ DISABLED";
  const shortEpoch =
    runtimeEpoch && /^[0-9a-f]{32}$/.test(runtimeEpoch)
      ? runtimeEpoch.slice(0, 8)
      : undefined;
  return (
    <aside
      className={styles.environmentBanner}
      role="status"
      aria-label="RFQ environment"
    >
      <strong>{copy}</strong>
      {providerIndex === 3 && shortEpoch ? (
        <>
          <span>Runtime {shortEpoch}</span>
          <span className={styles.environmentDetail}>
            A restarted local chain rotates this ID; prior-runtime records are
            intentionally isolated.
          </span>
        </>
      ) : null}
      <span>No automatic public fallback</span>
    </aside>
  );
}
