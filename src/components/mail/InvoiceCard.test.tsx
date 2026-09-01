import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolvePaymentRequestTokenForChain,
  type PaymentRequestPayload,
} from "@/lib/otc";

const fixture = vi.hoisted(() => ({
  chainId: "0x534e5f4c4f43414c",
  usdc: "0x53c",
  walletAddress: "0xb0b",
}));

vi.mock("../../utils/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/constants")>();
  return {
    ...actual,
    LOCALNET_CHAIN_ID: fixture.chainId,
    LOCALNET_PROVIDER_INDEX: 3,
    localnetWalletEnabled: true,
    localnetUSDCAddress: fixture.usdc,
    localnetUsdcToken: fixture.usdc,
  };
});

vi.mock("@/app/components/Wallet/walletContext", () => ({
  useStoreWallet: (
    selector: (state: { address: string; chain: string }) => unknown,
  ) => selector({ address: fixture.walletAddress, chain: fixture.chainId }),
}));

import InvoiceCard from "./InvoiceCard";

const request: PaymentRequestPayload = {
  requestId: `0x${"12".repeat(32)}`,
  token: { symbol: "USDC", address: fixture.usdc, decimals: 6 },
  amount: "2500000",
  requester: "0xa11ce",
  expiresAt: 0,
  chainId: fixture.chainId,
  memo: "Invoice 42",
};

function render(maturity?: {
  mature: boolean;
  matureAtBlock: number;
  blocksRemaining: number;
}) {
  return renderToStaticMarkup(
    <InvoiceCard
      request={request}
      status="requested"
      maturity={maturity}
      onPay={() => undefined}
      onPayPrivatelyWithStrk={() => undefined}
    />,
  );
}

describe("localnet USDC invoice actions", () => {
  beforeEach(() => {
    fixture.walletAddress = "0xb0b";
  });

  it("offers the exact private STRK RFQ handoff before a take is recorded", () => {
    expect(
      resolvePaymentRequestTokenForChain(request, fixture.chainId),
    ).toMatchObject({
      symbol: "USDC",
      decimals: 6,
    });
    const markup = render();
    expect(markup).toContain("Pay privately with STRK");
    expect(markup).not.toContain("Complete payment");
  });

  it("waits for note maturity before enabling completion", () => {
    const markup = render({
      mature: false,
      matureAtBlock: 110,
      blocksRemaining: 3,
    });
    expect(markup).toContain("matures at block 110");
    expect(markup).toContain("3 blocks left");
    expect(markup).not.toContain("Pay privately with STRK");
    expect(markup).not.toContain(">Complete payment</button>");
  });

  it("offers completion once the received USDC note is mature", () => {
    const markup = render({
      mature: true,
      matureAtBlock: 110,
      blocksRemaining: 0,
    });
    expect(markup).toContain("Complete payment");
    expect(markup).not.toContain("Pay privately with STRK");
  });
});
