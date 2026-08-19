import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  resolveSessionDisplay,
  SessionControlView,
  shortSessionAddress,
} from "./SessionControl";

vi.mock("@/app/components/client/WalletHandle/SelectWallet", () => ({
  default: ({ variant }: { variant: "nav" | "ctaBig" }) => (
    <button type="button" data-wallet-variant={variant}>
      Connect wallet
    </button>
  ),
}));

describe("SessionControl", () => {
  it("resolves the active rail without mixing Ready and Privy identities", () => {
    const display = resolveSessionDisplay({
      mode: "privy",
      readyConnected: true,
      readyAddress: "0xready",
      readyChain: "SN_MAIN",
      privyConnected: true,
      privyAddress: "0xprivy",
    });

    expect(display).toEqual({
      connected: true,
      address: "0xprivy",
      network: "SEPOLIA",
      rail: "PRIVY",
    });
  });

  it("shows one Ready wallet control in the header session", () => {
    const session = resolveSessionDisplay({
      mode: "ready",
      readyConnected: true,
      readyAddress: "0x1234567890abcdef12345",
      readyChain: "SN_MAIN",
      privyConnected: false,
      privyAddress: "",
    });
    const markup = renderToStaticMarkup(
      <SessionControlView session={session} />,
    );

    expect(markup).toContain("MAINNET / READY");
    expect(markup).toContain(shortSessionAddress("0x1234567890abcdef12345"));
    expect(markup).toContain('data-wallet-variant="nav"');
    expect(markup.match(/Connect wallet/g)).toHaveLength(1);
  });

  it("uses the Privy session identity when that rail is active", () => {
    const session = resolveSessionDisplay({
      mode: "privy",
      readyConnected: true,
      readyAddress: "0xreadyaccount",
      readyChain: "SN_MAIN",
      privyConnected: true,
      privyAddress: "0xprivyaccount123456789",
    });
    const markup = renderToStaticMarkup(
      <SessionControlView session={session} />,
    );

    expect(markup).toContain("SEPOLIA / PRIVY");
    expect(markup).toContain(shortSessionAddress("0xprivyaccount123456789"));
    expect(markup).not.toContain("0xreadyaccount");
  });

  it("makes the disconnected state explicit", () => {
    const session = resolveSessionDisplay({
      mode: "ready",
      readyConnected: false,
      readyAddress: "",
      readyChain: "",
      privyConnected: false,
      privyAddress: "",
    });
    const markup = renderToStaticMarkup(
      <SessionControlView session={session} />,
    );

    expect(markup).toContain("OFFLINE / READY");
    expect(markup).toContain("NO ACTIVE ACCOUNT");
  });
});
