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

async function quote(
  desk: Locator,
  outputSymbol: "STRK" | "USDC",
  options: { openFinalReview?: boolean } = {},
) {
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
  await expect(
    desk.getByRole("button", { name: "Prepare exact invitation review" }),
  ).toBeEnabled();
  await desk
    .getByRole("button", { name: "Prepare exact invitation review" })
    .click();
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
  const comparison = desk.getByRole("region", {
    name: /Compare all makers/,
  });
  await expect(comparison).toBeFocused();
  await expect(solverQuote).toContainText("YOU RECEIVE");
  await expect(solverQuote).toContainText(outputSymbol);
  await expect(solverQuote).toContainText("2 VERIFIED QUOTES");
  await expect(solverQuote).not.toContainText("SOLVER INVENTORY");
  await expect(solverQuote).toContainText("20 BPS");
  await expect(solverQuote).toContainText("QUOTE 10 MIN · REFUND 20 MIN");
  await expect(desk.getByLabel("Private intent market")).toBeDisabled();
  await expect(desk.getByLabel("Private intent sell amount")).toBeDisabled();
  await expect(
    desk.getByRole("button", { name: "Reverse swap direction" }),
  ).toBeDisabled();
  await expect(
    desk.getByText(
      "Deterministic ranking: highest verified receive; later quote expiry; maker ID; reservation ID.",
    ),
  ).toBeVisible();
  const cohort = desk.getByLabel("Invited maker cohort");
  await expect(cohort.getByRole("listitem")).toHaveCount(2);
  await expect(cohort).toContainText("raw inventory not exposed");
  await expect(cohort).toContainText("Eligible · selected");
  if (options.openFinalReview !== false) {
    await desk.getByRole("button", { name: "Review selected quote" }).click();
    const finalReview = desk.getByRole("region", {
      name: "Final value review",
    });
    await expect(finalReview).toBeVisible();
    await expect(finalReview).toBeFocused();
    await expect(
      desk.getByText("Legacy localnet escrow · not production canonical"),
    ).toBeVisible();
    await desk.getByText("Protocol details", { exact: true }).click();
    await expect(desk.getByText(/zero-fixture-v1/)).toBeVisible();
    await expect(
      desk.getByText(/gas unknown until the wallet confirms/),
    ).toBeVisible();
    await expect(desk.getByText(/Full fill only/).first()).toBeVisible();
  }
}

