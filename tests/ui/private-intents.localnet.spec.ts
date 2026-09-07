import {
  LOCALNET_WALLET_API,
  activateLocalnet,
  expect,
  localnetIdentity,
  test,
  type Page,
} from "./support/localnet";

test.describe.configure({ mode: "serial" });

function settlementRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" &&
      /\/(?:private-intents\/[^/?]+|invoke|privacy)(?:\?|$)/.test(request.url())) {
      requests.push(request.url());
    }
  });
  return requests;
}

async function expectPrivateOnlyRfq(page: Page) {
  const workspace = page.getByRole("main", { name: "Confidential RFQ" });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Private settlement is required" })).toBeVisible();
  await expect(workspace).toContainText("Mainnet and browser-wallet activation are pending");
  await expect(workspace).toContainText("RFQ swaps, Chat offers and Chat payments");
  await expect(workspace.getByRole("button", {
    name: /Get quotes|Request quotes|Request funded offer|Review selected quote fills|Take atomically|Swap now|Accept.*send|Create escrow/i,
  })).toHaveCount(0);
  await expect(workspace.getByLabel("Private intent sell amount")).toHaveCount(0);
  await expect(workspace.getByLabel("Private intent minimum receive")).toHaveCount(0);
  await expect(workspace.getByRole("region", { name: /Final atomic Take review|Pay invoice privately/ })).toHaveCount(0);
}

test("RFQ defaults to confidential availability without requesting a trade", async ({ page }) => {
  const requests = settlementRequests(page);
  await page.goto("/rfq");
  await expectPrivateOnlyRfq(page);
  await expect(page.getByRole("link", { name: "Recover earlier maker inventory →" })).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("connecting a local wallet cannot enable public-term RFQ controls", async ({ page }) => {
  const requests = settlementRequests(page);
  await page.goto("/rfq");
  await activateLocalnet(page, { identity: "alice" });
  await expect(page.getByRole("button", { name: "Disconnect wallet" })).toBeVisible();
  await expectPrivateOnlyRfq(page);
  expect(requests).toHaveLength(0);
});

test("legacy routes, market queries and history fragments cannot reopen settlement", async ({ page }) => {
  const requests = settlementRequests(page);
  for (const route of [
    "/vault#desk",
    "/workflows#activity",
    "/rfq?pair=USDC_STRK#active",
    "/rfq?pair=STRK_USDC&mode=advanced&settlement=live#desk",
    "/rfq/confidential?mainnetEnabled=true&VITE_CONFIDENTIAL_RFQ_LAB=true",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/rfq(?:\/confidential)?(?:\?|#|$)/);
    await expectPrivateOnlyRfq(page);
  }
  expect(requests).toHaveLength(0);
});

test("an older invoice handoff remains recovery data and cannot create a public RFQ", async ({ page, localnetConfig: config }) => {
  const requests = settlementRequests(page);
  const handoff = {
    version: 1,
    requestId: `0x${"1".repeat(64)}`,
    account: localnetIdentity(config, "alice").address,
    chainId: config.chainId,
    payee: localnetIdentity(config, "bob").address,
    buyToken: config.usdcTokenAddress,
    targetBuyBaseUnits: "100000",
    memo: "An older invoice requiring conversion",
    returnTo: "/chat",
    createdAt: Date.now(),
  };
  await page.addInitScript(value => {
    sessionStorage.setItem("app20/desk-handoff/invoice/v1", JSON.stringify(value));
  }, handoff);
  await page.goto("/rfq#desk");
  await activateLocalnet(page, { identity: "alice" });
  await expectPrivateOnlyRfq(page);
  await expect(page.getByText("INVOICE MODE · STRK → USDC", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pay privately with STRK", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("app20/desk-handoff/invoice/v1")!)))
    .toEqual(handoff);
  expect(requests).toHaveLength(0);
});

test("raw local RFQ starts reject before parsing trade fields or funding", async ({ request, localnetConfig: config }) => {
  for (const route of [
    "/escrow/ensure-mail-ticket",
    "/escrow/ensure-ticket",
    "/private-intents/quotes",
    "/private-intents/select-quote",
    "/private-intents/transcript",
    "/private-intents/sign-quote",
    "/private-intents/funding-prepare",
    "/private-intents/take-prepare",
    "/private-intents/solve",
  ]) {
    // Missing trade fields must still reach the immutable privacy-policy rejection.
    const response = await request.post(`${LOCALNET_WALLET_API}${route}`, {
      headers: { Origin: new URL(LOCALNET_WALLET_API).origin },
      data: { runtimeEpoch: config.runtimeEpoch },
    });
    expect(response.status(), route).toBe(400);
    expect(await response.json(), route).toEqual({
      error: "Confidential settlement is required. The earlier RFQ route exposes trade amounts and assets and is disabled. Use the confidential escrow when your wallet and network support it.",
    });
  }
});

test("historical operations status remains read-only and excludes raw inventory", async ({ page, request }) => {
  const response = await request.get(`${LOCALNET_WALLET_API}/rfq/operations/status`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.result).toMatchObject({
    schema: "app20/rfq-operations-status/v1",
    environment: "localnet",
    claimsAndRefundsEnabled: true,
    rawInventoryExposed: false,
  });
  expect(JSON.stringify(payload)).not.toMatch(
    /settlementAccount|processPid|operationLog|availableBaseUnits|rawBalance/i,
  );
  const requests = settlementRequests(page);
  await page.goto("/rfq/operations");
  await expect(page.getByRole("heading", { name: "RFQ operations" })).toBeVisible();
  expect(requests).toHaveLength(0);
});
