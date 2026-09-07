// Read-only tour of the built pages. The real origin is intercepted locally for CSP.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { presentation } from './presentation.mjs';
import { createBuiltAssetBinding, loadProductionSecurityHeaders } from '../../scripts/verify-production-csp.mjs';
const destination = resolve('artifacts/hackathon/v8');
await mkdir(destination, { recursive: true });
const { handler, env } = await loadProductionSecurityHeaders(process.cwd(), createBuiltAssetBinding(resolve('dist')));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: resolve(destination, 'preview-raw'), size: { width: 1440, height: 1000 } } });
  const page = await context.newPage(), video = page.video();
  await page.route('https://app20.io/**', async route => {
    if (route.request().method() !== 'GET') throw new Error('Preview is read-only.');
    const response = await handler(new Request(route.request().url()), env);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const demo = await presentation(page, 'confidential-preview');
  await page.goto('https://app20.io/rfq/confidential', { waitUntil: 'networkidle' });
  await demo.mark('Confidential development overview');
  await demo.point(page.getByRole('heading', { name: 'Agree privately. Exchange together.', exact: true }));
  await demo.hold(4);
  await demo.point(page.getByRole('heading', { name: 'What remains visible', exact: true }));
  await demo.mark('Public metadata and proving boundary');
  await demo.hold(11);
  await page.screenshot({ path: resolve(destination, 'confidential-preview.png') });
  await page.goto('https://app20.io/agents', { waitUntil: 'networkidle' });
  await demo.point(page.getByRole('heading', { name: 'Confidential RFQ development', exact: true }));
  await demo.mark('SDK development guide');
  await demo.hold(10);
  await page.screenshot({ path: resolve(destination, 'sdk-preview.png') });
  await context.close();
  await video.saveAs(resolve(destination, 'product-preview.webm'));
  console.log('Recorded local build preview; no wallet or transaction used.');
} finally { await browser.close(); }
