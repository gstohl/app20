import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  BASE_URL,
  activateLocalnet,
  connectLocalnetWallet,
  expect,
  expectNoHorizontalOverflow,
  localnetIdentity,
  newIsolatedLocalnetContext,
  primeLocalnetMailSeed,
  readStorageSnapshot,
  restoreLocalnetMailRandomness,
  test,
  type LocalnetConfig,
  type LocalnetIdentityId,
  type Locator,
  type Page,
  type TestInfo,
} from "./support/localnet";
import {
  COMPOSE_BODY_PLACEHOLDER,
  attachTerms,
  contextPanel,
  conversationRow,
  conversationRowByAddress,
  conversationsRail,
  entry,
  loadExistingKey,
  openFullRecord,
  openMailboxRecovery,
  openTools,
  scanRecent,
  timeline,
  navLink,
} from "./support/chat";

const ARTIFACT_DIR = resolve("ui-artifacts/localnet");
const WRONG_KEY_BACKUP =
  "11111111 11111111 11111111 11111111 11111111 11111111 11111111 11111111";
let sharedBobBackup = "";

test.describe.configure({ mode: "serial" });

async function screenshot(page: Page, name: string, testInfo: TestInfo) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const path = resolve(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

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
  const session = page.getByRole("region", { name: "Wallet session" });
  await expect(session.locator("[title]").first()).toHaveAttribute(
    "title",
    new RegExp(target.address.slice(2), "i"),
  );
}

/** Chat shows the key setup card whenever this device holds no loaded key. */
async function registerNewKey(
  page: Page,
  identity: LocalnetIdentityId,
  name: string,
  testInfo: TestInfo,
) {
  const setup = page.getByRole("button", {
    name: "Load device key & register",
  });
  await expect(setup).toBeVisible();
  const expectedBackup = await primeLocalnetMailSeed(page, identity);
  try {
    await setup.click();
  } finally {
    expect(await restoreLocalnetMailRandomness(page)).toBe(true);
  }
  const backupHeading = page.getByText(
    "Back up now — this phrase is shown once",
  );
  await expect(backupHeading).toBeVisible();
  const backup = (
    await backupHeading.locator("..").locator("code").innerText()
  ).trim();
  expect(backup).toBe(expectedBackup);
  await screenshot(page, name, testInfo);
  const acknowledge = page.getByRole("button", {
    name: "I saved the backup — open mailbox",
  });
  await expect(acknowledge).toBeVisible({ timeout: 60_000 });
  await acknowledge.click();
  await expect(
    page.getByRole("heading", { name: "Set up a mailbox key" }),
  ).toHaveCount(0);
  return backup;
}

async function restoreRegisteredKey(page: Page, backup: string) {
  const setup = page.getByRole("button", {
    name: "Load device key & register",
  });
  await expect(setup).toBeVisible();
  await page.getByText("Restore from backup").click();
  await page.getByLabel("Backup value").fill(backup);
  await page.getByRole("button", { name: "Restore mailbox key" }).click();
  await expect(setup).toHaveCount(0, { timeout: 60_000 });
}

/** The chain panel every decrypted or sent record carries. */
async function openChainPanel(record: Locator) {
  await record.getByText("What the chain sees", { exact: true }).click();
}

const STRK_SCALE = 10n ** 18n;

function parseDisplayedStrk(label: string): bigint {
  const match = /^(\d+)(?:\.(\d+))? STRK$/.exec(label.trim());
  if (!match) {
    throw new Error(`Unexpected shielded balance label: ${label}`);
  }
  const fraction = (match[2] ?? "").padEnd(18, "0");
  return BigInt(match[1]) * STRK_SCALE + BigInt(fraction || "0");
}

function formatDisplayedStrk(amount: bigint): string {
  const whole = amount / STRK_SCALE;
  const fraction = (amount % STRK_SCALE)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "")
    .slice(0, 4);
  return fraction ? `${whole}.${fraction} STRK` : `${whole} STRK`;
}

