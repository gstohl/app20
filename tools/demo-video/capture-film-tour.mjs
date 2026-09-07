// Record the current production build without connecting or signing a wallet.
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {presentation} from './presentation.mjs';
import {createBuiltAssetBinding, loadProductionSecurityHeaders} from '../../scripts/verify-production-csp.mjs';

const destination = resolve(process.env.APP20_DEMO_DIRECTORY ?? 'artifacts/hackathon/v3');
await mkdir(destination, {recursive: true});
const {handler, env} = await loadProductionSecurityHeaders(process.cwd(), createBuiltAssetBinding(resolve('dist')));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, recordVideo: {dir: resolve(destination, 'raw-tour'), size: {width: 1440, height: 900}}});
  const page = await context.newPage();
  const video = page.video();
  // The browser uses the real origin for CSP, but APP20 requests stay local.
  await page.route('https://app20.io/**', async route => {
    if (route.request().method() !== 'GET') throw Error('The product tour must be read-only.');
    const response = await handler(new Request(route.request().url()), env);
    await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
  });
  const demo = await presentation(page, process.env.APP20_DEMO_TOUR_NAME ?? 'v3-tour');
  await page.goto('https://app20.io/rfq', {waitUntil: 'networkidle'});
  await demo.mark('Product overview');
  await demo.point(page.getByRole('heading', {name: 'Private RFQ', exact: true}));
  await demo.hold(3);
  await demo.point(page.getByLabel('You sell (STRK)', {exact: true}));
  await demo.hold(3);
  await demo.point(page.getByLabel('Minimum you receive (USDC)', {exact: true}));
  await demo.hold(5);

  await page.goto('https://app20.io/rfq/maker', {waitUntil: 'networkidle'});
  await demo.mark('Anyone can become a maker');
  await demo.point(page.getByRole('heading', {name: 'Become a maker', exact: true}));
  await demo.hold(10);
  await page.screenshot({path: resolve(destination, 'maker-tour.png')});

  await page.goto('https://app20.io/agents', {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: 'Node.js library', exact: true}).evaluate(element => {
    window.scrollTo({top: window.scrollY + element.getBoundingClientRect().top - 130, behavior: 'smooth'});
  });
  await demo.hold(2);
  await demo.point(page.getByRole('heading', {name: 'Node.js library', exact: true}));
  await demo.mark('Agents use the SDK');
  await demo.hold(3);
  await demo.point(page.getByRole('link', {name: 'API guide and examples', exact: true}));
  await demo.hold(9);
  await page.screenshot({path: resolve(destination, 'agent-tour.png')});
  await demo.mark('End tour');
  await context.close();
  await video.saveAs(resolve(destination, 'product-tour.webm'));
  console.log('Saved current-build read-only tour. No wallet was connected.');
} finally {
  await browser.close();
}