async function privateBalance(
  request: APIRequestContext,
  token: string,
  runtimeEpoch: string,
) {
  const response = await request.post(`${LOCALNET_WALLET_API}/balances`, {
    headers: { Origin: new URL(LOCALNET_WALLET_API).origin },
    data: { identity: "alice", tokens: [token], runtimeEpoch },
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
      let recoveredPid: number | undefined;
      try {
        const recoveredState = JSON.parse(
          readFileSync(
            join(process.cwd(), ".app20-localnet", "state.json"),
            "utf8",
          ),
        ) as { makers?: Array<{ makerId?: string; pid?: number }> };
        recoveredPid = recoveredState.makers?.find(
          (maker) => maker.makerId === makerId,
        )?.pid;
      } catch {
        // The supervisor may be replacing the private runtime-state record.
      }
      if (recoveredPid && recoveredPid !== originalPid) {
        try {
          process.kill(recoveredPid, 0);
          return;
        } catch {
          // Keep polling until the replacement process is live.
        }
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${makerId} did not recover from its WAL within 60 seconds.`);
}

test("RFQ operations dashboard and endpoint expose only browser-safe localnet status", async ({
  page,
  request,
}) => {
  const response = await request.get(
    `${LOCALNET_WALLET_API}/rfq/operations/status`,
  );
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
  expect(serialized).not.toMatch(
    /settlementAccount|processPid|operationLog|availableBaseUnits|rawBalance/i,
  );
  await page.goto("/rfq/operations");
  await expect(page).toHaveURL(/\/rfq\/operations$/);
  await expect(
    page.getByRole("heading", { name: "RFQ operations" }),
  ).toBeVisible();
  await expect(
    page.getByText(/It does not expose or request raw health/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Invited maker cohort").getByRole("listitem"),
  ).toHaveCount(2);
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

  await quote(desk, "USDC", { openFinalReview: false });
  const freshQuoteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/private-intents/quotes") &&
      response.ok(),
    { timeout: 60_000 },
  );
  await desk.getByRole("button", { name: "Request new quotes" }).click();
  await freshQuoteResponse;
  await expect(desk.getByLabel("Selected private maker quote")).toBeVisible();
  await expect(
    desk.getByRole("region", { name: /Compare all makers/ }),
  ).toBeFocused();
  await desk.getByRole("button", { name: "Review selected quote" }).click();
  await expect(
    desk.getByRole("region", { name: "Final value review" }),
  ).toBeFocused();
  await desk.getByRole("button", { name: "Decline selected quote" }).click();
  await expect(market).toBeEnabled({ timeout: 60_000 });
  await quote(desk, "USDC");
  await crashAndRecoverSelectedMaker(request, "app20-localnet-solver-b");
  await expect(desk.getByLabel("Selected private maker quote")).toContainText(
    "0.1996 USDC",
  );
  await desk
    .getByRole("button", { name: "Accept and fund on LOCALNET" })
    .click();
  await expect(
    desk.getByText(/Funding confirmed from an exact local deal observation/),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Request maker fill" }).click();
  await expect(desk.getByText(/Exact maker fill observed/)).toBeVisible({
    timeout: 5 * 60_000,
  });
  await desk.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(
    desk.getByText(
      "Local demo escrow observation confirms the selected-maker claim.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await expect(
    desk.getByText("1 local transaction references recorded"),
  ).toBeVisible();

  // The same real browser tab verifies authoritative → stale → disagreement →
  // authoritative presentation before returning to a fresh request surface.
  let authorityMode: "pass" | "stale" | "disagreement" | "authoritative" =
    "pass";
  await page.route("**/rfq/authority/verify", async (route) => {
    const upstream = await route.fetch();
    const payload = (await upstream.json()) as {
      result?: Record<string, unknown>;
    };
    if (authorityMode !== "pass" && payload.result) {
      payload.result = { ...payload.result, status: authorityMode };
    }
    const headers = upstream.headers();
    delete headers["content-length"];
    await route.fulfill({
      status: upstream.status(),
      headers,
      body: JSON.stringify(payload),
    });
  });
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/rfq#activity$/);
  await expect(
    page.getByText("Finalized on the configured chain"),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("heading", {
      name: "Terminal lifecycle finalized locally",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/No exportable receipt is available/),
  ).toBeVisible();
  await expect(
    page.getByText(/Sepolia\/Mainnet production authority remains unavailable/),
  ).toBeVisible();
  await expect(page.getByText("No authoritative receipt")).toHaveCount(0);
  await expect(
    page.getByText(/value actions are blocked until this is reconciled/),
  ).toHaveCount(0);

  authorityMode = "stale";
  await expect(page.getByText("Verification pending").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Needs reconciliation" }),
  ).toBeVisible();

  authorityMode = "disagreement";
  await expect(
    page.getByText("Reader disagreement · unverified").first(),
  ).toBeVisible({ timeout: 15_000 });

  authorityMode = "authoritative";
  await expect(
    page.getByText("Finalized on the configured chain"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Needs reconciliation" }),
  ).toHaveCount(0);
  authorityMode = "pass";
  await page.getByRole("link", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Block RFQ", exact: true }).click();
  await expect(market).toBeEnabled();

  const usdcAfterFirstFill = await privateBalance(
    request,
    config.usdcTokenAddress,
    config.runtimeEpoch,
  );
  expect(usdcAfterFirstFill).toBe(199_600n);

  await market.selectOption("USDC_STRK");
  await expect(sellAmount).toHaveValue("0.1");
  await expect(minimumReceive).toHaveValue("0.0495");
  await quote(desk, "STRK");
  await expect(desk.getByLabel("Selected private maker quote")).toContainText(
    "0.0499 STRK",
  );
  await desk
    .getByRole("button", { name: "Accept and fund on LOCALNET" })
    .click();
  await expect(
    desk.getByText(/Funding confirmed from an exact local deal observation/),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Request maker fill" }).click();
  await expect(desk.getByText(/Exact maker fill observed/)).toBeVisible({
    timeout: 5 * 60_000,
  });
  await desk.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(
    desk.getByText(
      "Local demo escrow observation confirms the selected-maker claim.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 5 * 60_000 });

  const usdcAfterReverseFill = await privateBalance(
    request,
    config.usdcTokenAddress,
    config.runtimeEpoch,
  );
  expect(usdcAfterReverseFill).toBe(99_600n);

  await desk.getByRole("button", { name: "Start another RFQ" }).click();
  await sellAmount.fill("0.05");
  await minimumReceive.fill("0.02475");
  await quote(desk, "STRK");
  await desk.getByLabel("No fill → expiry refund").check();
  await desk
    .getByRole("button", { name: "Accept and fund on LOCALNET" })
    .click();
  await expect(
    desk.getByText(/Funding confirmed from an exact local deal observation/),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await desk
    .getByRole("button", { name: "Await and observe settlement expiry" })
    .click();
  await expect(
    desk.getByText(/Settlement expiry observed by the local harness/),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await desk.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(
    desk.getByText(
      "Local demo escrow observation confirms the timeout refund.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await expect(
    desk.getByText("1 local transaction references recorded"),
  ).toBeVisible();
  await expect(
    privateBalance(request, config.usdcTokenAddress, config.runtimeEpoch),
  ).resolves.toBe(usdcAfterReverseFill);

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
  await desk
    .getByRole("button", { name: "Prepare exact invitation review" })
    .click();
  await desk
    .getByLabel("Exact invitation review")
    .getByRole("checkbox")
    .check();
  await desk.getByRole("button", { name: "Request signed quotes" }).click();
  await expect(
    desk
      .getByRole("alert")
      .filter({ hasText: /private maker inventory can cover/i }),
  ).toBeVisible({ timeout: 60_000 });
});

test("modeled localnet authority survives TTL, two tabs, disagreement, reorg, and reload without resubmission", async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(3 * 60_000);
  const config = await readLocalnetConfig(request);
  const account = localnetIdentity(config, "alice").address;
  const rfqId = "0x7a11";

  await page.goto("/rfq#activity");
  if ((await localNetworkToggle(page).getAttribute("aria-pressed")) !== "true")
    await selectLocalNetwork(page);
  await connectLocalnetWallet(page);

  const seeded = await page.evaluate(
    async ({ account, chainId, escrowAddress, sellToken, buyToken, rfqId }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const lifecycle = await dynamicImport(
        "/src/app/rfq/rfq-lifecycle.ts",
      );
      const storageModule = await dynamicImport(
        "/src/app/rfq/rfq-storage.ts",
      );
      const fillRecovery = await dynamicImport(
        "/src/app/rfq/localnet-maker-fill-recovery.ts",
      );
      const epochModule = await dynamicImport(
        "/src/dev/localnet-runtime-epoch.ts",
      );
      const now = Math.floor(Date.now() / 1_000);
      const requestDigest = `0x${"51".repeat(32)}`;
      const quoteDigest = `0x${"52".repeat(32)}`;
      const terms = {
        pairId: "STRK_USDC",
        sellSymbol: "STRK",
        sellAddress: sellToken,
        sellDecimals: 18,
        sellAmount: "100000000000000000",
        buySymbol: "USDC",
        buyAddress: buyToken,
        buyDecimals: 6,
        minBuyAmount: "198000",
        buyAmount: "199600",
        rfqExpiresAt: now + 600,
      };
      const selectedQuote = {
        version: "Quote V2",
        solverId: "app20-localnet-solver-b",
        solverKey: "app20-localnet-solver-b/quote/p256/v1",
        nonce: `0x${"53".repeat(32)}`,
        reservationId: `0x${"54".repeat(32)}`,
        reservationFence: "7",
        quoteDigest,
        spreadBps: 20,
        pricingProvenance: "fixture:browser-authority-sequence",
        quotedAt: now,
        quoteExpiresAt: now + 600,
        reservationExpiresAt: now + 900,
        buyAmount: "199600",
        intentDigest: requestDigest,
        signature: "0x1",
      };
      let record = lifecycle.createRfqLifecycleRecord({
        chainId,
        account,
        rfqId,
        state: "reviewing",
        now,
        requestDigest,
        terms,
        selectedQuote,
        settlement: {
          version: "Localnet V2",
          escrowAddress,
          dealId: rfqId,
          ticketAddress: "0x123",
          deadline: now + 1_200,
        },
      });
      record = lifecycle.beginRfqPhaseAttempt(
        record,
        "funding",
        "browser-funding",
        now + 1,
        lifecycle.fundingTicketAttemptTargetFromLifecycle(record),
      );
      record = lifecycle.updateRfqPhaseAttempt(
        record,
        "funding",
        "confirmed",
        now + 2,
        { transactionHash: "0x701" },
      );
      record = lifecycle.reviseRfqLifecycle(record, {
        state: "funded",
        updatedAt: now + 3,
      });
      const localTerms = {
        account,
        chainId,
        rfqId,
        dealId: rfqId,
        intentDigest: requestDigest,
        solverId: selectedQuote.solverId,
        reservationId: selectedQuote.reservationId,
        reservationFence: selectedQuote.reservationFence,
        quoteDigest,
        sellToken,
        sellAmount: BigInt(terms.sellAmount),
        buyToken,
        buyAmount: BigInt(selectedQuote.buyAmount),
        deadline: now + 1_200,
        ticketAddress: "0x123",
      };
      record = lifecycle.beginRfqPhaseAttempt(
        record,
        "fill",
        "browser-fill",
        now + 4,
        fillRecovery.makerFillAttemptTarget(localTerms),
      );
      record = lifecycle.updateRfqPhaseAttempt(
        record,
        "fill",
        "confirmed",
        now + 5,
        { transactionHash: "0x702" },
      );
      record = lifecycle.reviseRfqLifecycle(record, {
        state: "claimable",
        updatedAt: now + 6,
      });
      record = lifecycle.beginRfqPhaseAttempt(
        record,
        "claim",
        "browser-claim",
        now + 7,
      );
      record = lifecycle.updateRfqPhaseAttempt(
        record,
        "claim",
        "confirmed",
        now + 8,
        { transactionHash: "0x703" },
      );
      record = lifecycle.reviseRfqLifecycle(record, {
        state: "settled",
        updatedAt: now + 9,
        latestObservation: {
          source: "localnet-deal",
          dealId: rfqId,
          escrowAddress,
          status: 3,
          stage: "settled",
          observedAt: now + 9,
        },
      });
      await storageModule.createIndexedDbRfqStorage().save(record);
      return {
        runtimeEpoch: epochModule.localnetRuntimeEpoch(),
      };
    },
    {
      account,
      chainId: config.chainId,
      escrowAddress: config.escrowAddress,
      sellToken: config.tokenAddress,
      buyToken: config.usdcTokenAddress,
      rfqId,
    },
  );
  expect(seeded.runtimeEpoch).toMatch(/^[0-9a-f]{32}$/);

  let authorityMode:
    | "authoritative"
    | "outage"
    | "disagreement"
    | "reorged" = "authoritative";
  let authorityRevision = 100;
  let valueMutationRequests = 0;
  const valueMutationPaths = [
    "/invoke",
    "/privacy",
    "/escrow/ensure-ticket",
    "/private-intents/quotes",
    "/private-intents/select-quote",
    "/private-intents/release-intent",
    "/private-intents/funding-prepare",
    "/private-intents/funding-unknown",
    "/private-intents/funding-abandon",
    "/private-intents/converge",
    "/private-intents/sign-quote",
    "/private-intents/solve",
    "/private-intents/expire",
  ];
  context.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      valueMutationPaths.some((path) => browserRequest.url().includes(path))
    )
      valueMutationRequests += 1;
  });
  await context.route("**/rfq/authority/verify", async (route) => {
    if (authorityMode === "outage") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "modeled reader outage" }),
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, string>;
    const observedAt = Math.floor(Date.now() / 1_000);
    authorityRevision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          source: "localnet-chain-authority",
          runtimeEpoch: body.runtimeEpoch,
          chainId: body.chainId,
          account: body.account,
          rfqId: body.rfqId,
          dealId: body.dealId,
          status: authorityMode,
          revision: authorityRevision,
          observedAt,
          validUntil:
            observedAt + (authorityMode === "authoritative" ? 2 : 30),
        },
      }),
    });
  });

  await page.reload();
  await connectLocalnetWallet(page);
  await expect(page).toHaveURL(/\/rfq#activity$/);
  await expect(
    page.getByText("Finalized on the configured chain").first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", {
      name: "Terminal lifecycle finalized locally",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/No exportable receipt is available/),
  ).toBeVisible();
  await expect(
    page.getByText(/Sepolia\/Mainnet production authority remains unavailable/),
  ).toBeVisible();
  await expect(page.getByText("No authoritative receipt")).toHaveCount(0);

  // Stop verifier responses and allow the two-second live capability to expire
  // against the real browser clock. The one-second presentation clock must
  // visibly demote it before the next five-second verifier attempt.
  authorityMode = "outage";
  await expect(page.getByText("Verification pending").first()).toBeVisible({
    timeout: 8_000,
  });
  const staleSnapshot = await page.evaluate(
    async ({ account, chainId, rfqId }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const storageModule = await dynamicImport(
        "/src/app/rfq/rfq-storage.ts",
      );
      const rows = await storageModule
        .createIndexedDbRfqStorage()
        .list(chainId, account);
      return rows.find((row: { rfqId?: string }) => row.rfqId === rfqId);
    },
    { account, chainId: config.chainId, rfqId },
  );
  expect(staleSnapshot).toBeTruthy();

  authorityMode = "disagreement";
  await page.reload();
  await connectLocalnetWallet(page);
  await expect(
    page.getByText("Reader disagreement · unverified").first(),
  ).toBeVisible({ timeout: 15_000 });

  const secondPage = await context.newPage();
  await secondPage.goto("/rfq#activity");
  if (
    (await localNetworkToggle(secondPage).getAttribute("aria-pressed")) !==
    "true"
  )
    await selectLocalNetwork(secondPage);
  await connectLocalnetWallet(secondPage);
  for (const candidate of [page, secondPage]) {
    await expect(
      candidate.getByText("Reader disagreement · unverified").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      candidate.getByRole("heading", { name: "Needs reconciliation" }),
    ).toBeVisible();
    await expect(
      candidate.getByText(/cannot drive a value action until/),
    ).toBeVisible();
    await expect(
      candidate.getByRole("button", { name: /Forget browser history/ }),
    ).toHaveCount(0);
  }

  authorityMode = "reorged";
  await secondPage.reload();
  await connectLocalnetWallet(secondPage);
  await expect(
    secondPage
      .getByText("Reorg-invalidated · canonical membership lost")
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    secondPage.getByText(/nothing was resubmitted/i).first(),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("button", { name: /Forget browser history/ }),
  ).toHaveCount(0);
  const forgetResult = await secondPage.evaluate(
    async ({ account, chainId, rfqId }) => {
      const dynamicImport = new Function("path", "return import(path)") as (
        path: string,
      ) => Promise<any>;
      const storageModule = await dynamicImport(
        "/src/app/rfq/rfq-storage.ts",
      );
      const storage = storageModule.createIndexedDbRfqStorage();
      const rows = await storage.list(chainId, account);
      const record = rows.find(
        (row: { rfqId?: string }) => row.rfqId === rfqId,
      );
      if (!record) return "missing reorg record";
      try {
        await storage.remove(record);
        return "accepted";
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { account, chainId: config.chainId, rfqId },
  );
  expect(forgetResult).toMatch(/refused removal of unresolved/i);
  await expect(
    page.getByText("Reader disagreement · unverified").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs reconciliation" }),
  ).toBeVisible();

  // The first page is deliberately left on its older disagreement snapshot.
  // Its pre-reorg row must lose the IndexedDB CAS against the second page's
  // durable reorg row rather than resurrecting the terminal outcome.
  const staleSaveResult = await page.evaluate(async (record) => {
    const dynamicImport = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const storageModule = await dynamicImport(
      "/src/app/rfq/rfq-storage.ts",
    );
    try {
      await storageModule.createIndexedDbRfqStorage().save(record);
      return "accepted";
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  }, staleSnapshot);
  expect(staleSaveResult).toMatch(/stale lifecycle snapshot|exact predecessor/i);

  await secondPage.getByRole("link", { name: "Active", exact: true }).click();
  await expect(
    secondPage.getByText(
      /Restoring and reconciling never automatically resubmits fund, fill, claim, or refund/,
    ),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("button", {
      name: /Accept and fund|Request maker fill|Claim|Refund/,
    }),
  ).toHaveCount(0);

  authorityMode = "outage";
  await page.reload();
  await connectLocalnetWallet(page);
  await expect(
    page.getByText("Reorg-invalidated · canonical membership lost").first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Needs reconciliation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Forget browser history/ }),
  ).toHaveCount(0);
  expect(valueMutationRequests).toBe(0);
  await secondPage.close();
});