async function shieldedBalanceLabel(walletRegion: Locator) {
  const label = walletRegion.getByText(/^\d+(?:\.\d+)? STRK$/, {
    exact: true,
  });
  await expect(label).toBeVisible({ timeout: 60_000 });
  return (await label.innerText()).trim();
}

test("creates a standalone payment link without an on-chain action", async ({
  page,
  browser,
  localnetConfig: config,
}, testInfo) => {
  test.setTimeout(3 * 60_000);
  const signer = localnetIdentity(config, "bob");
  const requestedUrls: string[] = [];
  page.on("request", (outgoing) => requestedUrls.push(outgoing.url()));

  await page.goto("/chat");
  await activateLocalnet(page);
  await switchIdentity(page, config, "bob");
  await navLink(page, "Pay").click();
  await expect(
    page.getByRole("heading", { name: "Create a link. Move nothing yet." }),
  ).toBeVisible();

  const generate = page.getByRole("button", {
    name: "Generate payment link",
  });
  await expect(
    page.getByText(
      "Create or restore this wallet's Mail identity in Chat first. APP20 will not present a newly generated payment request as trustworthy without a Mail signature.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(generate).toBeDisabled();
  await expect(page.getByText("No transaction submitted")).toHaveCount(0);

  await page.getByRole("link", { name: "Open Chat" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  if (sharedBobBackup) {
    expect(sharedBobBackup).toHaveLength(71);
    await restoreRegisteredKey(page, sharedBobBackup);
    await screenshot(page, "standalone-mail-identity-restored", testInfo);
  } else {
    sharedBobBackup = await registerNewKey(
      page,
      "bob",
      "standalone-mail-identity-backup",
      testInfo,
    );
    expect(sharedBobBackup).toHaveLength(71);
  }
  await navLink(page, "Pay").click();
  await expect(
    page.getByText(
      "Ready to create a Mail-signed request for the connected wallet. Generating and copying the link submits no transaction and costs no pool fee.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(generate).toBeEnabled();

  await page.getByLabel("STRK requested").fill("0.125");
  await page.getByLabel("Expiry in hours").fill("24");
  await page.getByLabel("Memo (optional)").fill("Standalone link test");
  const transactionRequestsBeforeGeneration = requestedUrls.filter((url) =>
    /\/__app20_localnet_wallet\/(?:invoke|privacy)(?:\?|$)/.test(url),
  ).length;
  await generate.click();

  await expect(
    page.getByText("No transaction submitted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Mail key signature verified", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/This Mail-key-signed request asks for\s+0\.125 STRK/),
  ).toBeVisible();
  const linkCode = page
    .locator("code")
    .filter({ hasText: `${BASE_URL}/pay#app20p3.` });
  const paymentLink = (await linkCode.innerText()).trim();
  expect(paymentLink.startsWith(`${BASE_URL}/pay#app20p3.`)).toBeTruthy();
  await expect(
    page.locator('[aria-label="QR code for this payment link"]'),
  ).toBeVisible();
  expect(
    requestedUrls.filter((url) =>
      /\/__app20_localnet_wallet\/(?:invoke|privacy)(?:\?|$)/.test(url),
    ),
  ).toHaveLength(transactionRequestsBeforeGeneration);
  expect(requestedUrls.some((url) => url.includes("#"))).toBeFalsy();
  await screenshot(page, "standalone-payment-link-create", testInfo);

  const fresh = await newIsolatedLocalnetContext(browser);
  const review = await fresh.newPage();
  const reviewRequests: string[] = [];
  review.on("request", (outgoing) => reviewRequests.push(outgoing.url()));
  await review.goto(paymentLink);
  await expect(
    review.getByRole("heading", { name: "Review before anything moves." }),
  ).toBeVisible();
  await expect(
    review.getByRole("heading", {
      name: "Mail-key signature verified — person not verified",
    }),
  ).toBeVisible();
  await expect(
    review.getByText("MAIL SIGNATURE VERIFIED", { exact: true }),
  ).toBeVisible();
  const signatureLimitNotices = review.getByText(
    "A valid Mail signature proves only that the exact displayed message was signed by the displayed Mail key. It does not prove who signed it or that they control the named wallet. APP20 currently cannot revoke a compromised Mail key, so anyone with the recovery phrase can create requests that pass this check. Confirm the person and wallet through a trusted channel before paying.",
    { exact: true },
  );
  await expect(signatureLimitNotices).toHaveCount(2);
  await expect(signatureLimitNotices.first()).toBeVisible();
  await expect(signatureLimitNotices.last()).toBeVisible();
  await expect(
    review.getByText("Verified Mail signing key", { exact: true }),
  ).toBeVisible();
  await expect(review.getByText(signer.address, { exact: true })).toBeVisible();
  await expect(
    review.getByText(/This Mail-key-signed request asks for\s+0\.125 STRK/),
  ).toBeVisible();
  await expect(review.getByText(/Standalone link test/)).toBeVisible();
  await expect(review.getByText(/Expires .* · Localnet \(dev\)/)).toBeVisible();
  await expect(
    review.getByRole("button", {
      name: "Continue to Chat to review & pay",
    }),
  ).toBeEnabled();
  expect(reviewRequests.some((url) => url.includes("#"))).toBeFalsy();
  expect(
    reviewRequests.some((url) =>
      url.includes("/__app20_localnet_wallet/privacy"),
    ),
  ).toBeFalsy();
  await screenshot(review, "standalone-payment-link-review", testInfo);
  await fresh.close();
});

test("all APP20 localnet journeys", async ({
  page,
  browser,
  localnetConfig: config,
}, testInfo) => {
  test.setTimeout(15 * 60_000);
  page.setDefaultTimeout(60_000);
  const alice = localnetIdentity(config, "alice");
  const bob = localnetIdentity(config, "bob");
  const bobLabel = "Bob recovery desk";
  // Unique per run: a reused chain keeps earlier runs' documents, and a
  // fresh browser context decrypts them all again.
  const runTag = Date.now().toString(36);
  const compositeBody = `Composite production test ${runTag}: payment, invoice, and offer in one private document.`;
  const escrowBody = `Escrow browser lifecycle ${runTag}`;
  const draftBody = `Draft ${runTag} survives navigation and resumes`;
  const multiBody = `Two recipients decrypt private circular ${runTag}`;

  await test.step("1. connect and onboard Alice and Bob", async () => {
    await page.goto("/chat");
    await connectLocalnetWallet(page, { auditFocusReturn: true });
    await switchIdentity(page, config, "alice");
    const aliceBackup = await registerNewKey(
      page,
      "alice",
      "01-alice-one-time-backup",
      testInfo,
    );
    expect(aliceBackup).toHaveLength(71);

    await switchIdentity(page, config, "bob");
    if (sharedBobBackup) {
      expect(sharedBobBackup).toHaveLength(71);
      await restoreRegisteredKey(page, sharedBobBackup);
    } else {
      sharedBobBackup = await registerNewKey(
        page,
        "bob",
        "02-bob-one-time-backup",
        testInfo,
      );
      expect(sharedBobBackup).toHaveLength(71);
    }
    testInfo.annotations.push({
      type: "bob-backup",
      description: sharedBobBackup,
    });
    await screenshot(page, "03-bob-onboarded", testInfo);
  });

  const bobBackup = testInfo.annotations.find(
    (annotation) => annotation.type === "bob-backup",
  )?.description;
  if (!bobBackup)
    throw new Error("Bob backup was not captured during onboarding.");

  await test.step("1b. Alice restores Contacts after local ciphertext loss through encrypted self-mail", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await navLink(page, "Counterparties").click();
    await page.getByLabel("New address book label").fill(bobLabel);
    await page.getByLabel("New address book address").fill(bob.address);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await navLink(page, "Chat").click();
    await loadExistingKey(page);
    await openMailboxRecovery(page);

    const backupContacts = page.getByRole("button", {
      name: "Back up contacts to this mailbox",
    });
    await expect(backupContacts).toBeEnabled({ timeout: 60_000 });
    await backupContacts.click();
    await expect(
      page.getByText(/1 contact backed up inline in 0x/),
    ).toBeVisible({ timeout: 60_000 });

    await navLink(page, "Counterparties").click();
    await page.evaluate(async (address) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const addressBook = await dynamicImport("/src/lib/address-book.ts");
      localStorage.removeItem(addressBook.addressBookStorageKey(address));
      window.dispatchEvent(new Event(addressBook.ADDRESS_BOOK_CHANGED_EVENT));
    }, alice.address);
    await expect(page.getByText(bobLabel)).toHaveCount(0);
    await navLink(page, "Chat").click();
    await loadExistingKey(page);
    await scanRecent(page);
    // Self-addressed backups file under the mailbox itself.
    const self = conversationRow(page, "This mailbox");
    await expect(self).toBeVisible({ timeout: 60_000 });
    await self.click();
    // Earlier runs on the same chain leave older backups above; the newest
    // one is the last entry of the chronological timeline.
    await expect(
      timeline(page).getByText("CONTACT BACKUP", { exact: true }).last(),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Merge verified contacts" })
      .last()
      .click();
    await expect(
      page.getByText(/Authenticated backup sequence .* restored/),
    ).toBeVisible();
    await navLink(page, "Counterparties").click();
    await expect(page.getByText(bobLabel)).toBeVisible();
    await navLink(page, "Chat").click();
  });

  await test.step("2. shield STRK and observe truthful progress", async () => {
    await switchIdentity(page, config, "alice");
    await navLink(page, "RFQ").click();
    await page.getByRole("link", { name: "Shield / unshield funding" }).click();
    await expect(page).toHaveURL(/\/funding$/);
    await expect(
      page.getByRole("heading", { name: "Shield / unshield" }),
    ).toBeVisible();
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
    const aliceBefore = parseDisplayedStrk(
      await shieldedBalanceLabel(walletRegion),
    );
    const aliceAfter = formatDisplayedStrk(aliceBefore + 100000000000000000n);
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
      walletRegion.getByText(aliceAfter, { exact: true }),
    ).toBeVisible({
      timeout: 60_000,
    });

    // Bob needs STRK for the later offer acceptance and invoice payment.
    // The identity switch stays in the dev-only localnet bar. Return through
    // RFQ's explicit separate-operation link to the canonical funding surface.
    await navLink(page, "Chat").click();
    await switchIdentity(page, config, "bob");
    await navLink(page, "RFQ").click();
    await page.getByRole("link", { name: "Shield / unshield funding" }).click();
    await expect(page).toHaveURL(/\/funding$/);
    const bobBefore = parseDisplayedStrk(
      await shieldedBalanceLabel(walletRegion),
    );
    const bobAfter = formatDisplayedStrk(bobBefore + STRK_SCALE);
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
    await expect(walletRegion.getByText(bobAfter, { exact: true })).toBeVisible(
      {
        timeout: 60_000,
      },
    );
    await screenshot(page, "05-shielded-balances", testInfo);
    await navLink(page, "Chat").click();
  });

  await test.step("3. send a composite document and inspect Sent evidence", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await conversationRow(page, bobLabel).click();
    await attachTerms(page);
    await page.getByLabel(/^To/).fill(bob.address);
    await page.getByPlaceholder(COMPOSE_BODY_PLACEHOLDER).fill(compositeBody);
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
    // The Sent copy files under the counterparty with its chain evidence.
    const sent = entry(page, compositeBody);
    await expect(sent).toBeVisible();
    await expect(sent).toContainText("Sent copy on this device");
    await expect(sent).toContainText("1 recipient");
    await openChainPanel(sent);
    await expect(sent.getByText("Transaction hash", { exact: true })).toBeVisible();
    await expect(conversationRow(page, bobLabel)).toContainText("You:");
    await screenshot(page, "08-composite-in-sent", testInfo);
  });

  await test.step("4. Bob decrypts all cards; a wrong backup is rejected", async () => {
    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await scanRecent(page);
    const row = conversationRowByAddress(page, alice.address);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText(/\d+ unread/);
    await row.click();
    await expect(row).toContainText("Opened");
    const received = entry(page, compositeBody);
    await expect(received).toBeVisible();
    await expect(received).toContainText("Opened · record");
    // Records that need nothing from Bob stay compact until opened.
    await openFullRecord(
      received.getByRole("article", { name: /^Private payment:/ }),
    );
    await expect(
      received.getByText("PRIVATE PAYMENT MEMO", { exact: true }),
    ).toBeVisible();
    await expect(
      received.getByText("OTC OFFER / ONE-SIDED V1", { exact: true }),
    ).toBeVisible();
    await expect(
      received.getByText("PAYMENT REQUEST / ONE-SIDED V1", { exact: true }),
    ).toBeVisible();
    await openChainPanel(received);
    await expect(
      received.getByText("Sender address", { exact: true }),
    ).toBeVisible();
    await expect(
      received.getByText("Recipient identities", { exact: true }),
    ).toBeVisible();
    await screenshot(page, "09-bob-decrypted-composite", testInfo);

    const unrelated = await newIsolatedLocalnetContext(browser, {
      config,
      identity: "bob",
    });
    const wrongKeyPage = await unrelated.newPage();
    await wrongKeyPage.goto("/chat");
    await connectLocalnetWallet(wrongKeyPage);
    await switchIdentity(wrongKeyPage, config, "bob");
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
    await expect(wrongKeyPage.getByText(compositeBody)).toHaveCount(0);
    await screenshot(wrongKeyPage, "10-unrelated-key-empty", testInfo);
    await unrelated.close();
  });

  await test.step("5. accept the offer exactly once", async () => {
    const accept = entry(page, compositeBody).getByRole("button", {
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
    const { local } = await readStorageSnapshot(page);
    const otcStorage = Object.entries(local).find(
      ([key]) =>
        key.startsWith("app20/otc/v1/") &&
        key.toLowerCase().includes(bob.address.slice(2).toLowerCase()),
    )?.[1];
    expect(otcStorage).toContain('"status":"closed"');
    expect(otcStorage).toContain('"settlementVerified":true');
    await screenshot(page, "12-offer-accepted-once", testInfo);
  });

  await test.step("6. share, review, and explicitly pay an invoice from a fresh context", async () => {
    const invoiceEntry = entry(page, compositeBody);
    await invoiceEntry
      .getByRole("button", { name: "Share payment link" })
      .click();
    const linkCode = invoiceEntry
      .locator("code")
      .filter({ hasText: `${BASE_URL}/pay#app20p2.` });
    const paymentLink = (await linkCode.innerText()).trim();
    expect(paymentLink.startsWith(`${BASE_URL}/pay#app20p2.`)).toBeTruthy();
    await screenshot(page, "13-invoice-share-link", testInfo);

    const fresh = await newIsolatedLocalnetContext(browser, {
      config,
      identity: "bob",
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
      payPage.getByRole("heading", {
        name: "Unsigned invoice — requester not verified",
      }),
    ).toBeVisible();
    await expect(
      payPage.getByText("UNVERIFIED LEGACY LINK", { exact: true }),
    ).toBeVisible();
    await expect(
      payPage.getByText(
        "Unverified legacy link: its checksum detects accidental damage but does not stop anyone from rewriting the terms. Verify every term with the requester through another channel.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      payPage.getByText(
        "Unverified: anyone can rewrite this address and issue a new checksum. Verify it out-of-band before paying.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      payPage.getByRole("heading", { name: "Verified signed invoice" }),
    ).toHaveCount(0);
    await expect(
      payPage.getByRole("button", {
        name: "Continue to Chat to review & pay",
      }),
    ).toBeVisible();
    await expect(
      payPage.getByRole("button", { name: /Pay 0.2 STRK privately/ }),
    ).toHaveCount(0);
    expect(requestedUrls.some((url) => url.includes("#"))).toBeFalsy();
    expect(
      requestedUrls.some((url) =>
        url.includes("/__app20_localnet_wallet/privacy"),
      ),
    ).toBeFalsy();
    await screenshot(payPage, "14-fresh-payment-review", testInfo);

    await connectLocalnetWallet(payPage);
    await payPage
      .getByRole("button", { name: "Continue to Chat to review & pay" })
      .click();
    await expect(payPage).toHaveURL(/\/chat$/);
    await expect(
      payPage.getByRole("heading", { name: "Set up a mailbox key" }),
    ).toBeVisible();
    // The imported request already files under its requester, before any key.
    await expect(
      conversationRowByAddress(payPage, alice.address),
    ).toContainText("Needs action");
    await payPage.getByText("Restore from backup").click();
    await payPage.getByLabel("Backup value").fill(bobBackup);
    await payPage.getByRole("button", { name: "Restore mailbox key" }).click();
    // The reviewed link is the record this device pays from; the sealed
    // copy Alice sent arrives with the post-payment mail check and carries
    // the outcome forward.
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
      payPage.getByText(/payment and encrypted memo confirmed\./i).first(),
    ).toBeVisible({ timeout: 180_000 });
    const paid = payPage
      .getByRole("article", { name: /^Invoice:/ })
      .filter({ hasText: /payment and encrypted memo confirmed/i });
    await expect(paid.first()).toBeVisible();
    await expect(
      paid.getByRole("button", { name: "Pay 0.2 STRK privately" }),
    ).toHaveCount(0);
    expect(
      requestedUrls.filter((url) =>
        url.includes("/__app20_localnet_wallet/privacy"),
      ),
    ).toHaveLength(1);
    await screenshot(payPage, "16-invoice-paid", testInfo);
    await fresh.close();
  });

  await test.step("7. fund, fill, and claim contract-backed escrow", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await conversationRow(page, bobLabel).click();
    await attachTerms(page);
    await page.getByLabel(/^To/).fill(bob.address);
    await page.getByPlaceholder(COMPOSE_BODY_PLACEHOLDER).fill(escrowBody);
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
    await conversationRowByAddress(page, alice.address).click();
    await expect(entry(page, escrowBody)).toBeVisible({ timeout: 60_000 });
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
    await conversationRow(page, bobLabel).click();
    await expect(entry(page, escrowBody)).toBeVisible();
    const claim = page.getByRole("button", { name: "Claim ETH leg" });
    await expect(claim).toBeVisible({ timeout: 60_000 });
    await claim.click();
    await expect(
      page.getByText("Localnet claim confirmed: the maker received leg B.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 180_000 });
    await expect(
      page.getByText("Settled on-chain", { exact: true }).first(),
    ).toBeVisible();
    await screenshot(page, "21-escrow-settled", testInfo);
  });

  await test.step("8. persist, resume, and send a device-private draft", async () => {
    await attachTerms(page);
    await page.getByLabel(/^To/).fill(bob.address);
    await page.getByPlaceholder(COMPOSE_BODY_PLACEHOLDER).fill(draftBody);
    await page.getByRole("button", { name: "Close document" }).click();
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toHaveCount(0);
    await openTools(page, "Drafts");
    const draftRow = page.getByRole("button", {
      name: `Open draft: ${draftBody}`,
    });
    await expect(draftRow).toBeVisible();
    await screenshot(page, "22-draft-persisted", testInfo);
    await draftRow.click();
    await expect(page.getByPlaceholder(COMPOSE_BODY_PLACEHOLDER)).toHaveValue(
      draftBody,
    );
    await page.getByRole("button", { name: "Send encrypted message" }).click();
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toHaveCount(0, {
      timeout: 180_000,
    });
    await expect(entry(page, draftBody)).toContainText(
      "Sent copy on this device",
    );
    await expect(
      page.locator("summary").filter({ hasText: "Drafts" }),
    ).toContainText("0");
    await screenshot(page, "23-draft-resumed-and-sent", testInfo);
  });

  await test.step("9. deliver one body to two independently decrypting recipients", async () => {
    // Written from Bob's conversation so the circular stays in that thread.
    await attachTerms(page);
    await page.getByLabel(/^To/).fill(`${alice.address}\n${bob.address}`);
    await page.getByPlaceholder(COMPOSE_BODY_PLACEHOLDER).fill(multiBody);
    await expect(
      page.getByText(/2 \/ 66 recipients\./),
    ).toBeVisible();
    await screenshot(page, "24-multi-recipient-compose", testInfo);
    await page.getByRole("button", { name: "Send encrypted message" }).click();
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toHaveCount(0, {
      timeout: 180_000,
    });
    // A circular to Bob and this mailbox files under Bob, with its public count.
    await expect(conversationRow(page, bobLabel)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(entry(page, multiBody)).toContainText("2 recipients");

    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await scanRecent(page);
    await conversationRowByAddress(page, alice.address).click();
    await expect(entry(page, multiBody)).toBeVisible({ timeout: 60_000 });
    await expect(entry(page, multiBody)).toContainText("Opened · record");
    await screenshot(page, "25-multi-recipient-bob", testInfo);

    // Alice decrypts her own copy from the chain; it stays one record, not
    // an echo under a sealed sender.
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await scanRecent(page);
    await conversationRow(page, bobLabel).click();
    await expect(entry(page, multiBody)).toHaveCount(1);
    await expect(
      conversationRow(page, "Sealed sender").filter({ hasText: multiBody }),
    ).toHaveCount(0);
    await screenshot(page, "26-multi-recipient-alice", testInfo);
  });

  await test.step("10. render responsive widths without overflow", async () => {
    await page.setViewportSize({ width: 1_440, height: 900 });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      /^(light|dark)$/,
    );
    await screenshot(page, "27-shared-shell-theme", testInfo);

    for (const width of [375, 768, 1_440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 375) {
        // One pane at a time on a phone: the open conversation, a way back
        // to the rail, and the contact context as a drawer.
        const back = page.getByRole("button", {
          name: "Back to conversations",
        });
        await expect(back).toBeVisible();
        await back.click();
        await expect(conversationsRail(page)).toBeVisible();
        await expect(back).toBeHidden();
        await conversationRow(page, bobLabel).click();
        await expect(timeline(page)).toBeVisible();
        const context = page.getByRole("button", {
          name: "Context",
          exact: true,
        });
        await expect(context).toHaveAttribute("aria-expanded", "false");
        await context.click();
        await expect(context).toHaveAttribute("aria-expanded", "true");
        await expect(
          contextPanel(page).getByRole("region", { name: "Wallet identity" }),
        ).toBeVisible();
        await contextPanel(page)
          .getByRole("button", { name: "Close contact context" })
          .click();
        await expect(context).toHaveAttribute("aria-expanded", "false");
      }
      await expectNoHorizontalOverflow(page);
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
    await page.getByText("Device safety", { exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", {
        name: "Forget this device",
      })
      .click();
    await expect(page.getByText(/Forgot this device: removed/)).toBeVisible();
    const sensitivePrefixes = [
      "app20/mailseed/v1",
      "app20/drafts/v1",
      "app20/sent/v1",
      "app20/aliases/v1",
      "app20/otc/v1",
      "app20/escrow/v1",
      "app20/mail-scan/v1",
    ];
    const { local } = await readStorageSnapshot(page);
    const remaining = Object.keys(local).filter((key) =>
      sensitivePrefixes.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}/`),
      ),
    );
    expect(remaining).toEqual([]);
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      /^(light|dark)$/,
    );
    await screenshot(page, "29-forgotten-device", testInfo);
  });
});
