"use client";

import {
  LOCALNET_SOLVER_ID,
  LOCALNET_SOLVER_KEY_ID,
  acceptQuote,
  assertInventoryCovers,
  createMemoryQuoteReplayStore,
  fillLockedIntent,
  quotePrivateSwapIntent,
  refundExpiredIntent,
  type PrivateSwapIntentV1,
  type SolverQuote,
} from "@app20/private-intents";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { consumeDeskHandoff, storeDeskHandoff } from "@/lib/desk-handoff";
import { verifyLocalnetSolverQuote } from "@/lib/localnet-quote-authority";
import {
  deskLeakChips,
  deskVenueCopy,
  suggestsBlockSurface,
  type DeskSurface,
  type DeskVenue,
} from "@/lib/desk-disclosure";
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
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
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
  signLocalnetSolverQuote,
  type LocalnetMarketToken,
  type LocalnetSolverQuote,
} from "./localnet-private-intents";
import styles from "./vault.module.css";

const quoteReplayStore = createMemoryQuoteReplayStore();

export type LocalnetMarketPairId = "STRK_USDC" | "USDC_STRK";

export type LocalnetPrivateIntentDeskProps = Readonly<{
  initialPairId?: LocalnetMarketPairId;
  swapOnly?: boolean;
  onPairChange?: (pairId: LocalnetMarketPairId) => void;
}>;

type MarketPair = {
  id: LocalnetMarketPairId;
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
  surface: DeskSurface;
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
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string };

