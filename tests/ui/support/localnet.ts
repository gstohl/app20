import {
  expect,
  request as playwrightRequest,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";

export { expect };
export type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";

export const BASE_URL = (
  process.env.APP20_TEST_BASE_URL ?? "http://127.0.0.1:5173"
).replace(/\/+$/, "");
export const LOCALNET_WALLET_API = `${BASE_URL}/__app20_localnet_wallet`;

const LOCALNET_WALLET_NAME = "Localnet (dev)";
const MAX_FAILURE_EVENTS = 50;

export type LocalnetIdentityId = "alice" | "bob";

export type LocalnetIdentity = {
  id: LocalnetIdentityId;
  label: string;
  address: string;
};

export type LocalnetConfig = {
  walletName: string;
  runtimeEpoch: string;
  chainId: string;
  poolAddress: string;
  helperAddress: string;
  escrowAddress: string;
  tokenAddress: string;
  counterTokenAddress: string;
  usdcTokenAddress: string;
  identities: LocalnetIdentity[];
};

export type StorageSnapshot = {
  local: Record<string, string | null>;
  session: Record<string, string | null>;
};

type LocalnetTestFixtures = {
  localnetConfig: LocalnetConfig;
  failureEvidence: void;
};

type LocalnetWorkerFixtures = {
  workerLocalnetConfig: LocalnetConfig;
};

function withoutFragment(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("#", 1)[0];
  }
}

function retainBounded(values: string[], value: string) {
  if (values.length < MAX_FAILURE_EVENTS) values.push(value);
}

/**
 * Shared UI-test fixtures keep immutable localnet configuration worker-scoped,
 * while Playwright continues to provide a fresh browser context per test.
 */
export const test = base.extend<LocalnetTestFixtures, LocalnetWorkerFixtures>({
  workerLocalnetConfig: [
    async ({}, use) => {
      const request = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        await use(await readLocalnetConfig(request));
      } finally {
        await request.dispose();
      }
    },
    { scope: "worker" },
  ],
  localnetConfig: async ({ workerLocalnetConfig }, use) => {
    await use(workerLocalnetConfig);
  },
  failureEvidence: [
    async ({ page }, use, testInfo) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];
      const errorResponses: string[] = [];
      const onConsole = (message: ConsoleMessage) => {
        if (message.type() === "error")
          retainBounded(consoleErrors, message.text());
      };
      const onPageError = (error: Error) => {
        retainBounded(pageErrors, error.stack ?? error.message);
      };
      const onRequestFailed = (request: Request) => {
        retainBounded(
          failedRequests,
          `${request.method()} ${withoutFragment(request.url())}: ${request.failure()?.errorText ?? "request failed"}`,
        );
      };
      const onResponse = (response: Response) => {
        if (response.status() >= 400)
          retainBounded(
            errorResponses,
            `${response.status()} ${response.request().method()} ${withoutFragment(response.url())}`,
          );
      };

      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      page.on("requestfailed", onRequestFailed);
      page.on("response", onResponse);
      await use();

      let routeCleanupError: unknown;
      try {
        // Route callbacks can still be fetching when the assertion body ends.
        // Waiting here keeps their real errors visible without racing context
        // teardown (and prevents a closed page from manufacturing a failure).
        await page.unrouteAll({ behavior: "wait" });
      } catch (error) {
        routeCleanupError = error;
        retainBounded(
          pageErrors,
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        );
      } finally {
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
        page.off("requestfailed", onRequestFailed);
        page.off("response", onResponse);
      }

      if (routeCleanupError || testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("browser-failure-summary", {
          body: Buffer.from(
            `${JSON.stringify(
              {
                pageUrl: withoutFragment(page.url()),
                consoleErrors,
                pageErrors,
                failedRequests,
                errorResponses,
              },
              null,
              2,
            )}\n`,
          ),
          contentType: "application/json",
        });
      }
      if (routeCleanupError) throw routeCleanupError;
    },
    { auto: true },
  ],
});

export async function readLocalnetConfig(
  request: APIRequestContext,
): Promise<LocalnetConfig> {
  const response = await request.get(`${LOCALNET_WALLET_API}/config`);
  expect(response.ok()).toBeTruthy();
  const config = (await response.json()).result as LocalnetConfig;
  expect(config.walletName).toBe(LOCALNET_WALLET_NAME);
  return config;
}

