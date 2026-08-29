import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const BASE_URL =
  process.env.APP20_TEST_BASE_URL ?? "http://127.0.0.1:5173";
export const LOCALNET_WALLET_API = `${BASE_URL}/__app20_localnet_wallet`;

const LOCALNET_WALLET_NAME = "Localnet (dev)";

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
      .map((element) => ({ element, right: element.getBoundingClientRect().right }))
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
