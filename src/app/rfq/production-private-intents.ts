import type { SepoliaRfqManifest } from "@/lib/sepolia-rfq-manifest";
import type { PrivateRfqV1 } from "@app20/private-intents";

export const PRODUCTION_RFQ_PUBLIC_FALLBACK = false as const;
export const PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE = false as const;
export const PRODUCTION_RFQ_TRANSPORT_ENABLED = false as const;
export type PreparedProductionRfq = Readonly<{ directoryDigest: string; envelopeIds: readonly string[] }>;

/**
 * Fail-closed seam retained for callers while the complete Desk state machine,
 * manifest-pinned directory checkpoint/high-water store, maker v2 signing,
 * custody and authoritative settlement path are unavailable.
 */
export async function publishInvitedMakerRfq(_input: {
  manifest: SepoliaRfqManifest;
  now: number;
  rfq: PrivateRfqV1;
}): Promise<PreparedProductionRfq> {
  throw new Error("Production private RFQ transport is unconditionally disabled until the complete reviewed Desk lifecycle is implemented.");
}

export function terminalInventoryRefusal(): Readonly<{ terminal: true; publicFallback: false; message: string }> {
  return Object.freeze({ terminal: true, publicFallback: false, message: "Invited makers declined or lacked inventory. No public order was created." });
}
