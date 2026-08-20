"use client";

import {
  acceptQuote,
  assertInventoryCovers,
  fillLockedIntent,
  quotePrivateSwapIntent,
  refundExpiredIntent,
  type PrivateSwapIntentV1,
  type SolverQuote,
} from "@app20/private-intents";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { storeDeskHandoff, consumeDeskHandoff } from "@/lib/desk-handoff";
import { buildEscrowFundActions } from "@/lib/escrow-actions";
import {
  assertReadyExecutionUnchanged,
  snapshotReadyExecution,
} from "@/lib/ready-execution";

import { submitActions } from "@/lib/strk20";
import {
  addrSTRK,
  escrowHelperLocalnet,
  LOCALNET_PROVIDER_INDEX,
  localnetUsdcToken,
  myFrontendProviders,
} from "@/utils/constants";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { validateAndParseAddress } from "starknet";
import {
  askLocalnetSolverToFill,
  buildLocalnetIntentPayoutActions,
  createLocalnetIntentId,
  ensureLocalnetEscrowTicket,
  expireLocalnetPrivateIntent,
  formatLocalnetTokenAmount,
  parseLocalnetTokenAmount,
  readLocalnetEscrowDeal,
  requestLocalnetSolverQuote,
  type LocalnetMarketToken,
  type LocalnetSolverQuote,
} from "./localnet-private-intents";
import styles from "./vault.module.css";

type MarketPair = {
  id: "STRK_USDC" | "USDC_STRK";
  label: string;
  sell: LocalnetMarketToken;
  buy: LocalnetMarketToken;
  defaultSellAmount: string;
  defaultMinBuyAmount: string;
};

type QuotedIntent = {
  intent: PrivateSwapIntentV1;
  quote: SolverQuote;
  inventory: bigint;
  pair: MarketPair;
};

type FlowPhase = "quote" | "lock" | "fill" | "claim" | "expire" | "refund";

type FlowState =
  | { kind: "idle" }
  | { kind: "working"; phase: FlowPhase; message: string }
  | {
      kind: "success";
      outcome: "settled" | "refunded";
      message: string;
      transactionHashes: string[];
    }
  | { kind: "error"; message: string };

function currentLifecycleStep(
  quoted: QuotedIntent | null,
  flow: FlowState,
  solverOutcome: "fill" | "refund",
): number {
  if (!quoted) return 0;
  if (flow.kind === "success") return 4;
  if (flow.kind !== "working") return 1;
  const phases: readonly FlowPhase[] =
    solverOutcome === "fill"
      ? ["quote", "lock", "fill", "claim"]
      : ["quote", "lock", "expire", "refund"];
  const index = phases.indexOf(flow.phase);
  return index < 0 ? 1 : index;
}

