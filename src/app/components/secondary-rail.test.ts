import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { secondaryRailEnvironmentLabel } from "./SecondaryRailShell";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const SECONDARY_PAGES = [
  "src/app/funding/page.tsx",
  "src/app/send/page.tsx",
  "src/app/cross-chain-review/page.tsx",
  "src/app/recovery/privy/page.tsx",
];

describe("secondary rails share one boundary shell", () => {
  it.each(SECONDARY_PAGES)("%s renders inside the shared shell", (path) => {
    const page = source(path);
    expect(page).toContain("SecondaryRailShell");
    expect(page).toContain("boundary=");
    expect(page).toContain("summary=");
  });

  it("always states the environment, boundary, and a way back to RFQ", () => {
    const shell = source("src/app/components/SecondaryRailShell.tsx");
    expect(shell).toContain("Not RFQ settlement authority");
    expect(shell).toContain("← Back to RFQ");
    expect(shell).toContain("LOCALNET DEMO");
    expect(shell).toContain("SEPOLIA");
    expect(shell).toContain("MAINNET");
  });

  it("maps Ready provider indices, not the unused Goerli slot, onto environment labels", () => {
    expect(secondaryRailEnvironmentLabel(0)).toBe("MAINNET");
    expect(secondaryRailEnvironmentLabel(1)).toBe("UNKNOWN NETWORK");
    expect(secondaryRailEnvironmentLabel(2)).toBe("SEPOLIA");
    expect(secondaryRailEnvironmentLabel(3)).toBe("LOCALNET DEMO");
  });

  it("labels public send as unavailable instead of an actionable module", () => {
    const page = source("src/app/send/page.tsx");
    expect(page).toContain("Unavailable in this build");
    expect(page).toContain("nothing on this page can move");
  });
});
