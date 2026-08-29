"use client";

import {
  acceptQuote,
  digestPrivateSwapIntent,
  quotePrivateSwapIntent,
  selectBestSolverQuote,
  type PrivateSwapIntentV1,
  type SolverQuote,
} from "@app20/private-intents";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { feltEquals } from "@/lib/addresses";
import { localnetRuntimeEpoch } from "@/dev/localnet-runtime-epoch";
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
  canProceedFromPrivacyPreflight,
  evaluatePrivacyPreflight,
} from "@/lib/privacy-preflight";
import {
  APP20_TOKEN_REGISTRY_REVISION,
  configuredMarketPair,
} from "@/lib/token-registry";
import {
  assertReadyExecutionUnchanged,
  snapshotReadyExecution,
} from "@/lib/ready-execution";
import {
  submitActions,
  transactionHashFromError,
  transactionStateFromError,
} from "@/lib/strk20";
import { readLivePoolFee, readPublicStrkBalance } from "@/lib/mainnet-safety";
import {
  addrSTRK,
  escrowHelperLocalnet,
  LOCALNET_PROVIDER_INDEX,
  localnetUsdcToken,
  myFrontendProviders,
  strk20PoolLocalnet,
} from "@/utils/constants";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { validateAndParseAddress } from "starknet";
import {
  abandonLocalnetFunding,
  askLocalnetSolverToFill,
  buildLocalnetIntentPayoutActions,
  createLocalnetIntentId,
  convergeLocalnetPrivateIntent,
  ensureLocalnetEscrowTicket,
  expireLocalnetPrivateIntent,
  formatLocalnetTokenAmount,
  fundingTicketAttemptTarget,
  markLocalnetFundingUnknown,
  localnetCommandWasRejected,
  parseLocalnetTokenAmount,
  prepareLocalnetFunding,
  readLocalnetEscrowDeal,
  readLocalnetRfqOperationsStatus,
  releaseLocalnetRfqReservations,
  requestLocalnetSolverQuotes,
  selectLocalnetSolverQuote,
  signLocalnetSolverQuote,
  type LocalnetMarketToken,
  type LocalnetSolverOffer,
} from "./localnet-private-intents";
import MakerCohortPanel from "./MakerCohortPanel";
import {
  LOCALNET_APP20_FEE_POLICY_ID,
  gateRfqAction,
  localnetEconomicReview,
  operationsAvailability,
  type BrowserSafeMakerStatus,
  type MakerDirectoryStatus,
} from "./rfq-operations";
import { useRfqOperations } from "./use-rfq-operations";
import styles from "./rfq.module.css";
import QuoteComparison from "./QuoteComparison";
import RfqCountdown from "./RfqCountdown";
import RfqFinalReview from "./RfqFinalReview";
import {
  validateFinalReview,
  type RfqFinalReviewSnapshot,
  type RfqFinalReviewTerms,
} from "./rfq-final-review";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  rfqHasFundingEvidence,
  reviseRfqLifecycle,
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
  type RfqAttemptPhase,
  type RfqAttemptTarget,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import {
  prepareFundedSettlementExpiry,
  preparePreFundingReservationRelease,
  reconcilePersistedReservationRelease,
  reservationReleaseReconciliationRoute,
} from "./localnet-release-recovery";
import { localnetResumeDecision } from "./localnet-resume-controller";
import { recoverLocalnetPreparingFundingAfterEmptyObservation } from "./localnet-prewallet-recovery";
import {
  assertLocalnetRecoveryContextUnchanged,
  recoveryContextMatches,
  snapshotLocalnetRecoveryContext,
} from "./localnet-recovery-context";
import RfqPhaseAction from "./RfqPhaseAction";
import { createIndexedDbRfqStorage } from "./rfq-storage";
import {
  LocalnetFundingPrewalletRecoveryPendingError,
  runLocalnetFundingOrchestration,
} from "./localnet-funding-orchestration";
import { applyLocalnetFundingFailureEvidence } from "./localnet-funding-failure-recovery";
import { reconcileFundingBeforeBrowserPersistence } from "./localnet-funded-persistence";
import {
  runAuthorizedInitialMakerFill,
  runAuthorizedPayout,
  runAuthorizedTicketAcceptance,
} from "./rfq-authorized-callers";
import {
  makerFillAttemptTarget,
  retryPersistedMakerFill,
} from "./localnet-maker-fill-recovery";

function consumeAccountScopedQuoteNonce(
  account: string,
  chainId: string,
  nonce: string,
): boolean {
  const key = `app20:rfq-replay:v1:${chainId}:${account.toLowerCase()}`;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? "[]",
    );
    const values = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    if (values.includes(nonce)) return false;
    window.localStorage.setItem(
      key,
      JSON.stringify([...values.slice(-127), nonce]),
    );
    return true;
  } catch {
    return false;
  }
}

export type LocalnetMarketPairId = "STRK_USDC" | "USDC_STRK";

export type LocalnetPrivateIntentDeskProps = Readonly<{
  initialPairId?: LocalnetMarketPairId;
  swapOnly?: boolean;
  onPairChange?: (pairId: LocalnetMarketPairId) => void;
  onLifecycleRecord?: (record: RfqLifecycleRecord) => void;
  requestBlockedReason?: string;
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
  quotes: readonly SolverQuote[];
  cohort: readonly BrowserSafeMakerStatus[];
  directory: MakerDirectoryStatus;
  governedMakerCount: number;
  pair: MarketPair;
  surface: DeskSurface;
};

function finalReviewTerms(quoted: QuotedIntent): RfqFinalReviewTerms {
  const economics = localnetEconomicReview({
    pairId: quoted.pair.id,
    sellAmount: quoted.intent.sellAmount,
    requestedFloor: quoted.intent.minBuyAmount,
    surface: quoted.surface,
  });
  return {
    rfqId: quoted.intent.intentId,
    intentDigest: quoted.quote.intentDigest,
    quoteNonce: quoted.quote.nonce,
    reservationId: quoted.quote.reservationId,
    makerId: quoted.quote.solverId,
    makerKeyId: quoted.quote.solverKey,
    sellSymbol: quoted.pair.sell.symbol,
    sellAddress: quoted.pair.sell.address,
    sellDecimals: quoted.pair.sell.decimals,
    sellAmount: quoted.intent.sellAmount,
    buySymbol: quoted.pair.buy.symbol,
    buyAddress: quoted.pair.buy.address,
    buyDecimals: quoted.pair.buy.decimals,
    buyAmount: quoted.quote.buyAmount,
    minBuyAmount: quoted.intent.minBuyAmount,
    referenceGrossBuyAmount: economics.referenceGrossBuyAmount,
    perTradeCapBaseUnits: economics.perTradeCapBaseUnits,
    maximumTotalDeviationBps: economics.maximumTotalDeviationBps,
    maximumMakerSpreadBps: economics.maximumMakerSpreadBps,
    economicPolicyId: economics.policyId,
    app20FeePolicyId: LOCALNET_APP20_FEE_POLICY_ID,
    app20FeeAmount: 0n,
    spreadBps: quoted.quote.spreadBps,
    quoteExpiresAt: quoted.quote.quoteExpiresAt,
    reservationExpiresAt: quoted.quote.reservationExpiresAt,
    settlementExpiresAt: quoted.intent.expiresAt,
    registryRevision: APP20_TOKEN_REGISTRY_REVISION,
    requiresMatureNote: false,
  };
}

type InvitationReview = Readonly<{
  createdAt: number;
  expiresAt: number;
  sellAmount: bigint;
  minBuyAmount: bigint;
  directoryEpoch: MakerDirectoryStatus["epoch"];
  directoryCheckpoint: MakerDirectoryStatus["checkpoint"];
  directoryValidUntil: number;
  governedMakerCount: number;
  cohort: readonly Readonly<{ makerId: string; keyId: string }>[];
  cohortBinding: string;
}>;

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
  | { kind: "ready"; message: string }
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
  return feltEquals(left, right);
}

