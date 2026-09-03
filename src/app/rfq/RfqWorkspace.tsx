"use client";

import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { validatedRfqPair } from "@/app/routes";
import { localnetRuntimeEpoch } from "@/dev/localnet-runtime-epoch";
import { buildLocalnetIntentPayoutActions } from "./localnet-private-intents";
import {
  assertReadyExecutionUnchanged,
  snapshotReadyExecution,
} from "@/lib/ready-execution";
import {
  submitActions,
  transactionHashFromError,
  transactionStateFromError,
} from "@/lib/strk20";
import {
  addrSTRK,
  LOCALNET_PROVIDER_INDEX,
  localnetUsdcToken,
  myFrontendProviders,
} from "@/utils/constants";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DeskMarketBoard from "./DeskMarketBoard";
import type { LocalnetMarketPairId } from "./LocalnetPrivateIntentDesk";
import {
  abandonLocalnetFunding,
  askLocalnetSolverToFill,
  convergeLocalnetPrivateIntent,
  createLocalnetIntentId,
  ensureLocalnetEscrowTicket,
  expireLocalnetPrivateIntent,
  readLocalnetEscrowDeal,
  readLocalnetRfqOperationsStatus,
  readLocalnetUnresolvedDeals,
  releaseLocalnetRfqReservations,
} from "./localnet-private-intents";
import {
  prepareFundedSettlementExpiry,
  preparePreFundingReservationRelease,
  reconcilePersistedReservationRelease,
  reservationReleaseReconciliationRoute,
} from "./localnet-release-recovery";
import {
  authorizeLocalnetResumeCommand,
  type LocalnetResumeAction,
} from "./localnet-resume-controller";
import {
  assertLocalnetRecoveryContextUnchanged,
  recoveryContextMatches,
  snapshotLocalnetRecoveryContext,
  type LocalnetRecoveryContext,
} from "./localnet-recovery-context";
import RfqActiveList from "./RfqActiveList";
import RfqActivity from "./RfqActivity";
import RfqEnvironmentBanner from "./RfqEnvironmentBanner";
import RfqInfoTip from "./RfqInfoTip";
import RfqV3ResumeReview from "./RfqV3ResumeReview";
import SettlementEvidencePanel from "./SettlementEvidencePanel";
import {
  RFQ_LIFECYCLE_V1_SCHEMA_REVISION,
  beginRfqPhaseAttempt,
  canonicalRfqAccount,
  canonicalRfqChainId,
  lifecycleMayForget,
  restoreRfqLifecycle,
  reviseRfqLifecycle,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import type { RfqFinalReviewSnapshot } from "./rfq-final-review";
import { createIndexedDbRfqStorage } from "./rfq-storage";
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
import { gateRfqAction, operationsAvailability } from "./rfq-operations";
import { sameMarketRequestFence } from "./rfq-request-fence";
import { recoverLocalnetPreparingFundingAfterEmptyObservation } from "./localnet-prewallet-recovery";
import { rebuildServerDerivedRfqRecord } from "./localnet-server-recovery";
import { useRfqOperations } from "./use-rfq-operations";
import {
  executeLocalnetV3Take,
  verifyLocalnetV3Take,
  type V3TakeExecutionResult,
} from "./ui/v3-take-controller";
import { requestRfqHistoryAutoBackup } from "./ui/rfq-auto-backup";
import styles from "./rfq.module.css";

const LocalnetPrivateIntentDesk = lazy(
  () => import("./LocalnetPrivateIntentDesk"),
);

import RfqRecoveryCard from "./RfqRecoveryCard";
import { refreshLiveRfqAuthority } from "./rfq-authority";
import type { WorkspaceLoadState } from "./workspace-load-state";

type View = "new" | "active" | "activity" | "compatibility";

export function rfqWorkspaceScopeKey(
  providerIndex: number,
  chain: string | undefined,
  address: string | undefined,
  runtimeEpoch = localnetRuntimeEpoch(),
): string | undefined {
  if (!chain || !address) return undefined;
  try {
    return `${runtimeEpoch}|${providerIndex}|${canonicalRfqChainId(chain)}|${canonicalRfqAccount(address)}`;
  } catch {
    return undefined;
  }
}

export function workspaceScopeIsReady(
  loadedScope: string | undefined,
  currentScope: string | undefined,
  loadState: WorkspaceLoadState,
): boolean {
  return Boolean(
    currentScope &&
      loadedScope === currentScope &&
      (loadState === "ready" ||
        loadState === "quarantined" ||
        loadState === "local-deal-read-failed"),
  );
}

export function deriveWorkspaceContextReady(input: {
  providerIndex: number;
  address: string | undefined;
  chain: string | undefined;
  loadedScope: string | undefined;
  currentScope: string | undefined;
  loadState: WorkspaceLoadState;
  records: readonly RfqLifecycleRecord[];
}): boolean {
  return Boolean(
    input.providerIndex === LOCALNET_PROVIDER_INDEX &&
      input.address &&
      input.chain &&
      workspaceScopeIsReady(
        input.loadedScope,
        input.currentScope,
        input.loadState,
      ) &&
      input.records.every((record) =>
        recoveryContextMatches(record, {
          account: input.address!,
          chainId: input.chain!,
          providerIndex: input.providerIndex,
        }),
      ),
  );
}

export function RfqWorkspaceActiveBoundary(props: {
  records: readonly RfqLifecycleRecord[];
  providerIndex: number;
  address: string | undefined;
  chain: string | undefined;
  loadedScope: string | undefined;
  currentScope: string | undefined;
  loadState: WorkspaceLoadState;
  loadDetail?: string;
  busyRfqId?: string;
  onAction: (record: RfqLifecycleRecord, action: LocalnetResumeAction) => void;
  onRemove: (record: RfqLifecycleRecord) => void;
  onClearAll: () => void;
  onRetryLoad?: () => void;
}) {
  const actionsDisabled = !deriveWorkspaceContextReady(props);
  return (
    <RfqActiveList
      records={props.records}
      loadState={props.loadState}
      loadDetail={props.loadDetail}
      busyRfqId={props.busyRfqId}
      actionsDisabled={actionsDisabled}
      onAction={props.onAction}
      onRemove={props.onRemove}
      onClearAll={props.onClearAll}
      onRetryLoad={props.onRetryLoad}
    />
  );
}

function viewFromHash(hash: string): View {
  const value = hash.replace(/^#/, "");
  if (value === "active") return "active";
  if (value === "activity") return "activity";
  if (value === "intents") return "compatibility";
  return "new";
}

function sortRecords(
  records: readonly RfqLifecycleRecord[],
): RfqLifecycleRecord[] {
  return [...records].sort((left, right) => right.updatedAt - left.updatedAt);
}

function actionableSettlement(record: RfqLifecycleRecord): boolean {
  if (record.mode === "v3") {
    return Boolean(record.settlement && record.state === "submission-unknown");
  }
  return (
    Boolean(record.settlement) &&
    ![
      "settled",
      "refunded",
      "cancelled",
      "refused",
      "quarantined",
      "reorged",
    ].includes(record.state)
  );
}

function localTerms(record: RfqLifecycleRecord) {
  if (!record.terms || !record.selectedQuote || !record.settlement)
    throw new Error("Persisted exact localnet terms are unavailable.");
  if (
    !record.requestDigest ||
    !record.selectedQuote.reservationFence ||
    !record.selectedQuote.quoteDigest
  )
    throw new Error(
      "Persisted request and selection authorization are unavailable.",
    );
  return {
    account: record.account,
    chainId: record.chainId,
    rfqId: record.rfqId,
    dealId: record.settlement.dealId,
    intentDigest: record.requestDigest,
    solverId: record.selectedQuote.solverId,
    reservationId: record.selectedQuote.reservationId,
    reservationFence: record.selectedQuote.reservationFence,
    quoteDigest: record.selectedQuote.quoteDigest,
    sellToken: record.terms.sellAddress,
    sellAmount: BigInt(record.terms.sellAmount),
    buyToken: record.terms.buyAddress,
    buyAmount: BigInt(record.selectedQuote.buyAmount),
    deadline: record.settlement.deadline,
    ticketAddress:
      record.settlement.ticketAddress ??
      (() => {
        throw new Error("Persisted settlement ticket identity is unavailable.");
      })(),
  };
}

export default function RfqWorkspace() {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const hash = useRouterState({ select: (state) => state.location.hash });
  const requestedPair = useRouterState({
    select: (state) =>
      validatedRfqPair((state.location.search as Record<string, unknown>).pair),
  });
  const address = useStoreWallet((state) => state.address);
  const chain = useStoreWallet((state) => state.chain);
  const view = viewFromHash(hash);
  const [pairId, setPairId] = useState<LocalnetMarketPairId>(requestedPair);
  const [records, setRecords] = useState<RfqLifecycleRecord[]>([]);
  const [loadState, setLoadState] = useState<WorkspaceLoadState>("loading");
  const [loadedScope, setLoadedScope] = useState<string>();
  const [busyRfqId, setBusyRfqId] = useState<string>();
  const [recordError, setRecordError] = useState<string>();
  const [resumeReviewRecord, setResumeReviewRecord] =
    useState<RfqLifecycleRecord>();
  const [loadDetail, setLoadDetail] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  const operations = useRfqOperations();
  const currentScope = rfqWorkspaceScopeKey(providerIndex, chain, address);
  const viewRegionRef = useRef<HTMLElement>(null);
  const viewChangedRef = useRef(false);
  const authorityRefreshesRef = useRef(new Map<string, number>());
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const liveAuthorityKey = records
    .filter(
      (record) => record.state === "settled" || record.state === "refunded",
    )
    .map((record) => record.rfqId)
    .join("\0");
  useEffect(() => setPairId(requestedPair), [requestedPair]);
  useEffect(() => {
    if (!viewChangedRef.current) {
      viewChangedRef.current = true;
      return;
    }
    viewRegionRef.current?.focus();
  }, [view]);

  const replaceRecord = useCallback((record: RfqLifecycleRecord) => {
    setRecords((current) =>
      sortRecords([
        ...current.filter((item) => item.rfqId !== record.rfqId),
        record,
      ]),
    );
  }, []);

  useEffect(() => {
    authorityRefreshesRef.current.clear();
    setRecords([]);
    setLoadedScope(undefined);
    setBusyRfqId(undefined);
    setResumeReviewRecord(undefined);
    if (!address || !chain) {
      setLoadState("stale/offline");
      return;
    }
    let active = true;
    const storage = createIndexedDbRfqStorage();
    setLoadState("loading");
    setRecordError(undefined);
    setLoadDetail(undefined);
    void storage
      .list(chain, address)
      .then(async (rows) => {
        if (!active) return;
        const now = Math.floor(Date.now() / 1_000);
        const restored: RfqLifecycleRecord[] = [];
        for (const raw of rows) {
          if (!active) return;
          let row = restoreRfqLifecycle(raw, {
            chainId: chain,
            account: address,
            now,
          });
          if (
            (raw as { schemaRevision?: unknown })?.schemaRevision ===
            RFQ_LIFECYCLE_V1_SCHEMA_REVISION
          ) {
            await storage.save(row);
            await storage.removeLegacy(row);
          }
          if (
            providerIndex === LOCALNET_PROVIDER_INDEX &&
            actionableSettlement(row)
          ) {
            try {
              if (row.mode === "v3") {
                const verification = await verifyLocalnetV3Take({
                  record: row,
                  persistence: {
                    persist: async (next) => {
                      await storage.save(next);
                      return next;
                    },
                    authorize: (candidate) => storage.authorize(candidate),
                  },
                });
                row = verification.record;
              } else {
                const observed = await readLocalnetEscrowDeal(
                  row.settlement!.dealId,
                );
                row = await reconcileFundingBeforeBrowserPersistence(
                  row,
                  observed,
                  Math.floor(Date.now() / 1_000),
                  {
                    authorize: (candidate) => storage.authorize(candidate),
                    convergeServer: (next, status, attemptId) =>
                      convergeLocalnetPrivateIntent(
                        localTerms(next),
                        attemptId,
                        status,
                      ),
                    persistBrowser: (next) => storage.save(next),
                  },
                );
              }
            } catch (error: unknown) {
              const detail =
                error instanceof Error && error.message.trim()
                  ? error.message
                  : "The exact local deal verifier returned an unknown failure.";
              row = reviseRfqLifecycle(row, {
                recoveryReadFailure: Object.freeze({
                  detail,
                  observedAt: Math.floor(Date.now() / 1_000),
                }),
                updatedAt: Math.floor(Date.now() / 1_000),
              });
              // Best effort makes the row-scoped verify-only fence durable. A
              // failed save is still kept in memory and never broadens actions.
              try {
                await storage.save(row);
              } catch {
                // The explicit retry path validates the durable identity again.
              }
            }
          }
          restored.push(row);
        }

        let discoveryFailure: string | undefined;
        if (providerIndex === LOCALNET_PROVIDER_INDEX) {
          try {
            const discovered = await readLocalnetUnresolvedDeals({
              account: address,
              chainId: chain,
              sellToken: addrSTRK,
              buyToken: localnetUsdcToken,
            });
            for (const deal of discovered) {
              if (restored.some((row) => row.rfqId === deal.rfqId)) continue;
              const rebuilt = rebuildServerDerivedRfqRecord(deal, {
                account: address,
                chainId: chain,
                now: Math.floor(Date.now() / 1_000),
                markets: [
                  {
                    pairId: "STRK_USDC",
                    sell: { symbol: "STRK", address: addrSTRK, decimals: 18 },
                    buy: {
                      symbol: "USDC",
                      address: localnetUsdcToken,
                      decimals: 6,
                    },
                  },
                  {
                    pairId: "USDC_STRK",
                    sell: {
                      symbol: "USDC",
                      address: localnetUsdcToken,
                      decimals: 6,
                    },
                    buy: { symbol: "STRK", address: addrSTRK, decimals: 18 },
                  },
                ],
              });
              await storage.save(rebuilt);
              restored.push(rebuilt);
            }
          } catch (error: unknown) {
            discoveryFailure =
              error instanceof Error && error.message.trim()
                ? error.message
                : "The local unresolved-deal discovery read failed.";
          }
        }
        if (!active) return;
        setRecords(sortRecords(restored));
        setLoadedScope(rfqWorkspaceScopeKey(providerIndex, chain, address));
        setLoadDetail(discoveryFailure);
        setLoadState(
          discoveryFailure
            ? "local-deal-read-failed"
            : restored.some((row) => row.state === "quarantined")
              ? "quarantined"
              : providerIndex === LOCALNET_PROVIDER_INDEX
                ? "ready"
                : "stale/offline",
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadState("storage-unavailable");
        setLoadDetail(
          error instanceof Error ? error.message : "IndexedDB is unavailable.",
        );
      });
    return () => {
      active = false;
    };
  }, [address, chain, providerIndex, reloadToken]);

  useEffect(() => {
    if (
      providerIndex !== LOCALNET_PROVIDER_INDEX ||
      !address ||
      !chain ||
      !workspaceScopeIsReady(loadedScope, currentScope, loadState)
    )
      return;
    let active = true;
    const refresh = () => {
      const now = Date.now();
      for (const record of recordsRef.current) {
        const nextRefreshAt =
          authorityRefreshesRef.current.get(record.rfqId) ?? 0;
        if (
          (record.state !== "settled" && record.state !== "refunded") ||
          record.evidenceAuthority.status === "reorged" ||
          record.evidenceAuthority.status === "quarantined" ||
          nextRefreshAt > now
        )
          continue;
        // Fence concurrent reads and retry both success and failure. Authority
        // reads are verification-only and never submit or resubmit value.
        authorityRefreshesRef.current.set(record.rfqId, now + 5_000);
        void refreshLiveRfqAuthority(record, localnetRuntimeEpoch())
          .then(async (next) => {
            if (!active) return;
            await createIndexedDbRfqStorage().save(next);
            if (active) replaceRecord(next);
          })
          .catch(() => {
            // A failed read remains non-authoritative. Authority views subscribe
            // to the shared presentation clock and demote an expired live mark.
          });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    address,
    chain,
    currentScope,
    liveAuthorityKey,
    loadState,
    loadedScope,
    providerIndex,
    replaceRecord,
  ]);

  async function persist(
    record: RfqLifecycleRecord,
  ): Promise<RfqLifecycleRecord> {
    await createIndexedDbRfqStorage().save(record);
    replaceRecord(record);
    return record;
  }

  async function authorize(
    record: RfqLifecycleRecord,
  ): Promise<RfqLifecycleRecord> {
    const authorized = await createIndexedDbRfqStorage().authorize(record);
    replaceRecord(authorized);
    return authorized;
  }

  async function reconcile(
    record: RfqLifecycleRecord,
  ): Promise<RfqLifecycleRecord> {
    if (!record.settlement)
      throw new Error("Persisted settlement identity is unavailable.");
    const observed = await readLocalnetEscrowDeal(record.settlement.dealId);
    const next = await reconcileFundingBeforeBrowserPersistence(
      record,
      observed,
      Math.floor(Date.now() / 1_000),
      {
        authorize,
        convergeServer: (fundedRecord, status, attemptId) =>
          convergeLocalnetPrivateIntent(
            localTerms(fundedRecord),
            attemptId,
            status,
          ),
        persistBrowser: persist,
      },
    );
    return next;
  }

  async function recordSettledV3Result(result: V3TakeExecutionResult) {
    replaceRecord(result.record);
    if (result.kind === "settled") {
      try {
        await requestRfqHistoryAutoBackup({
          chainId: result.record.chainId,
          account: result.record.account,
        });
      } catch (error: unknown) {
        setRecordError(
          `Take settled, but optional RFQ history auto-backup could not be queued: ${error instanceof Error ? error.message : "unknown backup failure"}`,
        );
      }
    } else {
      setRecordError(result.reason);
    }
  }

  async function submitReviewedV3Take(
    reviewedRecord: RfqLifecycleRecord,
    snapshot: RfqFinalReviewSnapshot,
  ) {
    setBusyRfqId(reviewedRecord.rfqId);
    setRecordError(undefined);
    try {
      const now = Math.floor(Date.now() / 1_000);
      const stored = await createIndexedDbRfqStorage().load(reviewedRecord);
      const durable = stored
        ? restoreRfqLifecycle(stored, {
            chainId: reviewedRecord.chainId,
            account: reviewedRecord.account,
            now,
          })
        : undefined;
      const current = authorizeReviewedV3Resume(reviewedRecord, durable, now);
      const result = await executeLocalnetV3Take({
        record: current,
        initialSnapshot: snapshot,
        persistence: { persist, authorize },
      });
      await recordSettledV3Result(result);
      setResumeReviewRecord(
        result.kind === "reverted" ? result.record : undefined,
      );
    } catch (error: unknown) {
      setRecordError(
        error instanceof Error
          ? error.message
          : "The reviewed atomic Take failed.",
      );
    } finally {
      setBusyRfqId(undefined);
    }
  }

  async function verifyV3Take(record: RfqLifecycleRecord) {
    const result = await verifyLocalnetV3Take({
      record,
      persistence: { persist, authorize },
    });
    replaceRecord(result.record);
    if (result.kind === "settled") {
      await recordSettledV3Result(result);
    } else {
      setRecordError(result.reason);
    }
  }

  async function verifyFunding(record: RfqLifecycleRecord) {
    let current = record;
    let attempt = current.attempts.funding;
    if (!attempt)
      throw new Error("The persisted funding attempt identity is unavailable.");
    if (attempt.state === "preparing") {
      if (!current.settlement)
        throw new Error(
          "The persisted funding settlement identity is unavailable.",
        );
      if (!current.settlement.ticketAddress) {
        if (attempt.target?.operation !== "funding-ticket")
          throw new Error(
            "The persisted funding ticket authorization is unavailable.",
          );
        const ticketContext = snapshotLocalnetRecoveryContext(current);
        const ticketRuntimeEpoch = localnetRuntimeEpoch();
        const ticket = await runAuthorizedTicketAcceptance(current, {
          authorize,
          accept: async () => undefined,
          beforeEnsureTicket: (authorized) => {
            assertLocalnetRecoveryContextUnchanged(ticketContext, authorized);
            if (localnetRuntimeEpoch() !== ticketRuntimeEpoch)
              throw new Error(
                "The localnet runtime changed before ticket recovery.",
              );
          },
          ensureTicket: (authorized) => {
            const exactAttempt = authorized.attempts.funding!;
            return ensureLocalnetEscrowTicket({
              target: exactAttempt.target as Extract<
                NonNullable<typeof exactAttempt.target>,
                { operation: "funding-ticket" }
              >,
              attemptId: exactAttempt.attemptId,
            });
          },
        });
        current = ticket.authorized;
        attempt = current.attempts.funding!;
        const ticketAddress = ticket.result;
        current = await persist(
          reviseRfqLifecycle(current, {
            settlement: { ...current.settlement!, ticketAddress },
            updatedAt: Math.floor(Date.now() / 1_000),
          }),
        );
      }
      const started = snapshotLocalnetRecoveryContext(current);
      const recoveryRuntimeEpoch = localnetRuntimeEpoch();
      const assertRecoveryContext = (authorized: RfqLifecycleRecord) => {
        assertLocalnetRecoveryContextUnchanged(started, authorized);
        if (localnetRuntimeEpoch() !== recoveryRuntimeEpoch)
          throw new Error(
            "The localnet runtime changed before pre-wallet recovery.",
          );
      };
      const observed = await readLocalnetEscrowDeal(current.settlement!.dealId);
      await recoverLocalnetPreparingFundingAfterEmptyObservation(
        current,
        observed,
        {
          abandonFunding: abandonLocalnetFunding,
          releaseRequestReservations: releaseLocalnetRfqReservations,
          persist,
          authorize,
          createAttemptId: createLocalnetIntentId,
          now: () => Math.floor(Date.now() / 1_000),
          beforeAbandon: assertRecoveryContext,
          beforeRelease: assertRecoveryContext,
        },
      );
      return;
    }
    const next = await reconcile(record);
    if ((next.latestObservation?.status ?? 0) === 0) {
      setRecordError(
        "Funding is still unknown after an exact empty-chain observation. Nothing was resubmitted.",
      );
    }
  }

  async function requestFill(record: RfqLifecycleRecord) {
    const recoveryStarted = snapshotLocalnetRecoveryContext(record);
    let current = await reconcile(record);
    const now = Math.floor(Date.now() / 1_000);
    if (
      current.state !== "funded" ||
      now >= (current.settlement?.deadline ?? 0)
    ) {
      throw new Error(
        "A fresh exact deal observation does not permit maker fill before the deadline.",
      );
    }
    const status = await readLocalnetRfqOperationsStatus();
    const gate = gateRfqAction(
      operationsAvailability(status, Math.floor(Date.now() / 1_000)),
      "fill",
      current.selectedQuote?.solverId,
    );
    if (!gate.allowed) throw new Error(gate.reason);
    const fillTerms = localTerms(current);
    current = await persist(
      beginRfqPhaseAttempt(
        current,
        "fill",
        createLocalnetIntentId(),
        Math.floor(Date.now() / 1_000),
        makerFillAttemptTarget(fillTerms),
      ),
    );
    const fill = await runAuthorizedInitialMakerFill(current, {
      authorize,
      beforeSubmit: () =>
        assertLocalnetRecoveryContextUnchanged(recoveryStarted, record),
      submit: (authorized) =>
        askLocalnetSolverToFill(fillTerms, authorized.attempts.fill!.attemptId),
    });
    current = fill.authorized;
    const transactionHash = fill.result;
    current = await persist(
      updateRfqPhaseAttempt(
        current,
        "fill",
        "submitted-unknown",
        Math.floor(Date.now() / 1_000),
        { transactionHash },
      ),
    );
    await reconcile(current);
  }

  async function retryMakerFill(record: RfqLifecycleRecord) {
    const recoveryStarted = snapshotLocalnetRecoveryContext(record);
    const status = await readLocalnetRfqOperationsStatus();
    const gate = gateRfqAction(
      operationsAvailability(status, Math.floor(Date.now() / 1_000)),
      "fill",
      record.selectedQuote?.solverId,
    );
    if (!gate.allowed) throw new Error(gate.reason);
    const submitted = await retryPersistedMakerFill(record, {
      authorize,
      beforeSubmit: () =>
        assertLocalnetRecoveryContextUnchanged(recoveryStarted, record),
      submitExact: askLocalnetSolverToFill,
      persist,
      now: () => Math.floor(Date.now() / 1_000),
    });
    await reconcile(submitted);
  }

  const releaseRecoveryDependencies = (
    record: RfqLifecycleRecord,
    started: LocalnetRecoveryContext,
  ) => ({
    releaseRequestReservations: releaseLocalnetRfqReservations,
    expireFundedSettlement: expireLocalnetPrivateIntent,
    persist,
    authorize,
    beforeSubmit: () => assertLocalnetRecoveryContextUnchanged(started, record),
    now: () => Math.floor(Date.now() / 1_000),
  });

  async function observeExpiry(record: RfqLifecycleRecord) {
    const started = snapshotLocalnetRecoveryContext(record);
    const observedFunded = await reconcile(record);
    const pending = await persist(
      prepareFundedSettlementExpiry(
        observedFunded,
        createLocalnetIntentId(),
        Math.floor(Date.now() / 1_000),
      ),
    );
    await reconcilePersistedReservationRelease(
      pending,
      releaseRecoveryDependencies(record, started),
    );
  }

  async function verifyReservationRelease(record: RfqLifecycleRecord) {
    const started = snapshotLocalnetRecoveryContext(record);
    const reconciled =
      reservationReleaseReconciliationRoute(record) ===
      "funded-settlement-expiry"
        ? await reconcile(record)
        : record;
    await reconcilePersistedReservationRelease(
      reconciled,
      releaseRecoveryDependencies(record, started),
    );
  }

  async function submitOutcome(
    record: RfqLifecycleRecord,
    phase: "claim" | "refund",
  ) {
    const started = snapshotReadyExecution();
    if (
      started.providerIndex !== LOCALNET_PROVIDER_INDEX ||
      !recoveryContextMatches(record, {
        account: started.address,
        chainId: started.chainId,
        providerIndex: started.providerIndex,
      })
    ) {
      throw new Error(
        "Reconnect the wallet and chain bound to this local resume record.",
      );
    }
    const settlement = record.settlement;
    const terms = record.terms;
    if (!settlement?.ticketAddress || !terms)
      throw new Error(
        "Persisted payout identity or exact terms are unavailable.",
      );
    const ticketAddress = settlement.ticketAddress;
    let current = await persist(
      beginRfqPhaseAttempt(
        record,
        phase,
        createLocalnetIntentId(),
        Math.floor(Date.now() / 1_000),
      ),
    );
    try {
      const payout = await runAuthorizedPayout(current, {
        authorize,
        submitWallet: async (authorized) => {
          current = authorized;
          return submitActions(
            started.account,
            myFrontendProviders[LOCALNET_PROVIDER_INDEX],
            buildLocalnetIntentPayoutActions({
              operation: phase === "claim" ? "claim" : "timeout",
              escrowAddress: settlement.escrowAddress,
              recoveryAddress: started.address,
              ticketAddress,
              dealId: settlement.dealId,
              payoutToken:
                phase === "claim" ? terms.buyAddress : terms.sellAddress,
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
                await persist(current);
              },
            },
          );
        },
      });
      const result = payout.result;
      if (current.attempts[phase]?.state === "preparing") {
        current = await persist(
          updateRfqPhaseAttempt(
            current,
            phase,
            "submitted-unknown",
            Math.floor(Date.now() / 1_000),
            { transactionHash: result.transactionHash },
          ),
        );
      }
      await reconcile(current);
    } catch (error: unknown) {
      const state = transactionStateFromError(error);
      const transactionHash = transactionHashFromError(error);
      if (state === "reverted") {
        await persist(
          updateRfqPhaseAttempt(
            current,
            phase,
            "reverted",
            Math.floor(Date.now() / 1_000),
            {
              ...(transactionHash ? { transactionHash } : {}),
              observation: "Wallet or chain reported revert.",
            },
          ),
        );
      } else if (
        transactionHash &&
        current.attempts[phase]?.state === "preparing"
      ) {
        await persist(
          updateRfqPhaseAttempt(
            current,
            phase,
            "submitted-unknown",
            Math.floor(Date.now() / 1_000),
            { transactionHash },
          ),
        );
      }
      throw error;
    }
  }

  async function releaseRequest(record: RfqLifecycleRecord) {
    const started = snapshotLocalnetRecoveryContext(record);
    const pending = await persist(
      preparePreFundingReservationRelease(
        record,
        createLocalnetIntentId(),
        Math.floor(Date.now() / 1_000),
      ),
    );
    await reconcilePersistedReservationRelease(
      pending,
      releaseRecoveryDependencies(record, started),
    );
  }

  async function runRecordAction(
    record: RfqLifecycleRecord,
    action: LocalnetResumeAction,
  ) {
    setBusyRfqId(record.rfqId);
    setRecordError(undefined);
    try {
      const now = Math.floor(Date.now() / 1_000);
      const stored = await createIndexedDbRfqStorage().load(record);
      const durableRecord = stored
        ? restoreRfqLifecycle(stored, {
            chainId: record.chainId,
            account: record.account,
            now,
          })
        : undefined;
      if (durableRecord) replaceRecord(durableRecord);
      const currentRecord =
        action === "verify-deal" && record.recoveryReadFailure
          ? (() => {
              if (
                !durableRecord ||
                durableRecord.rfqId !== record.rfqId ||
                durableRecord.account !== record.account ||
                durableRecord.chainId !== record.chainId ||
                durableRecord.storageRevision !== record.storageRevision ||
                durableRecord.updatedAt !== record.updatedAt
              )
                throw new Error(
                  "The RFQ record changed before deal verification. Reload and review it again.",
                );
              return durableRecord;
            })()
          : authorizeLocalnetResumeCommand(record, durableRecord, action, now);
      if (
        action === "accept-and-fund" ||
        action === "request-maker-fill" ||
        action === "retry-maker-fill" ||
        action === "take"
      ) {
        const gate = gateRfqAction(
          operations,
          action === "accept-and-fund"
            ? "fund"
            : action === "take"
              ? "take"
              : "fill",
          currentRecord.selectedQuote?.solverId,
        );
        if (!gate.allowed) throw new Error(gate.reason);
      }
      if (action === "take") setResumeReviewRecord(currentRecord);
      else if (action === "verify-take") await verifyV3Take(currentRecord);
      else if (action === "verify-funding") await verifyFunding(currentRecord);
      else if (
        ["verify-deal", "reconcile-fill", "reconcile-outcome"].includes(action)
      )
        await reconcile(currentRecord);
      else if (action === "request-maker-fill")
        await requestFill(currentRecord);
      else if (action === "retry-maker-fill")
        await retryMakerFill(currentRecord);
      else if (action === "observe-expiry") await observeExpiry(currentRecord);
      else if (action === "claim" || action === "refund")
        await submitOutcome(currentRecord, action);
      else if (action === "verify-reservation-release")
        await verifyReservationRelease(currentRecord);
      else if (action === "retry-reservation-release")
        await releaseRequest(currentRecord);
      else if (
        action === "release-request-reservations" ||
        action === "decline-and-release"
      )
        await releaseRequest(currentRecord);
      else if (action === "request-fresh-quotes") window.location.hash = "new";
      else if (action === "accept-and-fund")
        throw new Error(
          "Reloaded pre-funding review requires fresh privacy evidence. Request fresh quotes; no funding was submitted.",
        );
    } catch (error: unknown) {
      setRecordError(
        error instanceof Error
          ? error.message
          : "The persisted phase command failed.",
      );
    } finally {
      setBusyRfqId(undefined);
    }
  }

  function authorizeReviewedV3Resume(
    reviewedRecord: RfqLifecycleRecord,
    durableRecord: RfqLifecycleRecord | undefined,
    now: number,
  ): RfqLifecycleRecord {
    return authorizeLocalnetResumeCommand(
      reviewedRecord,
      durableRecord,
      "take",
      now,
    );
  }

  async function removeRecord(record: RfqLifecycleRecord) {
    try {
      if (!lifecycleMayForget(record)) {
        throw new Error(
          "Unresolved or value-bearing RFQ records cannot be forgotten.",
        );
      }
      if (
        !window.confirm(
          "Forget this terminal browser-history record? This never cancels a maker reservation or changes the chain settlement.",
        )
      )
        return;
      await createIndexedDbRfqStorage().remove(record);
      setRecords((current) =>
        current.filter((item) => item.rfqId !== record.rfqId),
      );
    } catch (error: unknown) {
      setRecordError(
        error instanceof Error
          ? error.message
          : "The local record could not be deleted.",
      );
    }
  }

  async function clearAllRecords() {
    if (!address || !chain) return;
    try {
      if (!records.every(lifecycleMayForget)) {
        throw new Error(
          "Forget all is blocked while any unresolved or value-bearing RFQ record remains.",
        );
      }
      if (
        !window.confirm(
          "Forget all terminal browser-history records? This never cancels maker reservations or changes chain settlements.",
        )
      )
        return;
      await createIndexedDbRfqStorage().clearAll(chain, address, records);
      setRecords([]);
    } catch (error: unknown) {
      setRecordError(
        error instanceof Error
          ? error.message
          : "Local records could not be cleared.",
      );
    }
  }

  const executable = providerIndex === LOCALNET_PROVIDER_INDEX;
  const activeRecords = useMemo(
    () => records.filter((row) => !lifecycleMayForget(row)),
    [records],
  );
  const workspaceContextReady = deriveWorkspaceContextReady({
    providerIndex,
    address,
    chain,
    loadedScope,
    currentScope,
    loadState,
    records,
  });
  function retryWorkspaceLoad() {
    if (loadState === "stale/offline") {
      document.getElementById("app20-session-control")?.focus();
      return;
    }
    setReloadToken((token) => token + 1);
  }

  return (
    <main className={styles.page}>
      <RfqEnvironmentBanner
        providerIndex={providerIndex}
        runtimeEpoch={localnetRuntimeEpoch()}
      />
      <h1 className={styles.workspaceTitle}>Private RFQ</h1>
      <nav className={styles.deskSubnav} aria-label="RFQ workspace">
        <Link
          to="/rfq"
          hash="new"
          activeOptions={{ exact: true, includeHash: true }}
          aria-current={view === "new" ? "page" : undefined}
        >
          New
        </Link>
        <Link
          to="/rfq"
          hash="active"
          activeOptions={{ exact: true, includeHash: true }}
          aria-current={view === "active" ? "page" : undefined}
        >
          Active
        </Link>
        <Link
          to="/rfq"
          hash="activity"
          activeOptions={{ exact: true, includeHash: true }}
          aria-current={view === "activity" ? "page" : undefined}
        >
          Activity
        </Link>
        <Link to="/rfq/operations">Operations</Link>
      </nav>
      {recordError ? <p role="alert">{recordError}</p> : null}
      {view === "compatibility" ? (
        <section>
          <strong>COMPATIBILITY BOUNDARY · NO SETTLEMENT</strong>
          <h2>Cross-chain review moved</h2>
          <p>This bookmark cannot request or execute an RFQ.</p>
          <Link to="/cross-chain-review">Open dry cross-chain review</Link>
        </section>
      ) : null}
      {view === "active" ? (
        <section ref={viewRegionRef} tabIndex={-1} aria-label="Active RFQs">
          <RfqWorkspaceActiveBoundary
            records={activeRecords}
            providerIndex={providerIndex}
            address={address}
            chain={chain}
            loadedScope={loadedScope}
            currentScope={currentScope}
            loadState={loadState}
            loadDetail={loadDetail}
            busyRfqId={busyRfqId}
            onAction={(record, action) => void runRecordAction(record, action)}
            onRemove={(record) => void removeRecord(record)}
            onClearAll={() => void clearAllRecords()}
            onRetryLoad={retryWorkspaceLoad}
          />
          {resumeReviewRecord ? (
            <RfqV3ResumeReview
              record={resumeReviewRecord}
              busy={busyRfqId === resumeReviewRecord.rfqId}
              operationBlocker={
                gateRfqAction(operations, "take").allowed
                  ? undefined
                  : gateRfqAction(operations, "take").reason
              }
              onAccept={(record, snapshot) =>
                void submitReviewedV3Take(record, snapshot)
              }
              onClose={() => setResumeReviewRecord(undefined)}
            />
          ) : null}
        </section>
      ) : null}
      {view === "activity" ? (
        <section ref={viewRegionRef} tabIndex={-1} aria-label="RFQ activity">
          <RfqActivity
            records={records}
            loadState={loadState}
            loadDetail={loadDetail}
            onRemove={(record) => void removeRecord(record)}
            onClearAll={() => void clearAllRecords()}
            onRetryLoad={retryWorkspaceLoad}
          />
          <SettlementEvidencePanel records={records} />
        </section>
      ) : null}
      {view === "new" ? (
        <section ref={viewRegionRef} tabIndex={-1} aria-label="New RFQ request">
          <h2 className={styles.viewHeading}>New request</h2>
          <RfqRecoveryCard
            loadState={loadState}
            detail={loadDetail}
            onRetry={retryWorkspaceLoad}
          />
          <section
            className={`${styles.privateWorkspace} ${
              executable ? "" : styles.publicMarketWorkspace
            }`}
          >
            <aside
              className={styles.tradeTicket}
              aria-label="Private RFQ ticket"
            >
              {executable ? (
                <Suspense fallback={<p>Loading local demo ticket…</p>}>
                  <LocalnetPrivateIntentDesk
                    initialPairId={pairId}
                    onPairChange={setPairId}
                    onLifecycleRecord={replaceRecord}
                    requestBlockedReason={
                      workspaceContextReady &&
                      loadState !== "local-deal-read-failed"
                        ? sameMarketRequestFence(records, pairId)
                        : "RFQ resume storage and unresolved-deal discovery must load successfully for the current account, wallet chain, and LOCAL provider before a new request."
                    }
                  />
                </Suspense>
              ) : (
                <section aria-label="Private RFQ unavailable">
                  <h3>Private RFQ unavailable</h3>
                  <p>
                    {providerIndex === 2
                      ? "Sepolia RFQ is disabled. Production contracts, governed maker directory, custody, chain verifier, operators, funding, audit, and rollout evidence are unavailable."
                      : "Mainnet RFQ is disabled. No maker request was sent and there is no automatic public fallback."}
                  </p>
                </section>
              )}
            </aside>
            <section
              className={styles.marketWorkspace}
              aria-label="Public market context"
            >
              <DeskMarketBoard pairId={pairId} />
            </section>
          </section>
          <nav
            className={styles.separateOperations}
            aria-label="Separate operations"
          >
            <Link to="/funding">Shield / unshield funding</Link>
            <Link to="/send">Public send · unavailable</Link>
            <Link to="/mail/inbox">Mail · coordination only</Link>
            <Link to="/cross-chain-review">Cross-chain dry review</Link>
            <Link to="/recovery/privy">Privy recovery</Link>
          </nav>
        </section>
      ) : null}
      <aside className={styles.privacyBoundary} aria-label="Privacy boundaries">
        <strong>Privacy & observability</strong>
        <span>No public order book · exact terms stay local until Take</span>
        <RfqInfoTip
          label="Review privacy and observability details"
          indicator="Review +"
        >
          <span className={styles.privacyBoundaryDetails}>
            <span>
              <strong>Not published as a public order.</strong> No order book
              carries this request.
              {" Public and private activity can still be correlated."}
            </span>
            <span>
              <strong>Invited makers see size-blind terms.</strong> Pair, side,
              one fixed ladder bucket, and expiry.
              {" Exact size and floor stay in this browser until Take."}
            </span>
            <span>
              <strong>Public in this local devnet demo.</strong> Shield and
              unshield legs, fees, collateral locks, exact per-lock Take
              amounts, lifecycle timing, and OPEN payout-note amounts. Legacy v2
              recovery remains available.
            </span>
            <span>
              <strong>Visible to services.</strong> Request timing and maker
              fanout; quote schedules and indicative mids are request-scoped
              signed data.
            </span>
          </span>
        </RfqInfoTip>
      </aside>
    </main>
  );
}
