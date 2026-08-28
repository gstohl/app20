import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE,
  PRODUCTION_RFQ_PUBLIC_FALLBACK,
  PRODUCTION_RFQ_TRANSPORT_ENABLED,
  publishInvitedMakerRfq,
} from "@/app/rfq/production-private-intents";
import {
  PRODUCTION_PRIVATE_DESK_IMPLEMENTED,
  SEPOLIA_RFQ_MANIFEST,
  assertPrivateRfqNetwork,
  validateSepoliaRfqManifest,
} from "./sepolia-rfq-manifest";
import {
  ESCROW_VNEXT_ABI_EXPECTATION,
  LOCALNET_ESCROW_V2_IS_VNEXT,
  assertVnextAbiReady,
} from "./escrow-vnext";
import { executeConfiguredChainVerifier } from "./settlement-receipt-chain";

describe("immutable-off RFQ production boundaries", () => {
  it("keeps browser transport, value authority, and public fallback disabled", async () => {
    expect(PRODUCTION_RFQ_TRANSPORT_ENABLED).toBe(false);
    expect(PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE).toBe(false);
    expect(PRODUCTION_RFQ_PUBLIC_FALLBACK).toBe(false);
    await expect(publishInvitedMakerRfq({ manifest: SEPOLIA_RFQ_MANIFEST, now: 1, rfq: {} as never })).rejects.toThrow(/unconditionally disabled/);
  });

  it("keeps public-network manifests and local legacy escrow fail closed", () => {
    expect(PRODUCTION_PRIVATE_DESK_IMPLEMENTED).toBe(false);
    expect(validateSepoliaRfqManifest(SEPOLIA_RFQ_MANIFEST)).toBe(false);
    expect(() => assertPrivateRfqNetwork("mainnet", SEPOLIA_RFQ_MANIFEST)).toThrow(/hard-disabled/);
    expect(LOCALNET_ESCROW_V2_IS_VNEXT).toBe(false);
    expect(() => assertVnextAbiReady(ESCROW_VNEXT_ABI_EXPECTATION)).toThrow(/localnet V2 calldata is refused/);
  });

  it("keeps configured-chain authority unconstructible and unavailable", async () => {
    const module = await import("./settlement-receipt-chain");
    expect("createConfiguredChainVerifier" in module).toBe(false);
    await expect(executeConfiguredChainVerifier({} as never, {} as never)).rejects.toThrow(/authority is unavailable/);
  });

  it("has no root RFQ Durable Object binding or enabled transport variable", () => {
    const wrangler = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
    expect(wrangler).not.toContain('"RFQ_REPLAY"');
    expect(wrangler).toContain('"RFQ_TRANSPORT_ENABLED": "false"');
  });
});
