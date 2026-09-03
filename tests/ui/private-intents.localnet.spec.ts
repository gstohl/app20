import {
  LOCALNET_WALLET_API,
  connectLocalnetWallet,
  expect,
  localNetworkToggle,
  localnetIdentity,
  primeLocalnetMailSeed,
  restoreLocalnetMailRandomness,
  selectLocalNetwork,
  test,
  type APIRequestContext,
  type LocalnetConfig,
  type LocalnetIdentityId,
  type Locator,
  type Page,
} from "./support/localnet";

test.describe.configure({ mode: "serial" });

async function switchIdentity(
  page: Page,
  config: LocalnetConfig,
  id: LocalnetIdentityId,
) {
  const target = localnetIdentity(config, id);
  const selector = page.locator(`[data-localnet-identity="${id}"]`);
  if ((await selector.getAttribute("aria-pressed")) !== "true") {
    await selector.click();
  }
  await expect(selector).toHaveAttribute("aria-pressed", "true");
  if (
    (await page.getByRole("button", { name: "Connect wallet" }).count()) > 0
  ) {
    await connectLocalnetWallet(page);
  }
  await expect(
    page
      .getByRole("region", { name: "Wallet session" })
      .locator("[title]")
      .first(),
  ).toHaveAttribute("title", new RegExp(target.address.slice(2), "i"));
}

async function ensureMailboxKey(page: Page, identity: LocalnetIdentityId) {
  let setup = page.getByRole("button", {
    name: "Load device key & register",
  });
  if ((await setup.count()) === 0) {
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    setup = page.getByRole("button", {
      name: "Load device key & register",
    });
  }
  await expect(setup).toBeVisible();
  await primeLocalnetMailSeed(page, identity);
  try {
    await setup.click();
  } finally {
    await restoreLocalnetMailRandomness(page);
  }
  const backupHeading = page.getByText(
    "Back up now — this phrase is shown once",
  );
  const scanButton = page.getByRole("button", { name: "Check for new mail" });
  await expect
    .poll(
      async () => {
        if (await backupHeading.isVisible()) return "backup";
        return (await scanButton.isEnabled()) ? "ready" : "waiting";
      },
      { timeout: 120_000 },
    )
    .not.toBe("waiting");
  if (await backupHeading.isVisible()) {
    const phrase = (
      await backupHeading.locator("..").locator("code").innerText()
    ).trim();
    expect(phrase).toMatch(/^(?:[0-9a-f]{8} ){7}[0-9a-f]{8}$/);
    await page
      .getByRole("button", { name: "I saved the backup — open mailbox" })
      .click();
  }
  await expect(scanButton).toBeEnabled({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "Back up RFQ history" }),
  ).toBeEnabled({ timeout: 60_000 });
  const deleteDraft = page.getByRole("button", {
    name: "Delete draft…",
    exact: true,
  });
  if ((await deleteDraft.count()) > 0) {
    page.once("dialog", (dialog) => dialog.accept());
    await deleteDraft.click();
  } else {
    const close = page.getByRole("button", { name: "Close", exact: true });
    if ((await close.count()) > 0) await close.click();
  }
}

async function scanRecent(page: Page) {
  const button = page.getByRole("button", { name: "Check for new mail" });
  await expect(button).toBeEnabled({ timeout: 120_000 });
  await button.click();
  const inbox = page.getByRole("button", { name: /^Inbox \d+$/ });
  if ((await inbox.getAttribute("aria-current")) !== "page") {
    await inbox.click();
  }
  await expect(inbox).toHaveAttribute("aria-current", "page");
}

async function privateBalance(
  request: APIRequestContext,
  token: string,
  runtimeEpoch: string,
) {
  const response = await request.post(`${LOCALNET_WALLET_API}/balances`, {
    headers: { Origin: new URL(LOCALNET_WALLET_API).origin },
    data: { identity: "alice", tokens: [token], runtimeEpoch },
  });
  expect(response.ok()).toBeTruthy();
  return BigInt((await response.json()).result[0].balance);
}

