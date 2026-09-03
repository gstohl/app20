import {
  connectLocalnetWallet,
  expect,
  expectNoHorizontalOverflow,
  localnetIdentity,
  openLocalnetPage,
  test,
  type Locator,
  type Page,
} from "./support/localnet";

async function expectVisibleFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  const focus = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focus.focusVisible).toBe(true);
  expect(focus.outlineStyle).not.toBe("none");
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
}

async function tabTo(page: Page, target: Locator, maximumTabs = 40) {
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement))
      return;
  }
  throw new Error(`Keyboard focus did not reach ${await target.toString()}.`);
}

async function expectNamedInteractiveControls(scope: Locator) {
  const unnamed = await scope
    .locator("a, button, input, select, textarea, summary")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          if (
            !(element instanceof HTMLElement) ||
            !element.getClientRects().length
          )
            return false;
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledByText = labelledBy
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
          const labels =
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
              ? Array.from(element.labels ?? [])
                  .map((label) => label.textContent ?? "")
                  .join(" ")
                  .trim()
              : "";
          const name =
            element.getAttribute("aria-label")?.trim() ||
            labelledByText ||
            element.getAttribute("title")?.trim() ||
            labels ||
            element.textContent?.trim() ||
            (element instanceof HTMLInputElement ? element.value.trim() : "");
          return !name;
        })
        .map((element) => element.outerHTML),
    );
  expect(unnamed).toEqual([]);
}

function expectHeadingOrder(headings: readonly number[]) {
  expect(headings.filter((level) => level === 1)).toHaveLength(1);
  expect(headings[0]).toBe(1);
  for (let index = 1; index < headings.length; index += 1) {
    expect(
      headings[index],
      `heading level skipped after heading ${index}`,
    ).toBeLessThanOrEqual(headings[index - 1] + 1);
  }
}

async function prepareFinalReview(page: Page) {
  await openLocalnetPage(page, "/rfq#desk");

  const ticket = page.locator('aside[aria-label="Private RFQ ticket"]');
  const desk = ticket.getByRole("region", { name: "Block RFQ", exact: true });
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
  await desk
    .getByRole("button", { name: "Request collateralized quotes" })
    .click();

  const comparison = desk.getByRole("region", { name: /Compare all makers/ });
  await expect(comparison).toBeFocused({ timeout: 60_000 });
  await desk
    .getByRole("button", { name: "Review selected quote fills" })
    .click();
  const review = desk.getByRole("region", {
    name: "Final atomic Take review",
  });
  await expect(review).toBeFocused({ timeout: 60_000 });
  return { ticket, desk, comparison, review };
}

