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
      sessionCompatible: true,
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

  it("shows a chain-derived maturity estimate without claiming a private balance read", () => {
    const model = createFundingReadinessModel({
      isConnected: true,
      address: "0x1234567890abcdef1234567890abcdef",
      capability: capableWallet,
      network: "localnet",
      pair: localnetPair,
      sessionCompatible: true,
      maturityEstimate: {
        kind: "ready",
        status: {
          headBlock: 105,
          maturityBlocks: 10,
          mature: [],
          pending: [
            {
              deposit: {
                kind: "shield",
                blockNumber: 100,
                transactionHash: "0xabc",
                token: "0x1",
                amountBaseUnits: 10n,
              },
              matureAtBlock: 110,
              blocksRemaining: 5,
            },
          ],
          allMatureAtBlock: 110,
        },
      },
    });
    const html = renderToStaticMarkup(
      <FundingReadinessPanelView model={model} />,
    );

    expect(model.noteMaturity.exposed).toBe(true);
    expect(html).toContain("Chain-derived estimate");
    expect(html).toContain("block 110");
    expect(html).toContain("5 blocks left");
    expect(html).toContain("estimate from public deposit events");
    expect(html).toContain("APP20 never reads private balances");
    expect(html).not.toContain("Not exposed by this wallet");
  });

  it("fails closed without a wallet or a reviewed API declaration", () => {
    const disconnected = createFundingReadinessModel({
      isConnected: false,
      address: "",
      capability: null,
      network: "localnet",
      pair: localnetPair,
      sessionCompatible: false,
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
      sessionCompatible: true,
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
      sessionCompatible: true,
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

  it("does not treat a localnet provider as ready when the wallet chain disagrees", () => {
    const model = createFundingReadinessModel({
      isConnected: true,
      address: "0x123",
      capability: capableWallet,
      network: "localnet",
      pair: localnetPair,
      sessionCompatible: false,
      sessionReason: "Ready account and selected network do not match.",
    });
    const html = renderToStaticMarkup(
      <FundingReadinessPanelView model={model}>
        <button type="button">Mismatched funding control</button>
      </FundingReadinessPanelView>,
    );

    expect(model.ready).toBe(false);
    expect(model.pair.eligible).toBe(false);
    expect(html).toContain("Ready account and selected network do not match.");
    expect(html).not.toContain("Mismatched funding control");
    expect(html).not.toContain("reviewed localnet demo identity");
  });
});
