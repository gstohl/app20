import { createLocalnetMakerReconciler } from "./localnet-maker-reconciler.mjs";

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new Error(`${label} is required.`);
  return value;
}

function exactTerminalAcknowledgement(value, query, expectedTerminal) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Maker terminal acknowledgement is not an exact snapshot.");
  const expected = makerTargetFromAuthorityQuery(query);
  const fields = [
    "intentDigest",
    "reservationId",
    "fence",
    "quoteDigest",
    "dealId",
    "sellToken",
    "sellAmount",
    "buyToken",
    "buyAmount",
    "deadline",
    "ticketAddress",
  ];
  for (const field of fields) {
    if (value[field] !== expected[field])
      throw new Error(`Maker terminal acknowledgement changed ${field}.`);
  }
  if (value.makerId !== query.makerId)
    throw new Error("Maker terminal acknowledgement changed makerId.");
  const expectedState = query.outcome === "settled" ? "consumed" : "released";
  if (value.state !== expectedState)
    throw new Error("Maker terminal acknowledgement has the wrong state.");
  if (
    query.outcome === "settled" &&
    value.settlementTransactionHash !== query.transactions.fill
  )
    throw new Error(
      "Maker terminal acknowledgement changed the settlement transaction.",
    );
  if (
    query.outcome === "refunded" &&
    value.settlementTransactionHash !== undefined
  )
    throw new Error(
      "Refund acknowledgement unexpectedly contains a settlement transaction.",
    );
  const terminal = value.terminalReconciliation;
  if (!terminal || typeof terminal !== "object" || Array.isArray(terminal))
    throw new Error(
      "Maker terminal acknowledgement lacks terminal reconciliation evidence.",
    );
  for (const [field, expected] of [
    ["attemptId", expectedTerminal.attemptId],
    ["authorityDigest", expectedTerminal.authorityDigest],
    ["authorityRevision", expectedTerminal.authorityRevision],
    ["outcome", query.outcome],
    ["selectionFence", query.reservationFence],
  ]) {
    if (terminal[field] !== expected)
      throw new Error(
        `Maker terminal acknowledgement changed terminal ${field}.`,
      );
  }
  if (
    !Number.isSafeInteger(terminal.reconciledAt) ||
    terminal.reconciledAt <= 0
  )
    throw new Error(
      "Maker terminal acknowledgement reconciliation time is invalid.",
    );
  return value;
}

function exactQuarantineAcknowledgement(value, query, expectedQuarantine) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Maker quarantine acknowledgement is not an exact snapshot.",
    );
  const expected = makerTargetFromAuthorityQuery(query);
  for (const field of [
    "intentDigest",
    "reservationId",
    "fence",
    "quoteDigest",
    "dealId",
    "sellToken",
    "sellAmount",
    "buyToken",
    "buyAmount",
    "deadline",
    "ticketAddress",
  ]) {
    if (value[field] !== expected[field])
      throw new Error(`Maker quarantine acknowledgement changed ${field}.`);
  }
  if (value.makerId !== query.makerId)
    throw new Error("Maker quarantine acknowledgement changed makerId.");
  if (value.state !== "quarantined")
    throw new Error("Maker quarantine acknowledgement has the wrong state.");
  const quarantine = value.authorityQuarantine;
  if (
    !quarantine ||
    typeof quarantine !== "object" ||
    Array.isArray(quarantine)
  )
    throw new Error(
      "Maker quarantine acknowledgement lacks durable quarantine evidence.",
    );
  for (const [field, expectedValue] of [
    ["attemptId", expectedQuarantine.attemptId],
    ["authorityDigest", expectedQuarantine.authorityDigest],
    ["authorityRevision", expectedQuarantine.authorityRevision],
    ["outcome", query.outcome],
    ["reason", expectedQuarantine.reason],
    ["selectionFence", query.reservationFence],
  ]) {
    if (quarantine[field] !== expectedValue)
      throw new Error(`Maker quarantine acknowledgement changed ${field}.`);
  }
  if (
    !Number.isSafeInteger(quarantine.quarantinedAt) ||
    quarantine.quarantinedAt <= 0
  )
    throw new Error("Maker quarantine acknowledgement time is invalid.");
  return value;
}

export function makerTargetFromAuthorityQuery(query) {
  return Object.freeze({
    reservationId: query.reservationId,
    intentDigest: query.intentDigest,
    fence: query.reservationFence,
    quoteDigest: query.quoteDigest,
    dealId: query.dealId,
    sellToken: query.sellToken,
    sellAmount: query.sellAmount,
    buyToken: query.buyToken,
    buyAmount: query.buyAmount,
    deadline: query.deadline,
    ticketAddress: query.ticketAddress,
  });
}

function requiresMakerQuarantine(authorityEvidence) {
  return (
    authorityEvidence.status === "disagreement" ||
    authorityEvidence.status === "reorged" ||
    authorityEvidence.status === "quarantined" ||
    authorityEvidence.marketQuarantined === true
  );
}

/**
 * Server-only composition root joining durable chain, coordinator, and maker
 * authority. It never submits a transaction and never releases inventory from
 * browser or coordinator evidence alone. The global queue intentionally spans
 * chain verification, maker mutation, exact acknowledgement, and journal
 * publication so one delayed projection cannot overtake a newer revision.
 */
