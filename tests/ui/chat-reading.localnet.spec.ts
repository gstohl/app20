import { expect, localnetIdentity, openLocalnetPage, test } from './support/localnet';

test('Chat setup choices and reading position survive newly arriving and older messages', async ({ page, localnetConfig }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  // Inject deterministic arrivals into the real mailbox hook only in this browser test.
  // No fixture is written to the chain or shipped in the application.
  await page.route('**/src/app/chat/useMailboxDesk.ts*', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'const [messages, setMessages] = useState([]);';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, marker + `
      useEffect(() => {
        window.__testMailReady = true;
        const receive = (event) => setMessages(event.detail);
        window.addEventListener('test-mail-arrivals', receive);
        return () => window.removeEventListener('test-mail-arrivals', receive);
      }, []);
    `) });
  });
  await openLocalnetPage(page, '/chat');
  await page.getByText('Restore from backup', { exact: true }).click();
  await expect(page.getByLabel('Chat recovery phrase')).toBeVisible();
  await page.screenshot({ path: 'artifacts/desktop-ux/four-steps/restore.png' });
  await expect(page.getByRole('button', { name: 'Enable encrypted chat' })).toHaveCount(0);
  await page.getByText('Restore from backup', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable encrypted chat' })).toBeVisible();
  await expect(page.getByLabel('Chat recovery phrase')).toBeHidden();
  const bob = localnetIdentity(localnetConfig, 'bob');
  const makeMessage = (index: number) => ({
    id: `reading-${index}`, index: String(index), direction: 'incoming', assignedAddress: bob.address,
    plaintext: `Reading message ${index}\n${"A longer line for reading position.\n".repeat(5)}`,
    envelope: { version: 1, type: 'text', payload: { conversationId: `0x${'aa'.repeat(32)}`, documentId: `0x${(index + 1).toString(16).padStart(64, '0')}`, body: `Reading message ${index}\n${'A longer line for reading position.\n'.repeat(5)}` } },
    record: { ephemeralPub: ['0x1', '0x2'], viewTag: 3, nonce: [`0x${(index + 1).toString(16)}`, '0x5'], ciphertextFelts: [`0x${(index + 1).toString(16)}`] },
    transactionHash: `0x${(index + 1).toString(16)}`, blockNumber: index + 10, blockTimestamp: 1_900_000_000 + index,
  });
  let messages = Array.from({ length: 18 }, (_, i) => makeMessage(i + 1));
  const deliver = () => page.evaluate((detail) => window.dispatchEvent(new CustomEvent('test-mail-arrivals', { detail })), messages);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__testMailReady))).toBe(true);
  await deliver();
  await page.getByRole('region', { name: 'Conversations', exact: true }).locator('ol button').first().click();
  const timeline = page.getByRole('list', { name: /^Conversation with/ });
  const scroll = timeline.locator('..');
  await expect(timeline.locator(':scope > li')).toHaveCount(18);
  await scroll.evaluate((element) => { element.scrollTop = 200; element.dispatchEvent(new Event('scroll')); });
  const before = await scroll.evaluate((element) => element.scrollTop);
  messages = [...messages, makeMessage(19)];
  await deliver();
  const latest = page.getByRole('button', { name: '1 new message · Jump to latest' });
  await expect(latest).toBeVisible();
  await page.screenshot({ path: 'artifacts/desktop-ux/four-steps/new-mail.png' });
  expect(Math.abs(await scroll.evaluate((element) => element.scrollTop) - before)).toBeLessThan(3);
  const read = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('app20/mailread/v1/')).flatMap((key) => JSON.parse(localStorage.getItem(key) || '[]')));
  expect(await read()).not.toContain('reading-19');
  await latest.click();
  await expect(latest).toHaveCount(0);
  await expect.poll(read).toContain('reading-19');
  await expect(timeline.locator(':scope > li').last()).toBeFocused();
  await scroll.evaluate((element) => { element.scrollTop = 200; element.dispatchEvent(new Event('scroll')); });
  const anchor = timeline.locator(':scope > li').nth(1);
  const anchorId = await anchor.getAttribute('id');
  const anchorBefore = await anchor.boundingBox();
  messages = [makeMessage(0), ...messages];
  await deliver();
  await expect(timeline.locator(':scope > li')).toHaveCount(20);
  await expect.poll(async () => Math.abs((await page.locator(`[id="${anchorId}"]`).boundingBox())!.y - anchorBefore!.y)).toBeLessThan(3);
  await expect(latest).toHaveCount(0);
  const details = timeline.locator(':scope > li').last().locator('summary', { hasText: 'Message details' });
  await details.click();
  await expect(timeline.getByRole('complementary', { name: /Public on-chain record for message 19/ })).toBeVisible();
});
