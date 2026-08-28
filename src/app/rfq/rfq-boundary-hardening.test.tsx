import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LOCALNET_PROVIDER_INDEX } from "@/utils/constants";
import RfqActiveCard from "./RfqActiveCard";
import { preparePreFundingReservationRelease } from "./localnet-release-recovery";
import { recoveryContextMatches } from "./localnet-recovery-context";
import { createRfqLifecycleRecord, type RfqLifecycleRecord } from "./rfq-lifecycle";
import { sameMarketRequestFence } from "./rfq-request-fence";
import {
  RfqWorkspaceActiveBoundary,
  rfqWorkspaceScopeKey,
  workspaceScopeIsReady,
} from "./RfqWorkspace";

const NOW = 1_900_000_000;
const DIGEST = `0x${"aa".repeat(32)}`;

function record(
  state:
    | "requesting"
    | "quoted"
    | "reviewing"
    | "expired"
    | "cancel-pending"
    | "quarantined",
): RfqLifecycleRecord {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state,
    now: NOW,
    requestDigest: DIGEST,
    terms: {
      pairId: "STRK_USDC",
      sellSymbol: "STRK",
      sellAddress: "0x1",
      sellDecimals: 18,
      sellAmount: "100",
      buySymbol: "USDC",
      buyAddress: "0x2",
      buyDecimals: 6,
      minBuyAmount: "190",
      rfqExpiresAt: NOW + 600,
    },
  });
}

describe("RFQ action boundary hardening", () => {
  it.each(["requesting", "quoted", "reviewing", "cancel-pending"] as const)(
    "fences a fresh same-market request while %s is unresolved",
    (state) => {
      expect(sameMarketRequestFence([record(state)], "STRK_USDC")).toMatch(
        /unresolved/i,
      );
      expect(sameMarketRequestFence([record(state)], "ETH_USDC")).toBeUndefined();
    },
  );

  it("keeps ambiguous quarantine and quote-only expiry fenced", () => {
    expect(sameMarketRequestFence([record("quarantined")], "STRK_USDC")).toMatch(
      /unresolved/i,
    );
    expect(sameMarketRequestFence([record("expired")], "STRK_USDC")).toMatch(
      /unresolved/i,
    );
    const malformed = {
      ...record("quarantined"),
      terms: undefined,
      requestDigest: undefined,
    };
    expect(sameMarketRequestFence([malformed], "USDC_STRK")).toMatch(
      /unresolved/i,
    );
  });

  it("fails closed synchronously when the rendered wallet scope changes", () => {
    const loadedA = rfqWorkspaceScopeKey(
      LOCALNET_PROVIDER_INDEX,
      "0x1",
      "0xaaa",
    );
    const currentB = rfqWorkspaceScopeKey(
      LOCALNET_PROVIDER_INDEX,
      "0x1",
      "0xbbb",
    );
    expect(workspaceScopeIsReady(loadedA, loadedA, "ready")).toBe(true);
    expect(workspaceScopeIsReady(loadedA, currentB, "ready")).toBe(false);
    expect(workspaceScopeIsReady(currentB, currentB, "loading")).toBe(false);
    expect(
      workspaceScopeIsReady(
        loadedA,
        rfqWorkspaceScopeKey(LOCALNET_PROVIDER_INDEX + 1, "0x1", "0xaaa"),
        "ready",
      ),
    ).toBe(false);
  });

  it("keeps the fence for any unresolved persisted release attempt", () => {
    const pending = preparePreFundingReservationRelease(
      record("quoted"),
      "release-1",
      NOW + 1,
    );
    const stateChanged = { ...pending, state: "expired" as const };
    expect(sameMarketRequestFence([stateChanged], "STRK_USDC")).toMatch(
      /unresolved/i,
    );
  });

  it("requires exact account, wallet chain, and LOCAL provider", () => {
    const row = record("requesting");
    expect(
      recoveryContextMatches(row, {
        account: "0x0abc",
        chainId: "0x01",
        providerIndex: LOCALNET_PROVIDER_INDEX,
      }),
    ).toBe(true);
    expect(
      recoveryContextMatches(row, {
        account: "0xdef",
        chainId: "0x1",
        providerIndex: LOCALNET_PROVIDER_INDEX,
      }),
    ).toBe(false);
    expect(
      recoveryContextMatches(row, {
        account: "0xabc",
        chainId: "0x2",
        providerIndex: LOCALNET_PROVIDER_INDEX,
      }),
    ).toBe(false);
    expect(
      recoveryContextMatches(row, {
        account: "0xabc",
        chainId: "0x1",
        providerIndex: LOCALNET_PROVIDER_INDEX + 1,
      }),
    ).toBe(false);
  });

  it("mounts the actual Workspace/Active derivation and disables it across account/provider reload boundaries", () => {
    const pending = preparePreFundingReservationRelease(
      record("requesting"),
      "release-mounted-active",
      NOW + 1,
    );
    const loaded = rfqWorkspaceScopeKey(
      LOCALNET_PROVIDER_INDEX,
      "0x1",
      "0xabc",
      "epoch-controlled",
    );
    const renderBoundary = (
      providerIndex: number,
      address: string,
      currentScope: string | undefined,
      loadState: "ready" | "loading",
    ) =>
      renderToStaticMarkup(
        <RfqWorkspaceActiveBoundary
          records={[pending]}
          providerIndex={providerIndex}
          address={address}
          chain="0x1"
          loadedScope={loaded}
          currentScope={currentScope}
          loadState={loadState}
          onAction={vi.fn()}
          onRemove={vi.fn()}
          onClearAll={vi.fn()}
        />,
      );

    expect(
      renderBoundary(LOCALNET_PROVIDER_INDEX, "0xabc", loaded, "ready"),
    ).not.toMatch(/<button[^>]*disabled/);
    expect(
      renderBoundary(
        LOCALNET_PROVIDER_INDEX,
        "0xdef",
        rfqWorkspaceScopeKey(
          LOCALNET_PROVIDER_INDEX,
          "0x1",
          "0xdef",
          "epoch-controlled",
        ),
        "loading",
      ),
    ).toMatch(/<button[^>]*disabled/);
    expect(
      renderBoundary(
        LOCALNET_PROVIDER_INDEX + 1,
        "0xabc",
        rfqWorkspaceScopeKey(
          LOCALNET_PROVIDER_INDEX + 1,
          "0x1",
          "0xabc",
          "epoch-controlled",
        ),
        "ready",
      ),
    ).toMatch(/<button[^>]*disabled/);
  });

  it("disables the actual Active action seam while records are stale or loading", () => {
    const pending = preparePreFundingReservationRelease(
      record("requesting"),
      "release-active",
      NOW + 1,
    );
    const action = vi.fn();
    const html = renderToStaticMarkup(
      <RfqActiveCard
        record={pending}
        now={NOW + 2}
        actionsDisabled
        onAction={action}
      />,
    );
    expect(html).toContain("disabled");
    expect(html).toMatch(/records reload successfully/i);
    expect(action).not.toHaveBeenCalled();
  });
});