async function createBlocks(
  request: APIRequestContext,
  runtimeEpoch: string,
  count: number,
) {
  let previous = -1;
  for (let index = 0; index < count; index += 1) {
    const response = await request.post(
      `${LOCALNET_WALLET_API}/devnet/create-block`,
      {
        headers: { Origin: new URL(LOCALNET_WALLET_API).origin },
        data: { runtimeEpoch },
      },
    );
    if (!response.ok()) throw new Error(await response.text());
    const blockNumber = (await response.json()).result.blockNumber as number;
    expect(blockNumber).toBeGreaterThan(previous);
    previous = blockNumber;
  }
  return previous;
}

async function prepareCohortReview(desk: Locator) {
  const acknowledge = desk.getByRole("button", {
    name: "Acknowledge and continue",
  });
  if (await acknowledge.isVisible()) await acknowledge.click();
  const preflight = desk.getByLabel("Privacy preflight");
  await expect(preflight).toContainText("Exact size and floor stay local");
  await expect(preflight).toContainText(
    "invited maker(s) receive: expiry, pair, side, size bucket",
  );
  await expect(preflight).toContainText(
    "OPEN payout-note amount, pair, per-lock Take amounts",
  );
  await expect(preflight).toContainText("BRIEFED ONCE");
  const prepare = desk.getByRole("button", {
    name: "Prepare size-blind cohort review",
  });
  await expect(prepare).toBeEnabled();
  await prepare.click();
  const review = desk.getByLabel("Maker cohort review");
  await expect(review).toContainText("What makers receive");
  await expect(review).toContainText("Local-only exact sell");
  await expect(review).toContainText("Local-only floor");
  await expect(review).toContainText("local-fixture-checkpoint-v1");
  await expect(
    desk.getByLabel("Invited maker cohort").getByRole("listitem"),
  ).toHaveCount(2);
  await expect(review).toContainText("raw inventory not exposed");
  await review.getByRole("checkbox").check();
}

async function requestCollateralizedQuotes(page: Page, desk: Locator) {
  const posted = page.waitForRequest(
    (candidate) =>
      candidate.method() === "POST" &&
      candidate.url().endsWith("/private-intents/quotes"),
    { timeout: 180_000 },
  );
  await desk
    .getByRole("button", { name: "Request collateralized quotes" })
    .click();
  const outgoing = await posted;
  const comparison = desk.getByRole("region", {
    name: /Compare all makers/,
  });
  await expect(comparison).toBeVisible({ timeout: 180_000 });
  await expect(comparison).toBeFocused();
  await expect(comparison.getByText(/received · consistent/)).toHaveCount(2, {
    timeout: 60_000,
  });
  await expect(comparison).not.toContainText(
    /raw inventory|available balance/i,
  );
  return outgoing.postDataJSON() as Record<string, unknown>;
}

function expectSealedRequest(
  wire: Record<string, unknown>,
  hiddenValues: string[],
) {
  const rfq = wire.rfq as Record<string, unknown>;
  expect(rfq).toMatchObject({
    version: 2,
    domain: "app20/private-rfq/v2",
    chainId: "starknet:APP20_LOCALNET",
  });
  expect(rfq).toHaveProperty("sellBucketMinBaseUnits");
  expect(rfq).toHaveProperty("sellBucketMaxBaseUnits");
  const serialized = JSON.stringify(wire);
  expect(serialized).not.toMatch(
    /exactSellAmount|localFloor|minBuyAmount|requestedFloor/,
  );
  for (const hidden of hiddenValues) expect(serialized).not.toContain(hidden);
}

