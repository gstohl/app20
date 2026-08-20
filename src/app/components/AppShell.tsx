import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import SessionControl from "@/app/components/SessionControl";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { LocalnetToolsContext } from "@/app/localnetToolsContext";
import { useVaultMode } from "@/app/vault/vaultMode";
import type { ReactNode } from "react";

type AppShellProps = {
  renderLocalnetTools: (() => ReactNode) | null;
};

export default function AppShell({ renderLocalnetTools }: AppShellProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const readyConnected = useStoreWallet((state) => state.isConnected);
  const vaultMode = useVaultMode((state) => state.mode);
  const privyConnected = useVaultMode((state) => state.privyConnected);
  const mailActive = pathname.startsWith("/mail") || pathname === "/inbox";
  const vaultActive = pathname === "/vault" || pathname.startsWith("/intents");
  const workflowsActive = pathname.startsWith("/workflows");
  const connected = vaultMode === "privy" ? privyConnected : readyConnected;

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
          <Link
            className="app-brand"
            to="/vault"
            aria-label="APP20 private superapp"
          >
            <span>APP</span>
            <b>[20]</b>
          </Link>
          <nav className="app-tabs" aria-label="APP20 modules">
            <Link
              to="/vault"
              aria-current={vaultActive ? "page" : undefined}
            >
              Vault
            </Link>
            <Link
              to="/workflows"
              aria-current={workflowsActive ? "page" : undefined}
            >
              Workflows
            </Link>
            <Link
              to="/mail/inbox"
              aria-current={mailActive ? "page" : undefined}
            >
              Mailbox
            </Link>
          </nav>
          <div className="app-utilities">
            <Link
              className="request-link"
              to="/pay"
              aria-current={pathname === "/pay" ? "page" : undefined}
            >
              Pay
            </Link>
            <SessionControl />
          </div>
        </header>
        <div id="route-content" className="app-content" tabIndex={-1}>
          <Outlet />
        </div>
      </div>
    </LocalnetToolsContext.Provider>
  );
}
