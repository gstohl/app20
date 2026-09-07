import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addrSTRK } from "../../utils/constants";
import type { EscrowFundPayload } from "../../lib/escrow";
import EscrowCard from "./EscrowCard";

const fund: EscrowFundPayload = {
  dealId: "0x123",
  escrowAddress: "0xe5c",
  maker: "0xa11ce",
  legA: {
    token: { symbol: "STRK", address: addrSTRK, decimals: 18 },
    amount: "10000000000000000",
  },
  legB: {
    token: { symbol: "ETH", address: "0x49d", decimals: 18 },
    amount: "20000000000000000",
  },
  deadline: 1,
  claimPubkey: "0x456",
};

function text(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("escrow payout route gating", () => {
  it("keeps Claim disabled with the note-id explanation on Wallet API routes", () => {
    const markup = text(
      renderToStaticMarkup(
        <EscrowCard fund={fund} status="filled" ownDeal termsVerified />,
      ),
    );

    expect(markup).not.toContain("Claim ETH leg");
    expect(markup).toContain("Claiming is unavailable through this wallet");
    expect(markup).toContain("The signature must bind the payout note");
    expect(markup).toContain(
      "Escrow stays off the mainnet scoring path until reviewed.",
    );
  });

  it("enables Claim only when the localnet-compatible callback is supplied", () => {
    const markup = text(
      renderToStaticMarkup(
        <EscrowCard
          fund={fund}
          status="filled"
          ownDeal
          termsVerified
          onClaim={() => undefined}
        />,
      ),
    );

    expect(markup).toContain("Claim ETH leg");
    expect(markup).not.toContain("Claiming is unavailable through this wallet");
  });

  it("applies the same production/localnet split to Timeout", () => {
    const production = text(
      renderToStaticMarkup(
        <EscrowCard fund={fund} status="funded" ownDeal termsVerified />,
      ),
    );
    const localnet = text(
      renderToStaticMarkup(
        <EscrowCard
          fund={fund}
          status="funded"
          ownDeal
          termsVerified
          onTimeout={() => undefined}
        />,
      ),
    );

    expect(production).not.toContain("Refund STRK leg");
    expect(production).toContain("Refunding is unavailable through this wallet");
    expect(localnet).toContain("Refund STRK leg");
    expect(localnet).not.toContain("Refunding is unavailable through this wallet");
  });
});