async function takeAtomically(
  desk: Locator,
  expectedShape: RegExp,
  invokeUrls: string[],
) {
  await desk
    .getByRole("button", { name: "Review selected quote fills" })
    .click();
  const finalReview = desk.getByRole("region", {
    name: "Final atomic Take review",
  });
  await expect(finalReview).toBeVisible();
  await expect(finalReview).toBeFocused();
  await expect(finalReview).toContainText(expectedShape);
  await expect(finalReview).toContainText("0 bps · 0 base units");
  await expect(finalReview).toContainText(
    "there is no later claim or taker refund step",
  );
  const before = invokeUrls.length;
  await finalReview
    .getByRole("button", { name: "Take atomically on LOCALNET" })
    .click();
  await expect(
    desk.getByText("Atomic receive confirmed from the exact escrow Take.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5 * 60_000 });
  expect(invokeUrls).toHaveLength(before + 1);
  await expect(desk.getByText(/Authority stage: lifecycle v3/)).toBeVisible();
  await expect(
    desk.getByRole("button", { name: "Claim", exact: true }),
  ).toHaveCount(0);
  await expect(
    desk.getByRole("button", { name: "Refund", exact: true }),
  ).toHaveCount(0);
}

test("RFQ operations dashboard and endpoint expose only browser-safe localnet status", async ({
  page,
  request,
}) => {
  const response = await request.get(
    `${LOCALNET_WALLET_API}/rfq/operations/status`,
  );
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.result).toMatchObject({
    schema: "app20/rfq-operations-status/v1",
    environment: "localnet",
    mode: "running",
    claimsAndRefundsEnabled: true,
    rawInventoryExposed: false,
  });
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(
    /settlementAccount|processPid|operationLog|availableBaseUnits|rawBalance/i,
  );
  await page.goto("/rfq/operations");
  await expect(page).toHaveURL(/\/rfq\/operations$/);
  await expect(
    page.getByRole("heading", { name: "RFQ operations" }),
  ).toBeVisible();
  await expect(
    page.getByText(/It does not expose or request raw health/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Invited maker cohort").getByRole("listitem"),
  ).toHaveCount(2);
});

test("v3 keeps floors sealed, expires locks, and atomically settles single and split Takes", async ({
  page,
  request,
  localnetConfig: config,
}) => {
  test.setTimeout(20 * 60_000);
  expect(BigInt(config.usdcTokenAddress)).toBeGreaterThan(0n);

  const invokeUrls: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.method() !== "POST") return;
    if (/\/(?:invoke|privacy)$/.test(outgoing.url()))
      invokeUrls.push(outgoing.url());
  });

  const strkBefore = await privateBalance(
    request,
    config.tokenAddress,
    config.runtimeEpoch,
  );
  const usdcBefore = await privateBalance(
    request,
    config.usdcTokenAddress,
    config.runtimeEpoch,
  );

  await page.goto("/vault#desk");
  await expect(page).toHaveURL(/\/rfq#desk$/);
  const localToggle = localNetworkToggle(page);
  await expect(localToggle).toHaveAttribute("aria-pressed", "false");
  await selectLocalNetwork(page);
  await connectLocalnetWallet(page);
  await expect(page.getByText("LOCALNET (DEV) / DEV WALLET")).toBeVisible();

  const desk = page.getByRole("region", { name: "Block RFQ", exact: true });
  const market = desk.getByLabel("Private intent market");
  const sellAmount = desk.getByLabel("Private intent sell amount");
  const minimumReceive = desk.getByLabel("Private intent minimum receive");
  await expect(market).toHaveValue("STRK_USDC");
  await expect(sellAmount).toHaveValue("0.1");
  await expect(minimumReceive).toHaveValue("0.198");

  // First let a real 90-second lock window close. The exact Take remains
  // disabled and a fresh request can be prepared without a public fallback.
  await prepareCohortReview(desk);
  const expiringWire = await requestCollateralizedQuotes(page, desk);
  expectSealedRequest(expiringWire, []);
  await expect(desk.getByText("SINGLE FILL SELECTED")).toBeVisible();
  await desk
    .getByRole("button", { name: "Review selected quote fills" })
    .click();
  const expiringReview = desk.getByRole("region", {
    name: "Final atomic Take review",
  });
  const expiringTake = expiringReview.getByRole("button", {
    name: "Take atomically on LOCALNET",
  });
  await expect(expiringTake).toBeEnabled();
  await page.waitForTimeout(91_000);
  await expect(expiringReview).toContainText("expired", { timeout: 10_000 });
  await expect(expiringReview).toContainText(/lock expired/i);
  await expect(expiringTake).toBeDisabled();
  await expiringReview
    .getByRole("button", { name: "Decline locked quotes" })
    .click();
  await expect(market).toBeEnabled();
  await expect(desk).toContainText(
    "RFQ cancelled. No Take was submitted; makers recover unused collateral after lock expiry.",
  );
  // Refresh the browser-safe operations capability after the full lock TTL;
  // the cohort confirmation itself must never be carried across that window.
  await page.reload();
  await connectLocalnetWallet(page);
  await expect(desk.getByText("OPERATIONS · RUNNING")).toBeVisible();

  // A larger clip is still covered by one maker. Only the fixed ladder bucket
  // crosses the browser boundary; the exact 13 STRK and floor stay sealed.
  await sellAmount.fill("13");
  await minimumReceive.fill("25.74");
  await prepareCohortReview(desk);
  const singleWire = await requestCollateralizedQuotes(page, desk);
  expectSealedRequest(singleWire, ["13000000000000000000", "25740000"]);
  expect(singleWire.rfq).toMatchObject({
    sellBucketMinBaseUnits: "10000000000000000000",
    sellBucketMaxBaseUnits: "25000000000000000000",
  });
  const singleComparison = desk.getByRole("region", {
    name: /Compare all makers/,
  });
  await expect(singleComparison).toContainText("SINGLE FILL SELECTED");
  await expect(singleComparison).toContainText(
    "sell 13 STRK · receive 26.07774 USDC",
  );
  await expect(singleComparison).toContainText("app20-localnet-solver-b");
  await takeAtomically(desk, /Single collateralized fill/, invokeUrls);

  expect(
    await privateBalance(request, config.usdcTokenAddress, config.runtimeEpoch),
  ).toBe(usdcBefore + 26_077_740n);
  expect(
    await privateBalance(request, config.tokenAddress, config.runtimeEpoch),
  ).toBe(strkBefore - 13n * 10n ** 18n);

  // The reverse direction exceeds either maker's 7 STRK inventory, so the
  // coordinator must construct one atomic Take over both locks.
  await desk.getByRole("button", { name: "Start another RFQ" }).click();
  await market.selectOption("USDC_STRK");
  await sellAmount.fill("24.5");
  await minimumReceive.fill("12.1275");

  const missingEpoch = await request.post(
    `${LOCALNET_WALLET_API}/devnet/create-block`,
    {
      headers: { Origin: new URL(LOCALNET_WALLET_API).origin },
      data: {},
    },
  );
  expect(missingEpoch.status()).toBe(409);
  await prepareCohortReview(desk);
  const splitOutgoing = await requestCollateralizedQuotes(page, desk);
  const splitComparison = desk.getByRole("region", {
    name: /Compare all makers/,
  });
  await expect(splitComparison).toBeVisible({ timeout: 180_000 });
  await expect(splitComparison.getByText(/received · consistent/)).toHaveCount(
    2,
    { timeout: 60_000 },
  );
  const splitWire = splitOutgoing;
  expectSealedRequest(splitWire, ["24500000", "12127500000000000000"]);
  expect(splitWire.rfq).toMatchObject({
    sellBucketMinBaseUnits: "10000000",
    sellBucketMaxBaseUnits: "25000000",
  });
  await expect(splitComparison).toContainText("SPLIT FILL SELECTED · 2 LOCKS");
  await expect(splitComparison).toContainText(
    "No single winning lock covers the full exact size",
  );
  await expect(splitComparison).toContainText("app20-localnet-solver");
  await expect(splitComparison).toContainText("app20-localnet-solver-b");
  await takeAtomically(desk, /2-maker atomic split/, invokeUrls);

  expect(
    await privateBalance(request, config.usdcTokenAddress, config.runtimeEpoch),
  ).toBe(usdcBefore + 1_577_740n);
  expect(
    await privateBalance(request, config.tokenAddress, config.runtimeEpoch),
  ).toBeGreaterThan(strkBefore - 1n * 10n ** 18n);

  // Leave the split payout note mature for the Mail-backed invoice journey.
  await createBlocks(request, config.runtimeEpoch, 10);

  await page.goto("/mail/inbox");
  await selectLocalNetwork(page);
  await switchIdentity(page, config, "alice");
  await ensureMailboxKey(page, "alice");

  const ipfsWrites: string[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      outgoing.url().includes("/__app20_localnet_ipfs/api/v0/add")
    ) {
      ipfsWrites.push(outgoing.url());
    }
  });
  const backUpRfqHistory = page.getByRole("button", {
    name: "Back up RFQ history",
  });
  await expect(backUpRfqHistory).toBeEnabled({ timeout: 60_000 });
  await backUpRfqHistory.click();
  await expect(
    page.getByText(
      /RFQ records? backed up through a CID-verified encrypted blob pointer/,
    ),
  ).toBeVisible({ timeout: 180_000 });
  expect(ipfsWrites.length).toBeGreaterThan(0);
  await expect(
    page.getByText(/Backup plaintext never left this browser/),
  ).toBeVisible();

  // Model loss of the local RFQ object store without invoking the product's
  // explicit forget action (which correctly creates deletion tombstones).
  // Restore must traverse the encrypted IPFS pointer and recreate evidence
  // without recreating any Take signing authority.
  const alice = localnetIdentity(config, "alice");
  const erasedRecordCount = await page.evaluate(
    async ({ chainId, account }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
      const storage = storageModule.createIndexedDbRfqStorage();
      const records = await storage.list(chainId, account);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("app20-rfq-resume");
        request.onerror = () =>
          reject(request.error ?? new Error("Could not open RFQ storage."));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("lifecycle", "readwrite");
          transaction.objectStore("lifecycle").clear();
          transaction.onerror = () =>
            reject(
              transaction.error ?? new Error("Could not erase RFQ storage."),
            );
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      });
      return records.length;
    },
    { chainId: config.chainId, account: alice.address },
  );
  expect(erasedRecordCount).toBeGreaterThan(0);

  await scanRecent(page);
  await expect(
    page.getByText("RFQ HISTORY BACKUP", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Merge verified RFQ history" })
    .click();
  await expect(
    page.getByText(/Authenticated backup sequence .* restored\./),
  ).toBeVisible({ timeout: 180_000 });
  const restoredHistory = await page.evaluate(
    async ({ chainId, account }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
      const lifecycleModule = await dynamicImport(
        "/src/app/rfq/rfq-lifecycle.ts",
      );
      const rows = await storageModule
        .createIndexedDbRfqStorage()
        .list(chainId, account);
      return rows.map((row: any) => ({
        restoredFromBackup: row.restoredFromBackup === true,
        hasSigningKey: "takerSigningKey" in row,
        maySubmit: lifecycleModule.lifecycleMaySubmit(
          row,
          Math.floor(Date.now() / 1_000),
        ),
      }));
    },
    { chainId: config.chainId, account: alice.address },
  );
  expect(restoredHistory).toHaveLength(erasedRecordCount);
  expect(restoredHistory).toEqual(
    Array.from({ length: erasedRecordCount }, () => ({
      restoredFromBackup: true,
      hasSigningKey: false,
      maySubmit: false,
    })),
  );

  const invoiceBody = `Lane U localnet USDC invoice ${Date.now()}`;
  await switchIdentity(page, config, "bob");
  await ensureMailboxKey(page, "bob");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByLabel(/^To/).fill(localnetIdentity(config, "alice").address);
  await page
    .getByPlaceholder(
      "Write a private message, or leave blank when sending attachments only",
    )
    .fill(invoiceBody);
  await page.getByRole("button", { name: "+ Invoice", exact: true }).click();
  const invoiceToken = page.getByLabel("Invoice token");
  await expect(invoiceToken.locator("option")).toHaveText(["STRK", "USDC"]);
  await invoiceToken.selectOption("USDC");
  const invoiceAmount = page.getByLabel("USDC requested");
  await invoiceAmount.fill("0.1");
  await page.getByLabel("Invoice memo (optional)").fill("Lane U acceptance");
  await expect(invoiceAmount).toHaveValue("0.1");
  await page.getByRole("button", { name: "Send encrypted message" }).click();
  await expect(page.getByRole("heading", { name: "New document" })).toHaveCount(
    0,
    { timeout: 180_000 },
  );

  await switchIdentity(page, config, "alice");
  await ensureMailboxKey(page, "alice");
  await scanRecent(page);
  const invoiceRow = page.getByRole("button").filter({ hasText: invoiceBody });
  await expect(invoiceRow).toBeVisible({ timeout: 60_000 });
  await invoiceRow.click();
  await expect(
    page.getByText(/This unsigned message requests\s+0\.1 USDC/),
  ).toBeVisible();
  await expect(
    page.getByText(/Mail coordinates the invoice but does not authenticate/),
  ).toBeVisible();
  await expect(page.getByText("Mail key signature verified")).toHaveCount(0);
  await page.getByRole("button", { name: "Pay privately with STRK" }).click();
  await expect(page).toHaveURL(/\/rfq(?:#desk)?$/, { timeout: 60_000 });

  const invoiceDesk = page.getByRole("region", {
    name: "Pay invoice privately",
  });
  await expect(
    invoiceDesk.getByText("INVOICE MODE · STRK → USDC"),
  ).toBeVisible();
  await expect(
    invoiceDesk.getByLabel("Private intent minimum receive"),
  ).toHaveCount(0);
  await expect(invoiceDesk.getByText(/0\.1 USDC/).first()).toBeVisible();
  await prepareCohortReview(invoiceDesk);
  await requestCollateralizedQuotes(page, invoiceDesk);
  await expect(invoiceDesk.getByText("SINGLE FILL SELECTED")).toBeVisible();
  await invoiceDesk
    .getByRole("button", { name: "Review selected quote fills" })
    .click();
  const invoiceReview = invoiceDesk.getByRole("region", {
    name: "Final atomic Take review",
  });
  const invoiceInvokesBefore = invokeUrls.length;
  await invoiceReview
    .getByRole("button", { name: "Take atomically on LOCALNET" })
    .click();
  await expect(page).toHaveURL(/\/mail\/inbox$/, { timeout: 5 * 60_000 });
  expect(invokeUrls).toHaveLength(invoiceInvokesBefore + 1);

  // The hard return navigation intentionally drops the in-memory wallet and
  // unlocked mailbox session. Re-establish both before scanning.
  await switchIdentity(page, config, "alice");
  await ensureMailboxKey(page, "alice");
  await scanRecent(page);
  await expect(invoiceRow).toBeVisible({ timeout: 120_000 });
  await invoiceRow.click();
  await expect(
    page.getByText(/USDC note from the private exchange matures/),
  ).toBeVisible();
  await createBlocks(request, config.runtimeEpoch, 9);
  await expect(page.getByText(/\(1 block left\)/)).toBeVisible({
    timeout: 15_000,
  });
  await createBlocks(request, config.runtimeEpoch, 1);
  const complete = page.getByRole("button", { name: "Complete payment" });
  await expect(complete).toBeEnabled({ timeout: 15_000 });
  await complete.click();
  await expect(
    page.getByText("Private USDC payment and encrypted memo confirmed."),
  ).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Payment verified locally")).toBeVisible();
  await expect(complete).toHaveCount(0);

  await switchIdentity(page, config, "bob");
  await ensureMailboxKey(page, "bob");
  await scanRecent(page);
  const paymentMemoRow = page.getByRole("button", {
    name: /Settlement memo · 0\.1 USDC/,
  });
  await expect(paymentMemoRow).toBeVisible({ timeout: 60_000 });
  await paymentMemoRow.click();
  await expect(page.getByText("PAYMENT MEMO", { exact: true })).toBeVisible();
  await expect(page.getByText(/claims they sent 0\.1 USDC/)).toBeVisible();
});

test("modeled localnet authority survives TTL, two tabs, disagreement, reorg, and reload without resubmission", async ({
  page,
  context,
  localnetConfig: config,
}) => {
  test.setTimeout(3 * 60_000);
  const account = localnetIdentity(config, "alice").address;
  const rfqId = "0x7a11";

  await page.goto("/rfq#activity");
  await selectLocalNetwork(page);
  await connectLocalnetWallet(page);

  const seeded = await page.evaluate(
    async ({ account, chainId, escrowAddress, sellToken, buyToken, rfqId }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const lifecycle = await dynamicImport("/src/app/rfq/rfq-lifecycle.ts");
      const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
      const epochModule = await dynamicImport(
        "/src/dev/localnet-runtime-epoch.ts",
      );
      const now = Math.floor(Date.now() / 1_000);
      const requestDigest = `0x${"51".repeat(32)}`;
      const terms = {
        pairId: "STRK_USDC",
        sellSymbol: "STRK",
        sellAddress: sellToken,
        sellDecimals: 18,
        sellAmount: "100000000000000000",
        buySymbol: "USDC",
        buyAddress: buyToken,
        buyDecimals: 6,
        minBuyAmount: "198000",
        buyAmount: "199600",
        rfqExpiresAt: now + 1_200,
      };
      let record = lifecycle.createRfqLifecycleRecord({
        mode: "v3",
        chainId,
        account,
        rfqId,
        state: "reviewing",
        now,
        requestDigest,
        terms,
        settlement: {
          version: "Localnet V3",
          escrowAddress,
          dealId: rfqId,
          deadline: now + 1_200,
        },
        bucket: {
          min: "50000000000000000",
          max: "100000000000000000",
        },
        takerCommitment:
          "0x746db56abc4d9fab4832ee42e92e96bbbf8cf4c9fd063b8515bda90d1e8aa5d",
        takerSigningKey: "0x66",
        fills: [
          {
            makerId: "app20-localnet-solver-b",
            lockId: "0x41",
            amountA: terms.sellAmount,
            amountB: terms.buyAmount,
            lockExpiresAt: now + 1_200,
          },
        ],
      });
      record = lifecycle.beginRfqPhaseAttempt(
        record,
        "take",
        "browser-take",
        now + 1,
        lifecycle.takeAttemptTargetFromLifecycle(record),
      );
      record = lifecycle.updateRfqPhaseAttempt(
        record,
        "take",
        "submitted-unknown",
        now + 2,
        { transactionHash: "0x703" },
      );
      record = lifecycle.transitionRfqLifecycle(
        record,
        "submission-unknown",
        now + 2,
      );
      record = lifecycle.confirmRfqV3Take(
        record,
        {
          tokenA: sellToken,
          totalA: BigInt(terms.sellAmount),
          tokenB: buyToken,
          totalB: BigInt(terms.buyAmount),
          fillCount: 1,
          fillsDigest:
            "0x68af3151d05c2da19b8d81457afdea339dfc7211ad85372e9805e32bd003f8c",
          lockTaken: [{ lockId: "0x41", amountA: terms.sellAmount }],
        },
        now + 3,
      );
      await storageModule.createIndexedDbRfqStorage().save(record);
      return {
        runtimeEpoch: epochModule.localnetRuntimeEpoch(),
      };
    },
    {
      account,
      chainId: config.chainId,
      escrowAddress: config.escrowAddress,
      sellToken: config.tokenAddress,
      buyToken: config.usdcTokenAddress,
      rfqId,
    },
  );
  expect(seeded.runtimeEpoch).toMatch(/^[0-9a-f]{32}$/);

  let authorityMode: "authoritative" | "outage" | "disagreement" | "reorged" =
    "authoritative";
  let reorgAuthorityPage: Page | undefined;
  let authorityRevision = 100;
  let valueMutationRequests = 0;
  const valueMutationPaths = [
    "/invoke",
    "/privacy",
    "/escrow/ensure-ticket",
    "/private-intents/quotes",
    "/private-intents/select-quote",
    "/private-intents/release-intent",
    "/private-intents/funding-prepare",
    "/private-intents/funding-unknown",
    "/private-intents/funding-abandon",
    "/private-intents/converge",
    "/private-intents/take-prepare",
    "/private-intents/take-unknown",
    "/private-intents/take-abandon",
    "/private-intents/take-observe",
    "/private-intents/take-converge",
    "/private-intents/sign-quote",
    "/private-intents/solve",
    "/private-intents/expire",
  ];
  context.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      valueMutationPaths.some((path) => browserRequest.url().includes(path))
    )
      valueMutationRequests += 1;
  });
  await context.route("**/rfq/authority/verify", async (route) => {
    if (
      authorityMode === "outage" ||
      (authorityMode === "reorged" &&
        route.request().frame().page() !== reorgAuthorityPage)
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "modeled reader outage" }),
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, string>;
    const observedAt = Math.floor(Date.now() / 1_000);
    authorityRevision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          source: "localnet-chain-authority",
          runtimeEpoch: body.runtimeEpoch,
          chainId: body.chainId,
          account: body.account,
          rfqId: body.rfqId,
          dealId: body.dealId,
          lifecycle: "v3",
          status: authorityMode,
          revision: authorityRevision,
          observedAt,
          validUntil: observedAt + (authorityMode === "authoritative" ? 2 : 30),
          ...(authorityMode === "authoritative"
            ? {
                fillsDigest:
                  "0x68af3151d05c2da19b8d81457afdea339dfc7211ad85372e9805e32bd003f8c",
                lockTaken: [{ lockId: "0x41", amountA: "100000000000000000" }],
              }
            : {}),
        },
      }),
    });
  });

  await page.reload();
  await connectLocalnetWallet(page);
  await expect(page).toHaveURL(/\/rfq#activity$/);
  await expect(
    page.getByText("Finalized on the configured chain").first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", {
      name: "Terminal lifecycle finalized locally",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/No exportable receipt is available/),
  ).toBeVisible();
  await expect(
    page.getByText(/Sepolia\/Mainnet production authority remains unavailable/),
  ).toBeVisible();
  await expect(page.getByText("No authoritative receipt")).toHaveCount(0);

  // Stop verifier responses and allow the two-second live capability to expire
  // against the real browser clock. The one-second presentation clock must
  // visibly demote it before the next five-second verifier attempt.
  authorityMode = "outage";
  await expect(page.getByText("Verification pending").first()).toBeVisible({
    timeout: 8_000,
  });
  const staleSnapshot = await page.evaluate(
    async ({ account, chainId, rfqId }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
      const rows = await storageModule
        .createIndexedDbRfqStorage()
        .list(chainId, account);
      return rows.find((row: { rfqId?: string }) => row.rfqId === rfqId);
    },
    { account, chainId: config.chainId, rfqId },
  );
  expect(staleSnapshot).toBeTruthy();

  authorityMode = "disagreement";
  await page.reload();
  await connectLocalnetWallet(page);
  await expect(
    page.getByText("Reader disagreement · unverified").first(),
  ).toBeVisible({ timeout: 15_000 });

  const secondPage = await context.newPage();
  await secondPage.goto("/rfq#activity");
  await selectLocalNetwork(secondPage);
  await connectLocalnetWallet(secondPage);
  for (const candidate of [page, secondPage]) {
    await expect(
      candidate.getByText("Reader disagreement · unverified").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      candidate.getByRole("heading", { name: "Needs reconciliation" }),
    ).toBeVisible();
    await expect(
      candidate.getByText(/cannot drive a value action until/),
    ).toBeVisible();
    await expect(
      candidate.getByRole("button", { name: /Forget browser history/ }),
    ).toHaveCount(0);
  }

  reorgAuthorityPage = secondPage;
  authorityMode = "reorged";
  await secondPage.reload();
  await connectLocalnetWallet(secondPage);
  await expect(
    secondPage
      .getByText("Reorg-invalidated · canonical membership lost")
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    secondPage.getByText(/nothing was resubmitted/i).first(),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("button", { name: /Forget browser history/ }),
  ).toHaveCount(0);
  const forgetResult = await secondPage.evaluate(
    async ({ account, chainId, rfqId }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
      const storage = storageModule.createIndexedDbRfqStorage();
      const rows = await storage.list(chainId, account);
      const record = rows.find(
        (row: { rfqId?: string }) => row.rfqId === rfqId,
      );
      if (!record) return "missing reorg record";
      try {
        await storage.remove(record);
        return "accepted";
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { account, chainId: config.chainId, rfqId },
  );
  expect(forgetResult).toMatch(/refused removal of unresolved/i);
  await expect(
    page.getByText("Reader disagreement · unverified").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs reconciliation" }),
  ).toBeVisible();

  // The first page is deliberately left on its older disagreement snapshot.
  // Its pre-reorg row must lose the IndexedDB CAS against the second page's
  // durable reorg row rather than resurrecting the terminal outcome.
  const staleSaveResult = await page.evaluate(async (record) => {
    const dynamicImport = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const storageModule = await dynamicImport("/src/app/rfq/rfq-storage.ts");
    try {
      await storageModule.createIndexedDbRfqStorage().save(record);
      return "accepted";
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  }, staleSnapshot);
  expect(staleSaveResult).toMatch(
    /stale lifecycle snapshot|exact predecessor/i,
  );

  await secondPage.getByRole("link", { name: "Active", exact: true }).click();
  await expect(
    secondPage.getByText(
      /Restoring and reconciling never automatically resubmits fund, fill, claim, or refund/,
    ),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("button", {
      name: /Take atomically|Accept and fund|Request maker fill|Claim|Refund/,
    }),
  ).toHaveCount(0);

  authorityMode = "outage";
  await page.reload();
  await connectLocalnetWallet(page);
  await expect(
    page.getByText("Reorg-invalidated · canonical membership lost").first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Needs reconciliation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Forget browser history/ }),
  ).toHaveCount(0);
  expect(valueMutationRequests).toBe(0);
  await secondPage.close();
});
