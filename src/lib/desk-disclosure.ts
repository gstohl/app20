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
      { id: "owner", label: "Owner private" },
      { id: "size", label: "No pre-trade market print" },
      { id: "venue", label: "Desk inventory" },
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
      { id: "owner", label: "Owner private" },
      { id: "size", label: "No private fill" },
      { id: "venue", label: "Refused" },
    ];
  }
  return [
    { id: "owner", label: "Owner private" },
    { id: "size", label: "No quote yet" },
    { id: "venue", label: "Awaiting inventory" },
  ];
}

export function deskVenueCopy(venue: DeskVenue): string {
  if (venue === "inventory") {
    return "Filled from desk inventory. Pair and OPEN amounts can still appear at settlement. Your wallet is not the on-chain sender.";
  }
  if (venue === "public-route") {
    return "Your wallet is not the on-chain sender. The amount still hits a public market.";
  }
  if (venue === "refused") {
    return "No private inventory covers this clip. Nothing was sent to a public book.";
  }
  return "Swap executes immediately from desk inventory. Block is a signed request with your floor and expiry.";
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
