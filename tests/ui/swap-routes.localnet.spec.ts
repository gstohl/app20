import { expect, test, type Page } from "@playwright/test";
import {
  connectLocalnetWallet,
  expectNoHorizontalOverflow,
  readStorageSnapshot,
  selectLocalNetwork,
} from "./support/localnet";

const STRK_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

async function connectLocalnet(page: Page) {
  await selectLocalNetwork(page);
  await connectLocalnetWallet(page);
}

async function gotoRoute(page: Page, route: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => (document.body.textContent?.trim().length ?? 0) > 0,
        undefined,
        { timeout: 5_000 },
      );
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(250);
    }
  }
  throw lastError;
}

test("enforces reviewed routes and prepares only a session-bound pool draft", async ({
  page,
}) => {
  await page.route("https://api.coingecko.com/**/ohlc?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        [1_787_472_000_000, 0.4, 0.43, 0.39, 0.42],
        [1_787_515_200_000, 0.42, 0.47, 0.41, 0.46],
        [1_787_558_400_000, 0.46, 0.52, 0.44, 0.5],
      ]),
    });
  });

  await gotoRoute(page, "/");
  await connectLocalnet(page);
  await expect(page.getByLabel("APP20 swap")).toBeVisible();
  await expect(page.getByText("STRK / USDC", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Swap", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  const swap = page.getByRole("region", { name: "Private swap" });
  await expect(swap.getByLabel("Private intent market")).toHaveValue(
    "STRK_USDC",
  );
  await swap.getByLabel("Private intent market").selectOption("USDC_STRK");
  await expect(page).toHaveURL(/\/swap\/usdc\/strk$/);

  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "STRK / USDC candlesticks" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Private quote ladder" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Desk market summary" })
      .getByText("0.50000", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "CoinGecko" })).toBeVisible();
  const chartGeometry = await page
    .locator('svg[aria-labelledby*="price-chart-title"]')
    .evaluate((element) => {
      const svg = element as SVGSVGElement;
      return {
        clientAspect: svg.clientWidth / svg.clientHeight,
        viewBoxAspect: svg.viewBox.baseVal.width / svg.viewBox.baseVal.height,
      };
    });
  expect(
    Math.abs(chartGeometry.clientAspect - chartGeometry.viewBoxAspect),
  ).toBeLessThan(0.01);

  await gotoRoute(page, "/swap/eth/usdc");
  await expect(
    page.getByRole("heading", { name: "Asset not reviewed" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /create pool/i })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /prepare proposal/i }),
  ).toHaveCount(0);

  await gotoRoute(page, `/swap/strk/0x000${STRK_ADDRESS.slice(2)}`);
  await expect(
    page.getByRole("heading", { name: "Choose different assets" }),
  ).toBeVisible();

  await gotoRoute(page, "/pools/create/eth/usdc");
  await expect(
    page.getByRole("heading", { name: "Asset not reviewed" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /prepare/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /deploy/i })).toHaveCount(0);

  await gotoRoute(page, "/pools/create/strk/usdc");
  await connectLocalnet(page);
  await expect(
    page.getByRole("heading", { name: "Prepare draft" }),
  ).toBeVisible();
  await expect(page.getByText("18 decimals · allowlisted")).toBeVisible();
  await expect(page.getByText("6 decimals · allowlisted")).toBeVisible();
  await expect(page.getByText(/0\.05%|0\.30%|1\.00%/)).toHaveCount(0);
  await expect(page.getByText(/combined value|executable price/i)).toHaveCount(
    0,
  );

  await page.getByLabel("STRK proposed amount").fill("2");
  await page.getByLabel("USDC proposed amount").fill("5000");
  await page
    .getByLabel("Non-executable reference price in USDC per STRK")
    .fill("0.4");
  const storageBefore = await readStorageSnapshot(page);
  const proposalUrl = page.url();
  await page.getByRole("button", { name: "Prepare draft review" }).click();
  await expect(page.getByText("DRAFT PREPARED", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2000000000000000000", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("5000000000", { exact: true })).toBeVisible();
  await expect(
    page.locator("code", { hasText: /^sha256:[0-9a-f]{64}$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Deployment unavailable" }),
  ).toBeDisabled();
  for (const label of [
    "Correct network",
    "Owner account",
    "Allowed token contracts",
    "Required balances",
    "Factory address",
    "ABI hash",
    "Deployment calldata",
    "Independent review",
    "Funding approvals",
    "Wallet confirmation",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  expect(await readStorageSnapshot(page)).toEqual(storageBefore);
  expect(page.url()).toBe(proposalUrl);

  await page.getByLabel("STRK proposed amount").fill("3");
  await expect(page.getByText("DRAFT PREPARED", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("code", { hasText: /^sha256:/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Prepare draft review" }).click();
  await expect(page.getByText("DRAFT PREPARED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Bob", exact: true }).click();
  await expect(page.getByText("DRAFT PREPARED", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("code", { hasText: /^sha256:/ })).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("STRK proposed amount")).toHaveValue("");
  await expect(page.locator("code", { hasText: /^sha256:/ })).toHaveCount(0);

  await page.setViewportSize({ width: 430, height: 932 });
  await expectNoHorizontalOverflow(page);
});