function marketPairs(): Record<MarketPair["id"], MarketPair> {
  const configured = configuredMarketPair("localnet");
  const strk: LocalnetMarketToken = configured.ok
    ? configured.pair.tokenA
    : {
        symbol: "STRK",
        address: addrSTRK,
        decimals: 18,
      };
  const usdc: LocalnetMarketToken = configured.ok
    ? configured.pair.tokenB
    : {
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
      defaultMinBuyAmount: "0.198",
    },
    USDC_STRK: {
      id: "USDC_STRK",
      label: "USDC → STRK",
      sell: usdc,
      buy: strk,
      defaultSellAmount: "0.1",
      defaultMinBuyAmount: "0.0495",
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The local private intent failed.";
}

function isInventoryRefusal(message: string): boolean {
  return /inventory (?:cannot|can) cover|does not cover|no output|below the intent floor/i.test(
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
  onLifecycleRecord,
  requestBlockedReason,
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
  const [reviewing, setReviewing] = useState(false);
  const [lifecycleRecord, setLifecycleRecord] =
    useState<RfqLifecycleRecord | null>(null);
  const [reviewSnapshot, setReviewSnapshot] =
    useState<RfqFinalReviewSnapshot | null>(null);
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  const [requotePending, setRequotePending] = useState(false);
  const [counterparty, setCounterparty] = useState<string | null>(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [invitationReview, setInvitationReview] =
    useState<InvitationReview | null>(null);
  const [invitationConfirmed, setInvitationConfirmed] = useState(false);
  const [latestCohort, setLatestCohort] = useState<
    readonly BrowserSafeMakerStatus[]
  >([]);
  const operations = useRfqOperations();
  const requestGate = gateRfqAction(operations, "request");
  const fundingGate = gateRfqAction(operations, "fund", quoted?.quote.solverId);
  const [executionLocked, setExecutionLocked] = useState(false);
  const executionStartedRef = useRef(false);
  const quoteComparisonRef = useRef<HTMLElement>(null);
  const finalReviewRef = useRef<HTMLElement>(null);
  const quoteFocusPendingRef = useRef(false);
  const [preflightObservedAt] = useState(() => Math.floor(Date.now() / 1_000));
  const [preflightNow, setPreflightNow] = useState(preflightObservedAt);
  const working = flow.kind === "working";
  useEffect(() => {
    const tick = () => setPreflightNow(Math.floor(Date.now() / 1_000));
    tick();
    const delay = Math.max(0, 1_000 - (Date.now() % 1_000));
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 1_000);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  const privacyPreflight = useMemo(() => {
    try {
      const amount = parseLocalnetTokenAmount(sellAmount, pair.sell);
      const stamp = {
        observedAt: preflightObservedAt,
        validUntil: preflightObservedAt + 24 * 60 * 60,
      };
      return evaluatePrivacyPreflight({
        amount,
        asset: pair.sell.symbol,
        network: "starknet:APP20_LOCALNET",
        now: preflightNow,
        denominationAlternatives: {
          ...stamp,
          provenance: "app20-client-denomination-policy:v1",
          amounts: [amount / 2n, amount * 2n].filter(
            (alternative) => alternative > 0n,
          ),
        },
        invitedMakerDisclosure: {
          ...stamp,
          provenance: "app20-localnet-maker-directory:v1",
          makerCount: 2,
          disclosedFields: ["pair", "side", "exact size", "floor", "expiry"],
        },
        publicSettlementLeakage: {
          ...stamp,
          provenance: "app20-escrow-disclosure:v1",
          publicFields: [
            "pair",
            "amount",
            "deadline",
            "lifecycle timing",
            "helper activity",
          ],
        },
      });
    } catch {
      return null;
    }
  }, [pair, preflightNow, preflightObservedAt, sellAmount]);
  const privacyReady =
    privacyPreflight !== null &&
    canProceedFromPrivacyPreflight(privacyPreflight, privacyConfirmed);

  const localnetReady =
    connected && Boolean(address) && providerIndex === LOCALNET_PROVIDER_INDEX;
  const lifecycleContextReady = Boolean(
    lifecycleRecord &&
      address &&
      chain &&
      recoveryContextMatches(lifecycleRecord, {
        account: address,
        chainId: chain,
        providerIndex,
      }),
  );
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
    setRequotePending(false);
    setPrivacyConfirmed(false);
    setInvitationReview(null);
    setInvitationConfirmed(false);
    setLatestCohort([]);
    executionStartedRef.current = false;
    setExecutionLocked(false);
  }, [initialPairId]);

  useEffect(() => {
    invalidateQuote();
  }, [address, chain, providerIndex]);

  useEffect(() => {
    if (!requotePending || requestBlockedReason) return;
    setRequotePending(false);
    void buildQuote();
  }, [requotePending, requestBlockedReason]);

  useEffect(() => {
    if (!quoted || reviewing || !quoteFocusPendingRef.current) return;
    quoteComparisonRef.current?.focus();
    quoteFocusPendingRef.current = false;
  }, [quoted, reviewing]);

  useEffect(() => {
    if (reviewing) finalReviewRef.current?.focus();
  }, [reviewing]);

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
    setPrivacyConfirmed(false);
    void navigate({
      to: "/rfq",
      hash: next === "block" ? "desk" : "swap",
    });
  }

  async function persistLifecycle(record: RfqLifecycleRecord) {
    await createIndexedDbRfqStorage().save(record);
    setLifecycleRecord(record);
    onLifecycleRecord?.(record);
  }

  const authorizeLifecycle = async (record: RfqLifecycleRecord) => {
    const authorized = await createIndexedDbRfqStorage().authorize(record);
    setLifecycleRecord(authorized);
    onLifecycleRecord?.(authorized);
    return authorized;
  };

  async function releasePreFundingRecord(
    record: RfqLifecycleRecord,
  ): Promise<RfqLifecycleRecord> {
    const started = snapshotLocalnetRecoveryContext(record);
    const pending = preparePreFundingReservationRelease(
      record,
      createLocalnetIntentId(),
      Math.floor(Date.now() / 1_000),
    );
    await persistLifecycle(pending);
    return reconcilePersistedReservationRelease(pending, {
      releaseRequestReservations: releaseLocalnetRfqReservations,
      expireFundedSettlement: expireLocalnetPrivateIntent,
      persist: async (next) => {
        await persistLifecycle(next);
        return next;
      },
      authorize: authorizeLifecycle,
      beforeSubmit: () =>
        assertLocalnetRecoveryContextUnchanged(started, record),
      now: () => Math.floor(Date.now() / 1_000),
    });
  }

  function invalidateQuote() {
    setQuoted(null);
    setReviewing(false);
    setLifecycleRecord(null);
    setFlow({ kind: "idle" });
    setRequotePending(false);
    setPrivacyConfirmed(false);
    setInvitationReview(null);
    setInvitationConfirmed(false);
    setLatestCohort([]);
    executionStartedRef.current = false;
    setExecutionLocked(false);
  }

  function prepareInvitationReview() {
    try {
      const createdAt = Math.floor(Date.now() / 1_000);
      const exactSell = parseLocalnetTokenAmount(sellAmount, pair.sell);
      const economics = localnetEconomicReview({
        pairId: pair.id,
        sellAmount: exactSell,
        surface,
        ...(surface === "block"
          ? { requestedFloor: parseLocalnetTokenAmount(minBuyAmount, pair.buy) }
          : {}),
      });
      const status = operations.status;
      if (!status || !requestGate.allowed) {
        throw new Error("A fresh planned maker cohort is unavailable.");
      }
      const cohort = Object.freeze(
        status.makers.map(({ makerId, keyId }) =>
          Object.freeze({ makerId, keyId }),
        ),
      );
      const cohortBinding = [
        status.schema,
        status.directory.epoch,
        status.directory.checkpoint,
        status.directory.validUntil,
        ...cohort.flatMap(({ makerId, keyId }) => [makerId, keyId]),
      ].join("|");
      setInvitationReview({
        createdAt,
        expiresAt: createdAt + 20 * 60,
        sellAmount: exactSell,
        minBuyAmount: economics.reviewedFloor,
        directoryEpoch: status.directory.epoch,
        directoryCheckpoint: status.directory.checkpoint,
        directoryValidUntil: status.directory.validUntil,
        governedMakerCount: status.cohort.governed,
        cohort,
        cohortBinding,
      });
      setInvitationConfirmed(false);
      setFlow({ kind: "idle" });
    } catch (error: unknown) {
      setInvitationReview(null);
      setInvitationConfirmed(false);
      setFlow({ kind: "error", message: errorMessage(error) });
    }
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
    let offers: readonly LocalnetSolverOffer[] = [];
    let requestingRecord: RfqLifecycleRecord | null = null;
    setFlow({
      kind: "working",
      phase: "quote",
      message: "Requesting signed quotes from 2 localnet fixture makers…",
    });
    try {
      if (requestBlockedReason) throw new Error(requestBlockedReason);
      if (!requestGate.allowed) throw new Error(requestGate.reason);
      const exactNow = Math.floor(Date.now() / 1_000);
      const currentPreflight = privacyPreflight
        ? evaluatePrivacyPreflight({
            amount: parseLocalnetTokenAmount(sellAmount, pair.sell),
            asset: pair.sell.symbol,
            network: "starknet:APP20_LOCALNET",
            now: exactNow,
            denominationAlternatives: {
              observedAt: preflightObservedAt,
              validUntil: preflightObservedAt + 24 * 60 * 60,
              provenance: "app20-client-denomination-policy:v1",
              amounts: [
                parseLocalnetTokenAmount(sellAmount, pair.sell) / 2n,
                parseLocalnetTokenAmount(sellAmount, pair.sell) * 2n,
              ].filter((value) => value > 0n),
            },
            invitedMakerDisclosure: {
              observedAt: preflightObservedAt,
              validUntil: preflightObservedAt + 24 * 60 * 60,
              provenance: "app20-localnet-maker-directory:v1",
              makerCount: 2,
              disclosedFields: [
                "pair",
                "side",
                "exact size",
                "floor",
                "expiry",
              ],
            },
            publicSettlementLeakage: {
              observedAt: preflightObservedAt,
              validUntil: preflightObservedAt + 24 * 60 * 60,
              provenance: "app20-escrow-disclosure:v1",
              publicFields: [
                "pair",
                "amount",
                "deadline",
                "lifecycle timing",
                "helper activity",
              ],
            },
          })
        : null;
      if (
        !currentPreflight ||
        !canProceedFromPrivacyPreflight(currentPreflight, privacyConfirmed)
      ) {
        throw new Error(
          "Review the privacy preflight and acknowledge the known disclosures before requesting quotes.",
        );
      }
      if (!invitationReview || !invitationConfirmed) {
        throw new Error(
          "Confirm the exact invitation review before maker terms leave the browser.",
        );
      }
      if (!localnetReady) {
        throw new Error(
          "No private inventory on this network. The RFQ was not published or routed elsewhere.",
        );
      }
      const configured = configuredMarketPair("localnet");
      if (!configured.ok) {
        throw new Error("The reviewed localnet market is not configured.");
      }
      const forward =
        matchesToken(pair.sell.address, configured.pair.tokenA.address) &&
        matchesToken(pair.buy.address, configured.pair.tokenB.address);
      const reverse =
        matchesToken(pair.sell.address, configured.pair.tokenB.address) &&
        matchesToken(pair.buy.address, configured.pair.tokenA.address);
      if (!forward && !reverse) {
        throw new Error("The selected pair is not a reviewed localnet market.");
      }
      if (BigInt(escrowHelperLocalnet) === 0n) {
        throw new Error("The local escrow deployment is unavailable.");
      }
      if (BigInt(localnetUsdcToken) === 0n) {
        throw new Error("The local private-market token is unavailable.");
      }
      const sell = parseLocalnetTokenAmount(sellAmount, pair.sell);
      const economics = localnetEconomicReview({
        pairId: pair.id,
        sellAmount: sell,
        surface,
        ...(surface === "block"
          ? { requestedFloor: parseLocalnetTokenAmount(minBuyAmount, pair.buy) }
          : {}),
      });
      const floor = economics.reviewedFloor;
      if (
        sell !== invitationReview.sellAmount ||
        floor !== invitationReview.minBuyAmount
      ) {
        throw new Error(
          "RFQ terms changed after invitation review. Prepare and confirm them again.",
        );
      }
      if (exactNow >= invitationReview.expiresAt) {
        throw new Error("The reviewed invitation expired before it was sent.");
      }
      if (exactNow >= invitationReview.directoryValidUntil) {
        throw new Error(
          "The confirmed maker-directory snapshot expired before it was sent. Prepare the invitation review again.",
        );
      }
      const now = invitationReview.createdAt;
      const intent: PrivateSwapIntentV1 = {
        version: 1,
        intentId: createLocalnetIntentId(),
        pool: "starknet:APP20_LOCALNET",
        sellToken: pair.sell.address,
        sellAmount: sell,
        buyToken: pair.buy.address,
        minBuyAmount: floor,
        createdAt: invitationReview.createdAt,
        expiresAt: invitationReview.expiresAt,
      };
      const intentDigest = await digestPrivateSwapIntent(intent);
      if (!address || !chain)
        throw new Error("The connected wallet context is unavailable.");
      const draftRecord = createRfqLifecycleRecord({
        chainId: chain,
        account: address,
        rfqId: intent.intentId,
        now,
        requestDigest: intentDigest,
        terms: {
          pairId: pair.id,
          sellSymbol: pair.sell.symbol,
          sellAddress: pair.sell.address,
          sellDecimals: pair.sell.decimals,
          sellAmount: intent.sellAmount.toString(),
          buySymbol: pair.buy.symbol,
          buyAddress: pair.buy.address,
          buyDecimals: pair.buy.decimals,
          minBuyAmount: intent.minBuyAmount.toString(),
          rfqExpiresAt: intent.expiresAt,
        },
      });
      requestingRecord = transitionRfqLifecycle(draftRecord, "requesting", now);
      await persistLifecycle(requestingRecord);
      const quoteRequest = await requestLocalnetSolverQuotes({
        account: draftRecord.account,
        chainId: draftRecord.chainId,
        rfqId: draftRecord.rfqId,
        intentDigest,
        createdAt: intent.createdAt,
        expiresAt: intent.expiresAt,
        sellToken: intent.sellToken,
        sellAmount: intent.sellAmount,
        buyToken: intent.buyToken,
        minBuyAmount: intent.minBuyAmount,
        cohort: {
          epoch: invitationReview.directoryEpoch,
          checkpoint: invitationReview.directoryCheckpoint,
          validUntil: invitationReview.directoryValidUntil,
          makers: invitationReview.cohort,
          binding: invitationReview.cohortBinding,
        },
      });
      offers = quoteRequest.offers;
      setLatestCohort(quoteRequest.cohort);
      if (offers.length === 0)
        throw new Error("No private maker inventory can cover this RFQ.");
      const signedQuotes: SolverQuote[] = [];
      for (const offer of offers) {
        if (offer.spreadBps > economics.maximumMakerSpreadBps) {
          throw new Error(
            "A maker quote exceeded the named localnet spread cap.",
          );
        }
        if (offer.grossBuyAmount !== economics.referenceGrossBuyAmount) {
          throw new Error(
            "A maker quote deviated from the named localnet fixture reference.",
          );
        }
        if (
          !matchesToken(offer.sellToken, pair.sell.address) ||
          !matchesToken(offer.buyToken, pair.buy.address)
        ) {
          throw new Error("A private maker changed the requested pair.");
        }
        const outcome = await quotePrivateSwapIntent(
          intent,
          {
            price: async () => ({
              buyAmount: offer.grossBuyAmount,
              provenance: offer.provenance,
            }),
          },
          {
            solverId: offer.solverId,
            solverKey: offer.solverKey,
            helper: escrowHelperLocalnet,
            spreadBps: offer.spreadBps,
            quoteTtlSeconds: 10 * 60,
            now,
            nonce: offer.nonce,
            reservationId: offer.reservationId,
            reservationExpiresAt: offer.reservationExpiresAt,
            sign: signLocalnetSolverQuote,
          },
        );
        if (outcome.kind !== "quoted") {
          throw new Error(outcome.reason);
        }
        signedQuotes.push(outcome.quote);
      }
      const selectedQuote = await selectBestSolverQuote(
        intent,
        signedQuotes,
        now,
        {
          helper: escrowHelperLocalnet,
          verify: verifyLocalnetSolverQuote,
        },
      );
      if (!requestingRecord)
        throw new Error("The requesting lifecycle record is unavailable.");
      const quotedRecord = transitionRfqLifecycle(
        requestingRecord,
        "quoted",
        now,
        {
          terms: Object.freeze({
            ...requestingRecord.terms!,
            buyAmount: selectedQuote.buyAmount.toString(),
          }),
          selectedQuote: Object.freeze({
            version: "Quote V1",
            solverId: selectedQuote.solverId,
            solverKey: selectedQuote.solverKey,
            nonce: selectedQuote.nonce,
            reservationId: selectedQuote.reservationId,
            spreadBps: selectedQuote.spreadBps,
            pricingProvenance: selectedQuote.pricingProvenance,
            quotedAt: selectedQuote.quotedAt,
            quoteExpiresAt: selectedQuote.quoteExpiresAt,
            reservationExpiresAt: selectedQuote.reservationExpiresAt,
            buyAmount: selectedQuote.buyAmount.toString(),
            intentDigest: selectedQuote.intentDigest,
            signature: selectedQuote.signature,
          }),
          quoteExpiresAt: selectedQuote.quoteExpiresAt,
          reservationExpiresAt: selectedQuote.reservationExpiresAt,
        },
      );
      await persistLifecycle(quotedRecord);
      quoteFocusPendingRef.current = true;
      setQuoted({
        intent,
        quote: selectedQuote,
        quotes: signedQuotes,
        cohort: quoteRequest.cohort,
        directory: Object.freeze({
          epoch: invitationReview.directoryEpoch,
          checkpoint: invitationReview.directoryCheckpoint,
          validUntil: invitationReview.directoryValidUntil,
        }),
        governedMakerCount: invitationReview.governedMakerCount,
        pair,
        surface,
      });
      setReviewing(false);
      setFlow({ kind: "idle" });
    } catch (error: unknown) {
      if (requestingRecord?.state === "requesting") {
        await releasePreFundingRecord(requestingRecord).catch(() => undefined);
      }
      const message = errorMessage(error);
      const refused = isInventoryRefusal(message);
      setQuoted(null);
      setFlow(
        refused ? { kind: "refused", message } : { kind: "error", message },
      );
    }
  }

  async function enterReview() {
    if (!quoted) return;
    try {
      const now = Math.floor(Date.now() / 1_000);
      if (
        now >= quoted.quote.quoteExpiresAt ||
        now >= quoted.quote.reservationExpiresAt
      ) {
        await expireSelectedQuote(
          now >= quoted.quote.quoteExpiresAt
            ? "Quote expired."
            : "Reservation expired.",
        );
        return;
      }
      if (!lifecycleRecord || !address || !chain)
        throw new Error("The local resume record is unavailable.");
      const selectionAttempt = transitionRfqLifecycle(
        lifecycleRecord,
        "reviewing",
        now,
        {
          reason:
            "Quote selection submitted; exact outcome requires reconciliation.",
        },
      );
      await persistLifecycle(selectionAttempt);
      const authorization = await selectLocalnetSolverQuote({
        intentDigest: quoted.quote.intentDigest,
        selectedReservationId: quoted.quote.reservationId,
      });
      if (authorization.solverId !== quoted.quote.solverId) {
        throw new Error("Selection authorization names a different maker.");
      }
      const started = snapshotReadyExecution();
      const provider = myFrontendProviders[LOCALNET_PROVIDER_INDEX];
      const [poolFee, publicFeeBalance] = await Promise.all([
        readLivePoolFee(provider, strk20PoolLocalnet),
        readPublicStrkBalance(provider, started.address),
      ]);
      setReviewSnapshot({
        account: started.address,
        chainId: chain,
        walletRail: "ready",
        observedAt: Math.floor(Date.now() / 1_000),
        poolFee,
        poolAddress: strk20PoolLocalnet,
        publicFeeBalance,
      });
      await persistLifecycle(
        reviseRfqLifecycle(selectionAttempt, {
          updatedAt: Math.floor(Date.now() / 1_000),
          reason: undefined,
          selectedQuote: selectionAttempt.selectedQuote
            ? Object.freeze({
                ...selectionAttempt.selectedQuote,
                reservationFence: authorization.reservationFence,
                quoteDigest: authorization.quoteDigest,
              })
            : undefined,
        }),
      );
      setReviewing(true);
    } catch (error: unknown) {
      const message = `Quote selection requires reservation-release verification: ${errorMessage(error)}`;
      const current = lifecycleRecord;
      if (current && ["quoted", "reviewing"].includes(current.state)) {
        const releasable =
          current.state === "reviewing"
            ? current
            : transitionRfqLifecycle(
                current,
                "reviewing",
                Math.floor(Date.now() / 1_000),
              );
        await releasePreFundingRecord(releasable).catch(() => undefined);
      }
      setFlow({ kind: "error", message });
    }
  }

  async function cancelRfq(reason: "decline" | "cancel"): Promise<boolean> {
    if (!quoted || !lifecycleRecord) return false;
    const unsafeState =
      [
        "submission-unknown",
        "funded",
        "filled",
        "claimable",
        "settled",
        "refundable",
        "refunded",
      ].includes(lifecycleRecord.state) ||
      (lifecycleRecord.state === "expired" &&
        rfqHasFundingEvidence(lifecycleRecord));
    if (executionStartedRef.current || unsafeState) {
      setFlow({
        kind: "error",
        message:
          "Cancellation is unavailable after acceptance starts. Monitor or recover the submitted lifecycle instead.",
      });
      return false;
    }
    setFlow({
      kind: "working",
      phase: "quote",
      message:
        "Persisting the release attempt before reconciling all request reservations…",
    });
    try {
      const started = snapshotLocalnetRecoveryContext(lifecycleRecord);
      const pending = preparePreFundingReservationRelease(
        lifecycleRecord,
        createLocalnetIntentId(),
        Math.floor(Date.now() / 1_000),
      );
      await persistLifecycle(pending);
      await reconcilePersistedReservationRelease(pending, {
        releaseRequestReservations: releaseLocalnetRfqReservations,
        expireFundedSettlement: expireLocalnetPrivateIntent,
        persist: persistLifecycle,
        authorize: authorizeLifecycle,
        beforeSubmit: () =>
          assertLocalnetRecoveryContextUnchanged(started, lifecycleRecord),
        now: () => Math.floor(Date.now() / 1_000),
      });
    } catch (error: unknown) {
      setFlow({
        kind: "error",
        message: `Reservation release remains pending: ${errorMessage(error)} Retry verifies the same persisted request and does not allocate a wallet attempt.`,
      });
      return false;
    }
    setQuoted(null);
    setReviewing(false);
    setFlow({ kind: "idle" });
    if (reason === "decline") setPrivacyConfirmed(false);
    return true;
  }

  async function requote() {
    if (!(await cancelRfq("cancel"))) return;
    setFlow({
      kind: "working",
      phase: "quote",
      message:
        "Reservation release verified. Waiting for the persisted workspace fence to refresh before requesting new quotes…",
    });
    setRequotePending(true);
  }

  function exactLocalTerms(current: QuotedIntent, record: RfqLifecycleRecord) {
    if (
      !record.requestDigest ||
      !record.selectedQuote?.reservationFence ||
      !record.selectedQuote.quoteDigest
    )
      throw new Error(
        "The exact request and selected reservation authorization are unavailable.",
      );
    return {
      account: record.account,
      chainId: record.chainId,
      rfqId: record.rfqId,
      dealId: current.intent.intentId,
      intentDigest: record.requestDigest,
      solverId: current.quote.solverId,
      reservationId: current.quote.reservationId,
      reservationFence: record.selectedQuote.reservationFence,
      quoteDigest: record.selectedQuote.quoteDigest,
      sellToken: current.intent.sellToken,
      sellAmount: current.intent.sellAmount,
      buyToken: current.intent.buyToken,
      buyAmount: current.quote.buyAmount,
      deadline: record.settlement?.deadline ?? current.intent.expiresAt,
      ticketAddress:
        record.settlement?.ticketAddress ??
        (() => {
          throw new Error("The exact settlement ticket is unavailable.");
        })(),
    };
  }

  async function persistPreparingAttempt(
    record: RfqLifecycleRecord,
    phase: RfqAttemptPhase,
    target?: RfqAttemptTarget,
  ): Promise<RfqLifecycleRecord> {
    const next = beginRfqPhaseAttempt(
      record,
      phase,
      createLocalnetIntentId(),
      Math.floor(Date.now() / 1_000),
      target,
    );
    await persistLifecycle(next);
    return next;
  }

  async function reconcileRecord(
    record: RfqLifecycleRecord,
  ): Promise<RfqLifecycleRecord> {
    const observed = await readLocalnetEscrowDeal(
      record.settlement?.dealId ?? record.rfqId,
    );
    const next = await reconcileFundingBeforeBrowserPersistence(
      record,
      observed,
      Math.floor(Date.now() / 1_000),
      {
        authorize: authorizeLifecycle,
        convergeServer: async (fundedRecord, status, attemptId) => {
          if (!quoted)
            throw new Error(
              "Funded browser state cannot be persisted without restored canonical quote terms.",
            );
          await convergeLocalnetPrivateIntent(
            exactLocalTerms(quoted, fundedRecord),
            attemptId,
            status,
          );
        },
        persistBrowser: persistLifecycle,
      },
    );
    return next;
  }

  async function acceptAndFund() {
    if (
      !quoted ||
      !reviewing ||
      executionStartedRef.current ||
      !lifecycleRecord
    )
      return;
    if (!fundingGate.allowed) {
      setFlow({ kind: "error", message: fundingGate.reason });
      return;
    }
    executionStartedRef.current = true;
    setExecutionLocked(true);
    setFlow({
      kind: "working",
      phase: "lock",
      message:
        "Revalidating and persisting the funding attempt before wallet submission…",
    });
    let current = lifecycleRecord;
    try {
      const preflightNow = Math.floor(Date.now() / 1_000);
      const acceptancePreflight = evaluatePrivacyPreflight({
        amount: quoted.intent.sellAmount,
        asset: quoted.pair.sell.symbol,
        network: "starknet:APP20_LOCALNET",
        now: preflightNow,
        denominationAlternatives: {
          observedAt: preflightObservedAt,
          validUntil: preflightObservedAt + 24 * 60 * 60,
          provenance: "app20-client-denomination-policy:v1",
          amounts: [
            quoted.intent.sellAmount / 2n,
            quoted.intent.sellAmount * 2n,
          ].filter((value) => value > 0n),
        },
        invitedMakerDisclosure: {
          observedAt: preflightObservedAt,
          validUntil: preflightObservedAt + 24 * 60 * 60,
          provenance: "app20-localnet-maker-directory:v1",
          makerCount: 2,
          disclosedFields: ["pair", "side", "exact size", "floor", "expiry"],
        },
        publicSettlementLeakage: {
          observedAt: preflightObservedAt,
          validUntil: preflightObservedAt + 24 * 60 * 60,
          provenance: "app20-escrow-disclosure:v1",
          publicFields: [
            "pair",
            "amount",
            "deadline",
            "lifecycle timing",
            "helper activity",
          ],
        },
      });
      if (
        !canProceedFromPrivacyPreflight(acceptancePreflight, privacyConfirmed)
      )
        throw new Error(
          "Privacy evidence expired or became unavailable before acceptance. Request fresh quotes.",
        );
      const started = snapshotReadyExecution();
      if (started.providerIndex !== LOCALNET_PROVIDER_INDEX)
        throw new Error("Select LOCAL and connect Localnet (dev) first.");
      if (!reviewSnapshot || !chain)
        throw new Error("Fresh final-review evidence is unavailable.");
      const provider = myFrontendProviders[LOCALNET_PROVIDER_INDEX];
      const [poolFee, publicFeeBalance] = await Promise.all([
        readLivePoolFee(provider, strk20PoolLocalnet),
        readPublicStrkBalance(provider, started.address),
      ]);
      const reviewNow = Math.floor(Date.now() / 1_000);
      const finalCheck = validateFinalReview({
        initial: reviewSnapshot,
        current: {
          account: started.address,
          chainId: chain,
          walletRail: "ready",
          observedAt: reviewNow,
          poolFee,
          poolAddress: strk20PoolLocalnet,
          publicFeeBalance,
        },
        terms: finalReviewTerms(quoted),
        now: reviewNow,
      });
      if (!finalCheck.ok)
        throw new Error(
          `Final review changed: ${finalCheck.blockers.join(" ")}`,
        );
      const freshOperationsStatus = await readLocalnetRfqOperationsStatus();
      const commitNow = Math.floor(Date.now() / 1_000);
      const commitGate = gateRfqAction(
        operationsAvailability(freshOperationsStatus, commitNow),
        "fund",
        quoted.quote.solverId,
      );
      if (!commitGate.allowed) throw new Error(commitGate.reason);
      const boundaryCheck = validateFinalReview({
        initial: reviewSnapshot,
        current: {
          account: started.address,
          chainId: chain,
          walletRail: "ready",
          observedAt: commitNow,
          poolFee,
          poolAddress: strk20PoolLocalnet,
          publicFeeBalance,
        },
        terms: finalReviewTerms(quoted),
        now: commitNow,
      });
      if (!boundaryCheck.ok)
        throw new Error(
          `Final review changed at submission boundary: ${boundaryCheck.blockers.join(" ")}`,
        );
      const fundingAttemptId = createLocalnetIntentId();
      const ticketTarget = fundingTicketAttemptTarget({
        account: current.account,
        chainId: current.chainId,
        rfqId: current.rfqId,
        dealId: quoted.intent.intentId,
        intentDigest:
          current.requestDigest ??
          (() => {
            throw new Error("The exact request digest is unavailable.");
          })(),
        solverId: quoted.quote.solverId,
        reservationId: quoted.quote.reservationId,
        reservationFence:
          current.selectedQuote?.reservationFence ??
          (() => {
            throw new Error("The reservation fence is unavailable.");
          })(),
        quoteDigest:
          current.selectedQuote?.quoteDigest ??
          (() => {
            throw new Error("The quote digest is unavailable.");
          })(),
        sellToken: quoted.intent.sellToken,
        sellAmount: quoted.intent.sellAmount,
        buyToken: quoted.intent.buyToken,
        buyAmount: quoted.quote.buyAmount,
        deadline: quoted.intent.expiresAt,
      });
      current = reviseRfqLifecycle(current, {
        settlement: Object.freeze({
          version: "Localnet V2" as const,
          escrowAddress: escrowHelperLocalnet,
          dealId: quoted.intent.intentId,
          deadline: quoted.intent.expiresAt,
        }),
        updatedAt: commitNow,
      });
      current = beginRfqPhaseAttempt(
        current,
        "funding",
        fundingAttemptId,
        commitNow,
        ticketTarget,
      );
      await persistLifecycle(current);
      let ticketAddress: string;
      const ticketRuntimeEpoch = localnetRuntimeEpoch();
      try {
        const ticket = await runAuthorizedTicketAcceptance(current, {
          authorize: authorizeLifecycle,
          accept: async (authorized) => {
            current = authorized;
            await acceptQuote(quoted.intent, quoted.quote, commitNow, {
              helper: escrowHelperLocalnet,
              verify: verifyLocalnetSolverQuote,
              consumeNonce: (nonce) =>
                Boolean(address && chain) &&
                consumeAccountScopedQuoteNonce(address, chain, nonce),
            });
          },
          beforeEnsureTicket: () => {
            assertReadyExecutionUnchanged(started, "private-swap");
            if (localnetRuntimeEpoch() !== ticketRuntimeEpoch)
              throw new Error(
                "The localnet runtime changed before ticket deployment.",
              );
          },
          ensureTicket: (authorized) => {
            const exactAttempt = authorized.attempts.funding;
            if (
              exactAttempt?.attemptId !== fundingAttemptId ||
              exactAttempt.target?.operation !== "funding-ticket"
            )
              throw new Error(
                "The exact ticket-authorized funding attempt changed.",
              );
            return ensureLocalnetEscrowTicket({
              target: exactAttempt.target,
              attemptId: exactAttempt.attemptId,
            });
          },
        });
        current = ticket.authorized;
        ticketAddress = ticket.result;
      } catch (error: unknown) {
        throw new LocalnetFundingPrewalletRecoveryPendingError(error);
      }
      current = reviseRfqLifecycle(current, {
        settlement: Object.freeze({
          ...current.settlement!,
          ticketAddress,
        }),
        updatedAt: Math.floor(Date.now() / 1_000),
      });
      await persistLifecycle(current);
      const funded = await runLocalnetFundingOrchestration({
        prepareBeforeLease: async () => {
          const actions = buildEscrowFundActions({
            escrowAddress: escrowHelperLocalnet,
            recoveryAddress: started.address,
            ticketAddress,
            dealId: quoted.intent.intentId,
            token: quoted.intent.sellToken,
            amount: quoted.intent.sellAmount,
            counterToken: quoted.intent.buyToken,
            counterAmount: quoted.quote.buyAmount,
            deadline: quoted.intent.expiresAt,
          });
          return {
            account: started.account,
            provider,
            actions,
            target: exactLocalTerms(quoted, current),
            attemptId: fundingAttemptId,
            policy: () => {
              assertReadyExecutionUnchanged(started, "private-swap");
              const submissionNow = Math.floor(Date.now() / 1_000);
              const liveGate = gateRfqAction(
                operationsAvailability(freshOperationsStatus, submissionNow),
                "fund",
                quoted.quote.solverId,
              );
              if (!liveGate.allowed) throw new Error(liveGate.reason);
              if (
                submissionNow >= quoted.quote.quoteExpiresAt ||
                submissionNow >= quoted.quote.reservationExpiresAt
              ) {
                throw new Error(
                  "Quote or reservation expired before wallet submission.",
                );
              }
            },
            onSubmitted: async (transactionHash: string) => {
              current = updateRfqPhaseAttempt(
                current,
                "funding",
                "submitted-unknown",
                Math.floor(Date.now() / 1_000),
                { transactionHash },
              );
              current = transitionRfqLifecycle(
                current,
                "submission-unknown",
                Math.floor(Date.now() / 1_000),
              );
              await persistLifecycle(current);
            },
          };
        },
        persistPreparedAttempt: async () => {
          if (
            current.attempts.funding?.attemptId !== fundingAttemptId ||
            current.attempts.funding.target?.operation !== "funding-ticket"
          )
            throw new Error(
              "The exact ticket-authorized funding lease was lost.",
            );
          current = await authorizeLifecycle(current);
        },
        authorizeWalletSubmission: async () => {
          current = await authorizeLifecycle(current);
        },
        prepareLease: prepareLocalnetFunding,
        markUnknown: markLocalnetFundingUnknown,
        abandonLease: abandonLocalnetFunding,
        leaseDefinitelyNotAcquired: localnetCommandWasRejected,
      });
      if (current.attempts.funding?.state !== "submitted-unknown") {
        await markLocalnetFundingUnknown(
          exactLocalTerms(quoted, current),
          current.attempts.funding!.attemptId,
        );
        current = updateRfqPhaseAttempt(
          current,
          "funding",
          "submitted-unknown",
          Math.floor(Date.now() / 1_000),
          { transactionHash: funded.transactionHash },
        );
        current = transitionRfqLifecycle(
          current,
          "submission-unknown",
          Math.floor(Date.now() / 1_000),
        );
        await persistLifecycle(current);
      }
      current = await reconcileRecord(current);
      if (current.state !== "funded")
        throw new Error(
          "Funding receipt succeeded but exact local deal reconciliation did not confirm Funded.",
        );
      executionStartedRef.current = false;
      setExecutionLocked(false);
      setFlow({
        kind: "ready",
        message:
          "Funding confirmed from an exact local deal observation. Choose the next persisted phase.",
      });
    } catch (error: unknown) {
      let recoveryMessage = errorMessage(error);
      try {
        const attemptState = transactionStateFromError(error);
        if (
          attemptState === "unknown" &&
          current.attempts.funding?.state === "preparing"
        ) {
          try {
            await markLocalnetFundingUnknown(
              exactLocalTerms(quoted, current),
              current.attempts.funding.attemptId,
            );
          } catch {
            // Fail closed: an active or committed unknown lease stays fenced.
          }
        }
        const stamp = Math.floor(Date.now() / 1_000);
        const evidence = applyLocalnetFundingFailureEvidence(
          current,
          error,
          stamp,
        );
        if (evidence.record !== current) {
          current = evidence.record;
          await persistLifecycle(current);
        }
        if (evidence.releaseRequired) {
          const releaseStarted = snapshotLocalnetRecoveryContext(current);
          current = preparePreFundingReservationRelease(
            current,
            createLocalnetIntentId(),
            stamp,
          );
          await persistLifecycle(current);
          current = await reconcilePersistedReservationRelease(current, {
            releaseRequestReservations: releaseLocalnetRfqReservations,
            expireFundedSettlement: expireLocalnetPrivateIntent,
            persist: async (next) => {
              current = next;
              await persistLifecycle(next);
            },
            authorize: authorizeLifecycle,
            beforeSubmit: () =>
              assertLocalnetRecoveryContextUnchanged(releaseStarted, current),
            now: () => Math.floor(Date.now() / 1_000),
          });
          setQuoted(null);
          setReviewing(false);
          setPrivacyConfirmed(false);
          recoveryMessage =
            "Funding was proven not submitted. The consumed quote was released request-wide; request fresh quotes.";
        } else if (evidence.verificationOnly) {
          recoveryMessage =
            current.attempts.funding?.state === "wallet-boundary-unknown"
              ? "The wallet boundary was entered without a hash. Funding remains verification-only and cannot be retried."
              : "Funding submission is unknown. Verify the exact transaction; do not retry.";
        }
      } catch (recoveryError: unknown) {
        recoveryMessage = `Funding recovery remains safely fenced: ${errorMessage(recoveryError)}`;
      } finally {
        executionStartedRef.current = false;
        setExecutionLocked(false);
      }
      setFlow({ kind: "error", message: recoveryMessage });
    }
  }

  async function requestMakerFill() {
    if (!quoted || !lifecycleRecord || lifecycleRecord.state !== "funded")
      return;
    const recoveryStarted = snapshotLocalnetRecoveryContext(lifecycleRecord);
    const fillGate = gateRfqAction(operations, "fill", quoted.quote.solverId);
    if (!fillGate.allowed) {
      setFlow({ kind: "error", message: fillGate.reason });
      return;
    }
    let current = lifecycleRecord;
    setFlow({
      kind: "working",
      phase: "fill",
      message:
        "Persisting maker-fill attempt before requesting the selected maker…",
    });
    try {
      current = await reconcileRecord(current);
      const fillNow = Math.floor(Date.now() / 1_000);
      if (
        current.state !== "funded" ||
        fillNow >= (current.settlement?.deadline ?? 0)
      ) {
        throw new Error(
          "A fresh exact deal observation does not permit maker fill before the deadline.",
        );
      }
      const freshStatus = await readLocalnetRfqOperationsStatus();
      const freshFillGate = gateRfqAction(
        operationsAvailability(freshStatus, Math.floor(Date.now() / 1_000)),
        "fill",
        quoted.quote.solverId,
      );
      if (!freshFillGate.allowed) throw new Error(freshFillGate.reason);
      const fillTerms = exactLocalTerms(quoted, current);
      current = await persistPreparingAttempt(
        current,
        "fill",
        makerFillAttemptTarget(fillTerms),
      );
      const fill = await runAuthorizedInitialMakerFill(current, {
        authorize: authorizeLifecycle,
        beforeSubmit: () =>
          assertLocalnetRecoveryContextUnchanged(
            recoveryStarted,
            lifecycleRecord,
          ),
        submit: (authorized) =>
          askLocalnetSolverToFill(
            fillTerms,
            authorized.attempts.fill!.attemptId,
          ),
      });
      current = fill.authorized;
      const transactionHash = fill.result;
      current = updateRfqPhaseAttempt(
        current,
        "fill",
        "submitted-unknown",
        Math.floor(Date.now() / 1_000),
        { transactionHash },
      );
      await persistLifecycle(current);
      current = await reconcileRecord(current);
      if (current.state !== "claimable")
        throw new Error(
          "Maker fill was not confirmed by exact local deal reconciliation.",
        );
      setFlow({
        kind: "ready",
        message:
          "Exact maker fill observed. Claim is now available as a separate persisted command.",
      });
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function retryMakerFill() {
    if (!quoted || !lifecycleRecord) return;
    const recoveryStarted = snapshotLocalnetRecoveryContext(lifecycleRecord);
    setFlow({
      kind: "working",
      phase: "fill",
      message:
        "Retrying the exact persisted maker-fill request; no new attempt is allocated…",
    });
    try {
      const freshStatus = await readLocalnetRfqOperationsStatus();
      const gate = gateRfqAction(
        operationsAvailability(freshStatus, Math.floor(Date.now() / 1_000)),
        "fill",
        lifecycleRecord.selectedQuote?.solverId,
      );
      if (!gate.allowed) throw new Error(gate.reason);
      let current = await retryPersistedMakerFill(lifecycleRecord, {
        authorize: (record) => createIndexedDbRfqStorage().authorize(record),
        beforeSubmit: () =>
          assertLocalnetRecoveryContextUnchanged(
            recoveryStarted,
            lifecycleRecord,
          ),
        submitExact: askLocalnetSolverToFill,
        persist: async (next) => {
          await persistLifecycle(next);
        },
        now: () => Math.floor(Date.now() / 1_000),
      });
      current = await reconcileRecord(current);
      setFlow({
        kind: "ready",
        message:
          current.state === "claimable"
            ? "The exact retried maker fill was observed. Claim is available."
            : "The exact maker-fill retry returned; verify its persisted outcome.",
      });
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function observeExpiry() {
    if (!lifecycleRecord || lifecycleRecord.state !== "funded") return;
    setFlow({
      kind: "working",
      phase: "expire",
      message: "Waiting for the local harness to report settlement expiry…",
    });
    try {
      const started = snapshotLocalnetRecoveryContext(lifecycleRecord);
      const observedFunded = await reconcileRecord(lifecycleRecord);
      const pending = prepareFundedSettlementExpiry(
        observedFunded,
        createLocalnetIntentId(),
        Math.floor(Date.now() / 1_000),
      );
      await persistLifecycle(pending);
      await reconcilePersistedReservationRelease(pending, {
        releaseRequestReservations: releaseLocalnetRfqReservations,
        expireFundedSettlement: expireLocalnetPrivateIntent,
        persist: persistLifecycle,
        authorize: authorizeLifecycle,
        beforeSubmit: () =>
          assertLocalnetRecoveryContextUnchanged(started, lifecycleRecord),
        now: () => Math.floor(Date.now() / 1_000),
      });
      setFlow({
        kind: "ready",
        message:
          "Settlement expiry observed by the local harness. Refund is now a separate persisted command.",
      });
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function verifyReservationRelease() {
    if (!lifecycleRecord) return;
    try {
      const started = snapshotLocalnetRecoveryContext(lifecycleRecord);
      const route = reservationReleaseReconciliationRoute(lifecycleRecord);
      setFlow({
        kind: "working",
        phase: route === "request-reservations" ? "quote" : "expire",
        message:
          route === "request-reservations"
            ? "Verifying the same idempotent coordinator request release…"
            : "Verifying the same idempotent funded settlement expiry…",
      });
      const reconciled =
        route === "funded-settlement-expiry"
          ? await reconcileRecord(lifecycleRecord)
          : lifecycleRecord;
      await reconcilePersistedReservationRelease(reconciled, {
        releaseRequestReservations: releaseLocalnetRfqReservations,
        expireFundedSettlement: expireLocalnetPrivateIntent,
        persist: persistLifecycle,
        authorize: authorizeLifecycle,
        beforeSubmit: () =>
          assertLocalnetRecoveryContextUnchanged(started, lifecycleRecord),
        now: () => Math.floor(Date.now() / 1_000),
      });
      if (route === "request-reservations") {
        setQuoted(null);
        setReviewing(false);
        setFlow({
          kind: "ready",
          message:
            "The coordinator verified release for the persisted request digest.",
        });
      } else {
        setFlow({
          kind: "ready",
          message:
            "Funded settlement expiry was verified. Refund is now available.",
        });
      }
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function submitOutcome(phase: "claim" | "refund") {
    if (!quoted || !lifecycleRecord) return;
    if (
      (phase === "claim" && lifecycleRecord.state !== "claimable") ||
      (phase === "refund" && lifecycleRecord.state !== "refundable")
    )
      return;
    let current = lifecycleRecord;
    setFlow({
      kind: "working",
      phase,
      message: `Persisting ${phase} attempt before wallet submission…`,
    });
    try {
      const started = snapshotReadyExecution();
      if (
        started.providerIndex !== LOCALNET_PROVIDER_INDEX ||
        !recoveryContextMatches(lifecycleRecord, {
          account: started.address,
          chainId: started.chainId,
          providerIndex: started.providerIndex,
        })
      )
        throw new Error(
          "Select LOCAL and reconnect the bound wallet and chain first.",
        );
      const settlement = current.settlement;
      if (!settlement?.ticketAddress)
        throw new Error("Persisted settlement ticket identity is unavailable.");
      const ticketAddress = settlement.ticketAddress;
      current = await persistPreparingAttempt(current, phase);
      const provider = myFrontendProviders[LOCALNET_PROVIDER_INDEX];
      const payout = await runAuthorizedPayout(current, {
        authorize: authorizeLifecycle,
        submitWallet: async (authorized) => {
          current = authorized;
          return submitActions(
            started.account,
            provider,
            buildLocalnetIntentPayoutActions({
              operation: phase === "claim" ? "claim" : "timeout",
              escrowAddress: settlement.escrowAddress,
              recoveryAddress: started.address,
              ticketAddress,
              dealId: settlement.dealId,
              payoutToken:
                phase === "claim"
                  ? quoted.intent.buyToken
                  : quoted.intent.sellToken,
            }),
            {
              policy: () =>
                assertReadyExecutionUnchanged(started, "private-swap"),
              onSubmitted: async (transactionHash) => {
                current = updateRfqPhaseAttempt(
                  current,
                  phase,
                  "submitted-unknown",
                  Math.floor(Date.now() / 1_000),
                  { transactionHash },
                );
                await persistLifecycle(current);
              },
            },
          );
        },
      });
      const submitted = payout.result;
      if (current.attempts[phase]?.state === "preparing") {
        current = updateRfqPhaseAttempt(
          current,
          phase,
          "submitted-unknown",
          Math.floor(Date.now() / 1_000),
          { transactionHash: submitted.transactionHash },
        );
        await persistLifecycle(current);
      }
      current = await reconcileRecord(current);
      const expected = phase === "claim" ? "settled" : "refunded";
      if (current.state !== expected)
        throw new Error(
          `${phase} was not confirmed by exact local deal reconciliation.`,
        );
      setFlow({
        kind: "success",
        outcome: expected,
        message:
          phase === "claim"
            ? "Local demo escrow observation confirms the selected-maker claim."
            : "Local demo escrow observation confirms the timeout refund.",
        transactionHashes: [submitted.transactionHash],
      });
    } catch (error: unknown) {
      const attemptState = transactionStateFromError(error);
      const transactionHash = transactionHashFromError(error);
      if (attemptState === "reverted" && current.attempts[phase]) {
        current = updateRfqPhaseAttempt(
          current,
          phase,
          "reverted",
          Math.floor(Date.now() / 1_000),
          {
            ...(transactionHash ? { transactionHash } : {}),
            observation: `Wallet or chain reported a reverted ${phase} attempt.`,
          },
        );
        await persistLifecycle(current);
      } else if (
        transactionHash &&
        current.attempts[phase]?.state === "preparing"
      ) {
        current = updateRfqPhaseAttempt(
          current,
          phase,
          "submitted-unknown",
          Math.floor(Date.now() / 1_000),
          { transactionHash },
        );
        await persistLifecycle(current);
      }
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function verifyCurrentPhase() {
    if (!lifecycleRecord?.settlement) return;
    setFlow({
      kind: "working",
      phase: "lock",
      message:
        "Reading and binding the exact local deal; no action will be resubmitted…",
    });
    try {
      let next: RfqLifecycleRecord;
      if (lifecycleRecord.attempts.funding?.state === "preparing") {
        let recoveryRecord = lifecycleRecord;
        const attempt = recoveryRecord.attempts.funding;
        if (!recoveryRecord.settlement?.ticketAddress) {
          if (attempt?.target?.operation !== "funding-ticket")
            throw new Error(
              "The persisted funding ticket authorization is unavailable.",
            );
          const ticketContext = snapshotLocalnetRecoveryContext(recoveryRecord);
          const ticketRuntimeEpoch = localnetRuntimeEpoch();
          const ticket = await runAuthorizedTicketAcceptance(recoveryRecord, {
            authorize: authorizeLifecycle,
            accept: async () => undefined,
            beforeEnsureTicket: (authorized) => {
              assertLocalnetRecoveryContextUnchanged(ticketContext, authorized);
              if (localnetRuntimeEpoch() !== ticketRuntimeEpoch)
                throw new Error(
                  "The localnet runtime changed before ticket recovery.",
                );
            },
            ensureTicket: (authorized) => {
              const exactAttempt = authorized.attempts.funding;
              if (exactAttempt?.target?.operation !== "funding-ticket")
                throw new Error(
                  "The exact ticket-authorized funding attempt changed.",
                );
              return ensureLocalnetEscrowTicket({
                target: exactAttempt.target,
                attemptId: exactAttempt.attemptId,
              });
            },
          });
          recoveryRecord = ticket.authorized;
          recoveryRecord = reviseRfqLifecycle(recoveryRecord, {
            settlement: {
              ...recoveryRecord.settlement!,
              ticketAddress: ticket.result,
            },
            updatedAt: Math.floor(Date.now() / 1_000),
          });
          await persistLifecycle(recoveryRecord);
        }
        const started = snapshotLocalnetRecoveryContext(recoveryRecord);
        const recoveryRuntimeEpoch = localnetRuntimeEpoch();
        const assertRecoveryContext = (authorized: RfqLifecycleRecord) => {
          assertLocalnetRecoveryContextUnchanged(started, authorized);
          if (localnetRuntimeEpoch() !== recoveryRuntimeEpoch)
            throw new Error(
              "The localnet runtime changed before pre-wallet recovery.",
            );
        };
        const observed = await readLocalnetEscrowDeal(
          recoveryRecord.settlement!.dealId,
        );
        next = await recoverLocalnetPreparingFundingAfterEmptyObservation(
          recoveryRecord,
          observed,
          {
            abandonFunding: abandonLocalnetFunding,
            releaseRequestReservations: releaseLocalnetRfqReservations,
            persist: persistLifecycle,
            authorize: authorizeLifecycle,
            createAttemptId: createLocalnetIntentId,
            now: () => Math.floor(Date.now() / 1_000),
            beforeAbandon: assertRecoveryContext,
            beforeRelease: assertRecoveryContext,
          },
        );
      } else {
        next = await reconcileRecord(lifecycleRecord);
      }
      const converged = (next.latestObservation?.status ?? 0) > 0;
      setFlow({
        kind: "ready",
        message:
          next.state === "cancelled"
            ? "Exact status 0 proved funding was not entered; the coordinator tombstoned the attempt and released the request."
            : converged
              ? `Exact ${next.state} state was reconciled server-before-browser. No transaction was resubmitted.`
              : `Funding is still unknown after observing ${next.latestObservation?.stage ?? "no funded deal"}. Nothing was resubmitted.`,
      });
      if (
        next.attempts.funding?.state !== "preparing" &&
        next.attempts.funding?.state !== "submitted-unknown"
      ) {
        executionStartedRef.current = false;
        setExecutionLocked(false);
      }
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  function nextDeskPhase(record: RfqLifecycleRecord) {
    if (!lifecycleContextReady) {
      const blocked = localnetResumeDecision(
        record,
        Math.floor(Date.now() / 1_000),
      );
      return Object.freeze({
        ...blocked,
        disabled: true,
        reason:
          "Reconnect the exact account and wallet chain and select the LOCAL provider before recovery.",
      });
    }
    if (
      record.state === "funded" &&
      solverOutcome === "refund" &&
      quoted?.surface === "block"
    ) {
      return Object.freeze({
        action: "observe-expiry" as const,
        label: "Await and observe settlement expiry",
        reason:
          "The local fixture will advance to the bound deadline; refund stays disabled until expiry is observed.",
        disabled: false,
      });
    }
    const decision = localnetResumeDecision(
      record,
      Math.floor(Date.now() / 1_000),
    );
    if (
      decision.action === "request-maker-fill" ||
      decision.action === "retry-maker-fill"
    ) {
      const fillGate = gateRfqAction(
        operations,
        "fill",
        record.selectedQuote?.solverId,
      );
      if (!fillGate.allowed)
        return Object.freeze({
          ...decision,
          disabled: true,
          reason: fillGate.reason,
        });
    }
    return decision;
  }

  async function runNextPhaseAction() {
    if (!lifecycleRecord) return;
    const next = nextDeskPhase(lifecycleRecord);
    if (
      next.action === "verify-funding" ||
      next.action === "reconcile-fill" ||
      next.action === "reconcile-outcome"
    )
      return verifyCurrentPhase();
    if (next.action === "request-maker-fill") return requestMakerFill();
    if (next.action === "retry-maker-fill") return retryMakerFill();
    if (next.action === "observe-expiry") return observeExpiry();
    if (next.action === "verify-reservation-release")
      return verifyReservationRelease();
    if (next.action === "retry-reservation-release") return cancelRfq("cancel");
    if (next.action === "claim") return submitOutcome("claim");
    if (next.action === "refund") return submitOutcome("refund");
  }

  async function expireSelectedQuote(reason: string) {
    if (
      !lifecycleRecord ||
      (lifecycleRecord.state !== "quoted" &&
        lifecycleRecord.state !== "reviewing")
    )
      return;
    try {
      const released = await releasePreFundingRecord(lifecycleRecord);
      if (released.state === "cancelled") {
        setQuoted(null);
        setReviewing(false);
        setExecutionLocked(false);
        executionStartedRef.current = false;
        setFlow({
          kind: "ready",
          message: `${reason} Request reservations were released. Start another RFQ when ready.`,
        });
        return;
      }
      setReviewing(false);
      setExecutionLocked(true);
      setFlow({
        kind: "error",
        message: `${reason} Release is still pending; verify the same request reservation lease.`,
      });
    } catch (error: unknown) {
      setReviewing(false);
      setExecutionLocked(true);
      setFlow({
        kind: "error",
        message: `${reason} Release remains pending: ${errorMessage(error)}`,
      });
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
            <span>APP20 / PRIVATE RFQ</span>
            <h3 id="local-private-intent-title">
              {surface === "swap" ? "Instant RFQ" : "Block RFQ"}
            </h3>
          </div>
          <strong>{surface === "swap" ? "DAY-TO-DAY" : "INVENTORY RFQ"}</strong>
        </header>
      )}

      <aside className={styles.operationsGate} role="status">
        <strong>OPERATIONS · {operations.mode.toUpperCase()}</strong>
        <span>
          {operations.reason}{" "}
          {requestBlockedReason
            ? `New RFQs are blocked: ${requestBlockedReason}`
            : lifecycleRecord && !lifecycleContextReady
              ? "Recovery actions are blocked until the bound wallet, chain, and provider context is restored."
              : requestGate.allowed
                ? "New RFQs may proceed when no persisted market fence remains."
                : "New requests and funding are blocked; recovery availability depends on the bound lifecycle context."}
        </span>
        <Link to="/rfq/operations">Open browser-safe operations</Link>
      </aside>

      {swapOnly ? null : (
        <div
          className={styles.deskModeSwitch}
          role="group"
          aria-label="RFQ surface"
        >
          <button
            type="button"
            aria-pressed={surface === "swap"}
            disabled={Boolean(quoted)}
            onClick={() => setSurface("swap")}
          >
            Instant RFQ
          </button>
          <button
            type="button"
            aria-pressed={surface === "block"}
            disabled={Boolean(quoted)}
            onClick={() => setSurface("block")}
          >
            Block RFQ
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
            Open Block RFQ
          </button>
        </p>
      ) : null}
      {!swapOnly && !blockHint && surface === "block" && !quoted ? (
        <p className={styles.deskHint} role="status">
          This clip is small enough that an immediate invited-maker RFQ is
          usually faster.
          <button type="button" onClick={() => setSurface("swap")}>
            Open Instant RFQ
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
          <span>RFQ MARKET</span>
          <select
            aria-label="Private intent market"
            value={pairId}
            onChange={(event) => {
              selectPair(event.target.value as LocalnetMarketPairId);
            }}
            disabled={working || Boolean(quoted)}
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
                disabled={working || Boolean(quoted)}
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
            disabled={working || Boolean(quoted)}
          >
            ⇅
          </button>

          <label className={styles.swapAssetCard}>
            <span className={styles.swapAssetHead}>
              <b>{surface === "block" ? "Minimum receive" : "Buy"}</b>
              <small>
                {quoted ? "Selected signed quote" : "Quote required"}
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
                  disabled={working || Boolean(quoted)}
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
          <>
            <button
              type="button"
              disabled={working}
              onClick={() => {
                setSellAmount("");
                setMinBuyAmount("");
                setPrivacyConfirmed(false);
                setInvitationReview(null);
                setInvitationConfirmed(false);
                setFlow({ kind: "idle" });
              }}
            >
              Clear draft
            </button>
            <aside
              className={styles.privacyPreflight}
              aria-label="Privacy preflight"
            >
              <strong>PRIVACY PREFLIGHT</strong>
              <p>
                Check amount fingerprinting, denominations, note maturity,
                timing, maker disclosure, and first-version settlement leakage.
              </p>
              {privacyPreflight ? (
                <ul>
                  {privacyPreflight.findings.map((finding) => (
                    <li key={finding.id}>
                      <strong>{finding.level.toUpperCase()}</strong>{" "}
                      {finding.message}{" "}
                      <small>
                        Source: {finding.provenance}; freshness:{" "}
                        {finding.freshness}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status">
                  <strong>UNAVAILABLE</strong> Enter a valid exact sell amount
                  to build the preflight.
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={privacyConfirmed}
                  disabled={!privacyPreflight || working}
                  onChange={(event) => {
                    setPrivacyConfirmed(event.target.checked);
                    setInvitationReview(null);
                    setInvitationConfirmed(false);
                  }}
                />
                I understand the warnings and known public settlement leakage.
              </label>
            </aside>
            <button
              type="button"
              onClick={prepareInvitationReview}
              disabled={
                working ||
                !privacyReady ||
                !requestGate.allowed ||
                Boolean(requestBlockedReason)
              }
            >
              Prepare exact invitation review
            </button>
            {invitationReview ? (
              <aside
                className={styles.privacyPreflight}
                aria-label="Exact invitation review"
              >
                <strong>INVITATION REVIEW · BEFORE MAKER DISCLOSURE</strong>
                <dl>
                  <div>
                    <dt>Direction / policy</dt>
                    <dd>
                      {pair.label} · Full fill only ·{" "}
                      {
                        localnetEconomicReview({
                          pairId: pair.id,
                          sellAmount: invitationReview.sellAmount,
                          requestedFloor: invitationReview.minBuyAmount,
                          surface,
                        }).policyId
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Exact sell</dt>
                    <dd>
                      {invitationReview.sellAmount.toString()} base units ·{" "}
                      {pair.sell.address} · {pair.sell.decimals} decimals
                    </dd>
                  </div>
                  <div>
                    <dt>Exact floor</dt>
                    <dd>
                      {invitationReview.minBuyAmount.toString()} base units ·{" "}
                      {formatLocalnetTokenAmount(
                        invitationReview.minBuyAmount,
                        pair.buy,
                      )}{" "}
                      {pair.buy.symbol} · max 100 bps total reference deviation
                    </dd>
                  </div>
                  <div>
                    <dt>Registry</dt>
                    <dd>{APP20_TOKEN_REGISTRY_REVISION}</dd>
                  </div>
                  <div>
                    <dt>Planned maker cohort</dt>
                    <dd>
                      {invitationReview.cohort
                        .map(({ makerId, keyId }) => `${makerId} · ${keyId}`)
                        .join("; ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Directory binding</dt>
                    <dd>
                      epoch {invitationReview.directoryEpoch} · checkpoint{" "}
                      {invitationReview.directoryCheckpoint} · valid through{" "}
                      {new Date(
                        invitationReview.directoryValidUntil * 1_000,
                      ).toISOString()}{" "}
                      · snapshot <code>{invitationReview.cohortBinding}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>
                      {new Date(
                        invitationReview.createdAt * 1_000,
                      ).toISOString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Invitation / RFQ clock</dt>
                    <dd>
                      <RfqCountdown
                        expiresAt={invitationReview.expiresAt}
                        onExpire={() => {
                          setInvitationConfirmed(false);
                          setFlow({
                            kind: "error",
                            message:
                              "Invitation review expired. Prepare the exact terms again; no maker request was sent.",
                          });
                        }}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Fees before disclosure</dt>
                    <dd>
                      APP20 fee: 0 · pool fee, public fee balance, and gas
                      unavailable until fresh post-selection review
                    </dd>
                  </div>
                  <div>
                    <dt>Public facts</dt>
                    <dd>
                      legacy escrow pair, OPEN amounts, deadline, fees, helper
                      activity, and lifecycle timing become public during
                      settlement
                    </dd>
                  </div>
                </dl>
                <label>
                  <input
                    type="checkbox"
                    checked={invitationConfirmed}
                    disabled={working}
                    onChange={(event) =>
                      setInvitationConfirmed(event.target.checked)
                    }
                  />
                  I confirm these exact terms may be disclosed to the two named
                  fixture makers.
                </label>
              </aside>
            ) : null}
            {invitationReview && operations.status ? (
              <MakerCohortPanel
                makers={operations.status.makers}
                directory={operations.status.directory}
                governedMakerCount={operations.status.cohort.governed}
                now={preflightNow}
              />
            ) : null}
            {requestBlockedReason ? (
              <p role="alert">{requestBlockedReason}</p>
            ) : null}
            <button
              className={styles.privateIntentQuoteButton}
              type="button"
              onClick={() => void buildQuote()}
              disabled={
                working ||
                !privacyReady ||
                !invitationReview ||
                !invitationConfirmed ||
                !requestGate.allowed ||
                Boolean(requestBlockedReason)
              }
            >
              {working ? "Requesting…" : "Request signed quotes"}
            </button>
          </>
        )}
      </div>

      {quoted ? (
        <div
          className={styles.privateIntentQuote}
          aria-label="Selected private maker quote"
        >
          <div>
            <span>YOU RECEIVE</span>
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
            <span>PRIVATE RESPONSES</span>
            <strong>
              {quoted.quotes.length} VERIFIED{" "}
              {quoted.quotes.length === 1 ? "QUOTE" : "QUOTES"}
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
            ? ["Quote", "Lock", "Maker fill", "Claim"]
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
              Maker fills
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
        <section
          ref={quoteComparisonRef}
          tabIndex={-1}
          className={styles.quoteComparison}
          aria-labelledby="rfq-maker-comparison"
        >
          <h3 id="rfq-maker-comparison">
            Compare all makers ({quoted.quotes.length} verified{" "}
            {quoted.quotes.length === 1 ? "quote" : "quotes"})
          </h3>
          <p>
            Review every verified response, refusal, capacity state, and the
            deterministic selection rationale before continuing.
          </p>
          <QuoteComparison
            quotes={quoted.quotes}
            cohort={quoted.cohort}
            directory={quoted.directory}
            governedMakerCount={quoted.governedMakerCount}
            now={preflightNow}
            selectedReservationId={quoted.quote.reservationId}
            sellDecimals={quoted.pair.sell.decimals}
            buyDecimals={quoted.pair.buy.decimals}
            sellSymbol={quoted.pair.sell.symbol}
            buySymbol={quoted.pair.buy.symbol}
            onSelectedExpire={() => void expireSelectedQuote("Quote expired.")}
          />
        </section>
      ) : null}

      {quoted && !reviewing && lifecycleRecord?.state === "quoted" ? (
        <div>
          <button
            type="button"
            onClick={() => void cancelRfq("cancel")}
            disabled={working || !lifecycleContextReady}
          >
            Cancel RFQ and release reservations
          </button>
          <button
            type="button"
            onClick={() => void requote()}
            disabled={working || !lifecycleContextReady}
          >
            Request new quotes
          </button>
          <button
            className={styles.privateIntentExecute}
            type="button"
            disabled={!localnetReady || !lifecycleContextReady || working}
            onClick={() => void enterReview()}
          >
            Review selected quote
          </button>
        </div>
      ) : null}

      {quoted &&
      lifecycleRecord?.state === "expired" &&
      !lifecycleRecord.settlement ? (
        <button
          type="button"
          disabled={working || !lifecycleContextReady}
          onClick={() => void requote()}
        >
          Request fresh quotes
        </button>
      ) : null}

      {quoted && reviewing && lifecycleRecord?.state === "reviewing" ? (
        <RfqFinalReview
          terms={Object.freeze({
            ...finalReviewTerms(quoted),
            ...(lifecycleRecord.selectedQuote?.quoteDigest
              ? { quoteDigest: lifecycleRecord.selectedQuote.quoteDigest }
              : {}),
            ...(lifecycleRecord.selectedQuote?.reservationFence
              ? {
                  reservationFence: BigInt(
                    lifecycleRecord.selectedQuote.reservationFence,
                  ),
                }
              : {}),
          })}
          snapshot={reviewSnapshot ?? undefined}
          blockers={[
            ...(fundingGate.allowed ? [] : [fundingGate.reason]),
            ...(reviewSnapshot
              ? validateFinalReview({
                  initial: reviewSnapshot,
                  current: reviewSnapshot,
                  terms: finalReviewTerms(quoted),
                  now: preflightNow,
                }).blockers
              : ["Fresh final-review fee evidence is unavailable."]),
          ]}
          disabled={
            !localnetReady ||
            !lifecycleContextReady ||
            !fundingGate.allowed ||
            working ||
            executionLocked ||
            preflightNow >= quoted.quote.quoteExpiresAt ||
            preflightNow >= quoted.quote.reservationExpiresAt
          }
          declineDisabled={working || executionLocked || !lifecycleContextReady}
          onDecline={() => void cancelRfq("decline")}
          onAccept={() => void acceptAndFund()}
          onQuoteExpire={() => void expireSelectedQuote("Quote expired.")}
          onReservationExpire={() =>
            void expireSelectedQuote("Reservation expired.")
          }
          focusRef={finalReviewRef}
        />
      ) : null}

      {quoted &&
      lifecycleRecord &&
      [
        "cancel-pending",
        "submission-unknown",
        "funded",
        "filled",
        "claimable",
        "refundable",
      ].includes(lifecycleRecord.state) ? (
        <section aria-label="Persisted recovery phase">
          <h3>Next persisted localnet phase</h3>
          <RfqPhaseAction
            decision={nextDeskPhase(lifecycleRecord)}
            busy={working}
            onAction={
              lifecycleContextReady
                ? () => void runNextPhaseAction()
                : undefined
            }
          />
        </section>
      ) : null}

      {flow.kind === "refused" ? (
        <div className={styles.deskRefusal} role="alert">
          {latestCohort.length && invitationReview ? (
            <MakerCohortPanel
              makers={latestCohort}
              directory={Object.freeze({
                epoch: invitationReview.directoryEpoch,
                checkpoint: invitationReview.directoryCheckpoint,
                validUntil: invitationReview.directoryValidUntil,
              })}
              governedMakerCount={invitationReview.governedMakerCount}
              now={preflightNow}
            />
          ) : null}
          <strong>No private fill</strong>
          <p>{flow.message}</p>
          <p>
            Public-route swap is a separate action and is not enabled in this
            build. The RFQ was not published or routed elsewhere.
          </p>
          <button
            type="button"
            onClick={() => {
              setFlow({ kind: "idle" });
              setPrivacyConfirmed(false);
            }}
          >
            Start new RFQ
          </button>
        </div>
      ) : null}

      {localnetReady ? null : (
        <p className={styles.privateIntentHint}>
          Select LOCAL in the header and connect Localnet (dev) to request and
          settle private maker quotes.
        </p>
      )}
      {flow.kind === "working" ||
      flow.kind === "ready" ||
      flow.kind === "error" ? (
        <p
          className={`${styles.privateIntentStatus} ${flow.kind === "error" ? styles.privateIntentError : ""}`}
          role={flow.kind === "error" ? "alert" : "status"}
        >
          {flow.message}
        </p>
      ) : null}
      {flow.kind === "ready" &&
      !quoted &&
      flow.message.includes("Start another RFQ") ? (
        <button type="button" onClick={() => setFlow({ kind: "idle" })}>
          Start another RFQ
        </button>
      ) : null}
      {flow.kind === "success" && quoted ? (
        <div className={styles.privateIntentSuccess} role="status">
          <div>
            <strong>{flow.message}</strong>
            <span>
              {flow.transactionHashes.length} local transaction references
              recorded
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
              <dt>
                {flow.outcome === "settled"
                  ? "RECEIVED (LOCALLY OBSERVED)"
                  : "REFUNDED (LOCALLY OBSERVED)"}
              </dt>
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
              <dd>
                {flow.transactionHashes.length} local references · this browser
                watched the local devnet; no configured-chain verifier confirmed
                it
              </dd>
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
          <button type="button" onClick={invalidateQuote}>
            Start another RFQ
          </button>
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
          ? "Request-scoped signed invited-maker quotes only. A refusal never falls through to a public venue."
          : "Swap and Block solicit request-scoped signed quotes from 2 localnet fixture makers without publishing an order book. Invited makers learn the exact pair, side, size, floor, and expiry. Loopback timing and fanout remain observable; quote responses are plain signed JSON. Legacy localnet escrow events and OPEN payout-note amounts remain public and are not production settlement authority."}
      </p>
    </section>
  );
}