async function expectBefore(earlier: Locator, later: Locator) {
  expect(
    await earlier.evaluate(
      (element, candidate) =>
        Boolean(
          element.compareDocumentPosition(candidate as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      await later.elementHandle(),
    ),
  ).toBe(true);
}

async function seedAuthorityActivity(
  page: Page,
  input: {
    account: string;
    chainId: string;
    escrowAddress: string;
    sellToken: string;
    buyToken: string;
  },
) {
  await page.evaluate(async (values) => {
    const dynamicImport = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const lifecycle = await dynamicImport("/src/app/rfq/rfq-lifecycle.ts");
    const storage = await dynamicImport("/src/app/rfq/rfq-storage.ts");
    const now = Math.floor(Date.now() / 1_000);
    const rfqId = "0xa110";
    const requestDigest = `0x${"a1".repeat(32)}`;
    const quoteDigest = `0x${"a2".repeat(32)}`;
    const quoteId = `0x${"a3".repeat(32)}`;
    const reservationId = `0x${"a4".repeat(32)}`;
    let record = lifecycle.createRfqLifecycleRecord({
      chainId: values.chainId,
      account: values.account,
      rfqId,
      state: "cancelled",
      now,
      requestDigest,
      terms: {
        pairId: "STRK_USDC",
        sellSymbol: "STRK",
        sellAddress: values.sellToken,
        sellDecimals: 18,
        sellAmount: "100000000000000000",
        buySymbol: "USDC",
        buyAddress: values.buyToken,
        buyDecimals: 6,
        minBuyAmount: "198000",
        buyAmount: "199600",
        rfqExpiresAt: now + 600,
      },
      selectedQuote: {
        version: "Quote V2",
        solverId: "app20-localnet-solver-b",
        solverKey: "app20-localnet-solver-b/quote/p256/v1",
        nonce: quoteId,
        reservationId,
        reservationFence: "17",
        quoteDigest,
        spreadBps: 20,
        pricingProvenance: "fixture:accessibility-evidence",
        quotedAt: now,
        quoteExpiresAt: now + 600,
        reservationExpiresAt: now + 900,
        buyAmount: "199600",
        intentDigest: requestDigest,
        signature: "0x1",
      },
      settlement: {
        version: "Localnet V2",
        escrowAddress: values.escrowAddress,
        dealId: rfqId,
        ticketAddress: "0xa115",
        deadline: now + 1_200,
      },
    });
    record = lifecycle.reviseRfqLifecycle(record, {
      evidenceAuthority: {
        status: "disagreement",
        label: "persisted text must not choose the visible label",
        revision: 7,
        observedAt: now,
      },
      updatedAt: now + 1,
    });
    await storage.createIndexedDbRfqStorage().save(record);
  }, input);
}

test("RFQ privacy briefing is versioned once and remains reviewable", async ({
  page,
}) => {
  await openLocalnetPage(page, "/rfq#new");

  const dialog = page.getByRole("dialog", {
    name: "Before your first private RFQ",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Acknowledge and continue" }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Acknowledge and continue" })
    .click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("app20:rfq:privacy-briefing")),
    )
    .toBe("rfq-v3-observability-briefing:1");

  const preflight = page.getByLabel("Privacy preflight");
  await expect(preflight).toContainText("BRIEFED ONCE");
  const freshnessHelp = page.getByRole("button", {
    name: "About maker-data freshness",
  });
  const freshnessTooltip = page.getByRole("tooltip", {
    name: "Fresh operations window.",
  });
  await freshnessHelp.hover();
  await expect(freshnessTooltip).toBeVisible();
  await freshnessHelp.focus();
  await expect(freshnessTooltip).toBeVisible();

  await openLocalnetPage(page, "/rfq#new");
  await expect(dialog).toBeHidden();
  await page
    .getByLabel("Privacy preflight")
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close briefing" }).click();
  await expect(dialog).toBeHidden();
});

