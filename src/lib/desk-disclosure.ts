export type DeskSurface = "swap" | "block";
export type DeskVenue = "idle" | "inventory" | "public-route" | "refused";

export type DeskLeakChip = {
  id: string;
  label: string;
};

const BLOCK_HINT_STRK = 5_000;
const BLOCK_HINT_USDC = 10_000;

export function deskLeakChips(venue: DeskVenue): readonly DeskLeakChip[] {
  if (venue === "inventory") {
    return [
      { id: "owner", label: "Wallet private" },
      { id: "size", label: "Invited makers see RFQ" },
      { id: "venue", label: "No public book" },
    ];
  }
  if (venue === "public-route") {
    return [
      { id: "owner", label: "Owner private" },
      { id: "size", label: "Size public" },
      { id: "venue", label: "Public-route" },
    ];
  }
  if (venue === "refused") {
    return [
      { id: "owner", label: "Wallet private" },
      { id: "size", label: "No private fill" },
      { id: "venue", label: "Not published" },
    ];
  }
  return [
    { id: "owner", label: "Wallet private" },
    { id: "size", label: "RFQ stays local" },
    { id: "venue", label: "Awaiting request" },
  ];
}

export function deskVenueCopy(venue: DeskVenue): string {
  if (venue === "inventory") {
    return "Invited makers saw the exact RFQ; uninvited parties saw no pre-trade quote. Pair and OPEN amounts can still appear at settlement. Your wallet is not the on-chain sender.";
  }
  if (venue === "public-route") {
    return "Your wallet is not the on-chain sender. The amount still hits a public market.";
  }
  if (venue === "refused") {
    return "No invited maker reserved this clip. The RFQ was not published or routed elsewhere.";
  }
  return "Swap and Block request sealed inventory quotes from invited makers. Block also binds your floor and expiry.";
}

export function suggestsBlockSurface(input: {
  sellSymbol: "STRK" | "USDC";
  sellAmount: string;
}): boolean {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.sellAmount.trim());
  if (!match) return false;
  const whole = Number(match[1]);
  if (!Number.isFinite(whole)) return false;
  return input.sellSymbol === "USDC"
    ? whole >= BLOCK_HINT_USDC
    : whole >= BLOCK_HINT_STRK;
}
