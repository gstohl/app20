"use client";

import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import PrivacyWalletMenu from "@/components/mail/PrivacyWalletMenu";

export default function VaultPage() {
  const connected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const chain = useStoreWallet((state) => state.chain);
  const capable = useStoreWallet((state) => state.isStrk20Capable);

  return (
    <main className="vault-page">
      <header className="vault-intro">
        <p>VLT20 / PRIVACY VAULT</p>
        <h1>One wallet. Two rails.</h1>
        <span>
          Move STRK between your public account and shielded wallet using the
          existing Wallet Standard privacy controls. No note-level data is
          inferred or displayed here.
        </span>
      </header>

      <div className="vault-grid">
        <section className="vault-public panel-frame" aria-labelledby="public-rail-title">
          <div className="panel-heading">
            <span>PUBLIC RAIL</span>
            <strong id="public-rail-title">Connected account</strong>
          </div>
          <div className="vault-state">
            <span className={`rail-indicator ${connected ? "is-live" : ""}`} aria-hidden="true" />
            <div>
              <small>{connected ? "WALLET STANDARD CONNECTED" : "CONNECTION REQUIRED"}</small>
              <strong>{address || "No public account"}</strong>
              <p>
                {chain || "Select a supported Starknet network."} · Public STRK
                balance and live pool fees are verified during Shield and
                Unshield preflight; VLT20 does not fabricate a cached balance.
              </p>
            </div>
          </div>
          <div className="rail-facts">
            <span><b>Shield entry</b>Public transaction</span>
            <span><b>Unshield exit</b>Public transaction</span>
            <span><b>Privacy API</b>{capable ? "Available" : "Not available"}</span>
          </div>
        </section>

        <section className="vault-private panel-frame" aria-labelledby="shielded-rail-title">
          <div className="panel-heading">
            <span>SHIELDED RAIL</span>
            <strong id="shielded-rail-title">Private wallet state</strong>
          </div>
          <PrivacyWalletMenu />
        </section>
      </div>
    </main>
  );
}
