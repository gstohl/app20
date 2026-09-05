"use client";

import {
  bucketForAmount,
  formatSizeBucketLabel,
  type SizeBucket,
} from "@app20/private-intents";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  useLocalnetNoteMaturity,
  type LocalnetNoteMaturityState,
} from "@/app/use-localnet-note-maturity";
import { feltEquals } from "@/lib/addresses";
import {
  consumeDeskHandoff,
  consumeInvoiceDeskHandoff,
  storeDeskHandoff,
  type InvoiceDeskHandoff,
} from "@/lib/desk-handoff";
import {
  deskLeakChips,
  deskVenueCopy,
  suggestsBlockSurface,
  type DeskSurface,
  type DeskVenue,
} from "@/lib/desk-disclosure";
import {
  canProceedFromPrivacyPreflight,
  evaluatePrivacyPreflight,
} from "@/lib/privacy-preflight";
import {
  APP20_TOKEN_REGISTRY_REVISION,
  configuredMarketPair,
} from "@/lib/token-registry";
import {
  describeNoteMaturity,
  type NoteMaturityStatus,
} from "@/lib/note-maturity";
import { recordInvoiceTakeSettled } from "@/lib/otc";
import {
  addrSTRK,
  escrowHelperLocalnet,
  LOCALNET_PROVIDER_INDEX,
  localnetUsdcToken,
} from "@/utils/constants";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { validateAndParseAddress } from "starknet";
import {
  createLocalnetIntentId,
  formatLocalnetTokenAmount,
  parseLocalnetTokenAmount,
  postSelectionTranscript,
  readLocalnetRfqOperationsStatus,
  requestQuotesV3,
  type LocalnetMarketToken,
  type LocalnetQuoteRefusalV3,
  type LocalnetTranscriptAcknowledgement,
  type LocalnetV3Cohort,
} from "./localnet-private-intents";
import MakerCohortPanel from "./MakerCohortPanel";
import RfqInfoTip from "./RfqInfoTip";
import {
  gateRfqAction,
  localnetEconomicReview,
  operationsAvailability,
} from "./rfq-operations";
import { useRfqOperations } from "./use-rfq-operations";
import styles from "./rfq.module.css";
import QuoteComparison from "./QuoteComparison";
import RfqFinalReview, {
  type RfqFinalReviewV3DisplayTerms,
} from "./RfqFinalReview";
import {
  takeAuthorizationFromLifecycle,
  validateV3FinalReview,
  type RfqFinalReviewSnapshot,
} from "./rfq-final-review";
import {
  createRfqLifecycleRecord,
  recordRfqV3TranscriptAcknowledgements,
  transitionRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import RfqAuthorityStrip from "./RfqAuthorityStrip";
import SettlementEvidencePanel from "./SettlementEvidencePanel";
import {
  assertQuoteProgressMayPersist,
  createLocalnetQuoteRequestRegistry,
  decideLocalnetQuoteRequestFailure,
  type LocalnetQuoteRequestHandle,
} from "./localnet/quote-request-controller";
import { createLocalnetRfqStorageClient } from "./localnet/rfq-storage-client";
import { RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE } from "./rfq-quote-scope";
import {
  createV3Request,
  v3RequestMaturityGate,
  type CreatedV3Request,
} from "./rfq-v3-request";
import { createV3Selection, type V3SelectionResult } from "./rfq-v3-selection";
import {
  estimateInvoiceSellSize,
  sizeInvoiceFromSelectedFills,
} from "./rfq-v3-invoice";
import {
  executeLocalnetV3Take,
  readV3FinalReviewSnapshot,
  verifyLocalnetV3Take,
  type V3TakeExecutionResult,
} from "./ui/v3-take-controller";
import { requestRfqHistoryAutoBackup } from "./ui/rfq-auto-backup";

export type LocalnetMarketPairId = "STRK_USDC" | "USDC_STRK";

export type LocalnetPrivateIntentDeskProps = Readonly<{
  initialPairId?: LocalnetMarketPairId;
  swapOnly?: boolean;
  onPairChange?: (pairId: LocalnetMarketPairId) => void;
  onLifecycleRecord?: (record: RfqLifecycleRecord) => void;
  requestBlockedReason?: string;
}>;

const RFQ_PRIVACY_BRIEFING_STORAGE_KEY = "app20:rfq:privacy-briefing";
const RFQ_PRIVACY_BRIEFING_REVISION = "rfq-v3-observability-briefing:1";

type MarketPair = Readonly<{
  id: LocalnetMarketPairId;
  label: string;
  sell: LocalnetMarketToken;
  buy: LocalnetMarketToken;
  defaultSellAmount: string;
  defaultMinBuyAmount: string;
}>;

type InvitationReview = Readonly<{
  createdAt: number;
  exactSellAmount: bigint;
  localFloor: bigint;
  bucket: SizeBucket;
  cohort: LocalnetV3Cohort;
  governedMakerCount: number;
}>;

type QuotedV3 = Readonly<{
  created: CreatedV3Request;
  selection: V3SelectionResult;
  refusals: readonly LocalnetQuoteRefusalV3[];
  pair: MarketPair;
  surface: DeskSurface;
  exactSellAmount: bigint;
  localFloor: bigint;
  transcriptAcknowledgements: readonly LocalnetTranscriptAcknowledgement[];
}>;

type FlowState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "working" | "waiting" | "ready"; message: string }>
  | Readonly<{
      kind: "submission-unknown" | "reverted" | "settled";
      message: string;
      transactionHash?: string;
    }>
  | Readonly<{ kind: "refused" | "error"; message: string }>;

function marketPairs(): Record<LocalnetMarketPairId, MarketPair> {
  const configured = configuredMarketPair("localnet");
  const strk: LocalnetMarketToken = configured.ok
    ? configured.pair.tokenA
    : { symbol: "STRK", address: addrSTRK, decimals: 18 };
  const usdc: LocalnetMarketToken = configured.ok
    ? configured.pair.tokenB
    : { symbol: "USDC", address: localnetUsdcToken, decimals: 6 };
  return {
    STRK_USDC: Object.freeze({
      id: "STRK_USDC",
      label: "STRK → USDC",
      sell: strk,
      buy: usdc,
      defaultSellAmount: "0.1",
      defaultMinBuyAmount: "0.198",
    }),
    USDC_STRK: Object.freeze({
      id: "USDC_STRK",
      label: "USDC → STRK",
      sell: usdc,
      buy: strk,
      defaultSellAmount: "0.1",
      defaultMinBuyAmount: "0.0495",
    }),
  };
}