export function localnetIdentity(
  config: LocalnetConfig,
  id: LocalnetIdentityId,
): LocalnetIdentity {
  const value = config.identities.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Localnet identity ${id} is missing.`);
  return value;
}

export function localNetworkToggle(page: Page) {
  return page.getByRole("button", { name: "LOCAL", exact: true });
}

export async function selectLocalNetwork(page: Page) {
  const toggle = localNetworkToggle(page);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

export async function connectLocalnetWallet(
  page: Page,
  options: { auditFocusReturn?: boolean } = {},
) {
  const trigger = page.getByRole("button", { name: "Connect wallet" });
  const disconnect = page.getByRole("button", { name: "Disconnect wallet" });
  if ((await disconnect.count()) > 0) {
    await expect(disconnect).toBeVisible();
    return;
  }
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(dialog).toBeVisible();
  const localnetOption = dialog.getByRole("button", {
    name: /Localnet \(dev\)/,
  });
  await expect(localnetOption).toBeFocused();
  if (options.auditFocusReturn) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
  }
  await localnetOption.click();
  await expect(disconnect).toBeVisible();
}

export async function activateLocalnet(
  page: Page,
  options: {
    auditFocusReturn?: boolean;
    identity?: LocalnetIdentityId;
  } = {},
) {
  await selectLocalNetwork(page);
  if (options.identity) {
    const selector = page.locator(
      `[data-localnet-identity="${options.identity}"]`,
    );
    if ((await selector.getAttribute("aria-pressed")) !== "true")
      await selector.click();
    await expect(selector).toHaveAttribute("aria-pressed", "true");
  }
  await connectLocalnetWallet(page, {
    auditFocusReturn: options.auditFocusReturn,
  });
}

export async function openLocalnetPage(
  page: Page,
  path: string,
  options: {
    auditFocusReturn?: boolean;
    identity?: LocalnetIdentityId;
  } = {},
) {
  await page.goto(path);
  await activateLocalnet(page, options);
}

export async function newIsolatedLocalnetContext(
  browser: Browser,
  options: {
    config?: LocalnetConfig;
    identity?: LocalnetIdentityId;
  } = {},
): Promise<BrowserContext> {
  if (options.identity && !options.config)
    throw new Error("A localnet config is required to preselect an identity.");
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1_440, height: 900 },
  });
  if (options.identity && options.config) {
    await context.addInitScript(
      ({ runtimeEpoch, identity }) => {
        localStorage.setItem(
          `app20/localnet-wallet/identity/v1/${runtimeEpoch}`,
          identity,
        );
      },
      {
        runtimeEpoch: options.config.runtimeEpoch,
        identity: options.identity,
      },
    );
  }
  return context;
}

export function readStorageSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(() => ({
    local: Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index) as string;
        return [key, localStorage.getItem(key)];
      }),
    ),
    session: Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index) as string;
        return [key, sessionStorage.getItem(key)];
      }),
    ),
  }));
}

export async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("*")]
      .map((element) => ({
        element,
        right: element.getBoundingClientRect().right,
      }))
      .filter(({ element, right }) => {
        if (right <= limit + 0.5) return false;
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      })
      .map(({ element, right }) => {
        const id = element.id ? `#${element.id}` : "";
        const cls = element.getAttribute("class");
        const label =
          element.getAttribute("aria-label") ??
          element.textContent?.trim().slice(0, 40) ??
          "";
        return `${element.tagName.toLowerCase()}${id}${cls ? `.${cls.split(/\s+/).join(".")}` : ""} right=${Math.round(right)} "${label}"`;
      });
    return {
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: limit,
      bodyWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      offenders: offenders.slice(-12),
    };
  });
  const detail = metrics.offenders.length
    ? `\nElements past the viewport edge:\n${metrics.offenders.join("\n")}`
    : "";
  expect(
    metrics.documentWidth,
    `document overflows its client width${detail}`,
  ).toBeLessThanOrEqual(metrics.documentClientWidth);
  expect(
    metrics.bodyWidth,
    `body overflows its client width${detail}`,
  ).toBeLessThanOrEqual(metrics.bodyClientWidth);
}