test("RFQ hash navigation is keyboard reachable and lands focus in labelled regions", async ({
  page,
}) => {
  await page.goto("/rfq#new");
  const newLink = page.getByRole("link", { name: "New", exact: true });
  const activeLink = page.getByRole("link", { name: "Active", exact: true });
  const activityLink = page.getByRole("link", {
    name: "Activity",
    exact: true,
  });

  await tabTo(page, newLink);
  await expectVisibleFocus(newLink);
  await page.keyboard.press("Tab");
  await expectVisibleFocus(activeLink);
  await page.keyboard.press("Tab");
  await expectVisibleFocus(activityLink);

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/rfq#active$/);
  await expectVisibleFocus(page.getByRole("region", { name: "Active RFQs" }));

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expectVisibleFocus(activityLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/rfq#activity$/);
  await expectVisibleFocus(page.getByRole("region", { name: "RFQ activity" }));
});

test("RFQ screen-reader shape, heading order, zoom reflow, and responsive hierarchy remain usable", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  await page.setViewportSize({ width: 640, height: 400 });
  const { ticket, review } = await prepareFinalReview(page);

  await expect(page.getByRole("banner")).toBeVisible();
  const disconnectWallet = page.getByRole("button", {
    name: "Disconnect wallet",
    exact: true,
  });
  await expect(disconnectWallet).toBeVisible();
  await expect(disconnectWallet).toHaveAccessibleName("Disconnect wallet");
  await expect(
    disconnectWallet.getByText("Disconnect", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "APP20 modules" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "RFQ workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Separate operations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "RFQ environment" }),
  ).toContainText("LOCALNET DEMO");
  await expect(
    page.getByRole("list", { name: "Verified maker quotes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Private RFQ", level: 1 }),
  ).toHaveCount(1);
  for (const name of ["New", "Active", "Activity"]) {
    await expect(
      page.getByRole("link", { name, exact: true }),
    ).toHaveAccessibleName(name);
  }

  const accept = review.getByRole("button", {
    name: "Take atomically on LOCALNET",
  });
  await expect(accept).toBeEnabled();
  await tabTo(page, accept, 10);
  await expectVisibleFocus(accept);
  await review.getByText("Protocol details", { exact: true }).click();
  const finalCopyControls = review.locator('button[aria-label^="Copy "]');
  await expect(finalCopyControls).toHaveCount(2);
  const finalCopyNames = await finalCopyControls.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label") ?? ""),
  );
  expect(finalCopyNames.every(Boolean)).toBe(true);
  expect(new Set(finalCopyNames).size).toBe(finalCopyNames.length);
  await expectNamedInteractiveControls(ticket);

  const headingLevels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((headings) =>
      headings.map((heading) => Number(heading.tagName.slice(1))),
    );
  expectHeadingOrder(headingLevels);

  const zoomOverflowingElements = await page
    .locator("*")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.right > innerWidth + 0.5 || bounds.left < -0.5;
        })
        .map((element) => ({
          tag: element.tagName,
          className: element.getAttribute("class") ?? "",
          text: (element.textContent ?? "").trim().slice(0, 80),
          bounds: element.getBoundingClientRect().toJSON(),
        })),
    );
  expect(zoomOverflowingElements).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await accept.scrollIntoViewIfNeeded();
  const zoomActionBounds = await accept.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  expect(zoomActionBounds.left).toBeGreaterThanOrEqual(0);
  expect(zoomActionBounds.right).toBeLessThanOrEqual(
    zoomActionBounds.viewportWidth,
  );
  expect(zoomActionBounds.top).toBeGreaterThanOrEqual(0);
  expect(zoomActionBounds.bottom).toBeLessThanOrEqual(
    zoomActionBounds.viewportHeight,
  );

  const environment = page.getByRole("status", { name: "RFQ environment" });
  const comparison = ticket.getByRole("region", {
    name: /Compare all makers/,
  });
  const publicMarket = page.getByRole("region", {
    name: "Public market context",
  });
  const funding = page.getByRole("link", { name: "Shield / unshield funding" });
  const send = page.getByRole("link", { name: "Public send" });
  const crossChain = page.getByRole("link", { name: "Cross-chain dry review" });
  const recovery = page.getByRole("link", { name: "Privy recovery" });

  for (const width of [320, 375, 768, 1_440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    for (const primary of [environment, ticket, comparison, review]) {
      for (const secondary of [
        publicMarket,
        funding,
        send,
        crossChain,
        recovery,
      ]) {
        await expectBefore(primary, secondary);
      }
    }
    await accept.scrollIntoViewIfNeeded();
    const actionBounds = await accept.boundingBox();
    expect(actionBounds).not.toBeNull();
    expect(actionBounds!.x).toBeGreaterThanOrEqual(0);
    expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(width);
  }
});

test("authority and copy controls expose unambiguous text rather than colour-only state", async ({
  page,
  localnetConfig: config,
}) => {
  const account = localnetIdentity(config, "alice").address;
  await openLocalnetPage(page, "/rfq#activity");
  await seedAuthorityActivity(page, {
    account,
    chainId: config.chainId,
    escrowAddress: config.escrowAddress,
    sellToken: config.tokenAddress,
    buyToken: config.usdcTokenAddress,
  });
  await page.reload();
  await connectLocalnetWallet(page);

  const authority = page
    .getByRole("article", { name: "STRK → USDC · Cancelled" })
    .getByRole("alert", {
      name: "Settlement authority: Reader disagreement · unverified",
    });
  await expect(authority).toBeVisible();
  await expect(authority).toHaveAttribute("data-tone", "warning");
  await expect(authority).toContainText("Reader disagreement · unverified");
  await expect(authority).toContainText("Configured readers disagreed");
  await expect(authority).toContainText(
    "value actions are blocked until this is reconciled",
  );

  const copyControls = page.locator('button[aria-label^="Copy "]');
  await expect(copyControls).toHaveCount(4);
  const copyNames = await copyControls.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label") ?? ""),
  );
  expect(copyNames.every(Boolean)).toBe(true);
  expect(new Set(copyNames).size).toBe(copyNames.length);
  expect(copyNames).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^Copy RFQ ID /),
      expect.stringMatching(/^Copy Quote ID /),
      expect.stringMatching(/^Copy Reservation ID /),
      expect.stringMatching(/^Copy Deal ID /),
    ]),
  );
  await expectNamedInteractiveControls(page.getByRole("main"));
  expectHeadingOrder(
    await page
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((headings) =>
        headings.map((heading) => Number(heading.tagName.slice(1))),
      ),
  );
});
