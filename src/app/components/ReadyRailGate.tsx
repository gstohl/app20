import { useWalletMode } from "@/app/rfq/walletMode";
import type { ReactNode } from "react";

type ReadyRailGateProps = {
  moduleName: string;
  children: ReactNode;
};

export default function ReadyRailGate({
  moduleName,
  children,
}: ReadyRailGateProps) {
  const mode = useWalletMode((state) => state.mode);
  const setMode = useWalletMode((state) => state.setMode);

  if (mode === "ready") return children;

  return (
    <main className="rail-gate-page">
      <section
        className="panel-frame rail-gate-card"
        aria-labelledby="rail-gate-title"
      >
        <p>APP20 / EXPLICIT ACCOUNT TRANSITION</p>
        <h1 id="rail-gate-title">{moduleName} requires the Ready rail.</h1>
        <span>
          The active APP20 account rail is Privy / Sepolia. This module has no
          reviewed Privy adapter, so APP20 will not silently fall back to a
          separately connected Ready account.
        </span>
        <dl>
          <div>
            <dt>Selected rail</dt>
            <dd>Sepolia / Privy</dd>
          </div>
          <div>
            <dt>Required rail</dt>
            <dd>Ready Wallet Standard</dd>
          </div>
          <div>
            <dt>Effect of switching</dt>
            <dd>No transaction; account context changes</dd>
          </div>
        </dl>
        <button type="button" onClick={() => setMode("ready")}>
          Switch explicitly to Ready
        </button>
        <small>
          Return to RFQ to review the selected account, network, signer, and
          available privacy capability before authorizing an operation.
        </small>
      </section>
    </main>
  );
}
