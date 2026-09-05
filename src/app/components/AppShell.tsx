import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import SessionControl from "@/app/components/SessionControl";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useWalletMode } from "@/app/rfq/walletMode";
import type { ReactNode } from "react";

type AppShellProps = {
  renderLocalnetTools: (() => ReactNode) | null;
};

export default function AppShell({ renderLocalnetTools }: AppShellProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const readyConnected = useStoreWallet((state) => state.isConnected);
  const walletMode = useWalletMode((state) => state.mode);
  const privyConnected = useWalletMode((state) => state.privyConnected);
  const rfqActive = pathname === "/rfq" || pathname.startsWith("/rfq/");
  const chatActive = pathname === "/chat" || pathname.startsWith("/chat/");
  const connected = walletMode === "privy" ? privyConnected : readyConnected;
  const payActive = pathname === "/pay";
  const moduleName = chatActive
    ? "CHAT"
    : payActive
      ? "PAY"
      : pathname === "/contacts"
        ? "COUNTERPARTIES"
        : rfqActive
          ? "RFQ WORKSPACE"
          : "APP20";

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
        {/* Live session state for the module you are actually in. */}
        {connected
          ? `${moduleName} · WALLET CONNECTED · PUBLIC-NETWORK RFQ DISABLED`
          : `${moduleName} · NO WALLET CONNECTED`}
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
          <Link to="/rfq" aria-current={rfqActive ? "page" : undefined}>
            RFQ
          </Link>
          <Link to="/chat" aria-current={chatActive ? "page" : undefined}>
            Chat
          </Link>
          <Link
            to="/contacts"
            aria-current={pathname === "/contacts" ? "page" : undefined}
          >
            Counterparties
          </Link>
          <Link to="/pay" aria-current={payActive ? "page" : undefined}>
            Pay
          </Link>
        </nav>
        <div className="app-utilities">
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