function surfaceFromHash(hash: string): DeskSurface {
  const value = hash.replace(/^#/, "");
  return value === "desk" || value === "block" ? "block" : "swap";
}

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

function isInventoryRefusal(message: string): boolean {
  return /inventory cannot cover|does not cover|no output|below the intent floor/i.test(
    message,
  );
}

function LeakChips({ venue }: { venue: DeskVenue }) {
  return (
    <div className={styles.deskChips} aria-label="Who learns what">
      {deskLeakChips(venue).map((chip) => (
        <span key={chip.id}>{chip.label}</span>
      ))}
    </div>
  );
}

export default function LocalnetPrivateIntentDesk({
  initialPairId = "STRK_USDC",
  swapOnly = false,
  onPairChange,
}: LocalnetPrivateIntentDeskProps = {}) {
  const pairs = marketPairs();
  const [pairId, setPairId] = useState<MarketPair["id"]>(initialPairId);
  const pair = pairs[pairId];
  const connected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const chain = useStoreWallet((state) => state.chain);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const requestedSurface = surfaceFromHash(hash);
  const [sellAmount, setSellAmount] = useState(pair.defaultSellAmount);
  const [minBuyAmount, setMinBuyAmount] = useState(pair.defaultMinBuyAmount);
  const [solverOutcome, setSolverOutcome] = useState<"fill" | "refund">("fill");
  const [quoted, setQuoted] = useState<QuotedIntent | null>(null);
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  const [counterparty, setCounterparty] = useState<string | null>(null);
  const working = flow.kind === "working";
  const localnetReady =
    connected && Boolean(address) && providerIndex === LOCALNET_PROVIDER_INDEX;
  const surface = swapOnly
    ? "swap"
    : quoted
      ? quoted.surface
      : requestedSurface;
  const venue: DeskVenue =
    flow.kind === "refused" ? "refused" : quoted ? "inventory" : "idle";
  const blockHint = suggestsBlockSurface({
    sellSymbol: pair.sell.symbol,
    sellAmount,
  });

  useEffect(() => {
    const nextPair = marketPairs()[initialPairId];
    setPairId(initialPairId);
    setSellAmount(nextPair.defaultSellAmount);
    setMinBuyAmount(nextPair.defaultMinBuyAmount);
    setQuoted(null);
    setFlow({ kind: "idle" });
  }, [initialPairId]);

  useEffect(() => {
    if (!address || !chain) return;
    const url = new URL(window.location.href);
    if (
      url.searchParams.has("counterparty") ||
      url.searchParams.has("action") ||
      url.searchParams.has("intent")
    ) {
      url.searchParams.delete("counterparty");
      url.searchParams.delete("action");
      url.searchParams.delete("intent");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    const input = consumeDeskHandoff(window.sessionStorage, "rfq", {
      account: address,
      chainId: chain,
    });
    if (!input) {
      setCounterparty(null);
      return;
    }
    try {
      setCounterparty(validateAndParseAddress(input));
    } catch {
      setCounterparty(null);
    }
  }, [address, chain]);

  function setSurface(next: DeskSurface) {
    if (quoted || swapOnly) return;
    void navigate({
      to: "/vault",
      hash: next === "block" ? "desk" : "swap",
    });
  }

  function invalidateQuote() {
    setQuoted(null);
    setFlow({ kind: "idle" });
  }

  function selectPair(nextId: LocalnetMarketPairId) {
    const nextPair = pairs[nextId];
    setPairId(nextId);
    setSellAmount(nextPair.defaultSellAmount);
    setMinBuyAmount(nextPair.defaultMinBuyAmount);
    invalidateQuote();
    onPairChange?.(nextId);
  }

  async function buildQuote() {
    setFlow({
      kind: "working",
      phase: "quote",
      message: "Reading desk inventory…",
    });
    try {
      if (!localnetReady) {
        throw new Error(
          "No private inventory on this network. Nothing was sent to a public book.",
        );
      }
      if (BigInt(escrowHelperLocalnet) === 0n) {
        throw new Error("The local escrow deployment is unavailable.");
      }
      if (BigInt(localnetUsdcToken) === 0n) {
        throw new Error("The local solver token is unavailable.");
      }
      const sell = parseLocalnetTokenAmount(sellAmount, pair.sell);
      const floor =
        surface === "swap"
          ? 1n
          : parseLocalnetTokenAmount(minBuyAmount, pair.buy);
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
            return {
              buyAmount: sourceQuote.buyAmount,
              provenance: sourceQuote.provenance,
            };
          },
        },
        {
          solverId: LOCALNET_SOLVER_ID,
          solverKey: LOCALNET_SOLVER_KEY_ID,
          helper: escrowHelperLocalnet,
          spreadBps: 30,
          quoteTtlSeconds: 10 * 60,
          now,
          sign: signLocalnetSolverQuote,
        },
      );
      if (outcome.kind !== "quoted" || !sourceQuote) {
        throw new Error(
          outcome.kind === "declined"
            ? outcome.reason
            : "The desk declined this clip.",
        );
      }
      if (sourceQuote.solverId !== LOCALNET_SOLVER_ID) {
        throw new Error("The desk quote named an unexpected solver.");
      }
      if (
        !matchesToken(sourceQuote.sellToken, pair.sell.address) ||
        !matchesToken(sourceQuote.buyToken, pair.buy.address)
      ) {
        throw new Error("The desk quote changed the requested pair.");
      }
      assertInventoryCovers(
        [{ token: pair.buy.address, available: sourceQuote.solverInventory }],
        pair.buy.address,
        outcome.quote.buyAmount,
      );
      setQuoted({
        intent,
        quote: outcome.quote,
        inventory: sourceQuote.solverInventory,
        pair,
        surface,
      });
      setFlow({ kind: "idle" });
    } catch (error: unknown) {
      const message = errorMessage(error);
      setQuoted(null);
      setFlow(
        isInventoryRefusal(message)
          ? { kind: "refused", message }
          : { kind: "error", message },
      );
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
      const locked = await acceptQuote(
        quoted.intent,
        quoted.quote,
        Math.floor(Date.now() / 1_000),
        {
          helper: escrowHelperLocalnet,
          verify: verifyLocalnetSolverQuote,
          consumeNonce: (nonce) => quoteReplayStore.consume(nonce),
        },
      );
      const provider = myFrontendProviders[LOCALNET_PROVIDER_INDEX];
      const policy = () => {
        assertReadyExecutionUnchanged(started, "private-swap");
      };

      setFlow({
        kind: "working",
        phase: "lock",
        message: `Locking the private ${quoted.pair.sell.symbol} note to the deal terms…`,
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

      if (solverOutcome === "fill" || quoted.surface === "swap") {
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
      const message = errorMessage(error);
      setFlow(
        isInventoryRefusal(message)
          ? { kind: "refused", message }
          : { kind: "error", message },
      );
    }
  }

  return (
    <section
      className={styles.privateIntentDesk}
      aria-label={swapOnly ? "Private swap" : undefined}
      aria-labelledby={swapOnly ? undefined : "local-private-intent-title"}
    >
      {swapOnly ? null : (
        <header className={styles.privateIntentHeader}>
          <div>
            <span>APP20 DESK</span>
            <h3 id="local-private-intent-title">
              {surface === "swap" ? "Swap" : "Block RFQ"}
            </h3>
          </div>
          <strong>{surface === "swap" ? "DAY-TO-DAY" : "INVENTORY RFQ"}</strong>
        </header>
      )}

      {swapOnly ? null : (
        <div
          className={styles.deskModeSwitch}
          role="tablist"
          aria-label="Desk surface"
        >
          <button
            type="button"
            role="tab"
            aria-selected={surface === "swap"}
            disabled={Boolean(quoted)}
            onClick={() => setSurface("swap")}
          >
            Swap
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === "block"}
            disabled={Boolean(quoted)}
            onClick={() => setSurface("block")}
          >
            Block
          </button>
        </div>
      )}

      {swapOnly ? null : (
        <>
          <LeakChips venue={venue} />
          <p className={styles.deskVenueCopy}>{deskVenueCopy(venue)}</p>
        </>
      )}

      {!swapOnly && blockHint && surface === "swap" && !quoted ? (
        <p className={styles.deskHint} role="status">
          This clip is large enough that a negotiated Block quote with a floor
          and expiry is usually the better shape.
          <button type="button" onClick={() => setSurface("block")}>
            Open Block
          </button>
        </p>
      ) : null}
      {!swapOnly && !blockHint && surface === "block" && !quoted ? (
        <p className={styles.deskHint} role="status">
          This clip is small enough that an immediate Swap from inventory is
          usually faster.
          <button type="button" onClick={() => setSurface("swap")}>
            Open Swap
          </button>
        </p>
      ) : null}

      {surface === "block" && counterparty ? (
        <aside className={styles.privateIntentCounterparty}>
          <div>
            <span>CORRESPONDENCE CONTACT</span>
            <code title={counterparty}>
              {counterparty.slice(0, 12)}…{counterparty.slice(-8)}
            </code>
          </div>
          {address && chain ? (
            <Link
              to="/mail/inbox"
              onClick={() =>
                storeDeskHandoff(window.sessionStorage, "mail", counterparty, {
                  account: address,
                  chainId: chain,
                })
              }
            >
              Open encrypted correspondence
            </Link>
          ) : null}
        </aside>
      ) : null}

      <div className={styles.privateIntentForm}>
        <label className={styles.privateIntentMarket}>
          <span>PRIVATE MARKET</span>
          <select
            aria-label="Private intent market"
            value={pairId}
            onChange={(event) => {
              selectPair(event.target.value as LocalnetMarketPairId);
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

        <div className={styles.swapAssetStack}>
          <label className={styles.swapAssetCard}>
            <span className={styles.swapAssetHead}>
              <b>Sell</b>
              <small>Private note</small>
            </span>
            <span className={styles.swapAssetControl}>
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
              <strong>{pair.sell.symbol}</strong>
            </span>
          </label>

          <button
            className={styles.swapDirection}
            type="button"
            aria-label="Reverse swap direction"
            title="Reverse market"
            onClick={() => {
              selectPair(pairId === "STRK_USDC" ? "USDC_STRK" : "STRK_USDC");
            }}
            disabled={working}
          >
            ⇅
          </button>

          <label className={styles.swapAssetCard}>
            <span className={styles.swapAssetHead}>
              <b>{surface === "block" ? "Minimum receive" : "Buy"}</b>
              <small>
                {quoted ? "Signed inventory quote" : "Quote required"}
              </small>
            </span>
            <span className={styles.swapAssetControl}>
              {surface === "block" ? (
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
              ) : (
                <output aria-label="Private intent quoted buy amount">
                  {quoted
                    ? formatLocalnetTokenAmount(
                        quoted.quote.buyAmount,
                        quoted.pair.buy,
                        6,
                      )
                    : "—"}
                </output>
              )}
              <strong>{pair.buy.symbol}</strong>
            </span>
          </label>
        </div>

        {quoted ? null : (
          <button
            className={styles.privateIntentQuoteButton}
            type="button"
            onClick={() => void buildQuote()}
            disabled={working}
          >
            {working
              ? "Quoting…"
              : surface === "swap"
                ? "Get swap quote"
                : "Get private quote"}
          </button>
        )}
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

      {surface === "block" ? (
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
      ) : null}

      {surface === "block" ? (
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
      ) : null}

      {quoted ? (
        <button
          className={styles.privateIntentExecute}
          type="button"
          disabled={!localnetReady || working}
          onClick={() => void executeIntent()}
        >
          {working
            ? "Executing…"
            : surface === "swap"
              ? "Swap from desk inventory"
              : "Execute local private intent"}
        </button>
      ) : null}

      {flow.kind === "refused" ? (
        <div className={styles.deskRefusal} role="alert">
          <strong>No private fill</strong>
          <p>{flow.message}</p>
          <p>
            Public-route swap is a separate action and is not enabled in this
            build. Nothing was sent to a public book.
          </p>
          <button type="button" disabled>
            Public-route swap unavailable
          </button>
        </div>
      ) : null}

      {localnetReady ? null : (
        <p className={styles.privateIntentHint}>
          Select LOCAL in the header and connect Localnet (dev) to execute from
          desk inventory.
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
              <dt>QUOTE BINDING</dt>
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
            {address && chain && counterparty ? (
              <Link
                to="/mail/inbox"
                onClick={() =>
                  storeDeskHandoff(
                    window.sessionStorage,
                    "mail",
                    counterparty,
                    {
                      account: address,
                      chainId: chain,
                    },
                  )
                }
              >
                Open encrypted correspondence
              </Link>
            ) : (
              <Link to="/mail/inbox">Open mailbox</Link>
            )}
            <Link to="/contacts">Open counterparties</Link>
          </nav>
        </div>
      ) : null}

      <p className={styles.privateIntentDisclosure}>
        {swapOnly
          ? "Private inventory only. A refusal never falls through to a public venue."
          : "Swap is an immediate inventory fill. Block is a signed request/quote/accept with your floor and expiry. Size may suggest a surface; it never picks a public venue. Localnet proves lock → solver fill → claim and expiry → refund against the real pool using mock proof bytes. Escrow events and OPEN payout-note amounts remain public."}
      </p>
    </section>
  );
}
