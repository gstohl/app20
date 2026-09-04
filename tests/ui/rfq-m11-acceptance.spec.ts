import {
  expect,
  expectNoHorizontalOverflow,
  openLocalnetPage,
  test,
} from "./support/localnet";

test("M11 keeps /rfq canonical, preserves legacy hashes, and restores keyboard-selected views", async ({
  page,
}) => {
  await page.goto("/rfq#new");
  await expect(page).toHaveURL(/\/rfq#new$/);
  await expect(
    page.getByRole("heading", { name: "Private RFQ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "RFQ environment" }),
  ).toContainText("No automatic public fallback");

  const recordsLink = page.getByRole("link", { name: "Records", exact: true });
  await recordsLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/rfq#records$/);
  await expect(page.getByRole("region", { name: "RFQ records" })).toBeFocused();

  await page.reload();
  await expect(page).toHaveURL(/\/rfq#records$/);
  await expect(page.getByRole("region", { name: "RFQ records" })).toBeVisible();

  // The two tabs this view replaced remain valid bookmarks.
  for (const legacy of ["/rfq#active", "/rfq#activity", "/vault#activity"]) {
    await page.goto(legacy);
    await expect(page).toHaveURL(/\/rfq#(active|activity)$/);
    await expect(
      page.getByRole("region", { name: "RFQ records" }),
    ).toBeVisible();
  }
});

test("M11 prioritizes the local RFQ ticket on mobile and keeps proposal migration non-executable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalnetPage(page, "/rfq#new", { auditFocusReturn: true });

  const environment = page.getByRole("status", { name: "RFQ environment" });
  const ticket = page.locator('aside[aria-label="Private RFQ ticket"]');
  const market = page.locator("summary", { hasText: "Public market context" });
  await expect(environment).toContainText("LOCALNET DEMO");
  await expect(ticket).toBeVisible();
  await expect(market).toBeVisible();

  const [ticketBox, marketBox] = await Promise.all([
    ticket.boundingBox(),
    market.boundingBox(),
  ]);
  expect(ticketBox).not.toBeNull();
  expect(marketBox).not.toBeNull();
  expect(ticketBox!.y).toBeLessThan(marketBox!.y);
  await expectNoHorizontalOverflow(page);

  await page.goto("/pools/create/strk/usdc#review");
  await expect(page).toHaveURL(/\/rfq\/markets\/strk\/usdc\/proposal#review$/);
  await expect(
    page.getByRole("heading", { name: "Draft market proposal" }),
  ).toBeVisible();
  await expect(
    page.getByText("PROPOSAL ONLY · NO DEPLOYMENT").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /deploy|create pool|fund pool/i }),
  ).toHaveCount(0);

  const amountA = page.getByRole("textbox", { name: "STRK proposed amount" });
  await amountA.fill("");
  await page.getByRole("button", { name: "Prepare draft review" }).click();
  const errorSummary = page.getByRole("alert", {
    name: "Proposal needs attention",
  });
  await expect(errorSummary).toBeFocused();
  await expect(amountA).toHaveAttribute(
    "aria-describedby",
    "market-proposal-amount-a-error",
  );
  await expectNoHorizontalOverflow(page);
});
