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
      { id: "owner", label: "No public order-book request" },
      { id: "size", label: "Invited makers see a size bucket" },
      { id: "venue", label: "No public book" },
    ];
  }
  if (venue === "public-route") {
    return [
      { id: "owner", label: "Public interaction visible" },
      { id: "size", label: "Size public" },
      { id: "venue", label: "Public-route" },
    ];
  }
  if (venue === "refused") {
    return [
      { id: "owner", label: "No public order-book request" },
      { id: "size", label: "No private fill" },
      { id: "venue", label: "Not published" },
    ];
  }
  return [
    { id: "owner", label: "No public order-book request" },
    { id: "size", label: "Request not yet sent" },
    { id: "venue", label: "Awaiting request" },
  ];
}

export function deskVenueCopy(venue: DeskVenue): string {
  if (venue === "inventory") {
    return "Invited makers received the pair, side, and size bucket. Exact size and floor stay in this browser until Take. The request is not posted to a public book; request timing and fanout remain observable. Take publishes the selected exact fills on the localnet chain.";
  }
  if (venue === "public-route") {
    return "A public route exposes its market interaction and amount on-chain; it is a separate operation from this RFQ.";
  }
  if (venue === "refused") {
    return "No invited maker reserved this clip. The RFQ was not published or routed elsewhere.";
  }
  return "Invited localnet makers receive signed bucket requests and return collateralized locked quotes. Exact size and floor remain in this browser until you approve Take.";
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
