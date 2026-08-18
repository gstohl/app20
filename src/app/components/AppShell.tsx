import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { LocalnetToolsContext } from "@/app/localnetToolsContext";
import { useVaultMode } from "@/app/vault/vaultMode";
import type { ReactNode } from "react";

type AppShellProps = {
  renderLocalnetTools: (() => ReactNode) | null;
};

function shortAddress(address: string): string {
  return address.length > 14
    ? `${address.slice(0, 7)}…${address.slice(-5)}`
    : address;
}

export default function AppShell({ renderLocalnetTools }: AppShellProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const readyConnected = useStoreWallet((state) => state.isConnected);
  const readyAddress = useStoreWallet((state) => state.address);
  const readyChain = useStoreWallet((state) => state.chain);
  const vaultMode = useVaultMode((state) => state.mode);
  const privyConnected = useVaultMode((state) => state.privyConnected);
  const privyAddress = useVaultMode((state) => state.privyAddress);
  const mailActive = pathname.startsWith("/mail") || pathname === "/inbox";
  const intentsActive = pathname.startsWith("/intents");
  const workflowsActive = pathname.startsWith("/workflows");
  const usingPrivy = vaultMode === "privy";
  const connected = usingPrivy ? privyConnected : readyConnected;
  const address = usingPrivy ? privyAddress : readyAddress;
  const chain = usingPrivy ? "SEPOLIA / PRIVY" : readyChain;

  return (
    <LocalnetToolsContext.Provider value={renderLocalnetTools}>
      <div className="app-shell">
        <a className="skip-link" href="#route-content">
          Skip to route content
        </a>
        <div className="signal-bar">
          <span
            className={`signal-dot ${connected ? "is-live" : ""}`}
            aria-hidden="true"
          />
          {connected ? "WALLET CONNECTED" : "APP20 PRIVATE WORKSPACE"}
          <span>PUBLIC BOUNDARIES REMAIN CORRELATABLE</span>
        </div>
        <header className="app-header">
          <Link className="app-brand" to="/vault" aria-label="APP20 private superapp">
            <span>APP</span><b>[20]</b>
          </Link>
          <nav className="app-tabs" aria-label="APP20 modules">
            <Link to="/vault" aria-current={pathname === "/vault" ? "page" : undefined}>
              Vault
            </Link>
            <Link to="/mail/inbox" aria-current={mailActive ? "page" : undefined}>
              Mail
            </Link>
            <Link to="/intents" aria-current={intentsActive ? "page" : undefined}>
              Intents
            </Link>
            <Link to="/workflows" aria-current={workflowsActive ? "page" : undefined}>
              Workflows
            </Link>
          </nav>
          <div className="app-utilities">
            <Link
              className="request-link"
              to="/pay"
              aria-current={pathname === "/pay" ? "page" : undefined}
            >
              Payment request
            </Link>
            <span className="network-status" title={chain || "No network selected"}>
              <i className={connected ? "status-live" : undefined} />
              {chain ? chain.replace(/^0x534e5f/i, "") : "OFFLINE"}
            </span>
            <span className="wallet-status" title={address || "Wallet disconnected"}>
              {address ? shortAddress(address) : "NO WALLET"}
            </span>
            <span className="mobile-session-status" title={`${chain || "Offline"} · ${address || "No wallet"}`}>
              {chain ? chain.replace(/^0x534e5f/i, "") : "OFFLINE"} · {address ? shortAddress(address) : "NO WALLET"}
            </span>
          </div>
        </header>
        <div id="route-content" className="app-content" tabIndex={-1}>
          <Outlet />
        </div>
      </div>
    </LocalnetToolsContext.Provider>
  );
}