export function createLocalnetAuthorityReconciliationPipeline(options) {
  const chainAuthority = options.chainAuthority;
  const coordinator = options.coordinator;
  const makerClientForId = requiredFunction(
    options.makerClientForId,
    "makerClientForId",
  );
  const requestMaker = requiredFunction(options.requestMaker, "requestMaker");
  const quarantineProjection =
    options.quarantineProjection ?? (async () => undefined);
  let tail = Promise.resolve();
  const enqueue = (operation) => {
    const run = tail.then(operation);
    tail = run.catch(() => undefined);
    return run;
  };

  const makerReconciler = createLocalnetMakerReconciler({
    path: options.journalPath,
    runtimeEpoch: options.runtimeEpoch,
    now: options.now,
    faultInjector: options.faultInjector,
    quarantineAuthority: async ({
      attemptId,
      authorityDigest,
      authorityRevision,
      query,
      reason,
    }) => {
      const client = makerClientForId(query.makerId);
      if (!client)
        throw new Error("Authority reconciliation maker is unavailable.");
      const acknowledgement = await requestMaker(
        client,
        "/v1/reconciliation/quarantine",
        {
          target: makerTargetFromAuthorityQuery(query),
          attemptId,
          authorityDigest,
          authorityRevision,
          outcome: query.outcome,
          reason,
        },
      );
      exactQuarantineAcknowledgement(acknowledgement, query, {
        attemptId,
        authorityDigest,
        authorityRevision,
        reason,
      });
    },
    releaseTerminal: async ({
      attemptId,
      authorityDigest,
      authorityRevision,
      query,
      settlementTransactionHash,
    }) => {
      const client = makerClientForId(query.makerId);
      if (!client)
        throw new Error(
          "Exact maker is unavailable for terminal reconciliation.",
        );
      const acknowledgement = await requestMaker(
        client,
        "/v1/reconciliation/terminal",
        {
          target: makerTargetFromAuthorityQuery(query),
          attemptId,
          authorityDigest,
          authorityRevision,
          outcome: query.outcome,
          settlementTransactionHash,
        },
      );
      exactTerminalAcknowledgement(acknowledgement, query, {
        attemptId,
        authorityDigest,
        authorityRevision,
      });
    },
  });

  const reconcileProjectionUnlocked = async (projection) => {
    const query = chainAuthority.exactQueryForProjection(projection);
    const requestRecord = coordinator
      .listRequests()
      .find((candidate) => candidate.intentDigest === query.intentDigest);
    if (!requestRecord)
      throw new Error(
        "Authority reconciliation has no exact coordinator request.",
      );
    const authorityEvidence = chainAuthority.reconciliationEvidence(query);
    if (!authorityEvidence)
      throw new Error("Authority reconciliation evidence is unavailable.");
    if (
      authorityEvidence.revision !== projection.revision ||
      authorityEvidence.status !== projection.status
    )
      throw new Error(
        "Authority projection no longer matches the durable authority revision.",
      );

    let reservation;
    if (authorityEvidence.status === "authoritative") {
      const client = makerClientForId(query.makerId);
      if (!client)
        throw new Error("Authority reconciliation maker is unavailable.");
      reservation = await requestMaker(client, "/v1/reconciliation/snapshot", {
        target: makerTargetFromAuthorityQuery(query),
      });
    }

    const result = await makerReconciler.reconcile({
      query,
      coordinator: requestRecord,
      reservation,
      authorityEvidence,
    });
    if (result.staleAuthorityIgnored === true) return result;

    if (requiresMakerQuarantine(authorityEvidence)) {
      if (
        result.status !== "quarantined" ||
        result.authorityRevision !== authorityEvidence.revision
      )
        throw new Error(
          "Authority quarantine was not durably acknowledged by the exact maker.",
        );
      // Coordinator/market publication follows the durable pending row, exact
      // maker WAL acknowledgement, and final reconciliation-journal row.
      await quarantineProjection(projection);
    }
    if (
      authorityEvidence.status === "authoritative" &&
      !authorityEvidence.marketQuarantined &&
      result.status !== "released-terminal"
    )
      throw new Error(
        "Exact maker reconciliation did not durably reach terminal authority.",
      );
    return result;
  };

  const reconcileProjection = (projection) =>
    enqueue(() => reconcileProjectionUnlocked(projection));

  return Object.freeze({
    reconcileProjection,
    verifyAndReconcile(input) {
      return enqueue(async () => {
        const projection = await chainAuthority.verify(input);
        const reconciliation = await reconcileProjectionUnlocked(projection);
        return Object.freeze({ projection, reconciliation });
      });
    },
    recover() {
      return enqueue(async () => {
        for (const binding of makerReconciler.listRecoveryBindings()) {
          if (!chainAuthority.hasQueryDigest(binding.queryDigest))
            throw new Error(
              "Maker reconciliation journal has no matching durable chain authority query.",
            );
        }
        const projections = await chainAuthority.reverifyAll();
        const results = [];
        for (const projection of projections)
          results.push(await reconcileProjectionUnlocked(projection));
        return Object.freeze(results);
      });
    },
    listOperatorSummaries: () => makerReconciler.listOperatorSummaries(),
    hasUnresolvedAuthority() {
      const chainRows = chainAuthority.listOperatorSummaries?.() ?? [];
      const makerRows = makerReconciler.listOperatorSummaries();
      return (
        chainRows.some(
          (row) =>
            row.status !== "authoritative" || row.marketQuarantined === true,
        ) || makerRows.some((row) => row.status !== "released-terminal")
      );
    },
  });
}
