import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import SessionControl from "@/app/components/SessionControl";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
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
  const swapActive =
    pathname === "/" ||
    pathname.startsWith("/swap") ||
    pathname.startsWith("/pools");
  const deskActive = pathname === "/vault" || pathname.startsWith("/intents");
  const connected = vaultMode === "privy" ? privyConnected : readyConnected;

  return (
    <div
      className={`app-shell${renderLocalnetTools ? " has-localnet-banner" : ""}`}
    >
      <a className="skip-link" href="#route-content">
        Skip to route content
      </a>
      <div className="signal-bar">
        <span
          className={`signal-dot ${connected ? "is-live" : ""}`}
          aria-hidden="true"
        />
        {connected ? "TRADING SESSION CONNECTED" : "APP20 PRIVATE TRADING DESK"}
        <span>PUBLIC BOUNDARIES REMAIN CORRELATABLE</span>
      </div>
      <header className="app-header">
        <Link
          className="app-brand"
          to="/"
          aria-label="APP20 private trading desk"
        >
          <span>APP</span>
          <b>[20]</b>
        </Link>
        <nav className="app-tabs" aria-label="APP20 modules">
          <Link to="/" aria-current={swapActive ? "page" : undefined}>
            Swap
          </Link>
          <Link to="/vault" aria-current={deskActive ? "page" : undefined}>
            Desk
          </Link>
          <Link to="/mail/inbox" aria-current={mailActive ? "page" : undefined}>
            Mailbox
          </Link>
          <Link
            to="/contacts"
            aria-current={pathname === "/contacts" ? "page" : undefined}
          >
            Counterparties
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
      {renderLocalnetTools ? (
        <div className="localnet-banner">{renderLocalnetTools()}</div>
      ) : null}
      <div id="route-content" className="app-content" tabIndex={-1}>
        <Outlet />
      </div>
    </div>
  );
}
