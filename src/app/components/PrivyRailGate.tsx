import { useWalletMode } from "@/app/rfq/walletMode";
import type { ReactNode } from "react";

export default function PrivyRailGate({ children }: { children: ReactNode }) {
  const mode = useWalletMode((state) => state.mode);
  const setMode = useWalletMode((state) => state.setMode);

  if (mode === "privy") return children;

  return (
    <main className="rail-gate-page">
      <section className="panel-frame rail-gate-card" aria-labelledby="privy-rail-gate-title">
        <p>APP20 / EXPLICIT ACCOUNT TRANSITION</p>
        <h1 id="privy-rail-gate-title">Recovery requires the Privy rail.</h1>
        <span>
          The active APP20 account rail is Ready. Recovery will not silently operate a
          separately connected Privy wallet or expose its export flow.
        </span>
        <dl>
          <div><dt>Selected rail</dt><dd>Ready Wallet Standard</dd></div>
          <div><dt>Required rail</dt><dd>Sepolia / Privy</dd></div>
          <div><dt>Effect of switching</dt><dd>No transaction; account context changes</dd></div>
        </dl>
        <button type="button" onClick={() => setMode("privy")}>Switch explicitly to Privy</button>
      </section>
    </main>
  );
}
