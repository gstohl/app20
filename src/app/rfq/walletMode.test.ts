import { describe, expect, it } from "vitest";
import { assertPrivyRailSelected } from "./walletMode";

describe("wallet rail authorization", () => {
  it("blocks Privy signing and export sinks until the Privy rail is explicit", () => {
    expect(() => assertPrivyRailSelected("ready")).toThrow(/switch explicitly to the Privy rail/i);
    expect(() => assertPrivyRailSelected("privy")).not.toThrow();
  });
});
