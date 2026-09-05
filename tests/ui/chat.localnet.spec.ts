import {
  activateLocalnet,
  connectLocalnetWallet,
  expect,
  localnetIdentity,
  primeLocalnetMailSeed,
  restoreLocalnetMailRandomness,
  test,
  type LocalnetConfig,
  type LocalnetIdentityId,
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

/** The recovery panel is a closed disclosure in the mailbox rail. */
async function openMailboxRecovery(page: Page) {
  await page
    .locator("details", {
      has: page.getByText("Encrypted mailbox recovery", { exact: true }),
    })
    .first()
    .evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
}

async function closeComposerIfOpen(page: Page) {
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

/** Registers the fixture mailbox key for an identity, or loads the saved one. */
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
    await page
      .getByRole("button", { name: "I saved the backup — open mailbox" })
      .click();
  }
  await expect(scanButton).toBeEnabled({ timeout: 60_000 });
  await openMailboxRecovery(page);
  await expect(
    page.getByRole("button", { name: "Back up RFQ history" }),
  ).toBeEnabled({ timeout: 60_000 });
  await closeComposerIfOpen(page);
}

async function loadExistingKey(page: Page) {
  const button = page.getByRole("button", {
    name: "Load device key & register",
  });
  if ((await button.count()) === 0) {
    await page.getByRole("button", { name: "Compose", exact: true }).click();
  }
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveCount(0, { timeout: 60_000 });
  await closeComposerIfOpen(page);
  await page
    .getByRole("button", { name: /^Inbox/ })
    .first()
    .click();
}

async function scanRecent(page: Page) {
  const button = page.getByRole("button", { name: "Check for new mail" });
  await expect(button).toBeEnabled();
  await button.click();
  await page.waitForTimeout(100);
  await expect(button).toBeEnabled({ timeout: 60_000 });
}

function messageRow(page: Page, body: string) {
  return page.getByRole("button").filter({ hasText: body });
}

/** Displayed addresses are canonical felts; fixture addresses may be zero-padded. */
function addressPattern(address: string): RegExp {
  return new RegExp(address.replace(/^0x0*/i, ""), "i");
}

function conversationRow(page: Page, name: string) {
  return page
    .getByRole("region", { name: "Conversations", exact: true })
    .getByRole("button", { name: new RegExp(name) });
}

test("chat sends an encrypted letter and reads Mailbox's records per counterparty", async ({
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
  const letter = `Chat letter ${runTag}: can you quote 0.25 STRK against ETH today?`;
  const offerBody = `Offer ${runTag} from Mailbox that Chat should read as work`;
  const contactLabel = "Alice desk";

  await test.step("1. both fixture mailboxes register their keys", async () => {
    await page.goto("/mail/inbox");
    await activateLocalnet(page);
    await switchIdentity(page, config, "alice");
    await ensureMailboxKey(page, "alice");
    await switchIdentity(page, config, "bob");
    await ensureMailboxKey(page, "bob");
  });

  await test.step("2. Bob saves Alice as a counterparty and opens Chat", async () => {
    await page.getByRole("link", { name: "Counterparties" }).click();
    await page.getByLabel("New address book label").fill(contactLabel);
    await page.getByLabel("New address book address").fill(alice.address);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(contactLabel, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator(".signal-bar")).toContainText("CHAT");
    await expect(
      page.getByRole("link", { name: "Chat", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const row = conversationRow(page, contactLabel);
    await expect(row).toBeVisible();
    await row.click();
    await expect(
      page
        .getByRole("region", { name: "Conversation", exact: true })
        .locator("header strong"),
    ).toContainText(contactLabel);
    await expect(
      page.getByText(`No records with ${contactLabel} on this device yet.`),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Contact context" }),
    ).toContainText(addressPattern(alice.address));
  });

  await test.step("3. Bob sends an encrypted letter from the composer", async () => {
    const input = page.getByLabel(`Message to ${contactLabel}`);
    await input.fill(letter);
    await expect(
      page.getByRole("form", { name: `Write to ${contactLabel}` }),
    ).toContainText(/bytes · sealed on this device · 1 wallet approval/i);
    await page.getByRole("button", { name: "Send encrypted" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Sealed and confirmed in/ }),
    ).toBeVisible({ timeout: 180_000 });
    const timeline = page.getByRole("list", {
      name: `Conversation with ${contactLabel}`,
    });
    await expect(timeline).toContainText(letter);
    await expect(timeline).toContainText("Sent copy on this device");
    await expect(conversationRow(page, contactLabel)).toContainText("You:");
    await expect(input).toHaveValue("");

    // The same Sent copy is what Mailbox shows: one store, two surfaces.
    await page.getByRole("link", { name: "Mailbox", exact: true }).click();
    await page
      .getByRole("button", { name: /^Sent/ })
      .first()
      .click();
    await expect(messageRow(page, letter)).toBeVisible();
  });

  await test.step("4. Alice decrypts it in Mailbox and answers with an offer", async () => {
    await switchIdentity(page, config, "alice");
    await loadExistingKey(page);
    await scanRecent(page);
    await expect(messageRow(page, letter)).toBeVisible({ timeout: 60_000 });
    await messageRow(page, letter).click();
    await expect(
      page.getByLabel("Correspondence").getByText(letter, { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Compose", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "New document" }),
    ).toBeVisible();
    await page.getByLabel(/^To/).fill(bob.address);
    await page
      .getByPlaceholder(
        "Write a private message, or leave blank when sending attachments only",
      )
      .fill(offerBody);
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
    await expect(messageRow(page, offerBody)).toBeVisible();
  });

  await test.step("5. Bob's Chat reads the received offer as work, with context", async () => {
    await switchIdentity(page, config, "bob");
    await loadExistingKey(page);
    await scanRecent(page);
    await expect(messageRow(page, offerBody)).toBeVisible({ timeout: 60_000 });

    await page.getByRole("link", { name: "Chat", exact: true }).click();
    const row = conversationRow(page, contactLabel);
    await expect(row).toContainText("Needs action");
    await expect(row).toContainText(/\d+ unread/);
    await row.click();
    await expect(row).toContainText("Opened");
    await expect(row).not.toContainText("unread");

    const timeline = page.getByRole("list", {
      name: `Conversation with ${contactLabel}`,
    });
    await expect(timeline).toContainText(letter);
    const offerCard = timeline.getByRole("article", {
      name: new RegExp(`^Offer: ${terms.replaceAll(".", "\\.")}`),
    });
    await expect(offerCard).toBeVisible();
    await expect(offerCard).toContainText("Accept or decline this offer in Mailbox.");
    await expect(timeline).toContainText("Saved by Mailbox from decrypted mail");

    const context = page.getByRole("complementary", { name: "Contact context" });
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
    await expect(timeline).toBeVisible();
    await context.getByRole("button", { name: "Show in conversation" }).click();
    await expect(timeline.locator('li[data-highlight="true"]')).toHaveCount(1);
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
    await expect(page.getByText("No conversation matches")).toBeVisible();
    await page.getByLabel("Search conversations").fill("");
    await page.getByRole("button", { name: /Needs action only/ }).click();
  });
});
