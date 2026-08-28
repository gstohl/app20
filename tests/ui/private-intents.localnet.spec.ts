import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";
import {
  LOCALNET_WALLET_API,
  connectLocalnetWallet,
  localNetworkToggle,
  localnetIdentity,
  readLocalnetConfig,
  selectLocalNetwork,
} from "./support/localnet";

async function quote(desk: Locator, outputSymbol: "STRK" | "USDC") {
  const preflight = desk.getByLabel("Privacy preflight");
  const requestButton = desk.getByRole("button", {
    name: "Request signed quotes",
  });
  await expect(preflight).toContainText(
    "Exact-amount frequency is unavailable",
  );
  await expect(preflight).toContainText(
    "First-version settlement publicly reveals: amount, deadline, helper activity, lifecycle timing, pair.",
  );
  await expect(requestButton).toBeDisabled();
  await preflight
    .getByRole("checkbox", {
      name: "I understand the warnings and known public settlement leakage.",
    })
    .check();
  await expect(desk.getByRole("button", { name: "Prepare exact invitation review" })).toBeEnabled();
  await desk.getByRole("button", { name: "Prepare exact invitation review" }).click();
  const invitationReview = desk.getByLabel("Exact invitation review");
  await expect(invitationReview).toContainText("Full fill only");
  await expect(invitationReview).toContainText("app20-localnet-solver");
  await expect(invitationReview).toContainText("app20-localnet-solver-b");
  await expect(invitationReview).toContainText("local-fixture-checkpoint-v1");
  await invitationReview.getByRole("checkbox").check();
  await expect(requestButton).toBeEnabled();
  await requestButton.click();
  const solverQuote = desk.getByLabel("Selected private maker quote");
  await expect(solverQuote).toBeVisible({ timeout: 60_000 });
  await expect(solverQuote).toContainText("YOU RECEIVE");
  await expect(solverQuote).toContainText(outputSymbol);
  await expect(solverQuote).toContainText("2 VERIFIED QUOTES");
  await expect(solverQuote).not.toContainText("SOLVER INVENTORY");
  await expect(solverQuote).toContainText("20 BPS");
  await expect(solverQuote).toContainText("QUOTE 10 MIN · REFUND 20 MIN");
  await expect(desk.getByLabel("Private intent market")).toBeDisabled();
  await expect(desk.getByLabel("Private intent sell amount")).toBeDisabled();
  await expect(desk.getByRole("button", { name: "Reverse swap direction" })).toBeDisabled();
  await expect(desk.getByText("Deterministic ranking: highest verified receive; later quote expiry; maker ID; reservation ID.")).toBeVisible();
  const cohort = desk.getByLabel("Invited maker cohort");
  await expect(cohort.getByRole("row")).toHaveCount(3);
  await expect(cohort).toContainText("raw inventory not exposed");
  await expect(cohort).toContainText("Eligible · selected");
  await desk.getByRole("button", { name: "Review selected quote" }).click();
  await expect(desk.getByRole("heading", { name: "Final value review" })).toBeVisible();
  await expect(desk.getByText("Legacy localnet escrow · not production canonical")).toBeVisible();
  await expect(desk.getByText(/zero-fixture-v1/)).toBeVisible();
  await expect(desk.getByText(/Unknown unless wallet-confirmed/)).toBeVisible();
  await expect(desk.getByText(/Full fill only/).first()).toBeVisible();
}

async function privateBalance(request: APIRequestContext, token: string) {
  const response = await request.post(`${LOCALNET_WALLET_API}/balances`, {
    headers: { Origin: new URL(LOCALNET_WALLET_API).origin },
    data: { identity: "alice", tokens: [token] },
  });
  expect(response.ok()).toBeTruthy();
  return BigInt((await response.json()).result[0].balance);
}

