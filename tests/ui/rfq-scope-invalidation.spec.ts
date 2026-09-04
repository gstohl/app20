import {
  expect,
  localnetIdentity,
  openLocalnetPage,
  test,
  type LocalnetConfig,
  type LocalnetIdentityId,
  type Locator,
  type Page,
} from "./support/localnet";

const DISCARD_MESSAGE =
  "The quote response was discarded because the connected wallet account, chain, or provider changed. No quote was added to this context.";

async function prepareQuoteRequest(desk: Locator) {
  const acknowledge = desk.getByRole("button", {
    name: "Acknowledge and continue",
  });
  if (await acknowledge.isVisible()) await acknowledge.click();
  await expect(desk.getByLabel("Privacy preflight")).toContainText(
    "BRIEFED ONCE",
  );
  await desk
    .getByRole("button", { name: "Prepare size-blind cohort review" })
    .click();
  await desk.getByLabel("Maker cohort review").getByRole("checkbox").check();
  await expect(
    desk.getByRole("button", { name: "Request collateralized quotes" }),
  ).toBeEnabled();
}

async function openLocalDesk(
  page: Page,
  options: {
    pairId?: "STRK_USDC" | "USDC_STRK";
    identity?: LocalnetIdentityId;
  } = {},
) {
  await openLocalnetPage(page, "/rfq#desk", {
    identity: options.identity,
  });
  const desk = page.getByRole("region", { name: "Block RFQ", exact: true });
  await expect(desk).toBeVisible();
  if (options.pairId && options.pairId !== "STRK_USDC")
    await desk.getByLabel("Private intent market").selectOption(options.pairId);
  await prepareQuoteRequest(desk);
  return desk;
}

async function expectNoPersistedCompletion(
  page: Page,
  config: LocalnetConfig,
  identity: LocalnetIdentityId = "alice",
) {
  const accountIdentity = localnetIdentity(config, identity);
  await expect
    .poll(async () => {
      const records = await page.evaluate(
        async ({ chainId, account }) => {
          const dynamicImport = new Function("path", "return import(path)") as (
            path: string,
          ) => Promise<any>;
          const storageModule = await dynamicImport(
            "/src/app/rfq/rfq-storage.ts",
          );
          return storageModule
            .createIndexedDbRfqStorage()
            .list(chainId, account);
        },
        { chainId: config.chainId, account: accountIdentity.address },
      );
      return {
        count: records.length,
        hasCompletion: records.some(
          (record: any) => record.selectedQuote || record.state === "quoted",
        ),
      };
    })
    .toEqual({
      count: 1,
      hasCompletion: false,
    });
}

async function delayQuoteResponse(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/private-intents/quotes", async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

test("an Alice quote request is discarded after switching to Bob", async ({
  page,
  localnetConfig: config,
}) => {
  const desk = await openLocalDesk(page);
  const release = await delayQuoteResponse(page);
  const quoteRequest = page.waitForRequest("**/private-intents/quotes");
  try {
    await desk
      .getByRole("button", { name: "Request collateralized quotes" })
      .click();
    await quoteRequest;

    await page.locator('[data-localnet-identity="bob"]').click();
    await expect(
      page.locator('[data-localnet-identity="bob"]'),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    release();
  }

  await expect(
    page.getByRole("alert").filter({ hasText: DISCARD_MESSAGE }),
  ).toBeVisible();
  await expect(page.getByLabel("Selected private maker quote")).toHaveCount(0);
  await page.getByRole("link", { name: "Records", exact: true }).click();
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page.getByLabel("RFQ records").locator("article")).toHaveCount(
    0,
  );
  await expectNoPersistedCompletion(page, config);
});

test("a LOCAL quote request is discarded after disconnecting and selecting Sepolia", async ({
  page,
  localnetConfig: config,
}) => {
  const desk = await openLocalDesk(page, {
    pairId: "USDC_STRK",
    identity: "bob",
  });
  const release = await delayQuoteResponse(page);
  const quoteRequest = page.waitForRequest("**/private-intents/quotes");
  try {
    await desk
      .getByRole("button", { name: "Request collateralized quotes" })
      .click();
    await quoteRequest;

    await page.getByRole("button", { name: "Disconnect wallet" }).click();
    await page.getByRole("button", { name: "SEPOLIA", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "SEPOLIA", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    release();
  }

  await expect(
    page.getByRole("heading", { name: "Private RFQ unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel("Selected private maker quote")).toHaveCount(0);
  await page.waitForTimeout(1_000);
  await expect(page.getByText(/RFQ ID|Quote ID|Reservation ID/)).toHaveCount(0);
  await expectNoPersistedCompletion(page, config, "bob");
});

test("blocked IndexedDB guidance states that new requests remain gated", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new Error("IndexedDB blocked by browser policy.");
    };
  });
  await openLocalnetPage(page, "/rfq#desk");

  const recovery = page.locator('[data-load-state="storage-unavailable"]');
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText(
    "New requests stay blocked until saved-history and unresolved-deal checks succeed.",
  );
  await expect(recovery).not.toContainText("continue with a new request");
  await expect(
    page.getByRole("alert").filter({
      hasText:
        /RFQ resume storage and unresolved-deal discovery must load successfully/,
    }),
  ).toBeVisible();
});