function surfaceFromHash(hash: string): DeskSurface {
  const value = hash.replace(/^#/, "");
  return value === "desk" || value === "block" ? "block" : "swap";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The local private RFQ failed.";
}

function randomDigest(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const digest = `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  bytes.fill(0);
  return digest;
}

function cohortFromStatus(
  status: NonNullable<ReturnType<typeof useRfqOperations>["status"]>,
): LocalnetV3Cohort {
  const makers = Object.freeze(
    status.makers.map(({ makerId, keyId }) =>
      Object.freeze({ makerId, keyId }),
    ),
  );
  return Object.freeze({
    epoch: status.directory.epoch,
    checkpoint: status.directory.checkpoint,
    validUntil: status.directory.validUntil,
    makers,
    binding: [
      status.schema,
      status.directory.epoch,
      status.directory.checkpoint,
      status.directory.validUntil,
      ...makers.flatMap(({ makerId, keyId }) => [makerId, keyId]),
    ].join("|"),
  });
}

function sameCohort(left: LocalnetV3Cohort, right: LocalnetV3Cohort): boolean {
  return (
    left.epoch === right.epoch &&
    left.checkpoint === right.checkpoint &&
    // The status capability refreshes its deadline on every browser-safe read.
    // Membership changes invalidate review; a later expiry for the same named
    // checkpoint does not. The server still validates the reviewed binding and
    // rejects it once its own original validUntil has passed.
    left.makers.length === right.makers.length &&
    left.makers.every(
      (maker, index) =>
        maker.makerId === right.makers[index]?.makerId &&
        maker.keyId === right.makers[index]?.keyId,
    )
  );
}

function maturityLine(
  state: LocalnetNoteMaturityState,
  token: string,
): ReactNode {
  if (state.kind !== "ready") {
    return state.kind === "error"
      ? state.message
      : "Reading public pool deposit events…";
  }
  const pending = state.status.pending
    .filter(({ deposit }) => feltEquals(deposit.token, token))
    .sort(
      (left, right) => right.deposit.blockNumber - left.deposit.blockNumber,
    )[0];
  if (pending) {
    return `Notes from your latest shield mature at block ${pending.matureAtBlock} (${pending.blocksRemaining} block${pending.blocksRemaining === 1 ? "" : "s"} left).`;
  }
  return describeNoteMaturity({
    ...state.status,
    mature: Object.freeze(
      state.status.mature.filter((deposit) => feltEquals(deposit.token, token)),
    ),
    pending: Object.freeze([]),
    allMatureAtBlock: null,
  });
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
  const pairs = useMemo(() => marketPairs(), []);
  const [pairId, setPairId] = useState<LocalnetMarketPairId>(initialPairId);
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
  const [privacyBriefingLoaded, setPrivacyBriefingLoaded] = useState(false);
  const [privacyBriefingAccepted, setPrivacyBriefingAccepted] = useState(false);
  const [showPrivacyBriefing, setShowPrivacyBriefing] = useState(false);
  const [invitationReview, setInvitationReview] =
    useState<InvitationReview | null>(null);
  const [invitationConfirmed, setInvitationConfirmed] = useState(false);
  const [quoted, setQuoted] = useState<QuotedV3 | null>(null);
  const [lifecycleRecord, setLifecycleRecord] =
    useState<RfqLifecycleRecord | null>(null);
  const [reviewSnapshot, setReviewSnapshot] =
    useState<RfqFinalReviewSnapshot | null>(null);
  const [reviewSnapshotError, setReviewSnapshotError] = useState<string>();
  const [showFinalReview, setShowFinalReview] = useState(false);
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  const [waitForMaturity, setWaitForMaturity] = useState(false);
  const [counterparty, setCounterparty] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDeskHandoff | null>(null);
  const [invoiceEstimateReady, setInvoiceEstimateReady] = useState(false);
  const [preflightObservedAt] = useState(() => Math.floor(Date.now() / 1_000));
  const [preflightNow, setPreflightNow] = useState(preflightObservedAt);
  const operations = useRfqOperations();
  const requestGate = gateRfqAction(operations, "request");
  const takeGate = gateRfqAction(operations, "take");
  const privacyBriefingDialogRef = useRef<HTMLDialogElement>(null);
  const quoteComparisonRef = useRef<HTMLElement>(null);
  const finalReviewRef = useRef<HTMLElement>(null);
  const quoteFocusPendingRef = useRef(false);
  const maturityTimerRef = useRef<number | undefined>(undefined);
  const consumedScopeRef = useRef<string | undefined>(undefined);
  const quoteRequestsRef = useRef(
    createLocalnetQuoteRequestRegistry({
      account: address,
      chainId: chain,
      providerIndex,
    }),
  );
  const rfqStorageClientRef = useRef(createLocalnetRfqStorageClient());
  quoteRequestsRef.current.setCurrentScope({
    account: address,
    chainId: chain,
    providerIndex,
  });

  const localnetReady = Boolean(
    connected && address && chain && providerIndex === LOCALNET_PROVIDER_INDEX,
  );
  const { maturity, refresh: refreshNoteMaturity } = useLocalnetNoteMaturity({
    enabled: localnetReady,
    address,
  });
  const working = flow.kind === "working" || flow.kind === "waiting";
  const surface: DeskSurface = invoice
    ? "swap"
    : swapOnly
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

  const exactDraft = useMemo(() => {
    try {
      return parseLocalnetTokenAmount(sellAmount, pair.sell);
    } catch {
      return null;
    }
  }, [pair.sell, sellAmount]);

  const economics = useMemo(() => {
    if (exactDraft === null) return null;
    try {
      if (invoice) {
        return Object.freeze({
          reviewedFloor: BigInt(invoice.targetBuyBaseUnits),
        });
      }
      return localnetEconomicReview({
        pairId: pair.id,
        sellAmount: exactDraft,
        surface,
        ...(surface === "block"
          ? {
              requestedFloor: parseLocalnetTokenAmount(minBuyAmount, pair.buy),
            }
          : {}),
      });
    } catch {
      return null;
    }
  }, [exactDraft, invoice, minBuyAmount, pair, surface]);

  const draftBucket = useMemo(() => {
    if (exactDraft === null) return null;
    try {
      return bucketForAmount(pair.sell.symbol, exactDraft);
    } catch {
      return null;
    }
  }, [exactDraft, pair.sell.symbol]);

  const denominationAlternativeLabel = useMemo(() => {
    if (exactDraft === null) return null;
    return [exactDraft / 2n, exactDraft * 2n]
      .filter((amount) => amount > 0n)
      .map(
        (amount) =>
          `${formatLocalnetTokenAmount(amount, pair.sell)} ${pair.sell.symbol}`,
      )
      .join(" or ");
  }, [exactDraft, pair.sell]);

  const privacyPreflight = useMemo(() => {
    if (exactDraft === null) return null;
    const stamp = {
      observedAt: preflightObservedAt,
      validUntil: preflightObservedAt + 24 * 60 * 60,
    };
    return evaluatePrivacyPreflight({
      amount: exactDraft,
      asset: pair.sell.symbol,
      network: "starknet:APP20_LOCALNET",
      now: preflightNow,
      denominationAlternatives: {
        ...stamp,
        provenance: "app20-client-denomination-policy:v1",
        amounts: [exactDraft / 2n, exactDraft * 2n].filter(
          (value) => value > 0n,
        ),
      },
      invitedMakerDisclosure: {
        ...stamp,
        provenance: "app20-localnet-maker-directory:v3",
        makerCount: operations.status?.cohort.governed ?? 2,
        disclosedFields: ["pair", "side", "size bucket", "expiry"],
      },
      publicSettlementLeakage: {
        ...stamp,
        provenance: "app20-escrow-v3-disclosure:v1",
        publicFields: [
          "pair",
          "per-lock Take amounts",
          "lock deadline",
          "OPEN payout-note amount",
          "helper activity",
        ],
      },
    });
  }, [
    exactDraft,
    operations.status?.cohort.governed,
    pair.sell.symbol,
    preflightNow,
    preflightObservedAt,
  ]);
  const privacyReady = Boolean(
    privacyPreflight &&
    canProceedFromPrivacyPreflight(privacyPreflight, privacyBriefingAccepted),
  );

  useEffect(() => {
    const synchronizeBriefing = () => {
      let accepted = false;
      try {
        accepted =
          window.localStorage.getItem(RFQ_PRIVACY_BRIEFING_STORAGE_KEY) ===
          RFQ_PRIVACY_BRIEFING_REVISION;
      } catch {
        // Storage denial keeps the briefing current-session only.
      }
      setPrivacyBriefingAccepted(accepted);
      setPrivacyBriefingLoaded(true);
      setShowPrivacyBriefing(!accepted);
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === RFQ_PRIVACY_BRIEFING_STORAGE_KEY
      ) {
        synchronizeBriefing();
      }
    };
    synchronizeBriefing();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  /* The briefing opens in the flow of the ticket, not as a modal: a modal made
     the whole page inert, wallet picker and navigation included, for anyone
     who had only passed through the route. The ticket's own actions stay
     disabled until it is acknowledged, which is the gate that matters. The
     first showing also waits for a connected wallet, since nothing can be
     sent before one; a later review of an accepted briefing opens on request. */
  const briefingCanOpen = connected || privacyBriefingAccepted;
  useEffect(() => {
    const dialog = privacyBriefingDialogRef.current;
    if (!dialog) return;
    if (showPrivacyBriefing && briefingCanOpen && !dialog.open) {
      dialog.show();
    } else if (!showPrivacyBriefing && dialog.open) {
      dialog.close();
    }
  }, [showPrivacyBriefing, briefingCanOpen]);

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

  useEffect(() => {
    const nextPair = pairs[initialPairId];
    setPairId(initialPairId);
    setSellAmount(nextPair.defaultSellAmount);
    setMinBuyAmount(nextPair.defaultMinBuyAmount);
    resetRequestView();
  }, [initialPairId, pairs]);

  useEffect(() => {
    const invalidated = quoteRequestsRef.current.invalidateIfScopeChanged();
    if (invalidated) {
      resetRequestView();
      setFlow({
        kind: "error",
        message: RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE,
      });
    }
  }, [address, chain, providerIndex]);

  useEffect(
    () => () => {
      quoteRequestsRef.current.cancelActive();
      if (maturityTimerRef.current !== undefined) {
        window.clearTimeout(maturityTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!quoted || showFinalReview || !quoteFocusPendingRef.current) return;
    quoteComparisonRef.current?.focus();
    quoteFocusPendingRef.current = false;
  }, [quoted, showFinalReview]);

  useEffect(() => {
    if (showFinalReview) finalReviewRef.current?.focus();
  }, [showFinalReview]);

  useEffect(() => {
    if (!address || !chain) return;
    const scope = `${chain}:${address.toLowerCase()}`;
    if (consumedScopeRef.current === scope) return;
    consumedScopeRef.current = scope;
    const invoiceHandoff = consumeInvoiceDeskHandoff(window.sessionStorage, {
      account: address,
      chainId: chain,
    });
    if (
      invoiceHandoff &&
      feltEquals(invoiceHandoff.buyToken, localnetUsdcToken)
    ) {
      setInvoice(invoiceHandoff);
      setInvoiceEstimateReady(false);
      setPairId("STRK_USDC");
      onPairChange?.("STRK_USDC");
    } else {
      setInvoice(null);
      setInvoiceEstimateReady(false);
    }
    const contact = consumeDeskHandoff(window.sessionStorage, "rfq", {
      account: address,
      chainId: chain,
    });
    if (!contact) {
      setCounterparty(null);
      return;
    }
    try {
      setCounterparty(validateAndParseAddress(contact));
    } catch {
      setCounterparty(null);
    }
  }, [address, chain, onPairChange]);

  useEffect(() => {
    if (
      !invoice ||
      invoiceEstimateReady ||
      quoted ||
      !operations.midAggregate ||
      operations.midAggregate.count === 0 ||
      operations.midAggregate.medianE18 <= 0n
    ) {
      return;
    }
    try {
      const estimate = estimateInvoiceSellSize({
        targetBuyBaseUnits: BigInt(invoice.targetBuyBaseUnits),
        medianMidE18: operations.midAggregate.medianE18,
      });
      setSellAmount(
        formatLocalnetTokenAmount(
          estimate.estimatedSellAmount,
          pairs.STRK_USDC.sell,
        ),
      );
      setMinBuyAmount(
        formatLocalnetTokenAmount(
          BigInt(invoice.targetBuyBaseUnits),
          pairs.STRK_USDC.buy,
        ),
      );
      setInvitationReview(null);
      setInvitationConfirmed(false);
      setInvoiceEstimateReady(true);
    } catch (error: unknown) {
      setInvoiceEstimateReady(false);
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }, [invoice, invoiceEstimateReady, operations.midAggregate, pairs, quoted]);

  function rfqStorage() {
    return rfqStorageClientRef.current.current();
  }

  async function persistLifecycle(
    record: RfqLifecycleRecord,
    request?: LocalnetQuoteRequestHandle,
  ): Promise<RfqLifecycleRecord> {
    assertQuoteProgressMayPersist(request, quoteRequestsRef.current, record);
    await rfqStorage().save(record);
    assertQuoteProgressMayPersist(request, quoteRequestsRef.current, record);
    setLifecycleRecord(record);
    onLifecycleRecord?.(record);
    return record;
  }

  async function authorizeLifecycle(
    record: RfqLifecycleRecord,
  ): Promise<RfqLifecycleRecord> {
    const authorized = await rfqStorage().authorize(record);
    setLifecycleRecord(authorized);
    onLifecycleRecord?.(authorized);
    return authorized;
  }

  function cancelMaturityTimer() {
    if (maturityTimerRef.current !== undefined) {
      window.clearTimeout(maturityTimerRef.current);
      maturityTimerRef.current = undefined;
    }
    setWaitForMaturity(false);
  }

  function resetRequestView() {
    cancelMaturityTimer();
    setQuoted(null);
    setLifecycleRecord(null);
    setReviewSnapshot(null);
    setReviewSnapshotError(undefined);
    setShowFinalReview(false);
    setInvitationReview(null);
    setInvitationConfirmed(false);
    setFlow({ kind: "idle" });
  }

  function selectPair(nextId: LocalnetMarketPairId) {
    if (invoice) return;
    const next = pairs[nextId];
    setPairId(nextId);
    setSellAmount(next.defaultSellAmount);
    setMinBuyAmount(next.defaultMinBuyAmount);
    resetRequestView();
    onPairChange?.(nextId);
  }

  function setSurface(next: DeskSurface) {
    if (quoted || swapOnly || invoice) return;
    setInvitationReview(null);
    setInvitationConfirmed(false);
    void navigate({
      to: "/rfq",
      hash: next === "block" ? "desk" : "swap",
    });
  }

  function acceptPrivacyBriefing() {
    try {
      window.localStorage.setItem(
        RFQ_PRIVACY_BRIEFING_STORAGE_KEY,
        RFQ_PRIVACY_BRIEFING_REVISION,
      );
    } catch {
      // The current session may proceed, but the next page load asks again.
    }
    setPrivacyBriefingAccepted(true);
    setPrivacyBriefingLoaded(true);
    setShowPrivacyBriefing(false);
  }

  function exactAndFloor(): { exact: bigint; floor: bigint } {
    const exact = parseLocalnetTokenAmount(sellAmount, pair.sell);
    if (invoice) {
      return { exact, floor: BigInt(invoice.targetBuyBaseUnits) };
    }
    const review = localnetEconomicReview({
      pairId: pair.id,
      sellAmount: exact,
      surface,
      ...(surface === "block"
        ? {
            requestedFloor: parseLocalnetTokenAmount(minBuyAmount, pair.buy),
          }
        : {}),
    });
    return { exact, floor: review.reviewedFloor };
  }

  function prepareInvitationReview() {
    try {
      if (!operations.status || !requestGate.allowed) {
        throw new Error("A fresh planned maker cohort is unavailable.");
      }
      if (invoice && !invoiceEstimateReady) {
        throw new Error(
          "A verified maker median is required before sizing this invoice RFQ.",
        );
      }
      const { exact, floor } = exactAndFloor();
      const reviewedBucket = bucketForAmount(pair.sell.symbol, exact);
      setInvitationReview(
        Object.freeze({
          createdAt: Math.floor(Date.now() / 1_000),
          exactSellAmount: exact,
          localFloor: floor,
          bucket: reviewedBucket,
          cohort: cohortFromStatus(operations.status),
          governedMakerCount: operations.status.cohort.governed,
        }),
      );
      setInvitationConfirmed(false);
      setFlow({ kind: "idle" });
    } catch (error: unknown) {
      setInvitationReview(null);
      setInvitationConfirmed(false);
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function selectionForRequest(input: {
    created: CreatedV3Request;
    quotes: Awaited<ReturnType<typeof requestQuotesV3>>;
    exactSellAmount: bigint;
    localFloor: bigint;
    now: number;
  }): Promise<
    Readonly<{ result: V3SelectionResult; exactSellAmount: bigint }>
  > {
    let exactSellAmount = input.exactSellAmount;
    let invoiceFloorApplied = !invoice;
    let result = await createV3Selection({
      rfq: input.created.rfq,
      quotes: input.quotes.quotes,
      refusals: input.quotes.refusals,
      exactSellAmount,
      // Invoice sizing first needs verified schedule depth. The invoice target
      // is enforced immediately after deriving the minimum in-bucket sell.
      localFloor: invoice ? 0n : input.localFloor,
      now: input.now,
    });
    if (!invoice) return Object.freeze({ result, exactSellAmount });
    for (let iteration = 0; iteration < 4; iteration += 1) {
      if (result.selection.kind !== "selected") break;
      const sized = sizeInvoiceFromSelectedFills({
        targetBuyBaseUnits: BigInt(invoice.targetBuyBaseUnits),
        selection: result.selection,
        bucket: input.created.bucket,
      });
      if (sized.exactSellAmount === exactSellAmount && invoiceFloorApplied) {
        break;
      }
      exactSellAmount = sized.exactSellAmount;
      invoiceFloorApplied = true;
      result = await createV3Selection({
        rfq: input.created.rfq,
        quotes: input.quotes.quotes,
        refusals: input.quotes.refusals,
        exactSellAmount,
        localFloor: input.localFloor,
        now: input.now,
      });
    }
    return Object.freeze({ result, exactSellAmount });
  }

  async function refreshReviewSnapshot(record: RfqLifecycleRecord) {
    setReviewSnapshotError(undefined);
    try {
      setReviewSnapshot(await readV3FinalReviewSnapshot(record));
    } catch (error: unknown) {
      setReviewSnapshot(null);
      setReviewSnapshotError(errorMessage(error));
    }
  }

  async function deliverTranscript(
    nextQuoted: Omit<QuotedV3, "transcriptAcknowledgements">,
    quotedRecord: RfqLifecycleRecord,
    request?: LocalnetQuoteRequestHandle,
  ) {
    const acknowledgements = await postSelectionTranscript({
      account: quotedRecord.account,
      chainId: quotedRecord.chainId,
      rfqDigest: nextQuoted.selection.transcript.rfqDigest,
      transcript: nextQuoted.selection.transcript,
    });
    let current = recordRfqV3TranscriptAcknowledgements(
      quotedRecord,
      acknowledgements,
      Math.floor(Date.now() / 1_000),
    );
    current = transitionRfqLifecycle(
      current,
      "reviewing",
      Math.floor(Date.now() / 1_000),
    );
    current = await persistLifecycle(current, request);
    setQuoted(
      Object.freeze({
        ...nextQuoted,
        transcriptAcknowledgements: acknowledgements,
      }),
    );
    await refreshReviewSnapshot(current);
    setFlow({
      kind: "ready",
      message:
        "Every invited maker received the fair-loss transcript. Review the exact atomic fills before Take.",
    });
  }

  async function runQuoteRequest(maturityOverride?: NoteMaturityStatus) {
    if (!address || !chain) {
      setFlow({
        kind: "error",
        message: "The connected wallet context is unavailable.",
      });
      return;
    }
    const maturityStatus =
      maturityOverride ?? (maturity.kind === "ready" ? maturity.status : null);
    if (!maturityStatus) {
      setFlow({
        kind: "error",
        message:
          "The chain-derived note maturity estimate is unavailable. Retry the public event read before requesting quotes.",
      });
      return;
    }
    const gate = v3RequestMaturityGate(maturityStatus, pair.sell.address);
    if (!gate.ready) {
      setWaitForMaturity(true);
      setFlow({
        kind: "waiting",
        message: `The latest matching deposit matures at block ${gate.matureAtBlock} (${gate.blocksRemaining} blocks left). Choose Request quotes when mature to keep checking locally.`,
      });
      return;
    }
    const request = quoteRequestsRef.current.start({
      account: address,
      chainId: chain,
      providerIndex,
    });
    let requestingRecord: RfqLifecycleRecord | undefined;
    setFlow({
      kind: "working",
      message:
        "Requesting collateralized schedules from the confirmed maker cohort…",
    });
    try {
      if (requestBlockedReason) throw new Error(requestBlockedReason);
      if (!privacyReady) {
        throw new Error(
          "Complete the one-time privacy briefing before requesting quotes.",
        );
      }
      if (!invitationReview || !invitationConfirmed) {
        throw new Error("Confirm the size-blind maker cohort review first.");
      }
      if (invoice && !invoiceEstimateReady) {
        throw new Error(
          "A verified maker median is required before sizing this invoice RFQ.",
        );
      }
      if (!localnetReady) {
        throw new Error(
          "Select LOCAL and connect Localnet (dev) before requesting quotes.",
        );
      }
      const freshStatus = await readLocalnetRfqOperationsStatus();
      quoteRequestsRef.current.assertActive(request);
      const freshAvailability = operationsAvailability(
        freshStatus,
        Math.floor(Date.now() / 1_000),
      );
      const freshGate = gateRfqAction(freshAvailability, "request");
      if (!freshGate.allowed) throw new Error(freshGate.reason);
      const freshCohort = cohortFromStatus(freshStatus);
      if (!sameCohort(freshCohort, invitationReview.cohort)) {
        throw new Error(
          "The maker cohort changed after review. Prepare and confirm it again.",
        );
      }
      const { exact, floor } = exactAndFloor();
      if (
        exact !== invitationReview.exactSellAmount ||
        floor !== invitationReview.localFloor
      ) {
        throw new Error(
          "Local RFQ terms changed after cohort review. Prepare them again.",
        );
      }
      const now = Math.floor(Date.now() / 1_000);
      const created = createV3Request({
        exactSellAmount: exact,
        floor,
        tokens: {
          sellSymbol: pair.sell.symbol,
          sellToken: pair.sell.address,
          buyToken: pair.buy.address,
        },
        rfqId: randomDigest(),
        rfqFelt: createLocalnetIntentId(),
        chainId: "starknet:APP20_LOCALNET",
        registryRevision: APP20_TOKEN_REGISTRY_REVISION,
        directoryEpoch: freshStatus.directory.epoch,
        settlementHelper: escrowHelperLocalnet,
        createdAt: now,
      });
      const requestingTerms = Object.freeze({
        pairId: pair.id,
        sellSymbol: pair.sell.symbol,
        sellAddress: pair.sell.address,
        sellDecimals: pair.sell.decimals,
        sellAmount: exact.toString(),
        buySymbol: pair.buy.symbol,
        buyAddress: pair.buy.address,
        buyDecimals: pair.buy.decimals,
        minBuyAmount: floor.toString(),
        rfqExpiresAt: created.rfq.expiresAt,
      });
      requestingRecord = createRfqLifecycleRecord({
        mode: "v3",
        chainId: chain,
        account: address,
        rfqId: created.rfq.rfqFelt,
        state: "requesting",
        now,
        requestDigest: created.rfq.rfqId,
        // Invoice sell size is only an indicative-mid estimate until signed
        // schedules arrive. Do not persist it as immutable exact terms.
        ...(invoice ? {} : { terms: requestingTerms }),
        bucket: {
          min: created.bucket.min.toString(),
          max: created.bucket.max.toString(),
        },
        takerCommitment: created.takerCommitment,
        takerSigningKey: created.takerSigningKey,
      });
      requestingRecord = await persistLifecycle(requestingRecord, request);
      const response = await requestQuotesV3({
        account: requestingRecord.account,
        chainId: requestingRecord.chainId,
        rfq: created.rfq,
        cohort: freshCohort,
        signal: request.signal,
      });
      quoteRequestsRef.current.assertActive(request);
      const selected = await selectionForRequest({
        created,
        quotes: response,
        exactSellAmount: exact,
        localFloor: floor,
        now: Math.floor(Date.now() / 1_000),
      });
      quoteRequestsRef.current.assertActive(request);
      const nextQuotedBase = Object.freeze({
        created,
        selection: selected.result,
        refusals: response.refusals,
        pair,
        surface,
        exactSellAmount: selected.exactSellAmount,
        localFloor: floor,
      });
      quoteFocusPendingRef.current = true;
      if (selected.result.selection.kind !== "selected") {
        let refused = transitionRfqLifecycle(
          requestingRecord,
          "refused",
          Math.floor(Date.now() / 1_000),
          {
            reason: `Local selection refused: ${selected.result.selection.reason}.`,
          },
        );
        refused = await persistLifecycle(refused, request);
        let acknowledgements: readonly LocalnetTranscriptAcknowledgement[] = [];
        try {
          acknowledgements = await postSelectionTranscript({
            rfqDigest: selected.result.transcript.rfqDigest,
            transcript: selected.result.transcript,
          });
        } catch {
          // Selection is already refused; transcript delivery failure is shown
          // but can never enable a Take.
        }
        setQuoted(
          Object.freeze({
            ...nextQuotedBase,
            transcriptAcknowledgements: acknowledgements,
          }),
        );
        setLifecycleRecord(refused);
        setFlow({
          kind: "refused",
          message: `No executable fill: ${selected.result.selection.reason}.`,
        });
        quoteRequestsRef.current.complete(request);
        return;
      }
      const fills = selected.result.selection.fills.map((fill) =>
        Object.freeze({
          makerId: fill.quote.solverId,
          lockId: fill.quote.lockId,
          amountA: fill.amountA.toString(),
          amountB: fill.amountB.toString(),
          lockExpiresAt: fill.quote.lockExpiresAt,
        }),
      );
      let quotedRecord = transitionRfqLifecycle(
        requestingRecord,
        "quoted",
        Math.floor(Date.now() / 1_000),
        {
          terms: Object.freeze({
            ...(requestingRecord.terms ?? requestingTerms),
            sellAmount: selected.exactSellAmount.toString(),
            buyAmount: selected.result.selection.totalB.toString(),
          }),
          settlement: Object.freeze({
            version: "Localnet V3" as const,
            escrowAddress: escrowHelperLocalnet,
            dealId: created.rfq.rfqFelt,
            deadline: created.rfq.lockExpiresAt,
          }),
          fills: Object.freeze(fills),
          quoteExpiresAt: Math.min(
            ...selected.result.selection.fills.map(
              (fill) => fill.quote.quoteExpiresAt,
            ),
          ),
        },
      );
      quotedRecord = await persistLifecycle(quotedRecord, request);
      setQuoted(
        Object.freeze({
          ...nextQuotedBase,
          transcriptAcknowledgements: Object.freeze([]),
        }),
      );
      try {
        await deliverTranscript(nextQuotedBase, quotedRecord, request);
      } catch (error: unknown) {
        setFlow({
          kind: "error",
          message: `Locked quotes are verified, but transcript delivery failed. Take remains blocked: ${errorMessage(error)}`,
        });
      }
      quoteRequestsRef.current.complete(request);
    } catch (error: unknown) {
      const disposition = decideLocalnetQuoteRequestFailure({
        request,
        activeToken: quoteRequestsRef.current.active()?.token ?? null,
        currentScope: quoteRequestsRef.current.currentScope(),
        error,
        requestingPersisted: requestingRecord?.state === "requesting",
        requestAborted: request.signal.aborted,
      });
      if (
        !disposition.discardedForScope &&
        requestingRecord?.state === "requesting"
      ) {
        try {
          const refused = transitionRfqLifecycle(
            requestingRecord,
            "refused",
            Math.floor(Date.now() / 1_000),
            { reason: errorMessage(error) },
          );
          await persistLifecycle(refused, request);
        } catch {
          // A concurrent scope change can still invalidate this request
          // between classification and persistence. Leave recovery to the
          // original account/chain scope instead of writing through the new one.
        }
      }
      if (disposition.completeActive) {
        quoteRequestsRef.current.complete(request);
      }
      if (disposition.applyUi) {
        setQuoted(null);
        setFlow({
          kind: "error",
          message: disposition.discardedForScope
            ? RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE
            : errorMessage(error),
        });
      }
    }
  }

  async function repollUntilMature() {
    cancelMaturityTimer();
    setWaitForMaturity(true);
    setFlow({
      kind: "waiting",
      message:
        "Waiting locally for the latest matching deposit to mature. No maker request has been sent.",
    });
    const poll = async () => {
      try {
        if (!address) throw new Error("The connected account changed.");
        const nextMaturity = await refreshNoteMaturity();
        if (nextMaturity.kind === "error") {
          throw new Error(nextMaturity.message);
        }
        if (nextMaturity.kind !== "ready") {
          throw new Error("The connected account changed.");
        }
        const status = nextMaturity.status;
        const gate = v3RequestMaturityGate(status, pair.sell.address);
        if (gate.ready) {
          setWaitForMaturity(false);
          await runQuoteRequest(status);
          return;
        }
        setFlow({
          kind: "waiting",
          message: `Latest matching deposit matures at block ${gate.matureAtBlock} (${gate.blocksRemaining} blocks left). No maker request has been sent.`,
        });
        maturityTimerRef.current = window.setTimeout(() => void poll(), 2_000);
      } catch (error: unknown) {
        setWaitForMaturity(false);
        setFlow({ kind: "error", message: errorMessage(error) });
      }
    };
    await poll();
  }

  async function declineLockedQuotes() {
    if (
      !lifecycleRecord ||
      !["quoted", "reviewing"].includes(lifecycleRecord.state)
    ) {
      return;
    }
    try {
      let current = transitionRfqLifecycle(
        lifecycleRecord,
        "cancel-pending",
        Math.floor(Date.now() / 1_000),
        {
          reason:
            "The taker declined. Maker collateral remains locked until its on-chain expiry.",
        },
      );
      current = await persistLifecycle(current);
      current = transitionRfqLifecycle(
        current,
        "cancelled",
        Math.floor(Date.now() / 1_000),
      );
      await persistLifecycle(current);
      setQuoted(null);
      setShowFinalReview(false);
      setFlow({
        kind: "ready",
        message:
          "RFQ cancelled. No Take was submitted; makers recover unused collateral after lock expiry.",
      });
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function finishSettledTake(
    result: Extract<V3TakeExecutionResult, { kind: "settled" }>,
  ) {
    try {
      await requestRfqHistoryAutoBackup({
        chainId: result.record.chainId,
        account: result.record.account,
      });
    } catch (error: unknown) {
      setFlow({
        kind: "settled",
        transactionHash: result.transactionHash,
        message: `Take settled. Optional RFQ history auto-backup could not be queued: ${errorMessage(error)}`,
      });
    }
    if (!invoice) return;
    try {
      if (
        !chain ||
        !address ||
        !feltEquals(chain, result.record.chainId) ||
        !feltEquals(address, result.record.account)
      ) {
        throw new Error(
          "The connected Mail scope changed before invoice settlement could be recorded.",
        );
      }
      // Mail keys local OTC state by the wallet-facing chain/account strings;
      // RFQ lifecycle rows intentionally canonicalize equivalent felt aliases.
      recordInvoiceTakeSettled(
        window.localStorage,
        chain,
        address,
        {
          requestId: invoice.requestId,
          takeTransactionHash: result.transactionHash,
          takeBlock: result.takeBlock,
          buyToken: invoice.buyToken,
          amount: invoice.targetBuyBaseUnits,
        },
        Math.floor(Date.now() / 1_000),
      );
      window.location.assign(invoice.returnTo);
    } catch (error: unknown) {
      setFlow({
        kind: "settled",
        transactionHash: result.transactionHash,
        message: `Take settled, but the invoice handoff could not be recorded: ${errorMessage(error)}`,
      });
    }
  }

  function applyTakeResult(result: V3TakeExecutionResult) {
    setLifecycleRecord(result.record);
    onLifecycleRecord?.(result.record);
    if (result.kind === "settled") {
      setFlow({
        kind: "settled",
        transactionHash: result.transactionHash,
        message:
          "Atomic Take settled. The exact escrow record matches every reviewed fill.",
      });
      void finishSettledTake(result);
    } else if (result.kind === "reverted") {
      setReviewSnapshot(null);
      setReviewSnapshotError(undefined);
      if (result.record.state === "reviewing") {
        void refreshReviewSnapshot(result.record);
      }
      setFlow({
        kind: "reverted",
        ...(result.transactionHash
          ? { transactionHash: result.transactionHash }
          : {}),
        message:
          result.record.state === "expired"
            ? `${result.reason} This RFQ is closed after the reverted Take; start a new RFQ.`
            : `${result.reason} Submission was disproved before wallet entry; review again before a new deliberate Take.`,
      });
    } else if (result.kind === "quarantined") {
      setShowFinalReview(false);
      setFlow({
        kind: "error",
        message: result.reason,
      });
    } else {
      setFlow({
        kind: "submission-unknown",
        ...(result.transactionHash
          ? { transactionHash: result.transactionHash }
          : {}),
        message: result.reason,
      });
    }
  }

  async function submitTake() {
    if (!lifecycleRecord || !reviewSnapshot) return;
    setFlow({
      kind: "working",
      message:
        "Revalidating every live lock and balance before the wallet boundary…",
    });
    try {
      const result = await executeLocalnetV3Take({
        record: lifecycleRecord,
        initialSnapshot: reviewSnapshot,
        persistence: {
          persist: persistLifecycle,
          authorize: authorizeLifecycle,
        },
      });
      applyTakeResult(result);
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  async function verifyTake() {
    if (!lifecycleRecord) return;
    setFlow({
      kind: "working",
      message:
        "Reading the exact escrow Take record. Nothing will be submitted or retried…",
    });
    try {
      const result = await verifyLocalnetV3Take({
        record: lifecycleRecord,
        persistence: {
          persist: persistLifecycle,
          authorize: authorizeLifecycle,
        },
      });
      if (result.kind === "absent") {
        setFlow({ kind: "submission-unknown", message: result.reason });
        return;
      }
      applyTakeResult(result);
    } catch (error: unknown) {
      setFlow({ kind: "error", message: errorMessage(error) });
    }
  }

  const finalTerms: RfqFinalReviewV3DisplayTerms | undefined = useMemo(() => {
    if (
      !quoted ||
      quoted.selection.selection.kind !== "selected" ||
      !lifecycleRecord?.terms?.buyAmount ||
      !lifecycleRecord.fills ||
      !lifecycleRecord.requestDigest ||
      !lifecycleRecord.settlement ||
      !lifecycleRecord.takerCommitment ||
      !reviewSnapshot?.privacyIdentityCommitment ||
      !reviewSnapshot.privacyNativeChainId
    ) {
      return undefined;
    }
    return Object.freeze({
      mode: "v3",
      rfqId: lifecycleRecord.rfqId,
      sellAddress: lifecycleRecord.terms.sellAddress,
      exactSellAmount: BigInt(lifecycleRecord.terms.sellAmount),
      buyAddress: lifecycleRecord.terms.buyAddress,
      totalBuyAmount: BigInt(lifecycleRecord.terms.buyAmount),
      floorBuyAmount: BigInt(lifecycleRecord.terms.minBuyAmount ?? "0"),
      fills: Object.freeze(
        lifecycleRecord.fills.map((fill) =>
          Object.freeze({
            makerId: fill.makerId,
            lockId: fill.lockId,
            amountA: BigInt(fill.amountA),
            amountB: BigInt(fill.amountB),
            lockExpiresAt: fill.lockExpiresAt,
          }),
        ),
      ),
      takeAuthorization: takeAuthorizationFromLifecycle(
        lifecycleRecord,
        reviewSnapshot.privacyIdentityCommitment,
        reviewSnapshot.privacyNativeChainId,
      ),
      feeBps: 0,
      app20FeeAmount: 0n,
      sellSymbol: lifecycleRecord.terms.sellSymbol,
      sellDecimals: lifecycleRecord.terms.sellDecimals,
      buySymbol: lifecycleRecord.terms.buySymbol,
      buyDecimals: lifecycleRecord.terms.buyDecimals,
      requestDigest: lifecycleRecord.requestDigest,
    });
  }, [lifecycleRecord, quoted, reviewSnapshot]);

  const finalBlockers = useMemo(() => {
    if (!finalTerms)
      return Object.freeze(["Exact final terms are unavailable."]);
    if (!reviewSnapshot) {
      return Object.freeze([
        reviewSnapshotError ?? "Fresh private balance is unavailable.",
      ]);
    }
    return validateV3FinalReview({
      initial: reviewSnapshot,
      current: reviewSnapshot,
      terms: finalTerms,
      now: preflightNow,
    }).blockers;
  }, [finalTerms, preflightNow, reviewSnapshot, reviewSnapshotError]);

  const presentedBucket = invitationReview?.bucket ?? draftBucket;
  const presentedBucketLabel = presentedBucket
    ? formatSizeBucketLabel(pair.sell.symbol, presentedBucket)
    : null;

  return (
    <section
      className={styles.privateIntentDesk}
      aria-label={swapOnly ? "Private swap" : undefined}
      aria-labelledby={swapOnly ? undefined : "local-private-intent-title"}
    >
      <dialog
        ref={privacyBriefingDialogRef}
        className={styles.privacyBriefingDialog}
        aria-labelledby="rfq-privacy-briefing-title"
        aria-describedby="rfq-privacy-briefing-intro"
        onCancel={(event) => {
          if (privacyBriefingAccepted) setShowPrivacyBriefing(false);
          else event.preventDefault();
        }}
        onClose={() => setShowPrivacyBriefing(false)}
      >
        <header>
          <span>APP20 / ONE-TIME BRIEFING</span>
          <h3 id="rfq-privacy-briefing-title">Before your first private RFQ</h3>
        </header>
        <p id="rfq-privacy-briefing-intro">
          Review this once in this browser. A material disclosure change bumps
          the version and shows it again.
        </p>
        <ul>
          <li>
            <strong>Local draft</strong>
            Exact size and policy floor stay in this browser until Take.
          </li>
          <li>
            <strong>Maker request</strong>
            Invited makers receive pair, side, one fixed size bucket, expiry,
            and request timing—not a public order.
          </li>
          <li>
            <strong>Public settlement</strong>
            Take reveals collateral activity, exact per-lock amounts, timing,
            helper activity, and the OPEN payout-note amount on-chain.
          </li>
        </ul>
        <p>
          Private and public activity may still be correlated. There is no
          automatic public fallback.
        </p>
        <footer>
          {privacyBriefingAccepted ? (
            <button
              type="button"
              autoFocus
              onClick={() => setShowPrivacyBriefing(false)}
            >
              Close briefing
            </button>
          ) : (
            <button type="button" autoFocus onClick={acceptPrivacyBriefing}>
              Acknowledge and continue
            </button>
          )}
          <small>
            Stores only this disclosure revision locally. No wallet signature or
            transaction is created.
          </small>
        </footer>
      </dialog>

      {swapOnly ? null : (
        <header className={styles.privateIntentHeader}>
          <div>
            <span>APP20 / PRIVATE RFQ V3</span>
            <h3 id="local-private-intent-title">
              {invoice
                ? "Pay invoice privately"
                : surface === "swap"
                  ? "Instant RFQ"
                  : "Block RFQ"}
            </h3>
          </div>
          <strong>COLLATERALIZED · ATOMIC</strong>
        </header>
      )}

      <aside className={styles.operationsGate} role="status">
        <strong>OPERATIONS · {operations.mode.toUpperCase()}</strong>
        <span>
          {operations.reason}{" "}
          {requestGate.allowed
            ? "New v3 requests may proceed."
            : requestGate.reason}
        </span>
        <Link to="/rfq/operations">Open browser-safe operations</Link>
      </aside>

      {swapOnly || invoice ? null : (
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
          {venue === "idle" ? (
            <div className={styles.deskVenueSummary}>
              <span>Invited maker inventory · no public route</span>
              <RfqInfoTip label="About the RFQ venue">
                {deskVenueCopy(venue)}
              </RfqInfoTip>
            </div>
          ) : (
            <>
              <LeakChips venue={venue} />
              <p className={styles.deskVenueCopy}>{deskVenueCopy(venue)}</p>
            </>
          )}
        </>
      )}

      {!swapOnly && !invoice && blockHint && surface === "swap" && !quoted ? (
        <p className={styles.deskHint} role="status">
          This clip may benefit from a typed Block floor.
          <button type="button" onClick={() => setSurface("block")}>
            Open Block RFQ
          </button>
        </p>
      ) : null}

      {invoice ? (
        <aside
          className={styles.invoiceTerms}
          aria-labelledby="invoice-terms-title"
        >
          <strong>INVOICE MODE · STRK → USDC</strong>
          <h4 id="invoice-terms-title">Invoice terms</h4>
          <dl>
            <div>
              <dt>Payee</dt>
              <dd>
                <code>{invoice.payee}</code>
              </dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>
                {formatLocalnetTokenAmount(
                  BigInt(invoice.targetBuyBaseUnits),
                  pairs.STRK_USDC.buy,
                )}{" "}
                USDC
              </dd>
            </div>
            <div>
              <dt>Memo</dt>
              <dd>{invoice.memo ?? "No memo"}</dd>
            </div>
          </dl>
          <p>
            The maker median estimates a bucket before the request. Exact STRK
            is minimized locally from verified schedules after quotes.
          </p>
          {invoiceEstimateReady ? null : (
            <p role="status">
              Waiting for a fresh verified maker median; quote requesting is
              blocked until invoice sizing is available.
            </p>
          )}
        </aside>
      ) : null}

      {surface === "block" && counterparty ? (
        <aside className={styles.privateIntentCounterparty}>
          <div>
            <span>CORRESPONDENCE CONTACT</span>
            <code title={counterparty}>{counterparty}</code>
          </div>
          {address && chain ? (
            <Link
              to="/chat"
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
            onChange={(event) =>
              selectPair(event.target.value as LocalnetMarketPairId)
            }
            disabled={working || Boolean(quoted) || Boolean(invoice)}
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
              <b>{invoice ? "Estimated sell before quotes" : "Exact sell"}</b>
              <small>Stays in this browser</small>
            </span>
            <span className={styles.swapAssetControl}>
              <input
                aria-label="Private intent sell amount"
                value={sellAmount}
                onChange={(event) => {
                  setSellAmount(event.target.value);
                  resetRequestView();
                }}
                inputMode="decimal"
                disabled={working || Boolean(quoted) || Boolean(invoice)}
              />
              <strong>{pair.sell.symbol}</strong>
            </span>
          </label>

          <button
            className={styles.swapDirection}
            type="button"
            aria-label="Reverse swap direction"
            title="Reverse market"
            onClick={() =>
              selectPair(pairId === "STRK_USDC" ? "USDC_STRK" : "STRK_USDC")
            }
            disabled={working || Boolean(quoted) || Boolean(invoice)}
          >
            ⇅
          </button>

          <label className={styles.swapAssetCard}>
            <span className={styles.swapAssetHead}>
              <b>{surface === "block" ? "Local floor" : "Policy floor"}</b>
              <small>Never sent to makers</small>
            </span>
            <span className={styles.swapAssetControl}>
              {surface === "block" && !invoice ? (
                <input
                  aria-label="Private intent minimum receive"
                  value={minBuyAmount}
                  onChange={(event) => {
                    setMinBuyAmount(event.target.value);
                    resetRequestView();
                  }}
                  inputMode="decimal"
                  disabled={working || Boolean(quoted)}
                />
              ) : (
                <output aria-label="Private intent local policy floor">
                  {economics
                    ? formatLocalnetTokenAmount(
                        economics.reviewedFloor,
                        pair.buy,
                      )
                    : "—"}
                </output>
              )}
              <strong>{pair.buy.symbol}</strong>
            </span>
          </label>
        </div>

        <aside
          className={styles.bucketNotice}
          aria-label="Size-blind request bucket"
        >
          <strong>MAKERS SEE</strong>
          <p>
            {presentedBucketLabel
              ? `${presentedBucketLabel} bucket`
              : "Enter an amount to derive its bucket"}
          </p>
          <RfqInfoTip label="About the size-blind maker request">
            Makers receive pair, side, this fixed ladder bucket, expiry, and
            request timing. Your exact sell amount and floor stay local until
            Take.
          </RfqInfoTip>
        </aside>

        <aside
          className={styles.maturityEstimate}
          aria-label="Note maturity estimate"
        >
          <strong>NOTE MATURITY</strong>
          <p>{maturityLine(maturity, pair.sell.address)}</p>
          <RfqInfoTip label="About the note-maturity estimate">
            Estimated from public deposit events. APP20 never reads private
            balances for this line.
          </RfqInfoTip>
        </aside>

        {quoted ? null : (
          <>
            <aside
              className={styles.privacyPreflight}
              aria-label="Privacy preflight"
            >
              <header className={styles.preflightHeader}>
                <strong>PRIVACY ROUTE</strong>
                <div className={styles.preflightBriefingControl} role="status">
                  <span>
                    {privacyBriefingLoaded
                      ? privacyBriefingAccepted
                        ? "BRIEFED ONCE"
                        : "REQUIRED"
                      : "CHECKING"}
                  </span>
                  <button
                    type="button"
                    disabled={!privacyBriefingLoaded || working}
                    onClick={() => setShowPrivacyBriefing(true)}
                  >
                    Review
                  </button>
                </div>
              </header>
              <p>Exact size and floor stay local.</p>
              <div
                className={styles.preflightSummary}
                role="list"
                aria-label="Privacy boundary summary"
              >
                <div role="listitem">
                  <span>Local</span>
                  <strong>Exact size + floor</strong>
                </div>
                <div role="listitem">
                  <span>Makers</span>
                  <strong>Bucket + timing</strong>
                </div>
                <div role="listitem">
                  <span>On-chain Take</span>
                  <strong>Exact fill amounts</strong>
                </div>
              </div>
              {privacyPreflight ? (
                <details className={styles.preflightEvidence}>
                  <summary>
                    Review privacy evidence
                    <strong>{privacyPreflight.findings.length} checks</strong>
                  </summary>
                  <ul>
                    {privacyPreflight.findings.map((finding) => (
                      <li key={finding.id}>
                        <strong>{finding.level.toUpperCase()}</strong>{" "}
                        {finding.topic === "denomination" &&
                        denominationAlternativeLabel
                          ? `Optional amount patterns: ${denominationAlternativeLabel}. Changing the amount is always your choice; these suggestions do not establish that activity cannot be correlated.`
                          : finding.message}
                        <small>
                          Source: {finding.provenance}; freshness:{" "}
                          {finding.freshness}
                        </small>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p role="status">Enter a valid exact sell amount.</p>
              )}
            </aside>

            <button
              type="button"
              onClick={prepareInvitationReview}
              disabled={
                working ||
                !privacyReady ||
                !requestGate.allowed ||
                Boolean(requestBlockedReason) ||
                (Boolean(invoice) && !invoiceEstimateReady)
              }
            >
              Review what makers will see
            </button>

            {invitationReview && operations.status ? (
              <aside
                className={styles.privacyPreflight}
                aria-label="Maker cohort review"
              >
                <strong>COHORT REVIEW · BEFORE MAKER DISCLOSURE</strong>
                <dl>
                  <div>
                    <dt>Direction</dt>
                    <dd>{pair.label}</dd>
                  </div>
                  <div>
                    <dt>What makers receive</dt>
                    <dd>
                      {formatSizeBucketLabel(
                        pair.sell.symbol,
                        invitationReview.bucket,
                      )}{" "}
                      · pair, side, and 90-second expiry only
                    </dd>
                  </div>
                  <div>
                    <dt>Local-only exact sell</dt>
                    <dd>
                      {formatLocalnetTokenAmount(
                        invitationReview.exactSellAmount,
                        pair.sell,
                      )}{" "}
                      {pair.sell.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Local-only floor</dt>
                    <dd>
                      {formatLocalnetTokenAmount(
                        invitationReview.localFloor,
                        pair.buy,
                      )}{" "}
                      {pair.buy.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Directory binding</dt>
                    <dd>
                      epoch {invitationReview.cohort.epoch} ·{" "}
                      <code>{invitationReview.cohort.checkpoint}</code>
                    </dd>
                  </div>
                </dl>
                <label className={styles.cohortConsent}>
                  <input
                    type="checkbox"
                    checked={invitationConfirmed}
                    disabled={working}
                    onChange={(event) =>
                      setInvitationConfirmed(event.target.checked)
                    }
                  />
                  <span>
                    Invite every named fixture maker with only the reviewed size
                    bucket.
                  </span>
                </label>
                <MakerCohortPanel
                  makers={operations.status.makers}
                  directory={operations.status.directory}
                  governedMakerCount={invitationReview.governedMakerCount}
                  now={preflightNow}
                />
              </aside>
            ) : null}

            {requestBlockedReason ? (
              <p role="alert">{requestBlockedReason}</p>
            ) : null}
            <button
              className={styles.privateIntentQuoteButton}
              type="button"
              onClick={() => void runQuoteRequest()}
              disabled={
                working ||
                !privacyReady ||
                !invitationReview ||
                !invitationConfirmed ||
                !requestGate.allowed ||
                Boolean(requestBlockedReason) ||
                (Boolean(invoice) && !invoiceEstimateReady)
              }
            >
              {flow.kind === "working" ? "Requesting…" : "Request quotes"}
            </button>
            {waitForMaturity ? (
              <button
                type="button"
                disabled={flow.kind === "working"}
                onClick={() => void repollUntilMature()}
              >
                Request quotes when mature
              </button>
            ) : null}
          </>
        )}
      </div>

      {quoted ? (
        <section
          ref={quoteComparisonRef}
          tabIndex={-1}
          className={styles.quoteComparison}
          aria-labelledby="rfq-maker-comparison"
        >
          <h3 id="rfq-maker-comparison">
            Compare all makers ({quoted.selection.comparison.length} verified{" "}
            {quoted.selection.comparison.length === 1 ? "quote" : "quotes"})
          </h3>
          <p>
            Review every verified response, refusal, exact-size evaluation,
            rank, outcome, and deterministic selection rationale.
          </p>
          <QuoteComparison
            quotes={quoted.selection.verifiedQuotes.map(({ quote }) => quote)}
            comparison={quoted.selection.comparison}
            refusals={quoted.refusals}
            selection={quoted.selection.selection}
            exactSellAmount={quoted.exactSellAmount}
            sellDecimals={quoted.pair.sell.decimals}
            buyDecimals={quoted.pair.buy.decimals}
            sellSymbol={quoted.pair.sell.symbol}
            buySymbol={quoted.pair.buy.symbol}
          />
          <section aria-labelledby="transcript-ack-title">
            <h4 id="transcript-ack-title">
              Fair-loss transcript acknowledgements
            </h4>
            {quoted.transcriptAcknowledgements.length ? (
              <ul className={styles.transcriptAcknowledgements}>
                {quoted.transcriptAcknowledgements.map((acknowledgement) => (
                  <li key={acknowledgement.makerId}>
                    <strong>{acknowledgement.makerId}</strong> ·{" "}
                    {acknowledgement.accepted ? "received" : "not accepted"} ·{" "}
                    {acknowledgement.consistent ? "consistent" : "inconsistent"}
                    {acknowledgement.reason
                      ? ` · ${acknowledgement.reason}`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p role="alert">
                Acknowledgements are unavailable. Take remains blocked until
                transcript delivery succeeds.
              </p>
            )}
          </section>
        </section>
      ) : null}

      {quoted &&
      quoted.selection.selection.kind === "selected" &&
      lifecycleRecord?.state === "quoted" ? (
        <button
          type="button"
          className={styles.privateIntentExecute}
          onClick={() =>
            void deliverTranscript(
              {
                created: quoted.created,
                selection: quoted.selection,
                refusals: quoted.refusals,
                pair: quoted.pair,
                surface: quoted.surface,
                exactSellAmount: quoted.exactSellAmount,
                localFloor: quoted.localFloor,
              },
              lifecycleRecord,
            ).catch((error: unknown) =>
              setFlow({ kind: "error", message: errorMessage(error) }),
            )
          }
          disabled={working}
        >
          Retry transcript delivery
        </button>
      ) : null}

      {quoted && lifecycleRecord?.state === "reviewing" && !showFinalReview ? (
        <div className={styles.reviewEntryActions}>
          <button
            type="button"
            onClick={() => {
              setShowFinalReview(true);
              void refreshReviewSnapshot(lifecycleRecord);
            }}
            disabled={working}
          >
            Review selected quote fills
          </button>
          <button
            type="button"
            onClick={() => void declineLockedQuotes()}
            disabled={working}
          >
            Decline locked quotes
          </button>
        </div>
      ) : null}

      {showFinalReview &&
      finalTerms &&
      lifecycleRecord?.state === "reviewing" ? (
        <RfqFinalReview
          terms={finalTerms}
          snapshot={reviewSnapshot ?? undefined}
          blockers={[
            ...(takeGate.allowed ? [] : [takeGate.reason]),
            ...finalBlockers,
          ]}
          disabled={!localnetReady || working || !takeGate.allowed}
          declineDisabled={working}
          onAccept={() => void submitTake()}
          onDecline={() => void declineLockedQuotes()}
          focusRef={finalReviewRef}
        />
      ) : null}

      {lifecycleRecord?.state === "submission-unknown" ? (
        <section
          className={styles.takeOutcome}
          aria-labelledby="take-unknown-title"
        >
          <h3 id="take-unknown-title">Take submission outcome unknown</h3>
          <p>
            Do not retry. Verify the exact escrow Take record for lifecycle v3.
          </p>
          {lifecycleRecord.takeTransactionHash ? (
            <code>{lifecycleRecord.takeTransactionHash}</code>
          ) : (
            <strong>
              No transaction hash returned · wallet boundary entered
            </strong>
          )}
          <button
            type="button"
            disabled={working}
            onClick={() => void verifyTake()}
          >
            Verify exact Take
          </button>
        </section>
      ) : null}

      {lifecycleRecord &&
      (lifecycleRecord.state === "submission-unknown" ||
        lifecycleRecord.state === "settled" ||
        lifecycleRecord.attempts.take?.state === "reverted" ||
        lifecycleRecord.state === "quarantined") ? (
        <section
          className={styles.takeEvidence}
          aria-label="RFQ v3 settlement evidence"
        >
          <p>
            <strong>Authority stage:</strong> lifecycle v3 · Take transaction
            only
          </p>
          <RfqAuthorityStrip record={lifecycleRecord} />
          <SettlementEvidencePanel
            records={[lifecycleRecord]}
            transactionHashes={
              lifecycleRecord.takeTransactionHash
                ? [lifecycleRecord.takeTransactionHash]
                : []
            }
          />
        </section>
      ) : null}

      {flow.kind !== "idle" && flow.kind !== "refused" ? (
        <p
          className={`${styles.privateIntentStatus} ${flow.kind === "error" ? styles.privateIntentError : ""}`}
          role={flow.kind === "error" ? "alert" : "status"}
        >
          {flow.message}
          {"transactionHash" in flow && flow.transactionHash
            ? ` Take transaction: ${flow.transactionHash}`
            : ""}
        </p>
      ) : null}

      {flow.kind === "refused" ? (
        <div className={styles.deskRefusal} role="alert">
          <strong>No private fill</strong>
          <p>{flow.message}</p>
          <p>
            No public fallback was attempted. Every quote and refusal remains
            visible above.
          </p>
          <button type="button" onClick={resetRequestView}>
            Start new RFQ
          </button>
        </div>
      ) : null}

      {flow.kind === "settled" ? (
        <div className={styles.privateIntentSuccess} role="status">
          <strong>Atomic receive confirmed from the exact escrow Take.</strong>
          {flow.transactionHash ? <code>{flow.transactionHash}</code> : null}
          <button type="button" onClick={resetRequestView}>
            Start another RFQ
          </button>
        </div>
      ) : null}

      {localnetReady ? null : (
        <p className={styles.privateIntentHint}>
          Select LOCAL in the header and connect Localnet (dev) to request and
          settle private maker quotes.
        </p>
      )}

      <footer className={styles.privateIntentDisclosure}>
        <span>RFQ v3 · localnet only</span>
        <RfqInfoTip label="Review RFQ protocol and privacy details">
          RFQ v3 sends invited makers only pair, side, fixed ladder bucket, and
          expiry. Exact size and floor stay local until one atomic Take
          publishes exact per-lock amounts. Quote schedules are signed and
          verified against on-chain collateral locks. Loopback timing and fanout
          remain observable; Sepolia and Mainnet execution remain disabled.
        </RfqInfoTip>
      </footer>
    </section>
  );
}
