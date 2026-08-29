import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const PAGE = "src/app/rfq/markets/proposal/page.tsx";

describe("market proposal information architecture", () => {
  it("no longer lives in the pool-creation namespace", () => {
    expect(existsSync(resolve(process.cwd(), "src/app/pools"))).toBe(false);
    expect(source("src/main.tsx")).toContain(
      "@/app/rfq/markets/proposal/page",
    );
    expect(source("src/main.tsx")).not.toContain("@/app/pools/create/page");
    expect(source(PAGE)).toContain("./market-proposal.module.css");
  });

  it("keeps the hash-preserving legacy pool bookmark redirect", () => {
    const main = source("src/main.tsx");
    expect(main).toContain('path: "/pools/create/$tokenA/$tokenB"');
    expect(main).toContain("/rfq/markets/$tokenA/$tokenB/proposal");
    expect(main).toContain("location.hash.replace");
  });

  it("places the proposal in the RFQ / Markets / Pair breadcrumb", () => {
    const page = source(PAGE);
    expect(page).toContain('aria-label="Breadcrumb"');
    expect(page).toContain("Markets");
    expect(page).toContain('aria-current="page"');
  });

  it("exposes no deployment, factory, or liquidity-provision action", () => {
    const page = source(PAGE);
    expect(page).toContain("PROPOSAL ONLY · NO DEPLOYMENT");
    for (const forbidden of [
      "deployContract",
      "createPool",
      "poolFactory",
      "addLiquidity",
      "fundPool",
    ]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("associates field errors and focuses a submission error summary", () => {
    const page = source(PAGE);
    for (const id of [
      "market-proposal-amount-a-error",
      "market-proposal-amount-b-error",
      "market-proposal-reference-price-error",
    ]) {
      expect(page).toContain(`aria-describedby={showErrors`);
      expect(page).toContain(`\"${id}\"`);
      expect(page).toContain(`<em id=\"${id}\">`);
    }
    expect(page).toContain("errorSummaryRef.current?.focus()");
    expect(page).toContain("market-proposal-error-summary-title");
    expect(page).toContain('tabIndex={-1}');
  });
});
