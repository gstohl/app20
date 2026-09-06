import {
  activateLocalnet,
  connectLocalnetWallet,
  expect,
  expectNoHorizontalOverflow,
  localnetIdentity,
  test,
  type LocalnetConfig,
  type LocalnetIdentityId,
  type Page,
} from "./support/localnet";
import {
  COMPOSE_BODY_PLACEHOLDER,
  addressPattern,
  attachTerms,
  contextPanel,
  conversationPane,
  conversationRow,
  conversationRowByAddress,
  conversationsRail,
  ensureMailboxKey,
  entry,
  loadExistingKey,
  scanRecent,
  timeline,
  navLink,
} from "./support/chat";

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

const recoveryRun = process.env.APP20_TEST_CHAT_RECOVERY === "1";

test(recoveryRun ? "chat recovers lost confirmation and two receipt failures without repeating payment" : "chat carries a message and an attached offer between two chats", async ({
  page,
  localnetConfig: config,
}) => {
  test.setTimeout(14 * 60_000);
  page.setDefaultTimeout(60_000);
  const alice = localnetIdentity(config, "alice");
  const bob = localnetIdentity(config, "bob");
  // Unique per run: the chain keeps earlier runs' letters, and a fresh browser
  // context decrypts them all again.
  const runTag = Date.now().toString(36);
  const quote = `0.01${String(Date.now() % 1_000).padStart(3, "0")}`;
  const terms = `0.25 STRK for ${quote} ETH`;
  const letter = `Chat message ${runTag}: can you quote 0.25 STRK against ETH today?`;
  const offerBody = `Offer ${runTag} attached from the conversation`;
  const contactLabel = "Alice desk";

  if (recoveryRun) {
    // Fault injection exists only in the browser test; real localnet transactions
    // still execute. Drop one confirmed send response and fail two receipt attempts.
    await page.route('**/src/app/chat/chat-send.ts*', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const marker = /return\s*\{\s*envelope,\s*transactionHash: result.transactionHash\s*\};/;
      expect(source).toMatch(marker);
      await route.fulfill({ response, body: source.replace(marker, `
        window.__chatSendCount = (window.__chatSendCount || 0) + 1;
        throw chatSendFailure(new Error("Injected lost confirmation"), pendingLetter);
      `) });
    });
    await page.route('**/src/app/chat/useMailboxDesk.ts*', async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      const marker = 'async function postReceipt(offer, accept, acceptTransactionHash, recipientKey) {';
      expect(source).toContain(marker);
      source = source.replace(marker, marker + `
        window.__receiptAttempts = (window.__receiptAttempts || 0) + 1;
        if (window.__receiptAttempts <= 2) throw new Error("Injected receipt interruption");
      `);
      const transfer = 'const result = await submitOtcAccept(';
      expect(source).toContain(transfer);
      source = source.replace(transfer, 'window.__acceptCount = (window.__acceptCount || 0) + 1; ' + transfer);
      await route.fulfill({ response, body: source });
    });
  }


  await test.step("1. the old chat route lands on Chat and both fixture chats register keys", async () => {
    await page.goto("/mail/inbox");
    await expect(page).toHaveURL(/\/chat$/);
    await activateLocalnet(page);
    await switchIdentity(page, config, "alice");
    await ensureMailboxKey(page, "alice");
    await switchIdentity(page, config, "bob");
    await ensureMailboxKey(page, "bob");
  });

  await test.step("2. Bob saves Alice as a counterparty and opens her conversation from the book", async () => {
    await navLink(page, "Counterparties").click();
    await page.getByLabel("New address book label").fill(contactLabel);
    await page.getByLabel("New address book address").fill(alice.address);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(contactLabel, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Open in Chat" }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator(".signal-bar")).toContainText("CHAT");
    await expect(
      navLink(page, "Chat"),
    ).toHaveAttribute("aria-current", "page");
    const row = conversationRow(page, contactLabel);
    await expect(row).toHaveAttribute("aria-current", "true");
    await expect(conversationPane(page).locator("header strong")).toContainText(
      contactLabel,
    );
    await expect(
      page.getByText(`No records with ${contactLabel} on this device yet.`),
    ).toBeVisible();
    await expect(contextPanel(page)).toBeHidden();
    await page.getByRole("button", { name: "Contact details", exact: true }).click();
    await expect(contextPanel(page)).toContainText(addressPattern(alice.address));
    await contextPanel(page).getByRole("button", { name: "Close contact context" }).focus();
    await page.keyboard.press("Escape");
    await expect(contextPanel(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Contact details", exact: true })).toBeFocused();
    await page.getByLabel(`Message to ${contactLabel}`).focus();
    await expect(page.getByLabel(`Message to ${contactLabel}`)).toBeFocused();
  });

  await test.step("3. Bob loads his key and sends an encrypted message from the composer", async () => {
    const form = page.getByRole("form", { name: `Write to ${contactLabel}` });
    await expect(form).toContainText("Open chat key tools");
    await loadExistingKey(page);
    const input = page.getByLabel(`Message to ${contactLabel}`);
    await input.fill(letter);
    await expect(form).toContainText(
      /1 wallet approval · recipient count and timing are public/i,
    );
    await form.locator("summary").filter({ hasText: "Sending details" }).click();
    await expect(form).toContainText("Ctrl+Enter");
    await input.focus();
    await page.keyboard.press("Control+Enter");
    if (recoveryRun) {
      await expect(form.getByRole("button", { name: "Check delivery", exact: true })).toBeVisible({ timeout: 180_000 });
      await expect(input).toHaveValue(letter);
      await expect(form.getByRole("button", { name: "Confirmation pending" })).toBeDisabled();
      await input.press("Control+Enter");
      expect(await page.evaluate(() => (window as any).__chatSendCount)).toBe(1);
      await page.screenshot({ path: "artifacts/desktop-ux/recovery/check-delivery.png" });
      await form.getByRole("button", { name: "Check delivery", exact: true }).click();
      await expect(form).toContainText("Delivery confirmed.");
      expect(await page.evaluate(() => (window as any).__chatSendCount)).toBe(1);
    } else {
      await expect(page.getByRole("status").filter({ hasText: /Sealed and confirmed in/ })).toBeVisible({ timeout: 180_000 });
    }
    await expect(entry(page, letter)).toContainText("Sent copy on this device");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Sent copy saved in this browser profile/ }),
    ).toBeVisible();
    await expect(conversationRow(page, contactLabel)).toContainText("You:");
    await expect(input).toHaveValue("");
  });

  await test.step("4. Alice names the sealed sender and answers with an offer in the same thread", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await scanRecent(page);
    // MessagePosted carries no sender: a first letter from an unknown
    // mailbox arrives sealed until Alice files it under Bob herself.
    const sealed = conversationRow(page, "Sealed sender").filter({
      hasText: runTag,
    });
    await expect(sealed).toBeVisible({ timeout: 60_000 });
    await expect(sealed).toContainText(/\d+ unread/);
    await sealed.click();
    await expect(entry(page, letter)).toContainText("Opened · record");
    const naming = page.getByRole("form", { name: "Reply wallet address" });
    await naming.getByLabel("Reply wallet address").fill(bob.address);
    await naming.getByRole("button", { name: "Set reply wallet" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Named on this device/ }),
    ).toBeVisible();
    await expect(sealed).toHaveCount(0);
    const row = conversationRowByAddress(page, bob.address);
    await expect(row).toBeVisible();
    await row.click();
    await expect(entry(page, letter)).toBeVisible();
    await expect(page.getByRole("form", { name: "Reply wallet address" })).toHaveCount(0);

    await attachTerms(page);
    await expect(page.getByLabel(/^To/)).toHaveValue(addressPattern(bob.address));
    await page.getByPlaceholder(COMPOSE_BODY_PLACEHOLDER).fill(offerBody);
    await page.getByRole("button", { name: /OTC offer/ }).click();
    await page.getByLabel("STRK to buy").fill("0.25");
    await page.getByLabel("Quoted token symbol").fill("ETH");
    await page
      .getByLabel("Quoted token address")
      .fill(config.counterTokenAddress);
    await page.getByLabel("Token decimals").fill("18");
    await page.getByLabel("Quoted amount").fill(quote);
    await page.getByLabel("Note (optional)").fill("Chat offer");
    await page.getByLabel(/Expiry in hours \(0 = none\)/).fill("24");
    await page
      .getByRole("button", { name: "Send encrypted message", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toHaveCount(0, { timeout: 180_000 });
    const sent = entry(page, offerBody);
    await expect(sent).toContainText("Sent copy on this device");
    await expect(
      sent.getByRole("article", {
        name: new RegExp(`^Offer: ${terms.replaceAll(".", "\\.")}`),
      }),
    ).toBeVisible();
  });

  await test.step("5. Bob's conversation reads the offer as work, with context and actions", async () => {
    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await scanRecent(page);
    const row = conversationRow(page, contactLabel);
    await expect(row).toContainText("Needs action", { timeout: 60_000 });
    await expect(row).toContainText(/\d+ unread/);
    await row.click();
    await expect(row).toContainText("Opened");
    await expect(row).not.toContainText("unread");

    const conversation = timeline(page);
    await expect(conversation).toContainText(letter);
    const offerCard = conversation.getByRole("article", {
      name: new RegExp(`^Offer: ${terms.replaceAll(".", "\\.")}`),
    });
    await expect(offerCard).toBeVisible();
    await expect(offerCard).toContainText("Accept or decline this offer.");
    await expect(
      offerCard.getByRole("button", { name: "Accept & send 0.25 STRK" }),
    ).toBeVisible();
    await expect(entry(page, offerBody)).toContainText("Opened · record");

    const context = contextPanel(page);
    await page.getByRole("button", { name: "Contact details", exact: true }).click();
    await expect(context.getByRole("region", { name: "Open RFQs" })).toContainText(
      terms,
    );
    await context
      .getByRole("button", { name: /Offer · received/ })
      .filter({ hasText: terms })
      .click();
    await expect(context).toContainText("Record detail");
    await expect(
      context.getByText("OTC OFFER / ONE-SIDED V1", { exact: true }),
    ).toBeVisible();
    await expect(conversation).toBeVisible();
    await context.getByRole("button", { name: "Show in conversation" }).click();
    await expect(conversation.locator('li[data-highlight="true"]')).toHaveCount(1);
    await expect(conversation.locator('li[data-highlight="true"]')).toBeFocused();
    await expect(context).toBeHidden();
    await page.getByRole("button", { name: "Contact details", exact: true }).click();
    await context
      .getByRole("button", { name: `Back to ${contactLabel}` })
      .click();
    await expect(
      context.getByRole("region", { name: "Wallet identity" }),
    ).toContainText(addressPattern(alice.address));

    await page.getByRole("button", { name: /Needs action only/ }).click();
    await expect(conversationRow(page, contactLabel)).toBeVisible();
    await page.getByLabel("Search conversations").fill(`${quote} ETH`);
    await expect(conversationRow(page, contactLabel)).toBeVisible();
    await page.getByLabel("Search conversations").fill("nothing matches this");
    // Rail and centre pane agree, and the centre offers the way back.
    await expect(
      conversationsRail(page).getByText("No conversation matches", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No conversation matches." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show all conversations" }).click();
    await expect(page.getByLabel("Search conversations")).toHaveValue("");
    await expect(
      page.getByRole("button", { name: /Needs action only/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(conversationRow(page, contactLabel)).toBeVisible();
    await context.getByRole("button", { name: "Close contact context" }).click();
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await entry(page, offerBody).getByRole("button", { name: "Accept & send 0.25 STRK" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `artifacts/desktop-ux/chat-focus/offer-${width}.png`, animations: "disabled" });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: "artifacts/desktop-ux/bob-offer.png", animations: "disabled" });
  });

  await test.step("6. Bob accepts once and confirms the local transfer and receipt", async () => {
    await conversationRow(page, contactLabel).click();
    const accept = entry(page, offerBody).getByRole("button", { name: "Accept & send 0.25 STRK" });
    await accept.click();
    if (recoveryRun) {
      const card = entry(page, offerBody);
      await expect(card.getByText(/Payment complete; receipt not confirmed/)).toBeVisible({ timeout: 180_000 });
      await expect(accept).toHaveCount(0);
      await expect(card).toContainText("Posting it will not send the payment again.");
      await card.getByRole("button", { name: "Post receipt", exact: true }).click();
      await expect(card).toContainText("You can retry only the receipt.");
      await page.screenshot({ path: "artifacts/desktop-ux/recovery/receipt-retry.png" });
      await card.getByRole("button", { name: "Post receipt", exact: true }).click();
      await expect(card.getByText("Receipt confirmed.", { exact: true })).toBeVisible({ timeout: 180_000 });
      expect(await page.evaluate(() => (window as any).__acceptCount)).toBe(1);
      expect(await page.evaluate(() => (window as any).__receiptAttempts)).toBe(3);
    } else {
      await expect(page.getByText("Accept transfer and one-sided receipt confirmed.", { exact: true })).toBeVisible({ timeout: 180_000 });
    }
    await expect(accept).toHaveCount(0);
    await page.screenshot({ path: "artifacts/desktop-ux/bob-accepted.png", animations: "disabled" });
  });
});
