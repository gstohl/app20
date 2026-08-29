import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Strk20Capability } from "@/lib/strk20";
import type { CanonicalPairResolution } from "@/lib/token-registry";
import {
  createFundingReadinessModel,
  FundingReadinessPanelView,
} from "./FundingReadinessPanel";

const capableWallet: Strk20Capability = {
  supported: true,
  versionSupported: true,
  walletName: "Fixture Ready wallet",
  walletVersion: "1.0.0",
  walletApiVersions: ["0.10"],
  specVersions: ["0.10"],
  accountMethods: {
    strk20InvokeTransaction: true,
    strk20Balances: true,
  },
  missingMethods: [],
  declarationErrors: {},
};

const localnetPair: CanonicalPairResolution = {
  ok: true,
  pair: {
    network: "localnet",
    key: "localnet:0x1:0x2",
    tokenA: {
      network: "localnet",
      key: "strk",
      address: "0x1",
      symbol: "STRK",
      decimals: 18,
      aliases: ["strk"],
    },
    tokenB: {
      network: "localnet",
      key: "usdc",
      address: "0x2",
      symbol: "USDC",
      decimals: 6,
      aliases: ["usdc"],
    },
  },
};

describe("FundingReadinessPanel", () => {
  it("shows declaration-derived actions, canonical localnet assets, and no invented maturity", () => {
    const model = createFundingReadinessModel({
      isConnected: true,
      address: "0x1234567890abcdef1234567890abcdef",
      capability: capableWallet,
      network: "localnet",
      pair: localnetPair,
    });
    const html = renderToStaticMarkup(
      <FundingReadinessPanelView model={model}>
        <button type="button">Localnet funding control</button>
      </FundingReadinessPanelView>,
    );

    expect(model.ready).toBe(true);
    expect(html).toContain("Localnet funding control");
    expect(html).toContain("Ready for localnet demo funding");
    expect(html).toContain("Shield");
    expect(html).toContain("deposit");
    expect(html).toContain("Unshield");
    expect(html).toContain("withdraw");
    expect(html).toContain("Private transfer");
    expect(html).toContain("0x1");
    expect(html).toContain("18 decimals");
    expect(html).toContain("0x2");
    expect(html).toContain("6 decimals");
    expect(html).toContain("Not exposed by this wallet");
    expect(html).toContain("did not request a private balance");
    expect(html).toContain("amount and timing are public and correlatable");
    expect(html).toContain("never bundled with RFQ acceptance");
    expect(html).toContain("Funding does not prove settlement");
  });

  it("fails closed without a wallet or a reviewed API declaration", () => {
    const disconnected = createFundingReadinessModel({
      isConnected: false,
      address: "",
      capability: null,
      network: "localnet",
      pair: localnetPair,
    });
    const oldApi = createFundingReadinessModel({
      isConnected: true,
      address: "0x123",
      capability: {
        ...capableWallet,
        supported: false,
        versionSupported: false,
        walletApiVersions: ["0.9"],
        specVersions: [],
      },
      network: "localnet",
      pair: localnetPair,
    });

    expect(disconnected.ready).toBe(false);
    expect(disconnected.actionDeclarationAvailable).toBe(false);
    expect(disconnected.blockers).toContain("No wallet is connected.");
    expect(oldApi.ready).toBe(false);
    expect(oldApi.actionDeclarationAvailable).toBe(false);
    expect(oldApi.blockers.join(" ")).toContain(
      "does not declare Wallet API/spec 0.10 or newer",
    );
    expect(
      renderToStaticMarkup(
        <FundingReadinessPanelView model={oldApi}>
          <button type="button">Blocked funding control</button>
        </FundingReadinessPanelView>,
      ),
    ).not.toContain("Blocked funding control");
  });

  it("shows unavailable asset identity and withholds action children on public networks", () => {
    const model = createFundingReadinessModel({
      isConnected: true,
      address: "0x123",
      capability: capableWallet,
      network: "sepolia",
      pair: {
        ok: false,
        code: "TOKEN_UNCONFIGURED",
        message:
          "USDC is not configured from reviewed metadata on this network.",
      },
    });
    const html = renderToStaticMarkup(
      <FundingReadinessPanelView model={model}>
        <button type="button">Executable funding control</button>
      </FundingReadinessPanelView>,
    );

    expect(model.ready).toBe(false);
    expect(html).toContain("Sepolia");
    expect(html).toContain("public-network execution remains unavailable");
    expect(html).toContain(
      "USDC is not configured from reviewed metadata on this network",
    );
    expect(html).not.toContain("Executable funding control");
  });
});
