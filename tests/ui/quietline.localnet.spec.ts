import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = "http://127.0.0.1:5173";
const ARTIFACT_DIR = resolve("ui-artifacts/localnet");
const WRONG_KEY_BACKUP =
  "11111111 11111111 11111111 11111111 11111111 11111111 11111111 11111111";

type LocalnetIdentity = {
  id: "alice" | "bob";
  label: string;
  address: string;
};

type LocalnetConfig = {
  walletName: string;
  helperAddress: string;
  escrowAddress: string;
  counterTokenAddress: string;
  identities: LocalnetIdentity[];
};

function identity(config: LocalnetConfig, id: LocalnetIdentity["id"]) {
  const value = config.identities.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Localnet identity ${id} is missing.`);
  return value;
}

async function screenshot(page: Page, name: string, testInfo: TestInfo) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const path = resolve(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function connectLocalnet(page: Page, auditFocus = false) {
  const trigger = page.getByRole("button", { name: "Connect wallet" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(dialog).toBeVisible();
  const localnetOption = dialog.getByRole("button", {
    name: /Localnet \(dev\)/,
  });
  await expect(localnetOption).toBeFocused();
  if (auditFocus) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
  }
  await dialog.getByRole("button", { name: /Localnet \(dev\)/ }).click();
  await expect(page.getByTitle("Disconnect")).toBeVisible();
}

async function switchIdentity(
  page: Page,
  config: LocalnetConfig,
  id: LocalnetIdentity["id"],
) {
  const target = identity(config, id);
  const selector = page.locator(`[data-localnet-identity="${id}"]`);
  await selector.click();
  await expect(selector).toHaveAttribute("aria-pressed", "true");
  const account = page.getByRole("region", {
    name: "Wallet and shielded balance",
  });
  await expect(account.locator("code[title]")).toHaveAttribute(
    "title",
    new RegExp(target.address.slice(2), "i"),
  );
  await expect(
    page.getByRole("button", { name: "Load device key & register" }),
  ).toBeVisible();
}

async function registerNewKey(page: Page, name: string, testInfo: TestInfo) {
  await page
    .getByRole("button", { name: "Load device key & register" })
    .click();
  const backupHeading = page.getByText(
    "Back up now — this phrase is shown once",
  );
  await expect(backupHeading).toBeVisible();
  const backup = (
    await backupHeading.locator("..").locator("code").innerText()
  ).trim();
  expect(backup).toMatch(/^(?:[0-9a-f]{8} ){7}[0-9a-f]{8}$/);
  await screenshot(page, name, testInfo);
  const acknowledge = page.getByRole("button", {
    name: "I saved the backup — open mailbox",
  });
  await expect(acknowledge).toBeVisible({ timeout: 60_000 });
  await acknowledge.click();
  await expect(
    page.getByRole("heading", { name: "Register a mail key" }),
  ).toHaveCount(0);
  return backup;
}

async function loadExistingKey(page: Page) {
  const button = page.getByRole("button", {
    name: "Load device key & register",
  });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveCount(0, { timeout: 60_000 });
}

async function scanRecent(page: Page) {
  const button = page.getByRole("button", { name: "Check for new mail" });
  await expect(button).toBeEnabled();
  await button.click();
  await page.waitForTimeout(100);
  await expect(page.getByRole("button", { name: "Check for new mail" })).toBeEnabled({
    timeout: 60_000,
  });
}

async function openNewDocument(page: Page) {
  await page.getByRole("button", { name: /New/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "New document" }),
  ).toBeVisible();
  await expect(page.getByLabel(/^To/)).toBeFocused();
}

function messageRow(page: Page, body: string) {
  return page.getByRole("button").filter({ hasText: body });
}

function threadBody(page: Page, body: string) {
  return page.getByLabel("Correspondence").getByText(body, { exact: true });
}

test("all Quietline localnet journeys", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(20 * 60_000);
  const configResponse = await request.get(
    `${BASE_URL}/__quietline_localnet_wallet/config`,
  );
  expect(configResponse.ok()).toBeTruthy();
  const config = (await configResponse.json()).result as LocalnetConfig;
  expect(config.walletName).toBe("Localnet (dev)");
  const alice = identity(config, "alice");
  const bob = identity(config, "bob");
  const compositeBody =
    "Composite production test: payment, invoice, and offer in one private document.";
  const escrowBody = "Escrow browser lifecycle";
  const draftBody = "Draft survives navigation and resumes";
  const multiBody = "Two recipients decrypt this private circular";

  await test.step("1. connect and onboard Alice and Bob", async () => {
    await page.goto("/");
    await connectLocalnet(page, true);
    await switchIdentity(page, config, "alice");
    const aliceBackup = await registerNewKey(
      page,
      "01-alice-one-time-backup",
      testInfo,
    );
    expect(aliceBackup).toHaveLength(71);

    await switchIdentity(page, config, "bob");
    testInfo.annotations.push({
      type: "bob-backup",
      description: await registerNewKey(
        page,
        "02-bob-one-time-backup",
        testInfo,
      ),
    });
    await screenshot(page, "03-bob-onboarded", testInfo);
  });

  const bobBackup = testInfo.annotations.find(
    (annotation) => annotation.type === "bob-backup",
  )?.description;
  if (!bobBackup)
    throw new Error("Bob backup was not captured during onboarding.");

  await test.step("2. shield STRK and observe truthful progress", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    const walletRegion = page.getByRole("region", {
      name: "Wallet and shielded balance",
    });
    const amountInput = walletRegion.getByLabel("Wallet action amount in STRK");
    await expect(amountInput).toHaveValue("0.1");
    await expect(
      walletRegion.getByText("0.1 STRK · 100000000000000000 base units", {
        exact: true,
      }),
    ).toBeVisible();
    await walletRegion.getByRole("button", { name: /^Shield/ }).click();
    await expect(
      page.getByText("Shield 0.1 STRK", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Indeterminate: elapsed time is not completion percentage/,
      ),
    ).toBeVisible();
    await screenshot(page, "04-alice-shield-progress", testInfo);
    await expect(
      page.getByText("Shield confirmed", { exact: true }),
    ).toBeVisible({
      timeout: 180_000,
    });
    await expect(
      walletRegion.getByText("10.1 STRK", { exact: true }),
    ).toBeVisible({
      timeout: 60_000,
    });

    // Bob needs STRK for the later offer acceptance and invoice payment.
    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await amountInput.fill("1");
    await expect(
      walletRegion.getByText("1 STRK · 1000000000000000000 base units", {
        exact: true,
      }),
    ).toBeVisible();
    await walletRegion.getByRole("button", { name: /^Shield/ }).click();
    await expect(
      page.getByText("Shield confirmed", { exact: true }),
    ).toBeVisible({
      timeout: 180_000,
    });
    await expect(walletRegion.getByText("1 STRK", { exact: true })).toBeVisible(
      {
        timeout: 60_000,
      },
    );
    await screenshot(page, "05-shielded-balances", testInfo);
  });

  await test.step("3. send a composite document and inspect Sent evidence", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await openNewDocument(page);
    await page.getByLabel(/^To/).fill(bob.address);
    await page
      .getByPlaceholder(
        "Write a private message, or leave blank when sending attachments only",
      )
      .fill(compositeBody);
    await page.getByRole("button", { name: /Private payment/ }).click();
    await page.getByRole("button", { name: /OTC offer/ }).click();
    await page.getByRole("button", { name: "+ Invoice", exact: true }).click();
    await page.getByLabel("Private STRK amount").fill("0.1");
    await page.getByLabel("STRK to buy").fill("0.25");
    await page.getByLabel("Quoted token symbol").fill("ETH");
    await page
      .getByLabel("Quoted token address")
      .fill(config.counterTokenAddress);
    await page.getByLabel("Token decimals").fill("18");
    await page.getByLabel("Quoted amount").fill("0.01");
    await page.getByLabel("Note (optional)").fill("Test bilateral quote");
    await page
      .getByLabel(/Expiry in hours \(0 = none\)/)
      .first()
      .fill("24");
    await page.getByLabel("STRK requested").fill("0.2");
    await page
      .getByLabel("Invoice memo (optional)")
      .fill("Invoice from composite document");
    await page
      .getByLabel(/Expiry in hours \(0 = none\)/)
      .last()
      .fill("24");
    await expect(
      page.getByRole("heading", { name: "Review before wallet approval" }),
    ).toBeVisible();
    await expect(
      page.getByText(/1 wallet approval · 1 transaction/),
    ).toBeVisible();
    await expect(
      page.getByText(
        /0\.1 STRK \(100000000000000000 base units\) privately to/,
      ),
    ).toBeVisible();
    await expect(page.getByText(/\/ 140 ciphertext felts/)).toBeVisible();
    await screenshot(page, "06-composite-document", testInfo);

    await page
      .getByRole("button", { name: "Send 0.1 STRK privately + message" })
      .click();
    await expect(page.getByText("Step 1 of 1", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /sending document/i }),
    ).toBeVisible();
    await screenshot(page, "07-composite-submit-progress", testInfo);
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toHaveCount(0, {
      timeout: 180_000,
    });
    await expect(page.getByText(/Sent · record local/i)).toBeVisible();
    await expect(threadBody(page, compositeBody)).toBeVisible();
    await expect(
      page.getByText("Transaction hash", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("1 recipient · confirmed", { exact: false }),
    ).toBeVisible();
    await expect(messageRow(page, compositeBody)).toContainText(
      "POSTED ON-CHAIN",
    );
    await screenshot(page, "08-composite-in-sent", testInfo);
  });

  await test.step("4. Bob decrypts all cards; a wrong backup is rejected", async () => {
    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await scanRecent(page);
    await expect(messageRow(page, compositeBody)).toBeVisible({
      timeout: 60_000,
    });
    await expect(messageRow(page, compositeBody)).toContainText("UNREAD");
    await messageRow(page, compositeBody).click();
    await expect(threadBody(page, compositeBody)).toBeVisible();
    await expect(messageRow(page, compositeBody)).toContainText("OPENED");
    await expect(
      page.getByRole("heading", { name: "Correspondence" }),
    ).toBeFocused();
    await expect(
      page.getByText("PRIVATE PAYMENT MEMO", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("OTC OFFER / ONE-SIDED V1", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("PAYMENT REQUEST / ONE-SIDED V1", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("What the chain sees", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Sender address", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Recipient identities", { exact: true }),
    ).toBeVisible();
    await screenshot(page, "09-bob-decrypted-composite", testInfo);

    const unrelated = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1_440, height: 900 },
    });
    await unrelated.addInitScript(() => {
      localStorage.setItem("quietline/localnet-wallet/identity/v1", "bob");
    });
    const wrongKeyPage = await unrelated.newPage();
    await wrongKeyPage.goto("/");
    await connectLocalnet(wrongKeyPage);
    await wrongKeyPage.getByText("Restore from backup").click();
    await wrongKeyPage.getByLabel("Backup value").fill(WRONG_KEY_BACKUP);
    await wrongKeyPage
      .getByRole("button", { name: "Restore mailbox key" })
      .click();
    await expect(
      wrongKeyPage.getByText(
        "This backup belongs to a different mailbox key. Nothing was replaced; use the backup registered to this wallet address.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      wrongKeyPage.getByRole("button", { name: "Check for new mail" }),
    ).toBeDisabled();
    await expect(messageRow(wrongKeyPage, compositeBody)).toHaveCount(0);
    await screenshot(wrongKeyPage, "10-unrelated-key-empty", testInfo);
    await unrelated.close();
  });

  await test.step("5. accept the offer exactly once", async () => {
    const accept = page.getByRole("button", {
      name: "Accept & send 0.25 STRK",
    });
    await expect(accept).toBeVisible();
    await accept.click();
    await expect(
      page.getByRole("status").filter({ hasText: /STRK transfer submitted/i }),
    ).toBeVisible({ timeout: 120_000 });
    await screenshot(page, "11-offer-accept-progress", testInfo);
    await expect(
      page.getByText("Accept transfer and one-sided receipt confirmed.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 180_000 });
    await expect(accept).toHaveCount(0);
    const otcStorage = await page.evaluate(
      (address) =>
        Object.entries(localStorage).find(
          ([key]) =>
            key.startsWith("quietline/otc/v1/") &&
            key.toLowerCase().includes(address.slice(2).toLowerCase()),
        )?.[1],
      bob.address,
    );
    expect(otcStorage).toContain('"status":"closed"');
    expect(otcStorage).toContain('"settlementVerified":true');
    await screenshot(page, "12-offer-accepted-once", testInfo);
  });

  await test.step("6. share, review, and explicitly pay an invoice from a fresh context", async () => {
    await page.getByRole("button", { name: "Share payment link" }).click();
    const linkCode = page
      .locator("code")
      .filter({ hasText: `${BASE_URL}/pay#qlp1.` });
    const paymentLink = (await linkCode.innerText()).trim();
    expect(paymentLink).toMatch(/^http:\/\/127\.0\.0\.1:5173\/pay#qlp1\./);
    await screenshot(page, "13-invoice-share-link", testInfo);

    const fresh = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1_440, height: 900 },
    });
    await fresh.addInitScript(() => {
      localStorage.setItem("quietline/localnet-wallet/identity/v1", "bob");
    });
    const payPage = await fresh.newPage();
    const requestedUrls: string[] = [];
    payPage.on("request", (outgoing) => requestedUrls.push(outgoing.url()));
    await payPage.goto(paymentLink);
    await expect(
      payPage.getByRole("heading", { name: "Review before anything moves." }),
    ).toBeVisible();
    await expect(
      payPage.getByText(alice.address, { exact: true }),
    ).toBeVisible();
    await expect(
      payPage.getByText(/Payment links are unauthenticated instructions/),
    ).toBeVisible();
    await expect(
      payPage.getByRole("button", {
        name: "Continue to inbox to review & pay",
      }),
    ).toBeVisible();
    await expect(
      payPage.getByRole("button", { name: /Pay 0.2 STRK privately/ }),
    ).toHaveCount(0);
    expect(requestedUrls.some((url) => url.includes("#"))).toBeFalsy();
    expect(
      requestedUrls.some((url) =>
        url.includes("/__quietline_localnet_wallet/privacy"),
      ),
    ).toBeFalsy();
    await screenshot(payPage, "14-fresh-payment-review", testInfo);

    await connectLocalnet(payPage);
    await payPage
      .getByRole("button", { name: "Continue to inbox to review & pay" })
      .click();
    await expect(
      payPage.getByRole("heading", { name: "Set up a mailbox key" }),
    ).toBeVisible();
    await payPage.getByText("Restore from backup").click();
    await payPage.getByLabel("Backup value").fill(bobBackup);
    await payPage.getByRole("button", { name: "Restore mailbox key" }).click();
    const pay = payPage.getByRole("button", { name: "Pay 0.2 STRK privately" });
    await expect(pay).toBeVisible();
    await pay.click();
    await expect(
      payPage
        .getByRole("status")
        .filter({ hasText: /Preparing one private STRK payment/i }),
    ).toBeVisible();
    await screenshot(payPage, "15-invoice-payment-progress", testInfo);
    await expect(
      payPage.getByText(/payment and encrypted memo confirmed\./i),
    ).toBeVisible({ timeout: 180_000 });
    await expect(pay).toHaveCount(0);
    expect(
      requestedUrls.filter((url) =>
        url.includes("/__quietline_localnet_wallet/privacy"),
      ),
    ).toHaveLength(1);
    await screenshot(payPage, "16-invoice-paid", testInfo);
    await fresh.close();
  });

  await test.step("7. fund, fill, and claim contract-backed escrow", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await openNewDocument(page);
    await page.getByLabel(/^To/).fill(bob.address);
    await page
      .getByPlaceholder(
        "Write a private message, or leave blank when sending attachments only",
      )
      .fill(escrowBody);
    await page
      .getByRole("button", { name: "+ Escrow fund", exact: true })
      .click();
    await page.getByLabel("Leg A STRK to deposit").fill("0.3");
    await page.getByLabel("Quoted token symbol").fill("ETH");
    await page
      .getByLabel("Quoted token address")
      .fill(config.counterTokenAddress);
    await page.getByLabel("Token decimals").fill("18");
    await page.getByLabel("Quoted amount").fill("0.01");
    await page.getByLabel("Note (optional)").fill("Localnet full lifecycle");
    await page.getByLabel("Fill deadline in hours").fill("24");
    await screenshot(page, "17-escrow-compose", testInfo);
    await expect(
      page.getByText(/2 wallet approvals · 2 transactions/),
    ).toBeVisible();
    await expect(
      page.getByText(
        /0\.3 STRK \(300000000000000000 base units\) deposited into escrow/,
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve 1 value move in 2 transactions" })
      .click();
    await expect(page.getByText("Step 1 of 2", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /funding escrow/i }),
    ).toBeVisible();
    await screenshot(page, "18-escrow-fund-progress", testInfo);
    const submission = page
      .getByText("Submission transactions", { exact: true })
      .locator("..");
    await expect(submission).toBeVisible({ timeout: 180_000 });
    await expect(submission.locator("code")).toHaveCount(2);
    await screenshot(page, "19-escrow-funded-and-sent", testInfo);

    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await scanRecent(page);
    await expect(messageRow(page, escrowBody)).toBeVisible({ timeout: 60_000 });
    await messageRow(page, escrowBody).click();
    const fill = page.getByRole("button", {
      name: "Deposit 0.01 ETH & receive leg A",
    });
    await expect(fill).toBeVisible({ timeout: 60_000 });
    await fill.click();
    await expect(
      page.getByText(/Fill confirmed: leg A was released/),
    ).toBeVisible({
      timeout: 180_000,
    });
    await screenshot(page, "20-escrow-filled", testInfo);

    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await page.getByRole("button", { name: /^Sent/ }).first().click();
    await messageRow(page, escrowBody).click();
    const claim = page.getByRole("button", { name: "Claim ETH leg" });
    await expect(claim).toBeVisible({ timeout: 60_000 });
    await claim.click();
    await expect(
      page.getByText("Localnet claim confirmed: the maker received leg B.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 180_000 });
    await expect(
      page.getByText("Settled on-chain", { exact: true }),
    ).toBeVisible();
    await screenshot(page, "21-escrow-settled", testInfo);
  });

  await test.step("8. persist, resume, and send a device-private draft", async () => {
    await openNewDocument(page);
    await page.getByLabel(/^To/).fill(bob.address);
    await page
      .getByPlaceholder(
        "Write a private message, or leave blank when sending attachments only",
      )
      .fill(draftBody);
    await page.getByRole("button", { name: "Close" }).click();
    await page
      .getByRole("button", { name: /^Drafts/ })
      .first()
      .click();
    const draftRow = messageRow(page, draftBody);
    await expect(draftRow).toBeVisible();
    await screenshot(page, "22-draft-persisted", testInfo);
    await draftRow.click();
    await expect(
      page.getByPlaceholder(
        "Write a private message, or leave blank when sending attachments only",
      ),
    ).toHaveValue(draftBody);
    await page
      .getByRole("button", { name: "Send message (no asset transfer)" })
      .click();
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toHaveCount(0, {
      timeout: 180_000,
    });
    await expect(page.getByText(/Sent · record local/i)).toBeVisible();
    await expect(threadBody(page, draftBody)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Drafts/ }).first(),
    ).toContainText("0");
    await screenshot(page, "23-draft-resumed-and-sent", testInfo);
  });

  await test.step("9. deliver one body to two independently decrypting recipients", async () => {
    await openNewDocument(page);
    await page.getByLabel(/^To/).fill(`${alice.address}\n${bob.address}`);
    await page
      .getByPlaceholder(
        "Write a private message, or leave blank when sending attachments only",
      )
      .fill(multiBody);
    await expect(
      page.getByText(/2 \/ 66 recipients\. Recipient count is public/),
    ).toBeVisible();
    await screenshot(page, "24-multi-recipient-compose", testInfo);
    await page
      .getByRole("button", { name: "Send message (no asset transfer)" })
      .click();
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toHaveCount(0, {
      timeout: 180_000,
    });
    await expect(page.getByText(/2 recipients · confirmed/i)).toBeVisible();
    await expect(
      page.getByText("Recipient count is public in the ciphertext format.", {
        exact: false,
      }),
    ).toBeVisible();

    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await scanRecent(page);
    await expect(messageRow(page, multiBody)).toBeVisible({ timeout: 60_000 });
    await messageRow(page, multiBody).click();
    await expect(threadBody(page, multiBody)).toBeVisible();
    await screenshot(page, "25-multi-recipient-bob", testInfo);

    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await scanRecent(page);
    await page
      .getByRole("button", { name: /^Inbox/ })
      .first()
      .click();
    await expect(messageRow(page, multiBody)).toBeVisible({ timeout: 60_000 });
    await messageRow(page, multiBody).click();
    await expect(threadBody(page, multiBody)).toBeVisible();
    await expect(
      page.getByText("Recipient count is public in the ciphertext format.", {
        exact: false,
      }),
    ).toBeVisible();
    await screenshot(page, "26-multi-recipient-alice", testInfo);
  });

  await test.step("10. render both themes and responsive widths without overflow", async () => {
    await page.setViewportSize({ width: 1_440, height: 900 });
    for (const theme of ["Light", "Dark"] as const) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme.toLowerCase(),
      );
      await screenshot(page, `27-theme-${theme.toLowerCase()}`, testInfo);
    }
    await expect(
      page.getByRole("button", { name: "System", exact: true }),
    ).toBeVisible();

    for (const width of [375, 768, 1_440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 375) {
        const drawer = page.getByRole("complementary", {
          name: "Mailbox sidebar",
        });
        const menu = page.getByRole("button", {
          name: "Open mailbox sidebar",
        });
        await expect(drawer).toHaveAttribute("inert", "");
        await menu.click();
        await expect(drawer).not.toHaveAttribute("inert", "");
        await expect(
          drawer.getByRole("button", { name: "Close mailbox sidebar" }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveAttribute("inert", "");
        await expect(menu).toBeFocused();
      }
      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      }));
      expect(metrics.documentWidth).toBeLessThanOrEqual(
        metrics.documentClientWidth,
      );
      expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.bodyClientWidth);
      await screenshot(page, `28-responsive-${width}`, testInfo);
    }
    const unnamedIconButtons = await page
      .locator("button")
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => {
            const text = (button.textContent ?? "").trim();
            return (
              /^[×+＋☰←→…✉✎]+$/.test(text) &&
              !button.getAttribute("aria-label") &&
              !button.getAttribute("title")
            );
          })
          .map((button) => (button.textContent ?? "").trim()),
      );
    expect(unnamedIconButtons).toEqual([]);
  });

  await test.step("11. forget this device clears every sensitive local mailbox store", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", {
        name: "Forget this device / clear local mailbox",
      })
      .click();
    await expect(page.getByText(/Forgot this device: removed/)).toBeVisible();
    const remaining = await page.evaluate(() => {
      const sensitivePrefixes = [
        "quietline/mailseed/v1",
        "quietline/drafts/v1",
        "quietline/sent/v1",
        "quietline/aliases/v1",
        "quietline/otc/v1",
        "quietline/escrow/v1",
        "quietline/mail-scan/v1",
      ];
      return Object.keys(localStorage).filter((key) =>
        sensitivePrefixes.some(
          (prefix) => key === prefix || key.startsWith(`${prefix}/`),
        ),
      );
    });
    expect(remaining).toEqual([]);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await screenshot(page, "29-forgotten-device", testInfo);
  });
});
