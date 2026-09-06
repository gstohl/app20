import { openLocalnetPage, activateLocalnet, expect, expectNoHorizontalOverflow, localnetIdentity, test } from './support/localnet';

test('desktop wallet switches Alice and Bob, copies the active address, and opens a conversation with keyboard focus', async ({ page, context, localnetConfig }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/chat');
  await activateLocalnet(page);
  const header = page.locator('.app-header');
  const copy = header.getByRole('button', { name: 'Copy active wallet address' });
  for (const id of ['alice', 'bob'] as const) {
    const identity = localnetIdentity(localnetConfig, id);
    const button = header.locator(`[data-localnet-identity="${id}"]`);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await copy.focus();
    await expect(copy).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(header.getByRole('status').filter({ hasText: 'Wallet address copied.' })).toBeVisible();
    expect(BigInt(await page.evaluate(() => navigator.clipboard.readText()))).toBe(BigInt(identity.address));
  }
  await header.locator('[data-localnet-identity="alice"]').click();
  await expect(copy).toHaveText('Copy');
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    await expect(copy).toBeVisible();
    const nav = await page.getByRole('navigation', { name: 'APP20 modules' }).boundingBox();
    const controls = await page.locator('.app-utilities').boundingBox();
    expect(nav!.x + nav!.width <= controls!.x || nav!.y >= controls!.y + controls!.height).toBe(true);
    await page.screenshot({ path: `artifacts/desktop-ux/desktop-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('heading', { name: 'No conversations on this device yet.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable encrypted chat' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Contact context' })).toBeHidden();
  await page.screenshot({ path: 'artifacts/desktop-ux/iteration-2/chat-empty.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByLabel('New conversation address')).toBeFocused();
  const addressBounds = await page.getByLabel('New conversation address').boundingBox();
  const searchBounds = await page.getByLabel('Search conversations').boundingBox();
  expect(addressBounds!.y).toBeLessThan(searchBounds!.y);
  // Clipboard denial must leave a usable, selectable address, never claim success.
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true, value: () => Promise.reject(new Error('Clipboard denied')),
  }));
  await copy.click();
  await expect(header.getByLabel('Active wallet address', { exact: true })).toBeVisible();
  await expect(header.getByRole('status').filter({ hasText: 'Could not copy.' })).toBeVisible();
  await header.getByRole('button', { name: 'Disconnect wallet' }).click();
  await expect(copy).toHaveCount(0);
});

test('desktop RFQ keeps amounts side by side and makes hints dismissible with Escape', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(15_000);
  await openLocalnetPage(page, '/rfq');
  await page.getByRole('button', { name: 'Instant RFQ', exact: true }).click();
  const acknowledge = page.getByRole('button', { name: 'Acknowledge and continue' });
  if (await acknowledge.isVisible()) await acknowledge.click();
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    const sell = await page.getByLabel('Private intent sell amount', { exact: true }).boundingBox();
    const receive = await page.getByLabel('Private intent local policy floor', { exact: true }).boundingBox();
    expect(sell).not.toBeNull();
    expect(receive).not.toBeNull();
    expect(Math.abs(sell!.y - receive!.y)).toBeLessThan(35);
    expect(receive!.x).toBeGreaterThan(sell!.x + sell!.width);
    await page.screenshot({ path: `artifacts/desktop-ux/declutter/rfq-${width}.png`, fullPage: true });
  }
  const hint = page.getByRole('button', { name: 'About RFQ availability' });
  const tooltip = hint.locator('..').getByRole('tooltip');
  await hint.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await expect(hint).toBeFocused();
  await page.keyboard.press('Tab');
  await hint.focus();
  await expect(tooltip).toBeVisible();
  await page.getByLabel('Privacy preflight').locator('summary').filter({ hasText: 'Review privacy evidence' }).click();
  await expect(page.getByLabel('Privacy preflight').locator('details')).toHaveAttribute('open', '');
});
