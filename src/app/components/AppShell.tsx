import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import SessionControl from "@/app/components/SessionControl";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useWalletMode } from "@/app/rfq/walletMode";
import { useEffect, useRef, type ReactNode } from "react";
import { clearChatSession } from "@/app/chat/chat-session";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";

type AppShellProps = {
  renderLocalnetTools: (() => ReactNode) | null;
};

export default function AppShell({ renderLocalnetTools }: AppShellProps) {
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeight = () => header.parentElement?.style.setProperty("--app-shell-offset", `${header.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const wallet = useStoreWallet.subscribe((next, previous) => {
      if (next.address !== previous.address || next.chain !== previous.chain || next.isConnected !== previous.isConnected) clearChatSession();
    });
    const rail = useWalletMode.subscribe((next, previous) => {
      if (next.mode !== previous.mode) clearChatSession();
    });
    const network = useFrontendProvider.subscribe((next, previous) => {
      if (next.currentFrontendProviderIndex !== previous.currentFrontendProviderIndex) clearChatSession();
    });
    return () => { wallet(); rail(); network(); clearChatSession(); };
  }, []);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const rfqActive = pathname === "/rfq" || pathname.startsWith("/rfq/");
  const chatActive = pathname === "/chat" || pathname.startsWith("/chat/");
  const payActive = pathname === "/pay";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#route-content">
        Skip to route content
      </a>
      <header className="app-header" ref={headerRef}>
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
          <Link to="/agents" aria-current={pathname === "/agents" ? "page" : undefined}>Agents</Link>
        </nav>
        <div className="app-utilities">
          {renderLocalnetTools?.()}
          <SessionControl />
        </div>
      </header>
      <div id="route-content" className="app-content" tabIndex={-1}>
        <Outlet />
      </div>
    </div>
  );
}
