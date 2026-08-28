import { describe, expect, it } from "vitest";
import { SEPOLIA_RFQ_MANIFEST } from "@/lib/sepolia-rfq-manifest";
import { PRODUCTION_RFQ_TRANSPORT_ENABLED, publishInvitedMakerRfq, terminalInventoryRefusal } from "./production-private-intents";

it("keeps production transport unconditionally disabled before any side effect", async () => {
  expect(PRODUCTION_RFQ_TRANSPORT_ENABLED).toBe(false);
  await expect(publishInvitedMakerRfq({ manifest: SEPOLIA_RFQ_MANIFEST, now: 1, rfq: {} as never })).rejects.toThrow(/unconditionally disabled/);
});
describe("terminal refusal", () => { it("never becomes automatic public fallback", () => { expect(terminalInventoryRefusal()).toMatchObject({ terminal: true, publicFallback: false }); }); });
