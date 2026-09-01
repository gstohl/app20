"use client";

import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import styles from "./secondary-rail.module.css";

export function secondaryRailEnvironmentLabel(providerIndex: number): string {
      if (providerIndex === 0) return "MAINNET";
      if (providerIndex === 2) return "SEPOLIA";
      if (providerIndex === 3) return "LOCALNET DEMO";
      return "UNKNOWN NETWORK";
}

export default function SecondaryRailShell({
      boundary,
      title,
      summary,
      children,
}: {
      boundary: string;
      title: string;
      summary: string;
      children?: ReactNode;
}) {
      const providerIndex = useFrontendProvider(
            (state) => state.currentFrontendProviderIndex,
      );
      const address = useStoreWallet((state) => state.address);
      const environment = secondaryRailEnvironmentLabel(providerIndex);
      return (
            <main className={styles.rail}>
                  <header className={styles.railHeader}>
                        <p className={styles.railContext}>
                              <strong>{environment}</strong>
                              <span>{boundary}</span>
                              <span>Not RFQ settlement authority</span>
                              <span>
                                    {address
                                          ? `Account ${address.slice(0, 10)}…${address.slice(-6)}`
                                          : "No wallet connected"}
                              </span>
                        </p>
                        <h1>{title}</h1>
                        <p className={styles.railSummary}>{summary}</p>
                        <Link className={styles.railBack} to="/rfq">
                              ← Back to RFQ
                        </Link>
                  </header>
                  {children}
            </main>
      );
}
