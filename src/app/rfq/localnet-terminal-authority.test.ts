import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("localnet terminal authority structure", () => {
  it("keeps /converge as the sole browser terminal convergence endpoint", () => {
    const browser = source("src/app/rfq/localnet-private-intents.ts");
    const server = source("scripts/localnet-app.mjs");
    expect(browser).not.toContain("terminalizeLocalnetPrivateIntent");
    expect(browser).not.toContain("/private-intents/terminalize");
    expect(server).not.toContain(
      'url.pathname === "/private-intents/terminalize"',
    );
    expect(browser).toContain("/private-intents/converge");
    expect(server).toContain('url.pathname === "/private-intents/converge"');
  });
});
