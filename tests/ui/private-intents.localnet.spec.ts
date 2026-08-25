import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const BASE_URL = process.env.QUIETLINE_TEST_BASE_URL ?? "http://127.0.0.1:5173";

type LocalnetConfig = {
  walletName: string;
  usdcTokenAddress: string;
  identities: Array<{ id: string; label: string; address: string }>;
};

async function connectLocalnet(page: Page) {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Localnet \(dev\)/ }).click();
  await expect(page.getByTitle("Disconnect")).toBeVisible();
}

async function quote(desk: Locator, outputSymbol: "STRK" | "USDC") {
  await desk.getByRole("button", { name: "Get private quote" }).click();
  const solverQuote = desk.getByLabel("Solver quote");
  await expect(solverQuote).toBeVisible({ timeout: 60_000 });
  await expect(solverQuote).toContainText("APP20 DELIVERS");
  await expect(solverQuote).toContainText(outputSymbol);
  await expect(solverQuote).toContainText("SOLVER INVENTORY");
  await expect(solverQuote).toContainText("30 BPS");
  await expect(solverQuote).toContainText("QUOTE 10 MIN · REFUND 20 MIN");
}

async function privateBalance(request: APIRequestContext, token: string) {
  const response = await request.post(
    `${BASE_URL}/__quietline_localnet_wallet/balances`,
    { data: { identity: "alice", tokens: [token] } },
  );
  expect(response.ok()).toBeTruthy();
  return BigInt((await response.json()).result[0].balance);
}

test("APP20 clears both USDC↔STRK directions and refunds on localnet", async ({
  page,
  request,
}) => {
  test.setTimeout(15 * 60_000);
  const configResponse = await request.get(
    `${BASE_URL}/__quietline_localnet_wallet/config`,
  );
  expect(configResponse.ok()).toBeTruthy();
  const config = (await configResponse.json()).result as LocalnetConfig;
  expect(config.walletName).toBe("Localnet (dev)");
  expect(BigInt(config.usdcTokenAddress)).toBeGreaterThan(0n);

  await page.goto("/vault");
  const localToggle = page.getByRole("button", { name: "LOCAL", exact: true });
  await expect(localToggle).toBeVisible();
  await expect(localToggle).toHaveAttribute("aria-pressed", "false");
  await localToggle.click();
  await expect(localToggle).toHaveAttribute("aria-pressed", "true");
  await connectLocalnet(page);
  await expect(page.getByText("LOCALNET (DEV) / DEV WALLET")).toBeVisible();

  const counterparty = config.identities.find(
    (identity) => identity.id === "bob",
  );
  expect(counterparty).toBeTruthy();
  await page.getByRole("link", { name: "Counterparties" }).click();
  await page.getByLabel("New address book label").fill("Bob trading desk");
  await page
    .getByLabel("New address book address")
    .fill(counterparty?.address ?? "");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const encryptedMailLink = page.getByRole("link", {
    name: "Encrypted Mail",
  });
  await expect(encryptedMailLink).toHaveAttribute("href", "/mail/inbox");
  await page.getByRole("link", { name: "New RFQ" }).click();
  await expect(page).toHaveURL(/\/vault(?:#desk)?/);
  await expect(page.getByText("CORRESPONDENCE CONTACT")).toBeVisible();

  const desk = page.getByRole("region", {
    name: "Block RFQ",
    exact: true,
  });
  const market = desk.getByLabel("Private intent market");
  const sellAmount = desk.getByLabel("Private intent sell amount");
  const minimumReceive = desk.getByLabel("Private intent minimum receive");
  await expect(desk).toBeVisible();
  await expect(market).toHaveValue("STRK_USDC");
  await expect(sellAmount).toHaveValue("0.1");
  await expect(minimumReceive).toHaveValue("0.19");

  await quote(desk, "USDC");
  await expect(desk.getByLabel("Solver quote")).toContainText("0.1994 USDC");
  await desk
    .getByRole("button", { name: "Execute local private intent" })
    .click();
  await expect(
    desk.getByText("Private intent settled through the local solver.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await expect(
    desk.getByText("3 private transactions confirmed"),
  ).toBeVisible();

  const usdcAfterFirstFill = await privateBalance(
    request,
    config.usdcTokenAddress,
  );
  expect(usdcAfterFirstFill).toBe(199_400n);

  await market.selectOption("USDC_STRK");
  await expect(sellAmount).toHaveValue("0.1");
  await expect(minimumReceive).toHaveValue("0.049");
  await quote(desk, "STRK");
  await expect(desk.getByLabel("Solver quote")).toContainText("0.04985 STRK");
  await desk
    .getByRole("button", { name: "Execute local private intent" })
    .click();
  await expect(
    desk.getByText("Private intent settled through the local solver.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5 * 60_000 });

  const usdcAfterReverseFill = await privateBalance(
    request,
    config.usdcTokenAddress,
  );
  expect(usdcAfterReverseFill).toBe(99_400n);

  await sellAmount.fill("0.05");
  await minimumReceive.fill("0.024");
  await quote(desk, "STRK");
  await desk.getByLabel("No fill → expiry refund").check();
  await desk
    .getByRole("button", { name: "Execute local private intent" })
    .click();
  await expect(
    desk.getByText("Private intent refunded after local expiry.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await expect(
    desk.getByText("2 private transactions confirmed"),
  ).toBeVisible();
  await expect(privateBalance(request, config.usdcTokenAddress)).resolves.toBe(
    usdcAfterReverseFill,
  );

  await market.selectOption("STRK_USDC");
  await sellAmount.fill("100000");
  await minimumReceive.fill("1");
  await desk.getByRole("button", { name: "Get private quote" }).click();
  await expect(
    desk.getByRole("alert").filter({ hasText: /inventory cannot cover/i }),
  ).toBeVisible({ timeout: 60_000 });
});
