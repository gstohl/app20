import {
    activateLocalnet,
    connectLocalnetWallet,
    expect,
    expectNoHorizontalOverflow,
    readStorageSnapshot,
    test,
    type Page,
} from "./support/localnet";

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

test("keeps RFQ canonical, public context opt-in, swap non-executable, and market planning proposal-only", async ({
    page,
}) => {
    let coinGeckoRequests = 0;
    await page.route("https://api.coingecko.com/**/ohlc?*", async (route) => {
        coinGeckoRequests += 1;
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
    await expect(page).toHaveURL(/\/rfq$/);
    await activateLocalnet(page);
    await expect(
        page.getByText("LOCALNET DEMO", { exact: true }),
    ).toBeVisible();
    // Public context is collapsed under the ticket until someone asks for it.
    await page.getByText("Public market context", { exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Not an RFQ quote" }),
    ).toBeVisible();
    expect(coinGeckoRequests).toBe(0);
    await page.getByRole("button", { name: "Load CoinGecko context" }).click();
    await expect(
        page.getByRole("heading", { name: "STRK / USDC candlesticks" }),
    ).toBeVisible();
    await expect.poll(() => coinGeckoRequests).toBe(1);
    await expect(page.getByText("0.50000", { exact: true })).toBeVisible();

    await gotoRoute(page, "/swap/strk/usdc");
    await expect(
        page.getByRole("heading", { name: "STRK / USDC" }),
    ).toBeVisible();
    await expect(
        page.getByText("PAIR HANDOFF · NO EXECUTION", { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: /request|accept|execute/i }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Open RFQ" }).click();
    await expect(page).toHaveURL(/\/rfq\?pair=STRK_USDC#new$/);
    await expect(page.getByLabel("Private intent market")).toHaveValue(
        "STRK_USDC",
    );

    await gotoRoute(page, "/swap/usdc/strk");
    await expect(
        page.getByRole("heading", { name: "USDC / STRK" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Open RFQ" }).click();
    await expect(page).toHaveURL(/\/rfq\?pair=USDC_STRK#new$/);
    await expect(page.getByLabel("Private intent market")).toHaveValue(
        "USDC_STRK",
    );

    await gotoRoute(page, "/swap/eth/usdc");
    await expect(
        page.getByRole("heading", { name: "Pair unavailable" }),
    ).toBeVisible();
    await expect(
        page.getByText("No RFQ, quote, proposal, or transaction was created."),
    ).toBeVisible();

    await gotoRoute(page, "/pools/create/eth/usdc#review");
    await expect(page).toHaveURL(/\/rfq\/markets\/eth\/usdc\/proposal#review$/);
    await expect(
        page.getByRole("heading", { name: "Asset not reviewed" }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: /prepare|deploy/i }),
    ).toHaveCount(0);

    await gotoRoute(page, "/pools/create/strk/usdc#review");
    await expect(page).toHaveURL(
        /\/rfq\/markets\/strk\/usdc\/proposal#review$/,
    );
    await connectLocalnetWallet(page);
    const proposalHeading = page.getByRole("heading", {
        name: "Draft market proposal",
    });
    await expect(proposalHeading).toBeVisible();
    await expect(
        proposalHeading
            .locator("..")
            .getByText("PROPOSAL ONLY · NO DEPLOYMENT", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("18 decimals · allowlisted")).toBeVisible();
    await expect(page.getByText("6 decimals · allowlisted")).toBeVisible();
    await expect(page.getByRole("button", { name: /deploy/i })).toHaveCount(0);

    await page.getByLabel("STRK proposed amount").fill("2");
    await page.getByLabel("USDC proposed amount").fill("5000");
    await page
        .getByLabel("Non-executable reference price in USDC per STRK")
        .fill("0.4");
    const storageBefore = await readStorageSnapshot(page);
    const proposalUrl = page.url();
    await page.getByRole("button", { name: "Prepare draft review" }).click();
    await expect(
        page.getByText("DRAFT PREPARED", { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText("2000000000000000000", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("5000000000", { exact: true })).toBeVisible();
    await expect(
        page.locator("code", { hasText: /^sha256:[0-9a-f]{64}$/ }),
    ).toBeVisible();
    expect(await readStorageSnapshot(page)).toEqual(storageBefore);
    expect(page.url()).toBe(proposalUrl);

    await page.reload();
    await expect(page.getByLabel("STRK proposed amount")).toHaveValue("");
    await expect(page.locator("code", { hasText: /^sha256:/ })).toHaveCount(0);
    await page.setViewportSize({ width: 430, height: 932 });
    await expectNoHorizontalOverflow(page);
});
