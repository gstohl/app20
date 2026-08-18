import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { LocalnetToolsContext } from "@/app/localnetToolsContext";
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
  const connected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const chain = useStoreWallet((state) => state.chain);
  const mailActive = pathname.startsWith("/mail") || pathname === "/inbox";

  return (
    <LocalnetToolsContext.Provider value={renderLocalnetTools}>
      <div className="app-shell">
        <div className="signal-bar" role="status">
          <span className="signal-dot" aria-hidden="true" />
          PRIVACY RAIL ONLINE
          <span>PUBLIC ACTIONS REMAIN VISIBLE ON-CHAIN</span>
        </div>
        <header className="app-header">
          <Link className="app-brand" to="/vault" aria-label="VLT20 Privacy Vault">
            <span>VLT</span><b>[20]</b>
          </Link>
          <nav className="app-tabs" aria-label="Products">
            <Link to="/vault" aria-current={pathname === "/vault" ? "page" : undefined}>
              Privacy Vault
            </Link>
            <Link to="/mail/inbox" aria-current={mailActive ? "page" : undefined}>
              Privacy Mail Vault
            </Link>
          </nav>
          <div className="app-utilities">
            <Link className="request-link" to="/pay">Request</Link>
            <span className="network-status" title={chain || "No network selected"}>
              <i className={connected ? "status-live" : undefined} />
              {chain ? chain.replace(/^0x534e5f/i, "") : "OFFLINE"}
            </span>
            <span className="wallet-status" title={address || "Wallet disconnected"}>
              {address ? shortAddress(address) : "NO WALLET"}
            </span>
            {pathname === "/vault" ? null : <SelectWallet variant="nav" />}
          </div>
        </header>
        <div className="app-content"><Outlet /></div>
      </div>
    </LocalnetToolsContext.Provider>
  );
}
