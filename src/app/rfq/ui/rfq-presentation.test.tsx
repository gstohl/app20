import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RfqCountdown from "../RfqCountdown";
import RfqActivity from "../RfqActivity";
import { createRfqLifecycleRecord, reviseRfqLifecycle } from "../rfq-lifecycle";
import { rfqAuthorityLabel } from "../rfq-authority";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const NOW = 1_900_000_000;
const DIGEST = `0x${"cc".repeat(32)}`;

describe("RFQ presentation timer isolation", () => {
  it("keeps countdown timers on the shared clock and does not fire expire from markup", () => {
    const countdown = source("src/app/rfq/RfqCountdown.tsx");
    expect(countdown).toContain("useRfqPresentationClock");
    expect(countdown).toContain("onExpireRef");
    expect(countdown).not.toContain("setInterval");
    expect(countdown).not.toContain("[onExpire, remaining]");

    let expired = 0;
    const markup = renderToStaticMarkup(
      <RfqCountdown expiresAt={NOW} now={NOW} onExpire={() => expired++} />,
    );
    expect(markup).toContain('role="timer"');
    expect(markup).toContain("expired");
    expect(markup).toContain('aria-live="polite"');
    expect(expired).toBe(0);
  });

  it("does not give the active list its own one-second rerender loop", () => {
    const list = source("src/app/rfq/RfqActiveList.tsx");
    expect(list).not.toContain("setInterval");
    expect(list).not.toContain("useState");
    expect(list).toContain("<RfqActiveCard");
    expect(source("src/app/rfq/RfqActiveCard.tsx")).toContain(
      "useRfqPresentationClock",
    );
  });

  it("scopes activity authority ticks to each record instead of the list", () => {
    const activity = source("src/app/rfq/RfqActivity.tsx");
    expect(activity).toContain("useRfqAuthorityPresentation");
    expect(activity).toContain("function RfqActivityRecord");
    const record = reviseRfqLifecycle(
      createRfqLifecycleRecord({
        chainId: "0x1",
        account: "0xabc",
        rfqId: "0x77",
        state: "requesting",
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
          minBuyAmount: "180",
          rfqExpiresAt: NOW + 600,
        },
      }),
      {
        state: "settled",
        selectedQuote: {
          version: "Quote V1",
          solverId: "maker-a",
          solverKey: "key-a",
          nonce: "quote-77",
          reservationId: "reservation-77",
          spreadBps: 20,
          pricingProvenance: "local-fixture",
          quotedAt: NOW,
          quoteExpiresAt: NOW + 300,
          reservationExpiresAt: NOW + 400,
          buyAmount: "200",
          intentDigest: DIGEST,
          signature: "signature",
        },
        settlement: {
          version: "Localnet V2",
          dealId: "0x99",
          escrowAddress: "0x5",
          ticketAddress: "0x6",
          deadline: NOW + 600,
        },
        updatedAt: NOW,
      },
    );
    const markup = renderToStaticMarkup(<RfqActivity records={[record]} />);
    expect(markup).toContain(rfqAuthorityLabel("local-non-authoritative"));
    expect(markup).toContain("Copy RFQ ID 0x77");
    expect(markup).toContain("Local reference · not settlement authority");
  });

  it("abandons public market fetches after abort and wraps the workspace nav", () => {
    const board = source("src/app/rfq/DeskMarketBoard.tsx");
    expect(board).toContain("if (controller.signal.aborted) return;");
    expect(
      board.match(/controller\.signal\.aborted/g)?.length,
    ).toBeGreaterThanOrEqual(3);

    const css = source("src/app/rfq/rfq.module.css");
    expect(css).toContain(
      ".deskSubnav {\n  display: flex;\n  flex-wrap: wrap;",
    );
    expect(css).toContain(".operationsDashboard dl,\n  .activeCard dl {");
    expect(css).toContain(".copyableId button {\n  min-height: 44px;");
    expect(source("src/app/rfq/PrivacyWalletMenu.module.css")).toContain(
      ".sidebarWalletActions {\n    grid-template-columns: 1fr;",
    );
  });
});
