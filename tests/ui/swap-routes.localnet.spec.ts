import { expect, test } from "@playwright/test";

test("centers the default swap and exposes pair and pool-creation routes", async ({
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

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("APP20 swap")).toBeVisible();
  await expect(page.getByText("STRK / USDC", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Swap", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await expect(page).toHaveURL(/\/vault$/);
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
  await expect(page.getByRole("button", { name: "1D" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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

  await page.goto("/");
  const swap = page.getByRole("region", { name: "Private swap" });
  await expect(swap.getByLabel("Private intent market")).toHaveValue(
    "STRK_USDC",
  );
  await swap.getByLabel("Private intent market").selectOption("USDC_STRK");
  await expect(page).toHaveURL(/\/swap\/usdc\/strk$/);
  await expect(swap.getByLabel("Private intent market")).toHaveValue(
    "USDC_STRK",
  );

  await page.goto("/swap");
  await expect(page).toHaveURL(/\/swap\/strk\/usdc$/);

  await page.goto("/swap/eth/usdc");
  await expect(
    page.getByRole("heading", { name: "No pool for ETH / USDC" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create pool" }).click();
  await expect(page).toHaveURL(/\/pools\/create\/eth\/usdc$/);
  await expect(
    page.getByRole("heading", { name: "Create pool" }),
  ).toBeVisible();
  await expect(
    page.getByText("ETH / USDC", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Pool factory")).toBeVisible();
  await page.getByLabel("Initial price in USDC per ETH").fill("2500");
  await page.getByLabel("ETH starting inventory").fill("2");
  await page.getByLabel("USDC starting inventory").fill("5000");
  await page.getByRole("button", { name: "Prepare pool creation" }).click();
  await expect(page.getByText("Creation review prepared")).toBeVisible();
  await expect(page.getByText("10,000 USDC", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Deploy pool unavailable" }),
  ).toBeDisabled();
});