function matchesToken(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function marketPairs(): Record<MarketPair["id"], MarketPair> {
  const strk: LocalnetMarketToken = {
    symbol: "STRK",
    address: addrSTRK,
    decimals: 18,
  };
  const usdc: LocalnetMarketToken = {
    symbol: "USDC",
    address: localnetUsdcToken,
    decimals: 6,
  };
  return {
    STRK_USDC: {
      id: "STRK_USDC",
      label: "STRK → USDC",
      sell: strk,
      buy: usdc,
      defaultSellAmount: "0.1",
      defaultMinBuyAmount: "0.19",
    },
    USDC_STRK: {
      id: "USDC_STRK",
      label: "USDC → STRK",
      sell: usdc,
      buy: strk,
      defaultSellAmount: "0.1",
      defaultMinBuyAmount: "0.049",
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The local private intent failed.";
}

export default function LocalnetPrivateIntentDesk() {
  const pairs = marketPairs();
  const [pairId, setPairId] = useState<MarketPair["id"]>("STRK_USDC");
  const pair = pairs[pairId];
  const connected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const [sellAmount, setSellAmount] = useState(pair.defaultSellAmount);
  const [minBuyAmount, setMinBuyAmount] = useState(pair.defaultMinBuyAmount);
  const [solverOutcome, setSolverOutcome] = useState<"fill" | "refund">("fill");
  const [quoted, setQuoted] = useState<QuotedIntent | null>(null);
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  const [counterparty, setCounterparty] = useState<string | null>(null);
  const working = flow.kind === "working";
  const localnetReady =
    connected && Boolean(address) && providerIndex === LOCALNET_PROVIDER_INDEX;

  useEffect(() => {
    const url = new URL(window.location.href);
    const queryCounterparty = url.searchParams.get("counterparty");
    if (queryCounterparty || url.searchParams.has("action")) {
      url.searchParams.delete("counterparty");
      url.searchParams.delete("action");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    const input =
      consumeDeskHandoff(window.sessionStorage, "rfq") ?? queryCounterparty;
    if (!input) {
      setCounterparty(null);
      return;
    }
    try {
      setCounterparty(validateAndParseAddress(input));
    } catch {
      setCounterparty(null);
    }
  }, []);

  function invalidateQuote() {
    setQuoted(null);
    setFlow({ kind: "idle" });
  }

  async function buildQuote() {
    setFlow({
      kind: "working",
      phase: "quote",
      message: "Reading local solver inventory…",
    });
    try {
      if (BigInt(escrowHelperLocalnet) === 0n) {
        throw new Error("The local escrow deployment is unavailable.");
      }
      if (BigInt(localnetUsdcToken) === 0n) {
        throw new Error("The local solver token is unavailable.");
      }
      const sell = parseLocalnetTokenAmount(sellAmount, pair.sell);
      const floor = parseLocalnetTokenAmount(minBuyAmount, pair.buy);
      const now = Math.floor(Date.now() / 1_000);
      const intent: PrivateSwapIntentV1 = {
        version: 1,
        intentId: createLocalnetIntentId(),
        pool: "starknet:APP20_LOCALNET",
        sellToken: pair.sell.address,
        sellAmount: sell,
        buyToken: pair.buy.address,
        minBuyAmount: floor,
        createdAt: now,
        expiresAt: now + 20 * 60,
      };
      let sourceQuote: LocalnetSolverQuote | undefined;
      const outcome = await quotePrivateSwapIntent(
        intent,
        {
          price: async (request) => {
            sourceQuote = await requestLocalnetSolverQuote({
              sellToken: request.sellToken,
              sellAmount: request.sellAmount,
              buyToken: request.buyToken,
            });
            if (
              sourceQuote.buyAmount <= 0n ||
              !matchesToken(sourceQuote.sellToken, request.sellToken) ||
              !matchesToken(sourceQuote.buyToken, request.buyToken)
            ) {
              throw new Error(
                "The local solver quote changed the requested pair.",
              );
            }
            return {
              buyAmount: sourceQuote.buyAmount,
              provenance: sourceQuote.provenance,
            };
          },
        },
        {
          solverId: "app20-localnet-solver",
          spreadBps: 30,
          quoteTtlSeconds: 10 * 60,
          now,
        },
      );
      if (outcome.kind === "declined") {
        throw new Error(outcome.reason);
      }
      if (!sourceQuote) {
        throw new Error("The local solver returned no inventory statement.");
      }
      assertInventoryCovers(
        [
          {
            token: intent.buyToken,
            available: sourceQuote.solverInventory,
          },
        ],
        intent.buyToken,
        outcome.quote.buyAmount,
      );
      setQuoted({
        intent,
        quote: outcome.quote,
        inventory: sourceQuote.solverInventory,
        pair,
      });
      setFlow({ kind: "idle" });
    } catch (error: unknown) {
      setQuoted(null);
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function executeIntent() {
    if (!quoted) return;
    const transactionHashes: string[] = [];
    try {
      const started = snapshotReadyExecution();
      if (started.providerIndex !== LOCALNET_PROVIDER_INDEX) {
        throw new Error("Select LOCAL and connect Localnet (dev) first.");
      }
      assertInventoryCovers(
        [{ token: quoted.intent.buyToken, available: quoted.inventory }],
        quoted.intent.buyToken,
        quoted.quote.buyAmount,
      );
      const locked = acceptQuote(
        quoted.intent,
        quoted.quote,
        Math.floor(Date.now() / 1_000),
      );
      const provider = myFrontendProviders[LOCALNET_PROVIDER_INDEX];
      const policy = () => {
        assertReadyExecutionUnchanged(started, "private-swap");
      };

      setFlow({
        kind: "working",
        phase: "lock",
        message: `Locking the private ${quoted.pair.sell.symbol} note to the intent digest…`,
      });
      const ticketAddress = await ensureLocalnetEscrowTicket({
        dealId: quoted.intent.intentId,
      });
      const funded = await submitActions(
        started.account,
        provider,
        buildEscrowFundActions({
          escrowAddress: escrowHelperLocalnet,
          recoveryAddress: started.address,
          ticketAddress,
          dealId: quoted.intent.intentId,
          token: quoted.intent.sellToken,
          amount: quoted.intent.sellAmount,
          counterToken: quoted.intent.buyToken,
          counterAmount: quoted.quote.buyAmount,
          deadline: quoted.intent.expiresAt,
        }),
        { policy },
      );
      transactionHashes.push(funded.transactionHash);
      await readLocalnetEscrowDeal(quoted.intent.intentId);

      const terms = {
        dealId: quoted.intent.intentId,
        sellToken: quoted.intent.sellToken,
        sellAmount: quoted.intent.sellAmount,
        buyToken: quoted.intent.buyToken,
        buyAmount: quoted.quote.buyAmount,
      };

      if (solverOutcome === "fill") {
        setFlow({
          kind: "working",
          phase: "fill",
          message: `APP20 solver is filling from pre-positioned ${quoted.pair.buy.symbol} notes…`,
        });
        transactionHashes.push(await askLocalnetSolverToFill(terms));
        await readLocalnetEscrowDeal(quoted.intent.intentId);
        fillLockedIntent(
          quoted.intent,
          locked,
          quoted.quote.buyAmount,
          Math.floor(Date.now() / 1_000),
        );
        setFlow({
          kind: "working",
          phase: "claim",
          message: `Claiming the solver's ${quoted.pair.buy.symbol} leg into an OPEN private note…`,
        });
        const claimed = await submitActions(
          started.account,
          provider,
          buildLocalnetIntentPayoutActions({
            operation: "claim",
            escrowAddress: escrowHelperLocalnet,
            recoveryAddress: started.address,
            ticketAddress,
            dealId: quoted.intent.intentId,
            payoutToken: quoted.intent.buyToken,
          }),
          { policy },
        );
        transactionHashes.push(claimed.transactionHash);
        await readLocalnetEscrowDeal(quoted.intent.intentId);
        setFlow({
          kind: "success",
          outcome: "settled",
          message: "Private intent settled through the local solver.",
          transactionHashes,
        });
      } else {
        setFlow({
          kind: "working",
          phase: "expire",
          message: "Advancing localnet past expiry without a solver fill…",
        });
        await expireLocalnetPrivateIntent(terms);
        await readLocalnetEscrowDeal(quoted.intent.intentId);
        refundExpiredIntent(quoted.intent, locked, quoted.intent.expiresAt);
        setFlow({
          kind: "working",
          phase: "refund",
          message: `Refunding the locked ${quoted.pair.sell.symbol} into a new private note…`,
        });
        const refunded = await submitActions(
          started.account,
          provider,
          buildLocalnetIntentPayoutActions({
            operation: "timeout",
            escrowAddress: escrowHelperLocalnet,
            recoveryAddress: started.address,
            ticketAddress,
            dealId: quoted.intent.intentId,
            payoutToken: quoted.intent.sellToken,
          }),
          { policy },
        );
        transactionHashes.push(refunded.transactionHash);
        await readLocalnetEscrowDeal(quoted.intent.intentId);
        setFlow({
          kind: "success",
          outcome: "refunded",
          message: "Private intent refunded after local expiry.",
          transactionHashes,
        });
      }
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  return (
    <section
      className={styles.privateIntentDesk}
      aria-labelledby="local-private-intent-title"
    >
      <header className={styles.privateIntentHeader}>
        <div>
          <span>APP20 PRIVATE DESK / LOCALNET MARKET</span>
          <h3 id="local-private-intent-title">Private USDC ↔ STRK RFQ</h3>
        </div>
        <strong>INVENTORY-FIRST</strong>
      </header>

      {counterparty ? (
        <aside className={styles.privateIntentCounterparty}>
          <div>
            <span>SELECTED COUNTERPARTY</span>
            <code title={counterparty}>
              {counterparty.slice(0, 12)}…{counterparty.slice(-8)}
            </code>
          </div>
          <Link
            to="/mail/inbox"
            onClick={() =>
              storeDeskHandoff(window.sessionStorage, "mail", counterparty)
            }
          >
            Open encrypted correspondence
          </Link>
        </aside>
      ) : null}

      <div className={styles.privateIntentForm}>
        <label>
          <span>PRIVATE MARKET</span>
          <select
            aria-label="Private intent market"
            value={pairId}
            onChange={(event) => {
              const nextId = event.target.value as MarketPair["id"];
              const nextPair = pairs[nextId];
              setPairId(nextId);
              setSellAmount(nextPair.defaultSellAmount);
              setMinBuyAmount(nextPair.defaultMinBuyAmount);
              invalidateQuote();
            }}
            disabled={working}
          >
            {Object.values(pairs).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>SELL / {pair.sell.symbol}</span>
          <input
            aria-label="Private intent sell amount"
            value={sellAmount}
            onChange={(event) => {
              setSellAmount(event.target.value);
              invalidateQuote();
            }}
            inputMode="decimal"
            disabled={working}
          />
        </label>
        <label>
          <span>MINIMUM RECEIVE / {pair.buy.symbol}</span>
          <input
            aria-label="Private intent minimum receive"
            value={minBuyAmount}
            onChange={(event) => {
              setMinBuyAmount(event.target.value);
              invalidateQuote();
            }}
            inputMode="decimal"
            disabled={working}
          />
        </label>
        <button
          type="button"
          onClick={() => void buildQuote()}
          disabled={working}
        >
          {working && !quoted ? "Quoting…" : "Get private quote"}
        </button>
      </div>

      {quoted ? (
        <div className={styles.privateIntentQuote} aria-label="Solver quote">
          <div>
            <span>APP20 DELIVERS</span>
            <strong>
              {formatLocalnetTokenAmount(
                quoted.quote.buyAmount,
                quoted.pair.buy,
                6,
              )}{" "}
              {quoted.pair.buy.symbol}
            </strong>
          </div>
          <div>
            <span>SOLVER INVENTORY</span>
            <strong>
              {formatLocalnetTokenAmount(quoted.inventory, quoted.pair.buy, 4)}{" "}
              {quoted.pair.buy.symbol}
            </strong>
          </div>
          <div>
            <span>SPREAD</span>
            <strong>{quoted.quote.spreadBps} BPS</strong>
          </div>
          <div>
            <span>TIME BOUNDS</span>
            <strong>QUOTE 10 MIN · REFUND 20 MIN</strong>
          </div>
        </div>
      ) : null}

      <ol
        className={styles.privateIntentStepper}
        aria-label="Settlement lifecycle"
      >
        {(solverOutcome === "fill"
          ? ["Quote", "Lock", "Solver fill", "Claim"]
          : ["Quote", "Lock", "Expiry", "Refund"]
        ).map((label, index) => {
          const current = currentLifecycleStep(quoted, flow, solverOutcome);
          return (
            <li
              key={label}
              data-state={
                current > index
                  ? "complete"
                  : current === index
                    ? "current"
                    : "pending"
              }
            >
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </li>
          );
        })}
      </ol>

      <details className={styles.privateIntentDemoControls} open>
        <summary>Demo controls</summary>
        <fieldset className={styles.privateIntentOutcome} disabled={working}>
          <legend>LOCALNET TEST OUTCOME</legend>
          <label>
            <input
              type="radio"
              name="local-private-intent-outcome"
              value="fill"
              checked={solverOutcome === "fill"}
              onChange={() => setSolverOutcome("fill")}
            />
            Solver fills
          </label>
          <label>
            <input
              type="radio"
              name="local-private-intent-outcome"
              value="refund"
              checked={solverOutcome === "refund"}
              onChange={() => setSolverOutcome("refund")}
            />
            No fill → expiry refund
          </label>
        </fieldset>
      </details>

      <button
        className={styles.privateIntentExecute}
        type="button"
        disabled={!quoted || !localnetReady || working}
        onClick={() => void executeIntent()}
      >
        {working ? "Executing…" : "Execute local private intent"}
      </button>

      {localnetReady ? null : (
        <p className={styles.privateIntentHint}>
          Select LOCAL in the header and connect Localnet (dev) to execute.
        </p>
      )}
      {flow.kind === "working" || flow.kind === "error" ? (
        <p
          className={`${styles.privateIntentStatus} ${flow.kind === "error" ? styles.privateIntentError : ""}`}
          role={flow.kind === "error" ? "alert" : "status"}
        >
          {flow.message}
        </p>
      ) : null}
      {flow.kind === "success" && quoted ? (
        <div className={styles.privateIntentSuccess} role="status">
          <div>
            <strong>{flow.message}</strong>
            <span>
              {flow.transactionHashes.length} private transactions confirmed
            </span>
          </div>
          <dl className={styles.privateIntentReceipt}>
            <div>
              <dt>SOLD</dt>
              <dd>
                {formatLocalnetTokenAmount(
                  quoted.intent.sellAmount,
                  quoted.pair.sell,
                  6,
                )}{" "}
                {quoted.pair.sell.symbol}
              </dd>
            </div>
            <div>
              <dt>{flow.outcome === "settled" ? "RECEIVED" : "REFUNDED"}</dt>
              <dd>
                {flow.outcome === "settled"
                  ? `${formatLocalnetTokenAmount(
                      quoted.quote.buyAmount,
                      quoted.pair.buy,
                      6,
                    )} ${quoted.pair.buy.symbol}`
                  : `${formatLocalnetTokenAmount(
                      quoted.intent.sellAmount,
                      quoted.pair.sell,
                      6,
                    )} ${quoted.pair.sell.symbol}`}
              </dd>
            </div>
            <div>
              <dt>INTENT DIGEST</dt>
              <dd>
                <code title={quoted.quote.intentDigest}>
                  {quoted.quote.intentDigest.slice(0, 18)}…
                </code>
              </dd>
            </div>
            <div>
              <dt>EVIDENCE</dt>
              <dd>{flow.transactionHashes.length} pool transactions</dd>
            </div>
          </dl>
          <details className={styles.privateIntentTransactions}>
            <summary>Transaction references</summary>
            {flow.transactionHashes.map((transactionHash, index) => (
              <code key={`${index}:${transactionHash}`}>
                {index + 1}. {transactionHash}
              </code>
            ))}
          </details>
          <nav
            className={styles.privateIntentLinks}
            aria-label="Desk follow-up actions"
          >
            <Link
              to="/mail/inbox"
              search={{ intent: quoted.quote.intentDigest }}
            >
              Open encrypted correspondence
            </Link>
            <Link to="/contacts">Open counterparties</Link>
          </nav>
        </div>
      ) : null}

      <p className={styles.privateIntentDisclosure}>
        Localnet proves both USDC↔STRK directions through lock → solver fill →
        claim and expiry → refund against the real pool contract using mock
        proof bytes. The fixture prices 1 STRK = 2 USDC before a 30 BPS spread.
        APP20's solver sees the RFQ. Escrow events and OPEN payout-note amounts
        remain public in this prototype.
      </p>
    </section>
  );
}
