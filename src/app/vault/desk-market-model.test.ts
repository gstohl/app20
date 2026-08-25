import { describe, expect, it } from "vitest";
import {
  deskMarketModel,
  LOCALNET_DESK_SPREAD_BPS,
  LOCALNET_REFERENCE_STRK_USDC,
} from "./desk-market-model";

describe("desk market model", () => {
  it("matches the deterministic localnet STRK to USDC quote model", () => {
    const model = deskMarketModel("STRK_USDC");

    expect(model.referencePrice).toBe(LOCALNET_REFERENCE_STRK_USDC);
    expect(model.clientRate).toBeCloseTo(1.994);
    expect(model.points.at(-1)).toEqual({
      sell: 50,
      grossReceive: 100,
      quotedReceive: 99.7,
    });
    expect(LOCALNET_DESK_SPREAD_BPS).toBe(30);
  });

  it("uses the reciprocal reference for USDC to STRK", () => {
    const model = deskMarketModel("USDC_STRK");

    expect(model.clientRate).toBeCloseTo(0.4985);
    expect(model.points.at(-1)).toEqual({
      sell: 100,
      grossReceive: 50,
      quotedReceive: 49.85,
    });
    expect(model.bid).toBeLessThan(model.midpoint);
    expect(model.ask).toBeGreaterThan(model.midpoint);
  });
});