async function crashAndRecoverSelectedMaker(
  request: APIRequestContext,
  makerId: string,
) {
  let state: {
    makers?: Array<{ makerId?: string; pid?: number }>;
  };
  try {
    state = JSON.parse(
      readFileSync(
        join(process.cwd(), ".app20-localnet", "state.json"),
        "utf8",
      ),
    );
  } catch (error) {
    throw new Error("Could not read the localnet maker process state.", {
      cause: error,
    });
  }
  const originalPid = state.makers?.find(
    (maker) => maker.makerId === makerId,
  )?.pid;
  expect(originalPid).toBeGreaterThan(0);
  if (!originalPid) throw new Error(`${makerId} has no recorded process ID.`);
  process.kill(originalPid, "SIGKILL");

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await request.get(`${LOCALNET_WALLET_API}/health`);
    if (response.ok()) {
      const health = await response.json();
      const recovered = health.result.makers?.find(
        (maker: {
          makerId?: string;
          processAlive?: boolean;
          processPid?: number;
        }) => maker.makerId === makerId,
      );
      if (
        recovered?.processAlive === true &&
        recovered.processPid !== originalPid
      ) {
        return;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${makerId} did not recover from its WAL within 60 seconds.`);
}

test("RFQ operations dashboard and endpoint expose only browser-safe localnet status", async ({ page, request }) => {
  const response = await request.get(`${LOCALNET_WALLET_API}/rfq/operations/status`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.result).toMatchObject({
    schema: "app20/rfq-operations-status/v1",
    environment: "localnet",
    mode: "running",
    claimsAndRefundsEnabled: true,
    rawInventoryExposed: false,
  });
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/settlementAccount|processPid|operationLog|availableBaseUnits|rawBalance/i);
  await page.goto("/rfq/operations");
  await expect(page).toHaveURL(/\/rfq\/operations$/);
  await expect(page.getByRole("heading", { name: "RFQ operations" })).toBeVisible();
  await expect(page.getByText(/It does not expose or request raw health/)).toBeVisible();
  await expect(page.getByLabel("Invited maker cohort").getByRole("row")).toHaveCount(3);
});

test("APP20 clears both USDC↔STRK directions and refunds on localnet", async ({
  page,
  request,
}) => {
  test.setTimeout(15 * 60_000);
  const config = await readLocalnetConfig(request);
  expect(BigInt(config.usdcTokenAddress)).toBeGreaterThan(0n);

  await page.goto("/vault#desk");
  await expect(page).toHaveURL(/\/rfq#desk$/);
  const localToggle = localNetworkToggle(page);
  await expect(localToggle).toBeVisible();
  await expect(localToggle).toHaveAttribute("aria-pressed", "false");
  await selectLocalNetwork(page);
  await connectLocalnetWallet(page);
  await expect(page.getByText("LOCALNET (DEV) / DEV WALLET")).toBeVisible();

  const counterparty = localnetIdentity(config, "bob");
  await page.getByRole("link", { name: "Counterparties" }).click();
  await page.getByLabel("New address book label").fill("Bob trading desk");
  await page.getByLabel("New address book address").fill(counterparty.address);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const encryptedMailLink = page.getByRole("link", {
    name: "Encrypted Mail",
  });
  await expect(encryptedMailLink).toHaveAttribute("href", "/mail/inbox");
  await page.getByRole("link", { name: "New RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq(?:#desk)?/);
  await expect(page.getByText("CORRESPONDENCE CONTACT")).toBeVisible();

  const desk = page.getByRole("region", {
    name: "Block RFQ",
    exact: true,
  });
  const market = desk.getByLabel("Private intent market");
  const sellAmount = desk.getByLabel("Private intent sell amount");
  const minimumReceive = desk.getByLabel("Private intent minimum receive");
  await expect(desk).toBeVisible();
  await expect(market).toHaveValue("STRK_USDC");
  await expect(sellAmount).toHaveValue("0.1");
  await expect(minimumReceive).toHaveValue("0.198");

  await quote(desk, "USDC");
  await crashAndRecoverSelectedMaker(request, "app20-localnet-solver-b");
  await expect(desk.getByLabel("Selected private maker quote")).toContainText(
    "0.1996 USDC",
  );
  await desk
    .getByRole("button", { name: "Accept and fund on LOCALNET" })
    .click();
  await expect(desk.getByText(/Funding confirmed from an exact local deal observation/)).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Request maker fill" }).click();
  await expect(desk.getByText(/Exact maker fill observed/)).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(
    desk.getByText("Local demo escrow observation confirms the selected-maker claim.", { exact: true }),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await expect(desk.getByText("1 local transaction references recorded")).toBeVisible();

  const usdcAfterFirstFill = await privateBalance(
    request,
    config.usdcTokenAddress,
  );
  expect(usdcAfterFirstFill).toBe(199_600n);

  await desk.getByRole("button", { name: "Start another RFQ" }).click();
  await market.selectOption("USDC_STRK");
  await expect(sellAmount).toHaveValue("0.1");
  await expect(minimumReceive).toHaveValue("0.0495");
  await quote(desk, "STRK");
  await expect(desk.getByLabel("Selected private maker quote")).toContainText(
    "0.0499 STRK",
  );
  await desk.getByRole("button", { name: "Accept and fund on LOCALNET" }).click();
  await expect(desk.getByText(/Funding confirmed from an exact local deal observation/)).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Request maker fill" }).click();
  await expect(desk.getByText(/Exact maker fill observed/)).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(desk.getByText("Local demo escrow observation confirms the selected-maker claim.", { exact: true })).toBeVisible({ timeout: 5 * 60_000 });

  const usdcAfterReverseFill = await privateBalance(
    request,
    config.usdcTokenAddress,
  );
  expect(usdcAfterReverseFill).toBe(99_600n);

  await desk.getByRole("button", { name: "Start another RFQ" }).click();
  await sellAmount.fill("0.05");
  await minimumReceive.fill("0.024");
  await quote(desk, "STRK");
  await desk.getByLabel("No fill → expiry refund").check();
  await desk.getByRole("button", { name: "Accept and fund on LOCALNET" }).click();
  await expect(desk.getByText(/Funding confirmed from an exact local deal observation/)).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Await and observe settlement expiry" }).click();
  await expect(desk.getByText(/Settlement expiry observed by the local harness/)).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(desk.getByText("Local demo escrow observation confirms the timeout refund.", { exact: true })).toBeVisible({ timeout: 5 * 60_000 });
  await expect(desk.getByText("1 local transaction references recorded")).toBeVisible();
  await expect(privateBalance(request, config.usdcTokenAddress)).resolves.toBe(
    usdcAfterReverseFill,
  );

  await desk.getByRole("button", { name: "Start another RFQ" }).click();
  await market.selectOption("USDC_STRK");
  await sellAmount.fill("11");
  await minimumReceive.fill("5.445");
  await desk
    .getByLabel("Privacy preflight")
    .getByRole("checkbox", {
      name: "I understand the warnings and known public settlement leakage.",
    })
    .check();
  await desk.getByRole("button", { name: "Prepare exact invitation review" }).click();
  await desk.getByLabel("Exact invitation review").getByRole("checkbox").check();
  await desk.getByRole("button", { name: "Request signed quotes" }).click();
  await expect(
    desk
      .getByRole("alert")
      .filter({ hasText: /private maker inventory can cover/i }),
  ).toBeVisible({ timeout: 60_000 });
});
