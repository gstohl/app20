import {
  expect,
  primeLocalnetMailSeed,
  restoreLocalnetMailRandomness,
  type LocalnetIdentityId,
  type Locator,
  type Page,
} from "./localnet";

/**
 * Chat is the mailbox: these helpers speak its vocabulary (conversations,
 * timeline entries, mailbox tools) so every journey reads the same way.
 */

export const COMPOSE_BODY_PLACEHOLDER =
  "Write a private message, or leave blank when sending attachments only";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Displayed addresses are canonical felts; fixture addresses may be zero-padded. */
export function addressPattern(address: string): RegExp {
  return new RegExp(address.replace(/^0x0*/i, ""), "i");
}

export function conversationsRail(page: Page): Locator {
  return page.getByRole("region", { name: "Conversations", exact: true });
}

/** A rail row by its displayed name: a saved label, "This mailbox", "Sealed sender". */
export function conversationRow(page: Page, name: string): Locator {
  return conversationsRail(page).getByRole("button", {
    name: new RegExp(escapeRegExp(name)),
  });
}

/** A rail row for an unnamed counterparty, matched by its wallet address. */
export function conversationRowByAddress(page: Page, address: string): Locator {
  const suffix = address.replace(/^0x0*/i, "").toLowerCase();
  return conversationsRail(page)
    .getByRole("button")
    .filter({ has: page.locator(`strong[title$="${suffix}" i]`) });
}

export function conversationPane(page: Page): Locator {
  return page.getByRole("region", { name: "Conversation", exact: true });
}

/** The open conversation's timeline. */
export function timeline(page: Page): Locator {
  return page.getByRole("list", { name: /^Conversation with / });
}

/** One timeline entry, found by text it carries. */
export function entry(page: Page, text: string): Locator {
  return timeline(page).locator(":scope > li").filter({ hasText: text });
}

export function contextPanel(page: Page): Locator {
  return page.getByRole("complementary", { name: "Contact context" });
}

/** Opens a compact record card so its full Mail card (and its actions) show. */
export async function openFullRecord(card: Locator) {
  const details = card.locator("details").first();
  if ((await details.getAttribute("open")) === null) {
    await card.getByText("Full record", { exact: true }).click();
  }
  await expect(details).toHaveAttribute("open", "");
}

/** The mailbox tools sit under the conversations; each section is a disclosure. */
export async function openTools(page: Page, title: string) {
  await page
    .locator("details", { has: page.locator("summary", { hasText: title }) })
    .first()
    .evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
}

export function openMailboxRecovery(page: Page) {
  return openTools(page, "Encrypted mailbox recovery");
}

export async function scanRecent(page: Page) {
  const button = page.getByRole("button", { name: "Check for new mail" });
  await expect(button).toBeEnabled({ timeout: 120_000 });
  await button.click();
  await page.waitForTimeout(100);
  await expect(button).toBeEnabled({ timeout: 60_000 });
}

/** Every page load starts with the key unloaded; this loads the persisted one. */
export async function loadExistingKey(page: Page) {
  const button = page.getByRole("button", {
    name: "Load device key & register",
  });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveCount(0, { timeout: 60_000 });
}

/** Registers the fixture key for an identity, or loads the one already saved. */
export async function ensureMailboxKey(
  page: Page,
  identity: LocalnetIdentityId,
) {
  const setup = page.getByRole("button", {
    name: "Load device key & register",
  });
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
}

/** Opens the document composer from the mailbox tools, optionally addressed. */
export async function openNewDocument(page: Page, recipient?: string) {
  await openTools(page, "Write to a new address");
  if (recipient !== undefined) {
    await page.getByLabel("New conversation address").fill(recipient);
  }
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New document" }),
  ).toBeVisible();
}

/** Opens the document composer for the open conversation's counterparty. */
export async function attachTerms(page: Page) {
  await page.getByRole("button", { name: "Attach terms", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New document" }),
  ).toBeVisible();
}

export async function closeDocumentIfOpen(page: Page) {
  const close = page.getByRole("button", {
    name: "Close document",
    exact: true,
  });
  if ((await close.count()) > 0) await close.click();
}

/** A module tab in the app header; in-page links may carry the same name. */
export function navLink(page: Page, name: string): Locator {
  return page
    .getByRole("navigation", { name: "APP20 modules" })
    .getByRole("link", { name, exact: true });
}
