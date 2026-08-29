import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const DOMAIN = "app20/localnet-reservation-coordinator/v3";
const LEGACY_DOMAIN = "app20/localnet-reservation-coordinator/v2";
const HEX_32 = /^0x[0-9a-f]{64}$/;
const REQUEST_STATES = new Set([
  "open",
  "selection-pending",
  "selected",
  "ticket-pending",
  "ticket-ready",
  "release-check",
  "release-pending",
  "funding-pending",
  "funding-unknown",
  "funded",
  "filled",
  "settled",
  "expired",
  "refunded",
  "released",
  "authority-quarantined",
]);
const TERMINAL_REQUEST_STATES = new Set([
  "filled",
  "settled",
  "expired",
  "refunded",
  "released",
]);

function requireHex32(value, label) {
  if (typeof value !== "string" || !HEX_32.test(value))
    throw new Error(
      `${label} must be a canonical lowercase 32-byte hex value.`,
    );
  return value;
}

function requireFelt(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/.test(value))
    throw new Error(`${label} must be a lowercase felt.`);
  return `0x${BigInt(value).toString(16)}`;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error(`${label} is required and must not contain a NUL byte.`);
  return value.trim();
}

function requireFence(value) {
  const fence = requireText(value, "fence");
  if (!/^[1-9][0-9]*$/.test(fence))
    throw new Error("fence must be a positive canonical decimal string.");
  return fence;
}

function requireTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive timestamp.`);
  return value;
}

function requireAmount(value, label) {
  const text = typeof value === "bigint" ? value.toString() : value;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text))
    throw new Error(`${label} must be a positive canonical decimal amount.`);
  return text;
}

function validateTicketSettlementTerms(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Coordinator canonical ticket settlement terms are required.",
    );
  return Object.freeze({
    sellToken: requireFelt(value.sellToken, "sellToken"),
    sellAmount: requireAmount(value.sellAmount, "sellAmount"),
    buyToken: requireFelt(value.buyToken, "buyToken"),
    buyAmount: requireAmount(value.buyAmount, "buyAmount"),
    deadline: requireTimestamp(value.deadline, "deadline"),
  });
}

function validateSettlementTerms(value) {
  return Object.freeze({
    ...validateTicketSettlementTerms(value),
    ticketAddress: requireFelt(value.ticketAddress, "ticketAddress"),
  });
}

function validateTicketAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator funding-ticket authorization is invalid.");
  return Object.freeze({
    ticketAttemptId: requireText(value.ticketAttemptId, "ticketAttemptId"),
    dealId: requireFelt(value.dealId, "dealId"),
    ticketAddress: requireFelt(value.ticketAddress, "ticketAddress"),
    settlementTerms: validateSettlementTerms(value.settlementTerms),
  });
}

function requireMakerPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator maker plan must be an object.");
  const plan = {
    makerId: requireText(value.makerId, "makerId"),
    state: value.state,
  };
  if (!["planned", "responded", "refused", "expired"].includes(plan.state))
    throw new Error("Coordinator maker plan state is invalid.");
  return Object.freeze(plan);
}

function normalizeMakerPlans(value = []) {
  if (!Array.isArray(value))
    throw new Error("Coordinator maker plans must be an array.");
  const plans = value.map(requireMakerPlan);
  if (new Set(plans.map(({ makerId }) => makerId)).size !== plans.length)
    throw new Error("Coordinator maker plans contain a duplicate maker.");
  return Object.freeze(
    plans.sort((a, b) => a.makerId.localeCompare(b.makerId)),
  );
}

function keyOf(record) {
  return `${record.intentDigest}\0${record.reservationId}\0${record.makerId}`;
}

function clone(record) {
  return Object.freeze({ ...record });
}

function validatePendingSelection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator exact pending selection is invalid.");
  return Object.freeze({
    reservationId: requireHex32(value.reservationId, "reservationId"),
    makerId: requireText(value.makerId, "makerId"),
  });
}

function validateSelection(value) {
  return Object.freeze({
    ...validatePendingSelection(value),
    fence: requireFence(value.fence),
    quoteDigest: requireHex32(value.quoteDigest, "quoteDigest"),
  });
}

function validateRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator record must be an object.");
  const record = {
    intentDigest: requireHex32(value.intentDigest, "intentDigest"),
    reservationId: requireHex32(value.reservationId, "reservationId"),
    makerId: requireText(value.makerId, "makerId"),
    expiresAt: requireTimestamp(value.expiresAt, "expiresAt"),
    state: value.state,
    ...(value.fence === undefined ? {} : { fence: requireFence(value.fence) }),
    ...(value.quoteDigest === undefined
      ? {}
      : { quoteDigest: requireHex32(value.quoteDigest, "quoteDigest") }),
  };
  if (
    ![
      "reserved",
      "selected",
      "release-pending",
      "released",
      "expired",
      "consumed",
    ].includes(record.state)
  )
    throw new Error("Coordinator record state is invalid.");
  if ((record.fence === undefined) !== (record.quoteDigest === undefined))
    throw new Error("Selected coordinator authorization is incomplete.");
  return clone(record);
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator request must be an object.");
  const request = {
    intentDigest: requireHex32(value.intentDigest, "intentDigest"),
    rfqId: requireFelt(value.rfqId, "rfqId"),
    account: requireFelt(value.account, "account"),
    chainId: requireText(value.chainId, "chainId").toLowerCase(),
    createdAt: requireTimestamp(value.createdAt, "createdAt"),
    expiresAt: requireTimestamp(value.expiresAt, "expiresAt"),
    fanoutComplete: value.fanoutComplete === true,
    makerPlans: normalizeMakerPlans(value.makerPlans),
    ...(value.market === undefined
      ? {}
      : { market: requireText(value.market, "market").toLowerCase() }),
    ...(value.pendingSelection === undefined
      ? {}
      : { pendingSelection: validatePendingSelection(value.pendingSelection) }),
    ...(value.selection === undefined
      ? {}
      : { selection: validateSelection(value.selection) }),
    ...(value.ticketAttemptId === undefined
      ? {}
      : {
          ticketAttemptId: requireText(
            value.ticketAttemptId,
            "ticketAttemptId",
          ),
        }),
    ...(value.ticketDealId === undefined
      ? {}
      : { ticketDealId: requireFelt(value.ticketDealId, "ticketDealId") }),
    ...(value.ticketSettlementTerms === undefined
      ? {}
      : {
          ticketSettlementTerms: validateTicketSettlementTerms(
            value.ticketSettlementTerms,
          ),
        }),
    ...(value.ticketAuthorization === undefined
      ? {}
      : {
          ticketAuthorization: validateTicketAuthorization(
            value.ticketAuthorization,
          ),
        }),
    ...(value.fundingAttemptId === undefined
      ? {}
      : {
          fundingAttemptId: requireText(
            value.fundingAttemptId,
            "fundingAttemptId",
          ),
        }),
    ...(value.releaseLeaseId === undefined
      ? {}
      : {
          releaseLeaseId: requireText(value.releaseLeaseId, "releaseLeaseId"),
        }),
    ...(value.abandonedFundingAttemptId === undefined
      ? {}
      : {
          abandonedFundingAttemptId: requireText(
            value.abandonedFundingAttemptId,
            "abandonedFundingAttemptId",
          ),
        }),
    ...(value.authorityRevision === undefined
      ? {}
      : {
          authorityRevision: requireTimestamp(
            value.authorityRevision,
            "authorityRevision",
          ),
          authorityReason: requireText(value.authorityReason, "authorityReason"),
        }),
    ...(value.settlementTerms === undefined
      ? {}
      : { settlementTerms: validateSettlementTerms(value.settlementTerms) }),
    state: value.state,
  };
  if (!REQUEST_STATES.has(request.state))
    throw new Error("Coordinator request state is invalid.");
  if (
    request.state === "selection-pending" &&
    (!request.pendingSelection || request.selection)
  )
    throw new Error(
      "Coordinator selection-pending state requires only its exact pending selection.",
    );
  if (request.state !== "selection-pending" && request.pendingSelection)
    throw new Error(
      "Coordinator pending selection is forbidden outside selection-pending state.",
    );
  if (
    [
      "selected",
      "ticket-pending",
      "ticket-ready",
      "funding-pending",
      "funding-unknown",
      "funded",
      "filled",
      "settled",
      "expired",
      "refunded",
      "authority-quarantined",
    ].includes(request.state) &&
    !request.selection
  )
    throw new Error("Coordinator request state requires an exact selection.");
  if (
    ["ticket-pending", "ticket-ready"].includes(request.state) &&
    (!request.ticketAttemptId ||
      !request.ticketDealId ||
      !request.ticketSettlementTerms)
  )
    throw new Error(
      "Coordinator ticket state requires the complete exact pre-side-effect journal.",
    );
  if (request.state === "ticket-ready" && !request.ticketAuthorization)
    throw new Error(
      "Coordinator ticket-ready state requires the finalized exact ticket address.",
    );
  if (
    ["funding-pending", "funding-unknown"].includes(request.state) &&
    !request.fundingAttemptId
  )
    throw new Error(
      "Coordinator funding state requires an exact attempt lease.",
    );
  if (
    ["release-check", "release-pending"].includes(request.state) &&
    !request.releaseLeaseId
  )
    throw new Error(
      "Coordinator release state requires an exact release lease.",
    );
  if (
    request.ticketAuthorization &&
    (request.ticketAuthorization.ticketAttemptId !== request.ticketAttemptId ||
      request.ticketAuthorization.dealId !== request.rfqId ||
      (request.ticketDealId !== undefined &&
        request.ticketAuthorization.dealId !== request.ticketDealId) ||
      (request.ticketSettlementTerms !== undefined &&
        JSON.stringify(request.ticketAuthorization.settlementTerms) !==
          JSON.stringify({
            ...request.ticketSettlementTerms,
            ticketAddress: request.ticketAuthorization.ticketAddress,
          })))
  )
    throw new Error(
      "Coordinator ticket authorization contradicts its request identity or settlement terms.",
    );
  return clone(request);
}

function validateDeal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator deal association must be an object.");
  return clone({
    intentDigest: requireHex32(value.intentDigest, "intentDigest"),
    rfqId: requireFelt(value.rfqId, "rfqId"),
    account: requireFelt(value.account, "account"),
    chainId: requireText(value.chainId, "chainId").toLowerCase(),
    dealId: requireFelt(value.dealId, "dealId"),
    reservationId: requireHex32(value.reservationId, "reservationId"),
    makerId: requireText(value.makerId, "makerId"),
    fence: requireFence(value.fence),
    quoteDigest: requireHex32(value.quoteDigest, "quoteDigest"),
  });
}

function requestBinding(input) {
  return {
    intentDigest: requireHex32(input.intentDigest, "intentDigest"),
    rfqId: requireFelt(input.rfqId, "rfqId"),
    account: requireFelt(input.account, "account"),
    chainId: requireText(input.chainId, "chainId").toLowerCase(),
  };
}

function exactTarget(input) {
  return {
    ...requestBinding(input),
    dealId: requireFelt(input.dealId, "dealId"),
    reservationId: requireHex32(input.reservationId, "reservationId"),
    makerId: requireText(input.makerId, "makerId"),
    fence: requireFence(input.fence),
    quoteDigest: requireHex32(input.quoteDigest, "quoteDigest"),
  };
}

function sameRequest(left, right) {
  return (
    left.intentDigest === right.intentDigest &&
    left.rfqId === right.rfqId &&
    left.account === right.account &&
    left.chainId === right.chainId &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    left.market === right.market &&
    JSON.stringify(left.makerPlans) === JSON.stringify(right.makerPlans)
  );
}

function assertRequestBinding(request, binding, action) {
  if (
    !request ||
    request.rfqId !== binding.rfqId ||
    request.account !== binding.account ||
    request.chainId !== binding.chainId
  )
    throw new Error(
      `${action} target does not match the durable request principal and RFQ.`,
    );
}

function pendingSelectionMatches(selection, target) {
  return Boolean(
    selection &&
      selection.reservationId === target.reservationId &&
      selection.makerId === target.makerId,
  );
}

function selectionMatches(selection, target) {
  return Boolean(
    pendingSelectionMatches(selection, target) &&
      selection.fence === target.fence &&
      selection.quoteDigest === target.quoteDigest,
  );
}

export class LocalnetReservationCoordinator {
  #path;
  #records = new Map();
  #requests = new Map();
  #deals = new Map();
  #rfqs = new Map();
  #tail = Promise.resolve();
  #activeLoserReleases = new Map();
  #durableAuthority;
  #durableSerialized;
  #failed = false;
  #faultInjector;

  constructor(path, options = {}) {
    this.#path = path;
    this.#faultInjector = options.faultInjector;
    if (!existsSync(path)) {
      this.#durableAuthority = this.#captureAuthority();
      return;
    }
    this.#durableSerialized = readFileSync(path, "utf8");
    const journal = JSON.parse(this.#durableSerialized);
    const current = journal?.domain === DOMAIN && journal?.version === 3;
    const legacy = journal?.domain === LEGACY_DOMAIN && journal?.version === 2;
    if (
      (!current && !legacy) ||
      !Array.isArray(journal.records) ||
      !Array.isArray(journal.requests) ||
      !Array.isArray(journal.deals)
    )
      throw new Error("Localnet reservation coordinator journal is invalid.");
    for (const value of journal.requests) {
      const legacySelection = legacy
        ? journal.records.find(
            (record) =>
              record.intentDigest === value.intentDigest &&
              record.state === "selected" &&
              record.fence &&
              record.quoteDigest,
          )
        : undefined;
      const migratedTicket =
        !legacy && value.ticketAuthorization
          ? {
              ...value,
              state:
                value.state === "selected" &&
                value.ticketDealId === undefined &&
                value.ticketSettlementTerms === undefined &&
                !value.abandonedFundingAttemptId
                  ? "ticket-ready"
                  : value.state,
              ticketDealId:
                value.ticketDealId ?? value.ticketAuthorization.dealId,
              ticketSettlementTerms:
                value.ticketSettlementTerms ??
                value.ticketAuthorization.settlementTerms,
              settlementTerms:
                value.settlementTerms ??
                value.ticketAuthorization.settlementTerms,
            }
          : value;
      const request = validateRequest(
        legacy
          ? {
              ...value,
              state:
                value.state === "released"
                  ? "released"
                  : ["release-check", "release-pending"].includes(value.state)
                    ? value.state
                    : legacySelection
                      ? "selected"
                      : value.state,
              ...(legacySelection ? { selection: legacySelection } : {}),
              releaseLeaseId:
                value.state === "release-pending"
                  ? `legacy-release:${value.intentDigest}`
                  : undefined,
            }
          : migratedTicket,
      );
      if (this.#requests.has(request.intentDigest))
        throw new Error("Coordinator journal contains a duplicate request.");
      const priorRfq = this.#rfqs.get(request.rfqId);
      if (priorRfq && priorRfq !== request.intentDigest)
        throw new Error(
          "Coordinator journal contains a duplicate RFQ identity.",
        );
      this.#requests.set(request.intentDigest, request);
      this.#rfqs.set(request.rfqId, request.intentDigest);
    }
    for (const value of journal.records) {
      const record = validateRecord(value);
      const key = keyOf(record);
      if (this.#records.has(key))
        throw new Error("Coordinator journal contains a duplicate attempt.");
      this.#records.set(key, record);
    }
    for (const value of journal.deals) {
      const deal = validateDeal(value);
      if (this.#deals.has(deal.dealId))
        throw new Error(
          "Coordinator journal contains a duplicate deal association.",
        );
      this.#deals.set(deal.dealId, deal);
    }
    this.#durableAuthority = this.#captureAuthority();
    if (this.#serializedAuthority() !== this.#durableSerialized)
      this.#persist();
  }

  #captureAuthority() {
    return Object.freeze({
      records: new Map(this.#records),
      requests: new Map(this.#requests),
      deals: new Map(this.#deals),
      rfqs: new Map(this.#rfqs),
    });
  }

  #restoreAuthority(authority) {
    this.#records = new Map(authority.records);
    this.#requests = new Map(authority.requests);
    this.#deals = new Map(authority.deals);
    this.#rfqs = new Map(authority.rfqs);
  }

  #serializedAuthority() {
    const records = [...this.#records.values()].sort((a, b) =>
      keyOf(a).localeCompare(keyOf(b)),
    );
    const requests = [...this.#requests.values()].sort((a, b) =>
      a.intentDigest.localeCompare(b.intentDigest),
    );
    const deals = [...this.#deals.values()].sort((a, b) =>
      a.dealId.localeCompare(b.dealId),
    );
    return `${JSON.stringify({ version: 3, domain: DOMAIN, requests, records, deals }, null, 2)}\n`;
  }

  #serialize(operation) {
    const run = this.#tail.then(() => {
      if (this.#failed)
        throw new Error(
          "Coordinator is fail-stopped after an uncertain durable journal failure; reopen it from disk before retrying.",
        );
      return operation();
    });
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #checkpoint(stage) {
    this.#faultInjector?.(stage);
  }

  #rollbackDurableFile(serialized) {
    const directoryPath = dirname(this.#path);
    if (serialized === undefined) {
      if (existsSync(this.#path)) unlinkSync(this.#path);
    } else {
      const rollback = `${this.#path}.${process.pid}.rollback.tmp`;
      writeFileSync(rollback, serialized, { mode: 0o600 });
      const file = openSync(rollback, "r");
      try {
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      renameSync(rollback, this.#path);
      chmodSync(this.#path, 0o600);
    }
    const directory = openSync(directoryPath, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }

  #persist() {
    const durableAuthority = this.#durableAuthority;
    const durableSerialized = this.#durableSerialized;
    let directoryPath;
    let temporary;
    let candidate;
    let renamed = false;
    try {
      directoryPath = dirname(this.#path);
      temporary = `${this.#path}.${process.pid}.tmp`;
      this.#checkpoint("serialize");
      candidate = this.#serializedAuthority();
      this.#checkpoint("mkdir");
      mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
      this.#checkpoint("write");
      writeFileSync(temporary, candidate, { mode: 0o600 });
      const file = openSync(temporary, "r");
      try {
        this.#checkpoint("file-fsync");
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      this.#checkpoint("rename");
      renameSync(temporary, this.#path);
      renamed = true;
      this.#checkpoint("chmod");
      chmodSync(this.#path, 0o600);
      const directory = openSync(directoryPath, "r");
      try {
        this.#checkpoint("dir-fsync");
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      const candidateAuthority = this.#captureAuthority();
      this.#durableSerialized = candidate;
      this.#durableAuthority = candidateAuthority;
    } catch (error) {
      this.#failed = true;
      this.#restoreAuthority(durableAuthority);
      try {
        if (!renamed && temporary && existsSync(temporary))
          unlinkSync(temporary);
        if (renamed) this.#rollbackDurableFile(durableSerialized);
      } catch {
        // Memory is already restored and the instance remains fail-stopped even
        // if best-effort temporary cleanup or disk rollback also fails.
      }
      throw new Error(
        "Coordinator durable journal commit failed; the instance is fail-stopped and must be reopened from disk.",
        { cause: error },
      );
    }
  }

  beginRequest(input) {
    return this.#serialize(() => {
      const request = validateRequest({
        ...input,
        fanoutComplete: false,
        makerPlans: (input.makerIds ?? []).map((makerId) => ({
          makerId,
          state: "planned",
        })),
        state: "open",
      });
      const prior = this.#requests.get(request.intentDigest);
      if (prior) {
        if (TERMINAL_REQUEST_STATES.has(prior.state))
          throw new Error(
            "Terminal request tombstone prevents request resurrection.",
          );
        if (!sameRequest(prior, request))
          throw new Error(
            "Request digest was reused with different principal or RFQ identity.",
          );
        return prior;
      }
      const rfqOwner = this.#rfqs.get(request.rfqId);
      if (rfqOwner && rfqOwner !== request.intentDigest)
        throw new Error("RFQ identity is already reserved by another request.");
      if (
        request.market &&
        [...this.#requests.values()].some(
          (candidate) =>
            candidate.intentDigest !== request.intentDigest &&
            !TERMINAL_REQUEST_STATES.has(candidate.state) &&
            candidate.account === request.account &&
            candidate.chainId === request.chainId &&
            candidate.market === request.market,
        )
      )
        throw new Error(
          "An active request already holds the account, chain, and market lease.",
        );
      this.#requests.set(request.intentDigest, request);
      this.#rfqs.set(request.rfqId, request.intentDigest);
      this.#persist();
      return request;
    });
  }

  markFanoutRefused(intentDigest, makerId) {
    return this.#serialize(() => {
      const digest = requireHex32(intentDigest, "intentDigest");
      const maker = requireText(makerId, "makerId");
      const prior = this.#requests.get(digest);
      if (!prior)
        throw new Error("Cannot update fanout for an unknown request.");
      const plan = prior.makerPlans.find((entry) => entry.makerId === maker);
      if (!plan) throw new Error("Maker was not in the durable fanout plan.");
      if (plan.state === "responded") return prior;
      const next = validateRequest({
        ...prior,
        makerPlans: prior.makerPlans.map((entry) =>
          entry.makerId === maker ? { ...entry, state: "refused" } : entry,
        ),
      });
      this.#requests.set(digest, next);
      this.#persist();
      return next;
    });
  }

  completeRequestFanout(intentDigest) {
    return this.#serialize(() => {
      const digest = requireHex32(intentDigest, "intentDigest");
      const prior = this.#requests.get(digest);
      if (!prior)
        throw new Error("Cannot complete fanout for an unknown request.");
      if (prior.makerPlans.some((plan) => plan.state === "planned"))
        throw new Error(
          "Cannot complete fanout while a maker outcome is ambiguous.",
        );
      const pending = [...this.#records.values()].some(
        (record) =>
          record.intentDigest === digest &&
          !["released", "expired", "consumed"].includes(record.state),
      );
      const allInvitedMakersRefused =
        prior.makerPlans.length > 0 &&
        prior.makerPlans.every((plan) => plan.state === "refused");
      const state =
        !pending &&
        (prior.state === "release-pending" || allInvitedMakersRefused)
          ? "released"
          : prior.state;
      const next = validateRequest({ ...prior, fanoutComplete: true, state });
      this.#requests.set(digest, next);
      this.#persist();
      return next;
    });
  }

  register(input, release) {
    return this.#serialize(async () => {
      const record = validateRecord({ ...input, state: "reserved" });
      let request = this.#requests.get(record.intentDigest);
      if (!request)
        throw new Error(
          "Reservation registration requires a durable request journal entry.",
        );
      const planned = request.makerPlans.find(
        (entry) => entry.makerId === record.makerId,
      );
      if (request.makerPlans.length && !planned)
        throw new Error(
          "Reservation maker was not in the durable fanout plan.",
        );
      if (planned?.state !== "responded") {
        request = validateRequest({
          ...request,
          makerPlans: request.makerPlans.map((entry) =>
            entry.makerId === record.makerId
              ? { ...entry, state: "responded" }
              : entry,
          ),
        });
        this.#requests.set(record.intentDigest, request);
        this.#persist();
      }
      const key = keyOf(record);
      const prior = this.#records.get(key);
      if (prior) {
        if (prior.expiresAt !== record.expiresAt)
          throw new Error(
            "Reservation attempt was reused with a different expiry.",
          );
        return prior;
      }
      if (request.state !== "open") {
        const pending = validateRecord({ ...record, state: "release-pending" });
        this.#records.set(key, pending);
        this.#persist();
        try {
          if (
            await release(
              pending,
              "late reservation released behind request tombstone",
            )
          ) {
            const released = validateRecord({ ...pending, state: "released" });
            this.#records.set(key, released);
            this.#persist();
            return released;
          }
        } catch (error) {
          if (this.#failed) throw error;
          /* durable pending retry */
        }
        if (
          request.state !== "release-check" &&
          request.state !== "release-pending" &&
          !TERMINAL_REQUEST_STATES.has(request.state)
        )
          throw new Error(
            "Late reservation conflicts with an active funding state.",
          );
        this.#requests.set(
          request.intentDigest,
          validateRequest({ ...request, state: "release-pending" }),
        );
        this.#persist();
        return pending;
      }
      this.#records.set(key, record);
      this.#persist();
      return record;
    });
  }

  beginSelection(input) {
    return this.#serialize(() => {
      const intentDigest = requireHex32(input.intentDigest, "intentDigest");
      const pendingSelection = validatePendingSelection(input);
      const key = `${intentDigest}\0${pendingSelection.reservationId}\0${pendingSelection.makerId}`;
      const record = this.#records.get(key);
      if (!record || !["reserved", "selected"].includes(record.state))
        throw new Error(
          "Only a known durable reservation can begin selection.",
        );
      const request = this.#requests.get(intentDigest);
      if (!request) throw new Error("Unknown request cannot begin selection.");
      if (request.selection) {
        if (!pendingSelectionMatches(request.selection, pendingSelection))
          throw new Error(
            "Request is already bound to another exact selection.",
          );
        return request;
      }
      if (request.state === "selection-pending") {
        if (
          !pendingSelectionMatches(request.pendingSelection, pendingSelection)
        )
          throw new Error(
            "Another exact reservation already owns the durable selection lease.",
          );
        return request;
      }
      if (request.state !== "open")
        throw new Error("Request state cannot begin selection.");
      const next = validateRequest({
        ...request,
        state: "selection-pending",
        pendingSelection,
      });
      this.#requests.set(intentDigest, next);
      this.#persist();
      return next;
    });
  }

  confirmSelection(input) {
    return this.#serialize(() => {
      const intentDigest = requireHex32(input.intentDigest, "intentDigest");
      const selection = validateSelection(input);
      const key = `${intentDigest}\0${selection.reservationId}\0${selection.makerId}`;
      const prior = this.#records.get(key);
      if (!prior || !["reserved", "selected"].includes(prior.state))
        throw new Error("Only a known reserved attempt can be selected.");
      const request = this.#requests.get(intentDigest);
      if (!request)
        throw new Error("Unknown request cannot confirm selection.");
      if (request.selection) {
        if (!selectionMatches(request.selection, selection))
          throw new Error(
            "Request is already bound to another exact selection.",
          );
        return this.#confirmedSelectionRecord(request, "Selection replay");
      }
      if (
        request.state !== "selection-pending" ||
        !pendingSelectionMatches(request.pendingSelection, selection)
      )
        throw new Error(
          "Maker acknowledgement does not own the exact durable pending selection.",
        );
      const nextRecord = validateRecord({
        ...prior,
        state: "selected",
        fence: selection.fence,
        quoteDigest: selection.quoteDigest,
      });
      const { pendingSelection: _pendingSelection, ...rest } = request;
      const nextRequest = validateRequest({
        ...rest,
        state: "selected",
        selection,
      });
      this.#records.set(key, nextRecord);
      this.#requests.set(intentDigest, nextRequest);
      this.#persist();
      return nextRecord;
    });
  }

  async markSelected(input) {
    await this.beginSelection(input);
    return this.confirmSelection(input);
  }

  quarantineAuthority(input) {
    return this.#serialize(() => {
      const { request } = this.#exactRequest(input, "Authority quarantine");
      const revision = requireTimestamp(input.authorityRevision, "authorityRevision");
      const reason = requireText(input.authorityReason, "authorityReason");
      if (request.state === "authority-quarantined") {
        if (request.authorityRevision === revision && request.authorityReason === reason)
          return request;
        if (revision <= request.authorityRevision)
          throw new Error("Authority quarantine revision must increase.");
      } else if (!["filled", "settled", "expired", "refunded"].includes(request.state)) {
        throw new Error("Only an observed terminal request can enter authority quarantine.");
      }
      const next = validateRequest({
        ...request,
        state: "authority-quarantined",
        authorityRevision: revision,
        authorityReason: reason,
      });
      this.#requests.set(request.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  #confirmedSelectionRecord(request, action) {
    if (!request.selection)
      throw new Error(`${action} requires a durable confirmed selection.`);
    const record = this.#records.get(
      `${request.intentDigest}\0${request.selection.reservationId}\0${request.selection.makerId}`,
    );
    if (
      !record ||
      record.state !== "selected" ||
      !selectionMatches(request.selection, record)
    )
      throw new Error(
        `${action} requires the exact durable winner record to remain selected and not released.`,
      );
    return record;
  }

  #exactRequest(input, action) {
    const target = exactTarget(input);
    if (target.dealId !== target.rfqId)
      throw new Error(
        "Deal identity is not the RFQ identity bound before fanout.",
      );
    const request = this.#requests.get(target.intentDigest);
    assertRequestBinding(request, target, action);
    if (!selectionMatches(request.selection, target))
      throw new Error(
        `${action} target does not match the exact durable selection.`,
      );
    return { request, target };
  }

  authorizeFundingTicket(input) {
    return this.#serialize(() => {
      const { request, target } = this.#exactRequest(input, "Funding ticket");
      this.#confirmedSelectionRecord(request, "Funding ticket");
      const attemptId = requireText(input.attemptId, "attemptId");
      const ticketSettlementTerms = validateTicketSettlementTerms(input);
      if (["ticket-pending", "ticket-ready"].includes(request.state)) {
        if (
          request.ticketAttemptId !== attemptId ||
          request.ticketDealId !== target.dealId ||
          JSON.stringify(request.ticketSettlementTerms) !==
            JSON.stringify(ticketSettlementTerms)
        )
          throw new Error(
            "Another exact browser funding attempt or settlement target owns the ticket lease.",
          );
        return request;
      }
      if (request.state !== "selected")
        throw new Error(
          `Funding ticket cannot be authorized while request state is ${request.state}.`,
        );
      if (request.abandonedFundingAttemptId)
        throw new Error("Funding ticket is closed after exact abandonment.");
      if (request.ticketAttemptId && request.ticketAttemptId !== attemptId)
        throw new Error(
          "Another exact browser funding attempt owns the ticket lease.",
        );
      const next = validateRequest({
        ...request,
        state: "ticket-pending",
        ticketAttemptId: attemptId,
        ticketDealId: target.dealId,
        ticketSettlementTerms,
      });
      this.#requests.set(request.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  persistFundingTicket(input) {
    return this.#serialize(() => {
      const { request, target } = this.#exactRequest(
        input,
        "Funding ticket persistence",
      );
      this.#confirmedSelectionRecord(request, "Funding ticket persistence");
      const ticketAttemptId = requireText(input.attemptId, "attemptId");
      if (
        !["ticket-pending", "ticket-ready"].includes(request.state) ||
        request.ticketAttemptId !== ticketAttemptId ||
        request.ticketDealId !== target.dealId
      )
        throw new Error(
          "Funding ticket persistence requires its exact pending or ready browser attempt.",
        );
      const settlementTerms = validateSettlementTerms(input);
      const { ticketAddress: _ticketAddress, ...ticketSettlementTerms } =
        settlementTerms;
      if (
        JSON.stringify(request.ticketSettlementTerms) !==
        JSON.stringify(ticketSettlementTerms)
      )
        throw new Error(
          "Funding ticket persistence changed its exact pre-side-effect settlement terms.",
        );
      const ticketAuthorization = validateTicketAuthorization({
        ticketAttemptId,
        dealId: target.dealId,
        ticketAddress: settlementTerms.ticketAddress,
        settlementTerms,
      });
      if (request.ticketAuthorization) {
        if (
          JSON.stringify(request.ticketAuthorization) !==
          JSON.stringify(ticketAuthorization)
        )
          throw new Error(
            "Funding ticket replay changed its exact address or settlement terms.",
          );
        return request;
      }
      const next = validateRequest({
        ...request,
        state: "ticket-ready",
        ticketAuthorization,
        settlementTerms,
      });
      this.#requests.set(request.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  prepareFunding(input) {
    return this.#serialize(() => {
      const { request, target } = this.#exactRequest(input, "Funding lease");
      this.#confirmedSelectionRecord(request, "Funding lease");
      const attemptId = requireText(input.attemptId, "attemptId");
      const settlementTerms = validateSettlementTerms(input);
      if (request.abandonedFundingAttemptId)
        throw new Error(
          "This selected quote is durably funding-closed after abandonment; every later funding preparation is forbidden.",
        );
      if (request.state === "funding-unknown")
        throw new Error(
          "Funding outcome is unknown; reconcile the exact active attempt without preparing another wallet submission.",
        );
      if (request.state === "funded")
        throw new Error(
          "Funding is already authoritatively recorded; another preparation is forbidden.",
        );
      if (request.state === "selected" && !request.ticketAuthorization)
        throw new Error(
          "Funding preparation requires a durable exact funding-ticket authorization.",
        );
      if (!["ticket-ready", "funding-pending"].includes(request.state))
        throw new Error(
          `Funding cannot begin while request state is ${request.state}.`,
        );
      if (!request.ticketAuthorization)
        throw new Error(
          "Funding preparation requires a durable exact funding-ticket authorization.",
        );
      if (
        request.ticketAttemptId !== attemptId ||
        request.ticketAuthorization.ticketAttemptId !== attemptId
      )
        throw new Error(
          "Funding preparation changed the ticket-authorized attempt.",
        );
      if (
        request.ticketAuthorization.dealId !== target.dealId ||
        JSON.stringify(request.ticketAuthorization.settlementTerms) !==
          JSON.stringify(settlementTerms)
      )
        throw new Error(
          "Funding preparation changed the ticket-authorized canonical settlement terms or address.",
        );
      if (request.state === "funding-pending") {
        if (request.fundingAttemptId !== attemptId)
          throw new Error(
            "Another exact funding attempt already owns the request lease.",
          );
        if (
          JSON.stringify(request.settlementTerms) !==
          JSON.stringify(settlementTerms)
        )
          throw new Error(
            "Funding replay changed the canonical settlement terms.",
          );
        return request;
      }
      const next = validateRequest({
        ...request,
        state: "funding-pending",
        fundingAttemptId: attemptId,
        settlementTerms,
      });
      this.#requests.set(target.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  markFundingUnknown(input) {
    return this.#serialize(() => {
      const { request, target } = this.#exactRequest(input, "Funding unknown");
      this.#confirmedSelectionRecord(request, "Funding unknown");
      const attemptId = requireText(input.attemptId, "attemptId");
      if (
        request.fundingAttemptId !== attemptId ||
        !["funding-pending", "funding-unknown"].includes(request.state)
      )
        throw new Error(
          "Only the exact active funding lease may become unknown.",
        );
      if (request.state === "funding-unknown") return request;
      const next = validateRequest({ ...request, state: "funding-unknown" });
      this.#requests.set(target.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  resolveFundingReverted(_input) {
    return this.#serialize(() => {
      throw new Error(
        "Funding-reverted reopening is disabled; unknown funding remains fail-closed.",
      );
    });
  }

  abandonFunding(input) {
    return this.#serialize(() => {
      const { request, target } = this.#exactRequest(
        input,
        "Funding abandonment",
      );
      const attemptId = requireText(input.attemptId, "attemptId");
      const settlementTerms = validateSettlementTerms(input);
      if (request.ticketAuthorization) {
        if (
          request.ticketAttemptId !== attemptId ||
          request.ticketDealId !== target.dealId ||
          request.ticketAuthorization.ticketAttemptId !== attemptId ||
          request.ticketAuthorization.dealId !== target.dealId ||
          request.ticketAuthorization.ticketAddress !==
            settlementTerms.ticketAddress ||
          JSON.stringify(request.ticketSettlementTerms) !==
            JSON.stringify(validateTicketSettlementTerms(settlementTerms)) ||
          JSON.stringify(request.ticketAuthorization.settlementTerms) !==
            JSON.stringify(settlementTerms) ||
          JSON.stringify(request.settlementTerms) !==
            JSON.stringify(settlementTerms)
        )
          throw new Error(
            "Funding abandonment is funding-closed by a different exact durable ticket attempt, deal, address, or canonical settlement terms.",
          );
      }
      if (request.state === "ticket-ready") {
        const next = validateRequest({
          ...request,
          state: "selected",
          abandonedFundingAttemptId: attemptId,
        });
        this.#requests.set(target.intentDigest, next);
        this.#persist();
        return next;
      }
      if (
        ["release-check", "release-pending", "released"].includes(request.state)
      ) {
        if (
          request.abandonedFundingAttemptId &&
          request.abandonedFundingAttemptId !== attemptId
        )
          throw new Error(
            "This released request is funding-closed by a different exact abandoned attempt.",
          );
        if (
          request.settlementTerms &&
          JSON.stringify(request.settlementTerms) !==
            JSON.stringify(settlementTerms)
        )
          throw new Error(
            "Funding abandonment replay changed canonical settlement terms.",
          );
        if (
          request.abandonedFundingAttemptId === attemptId &&
          request.settlementTerms
        )
          return request;
        const next = validateRequest({
          ...request,
          settlementTerms,
          abandonedFundingAttemptId: attemptId,
        });
        this.#requests.set(target.intentDigest, next);
        this.#persist();
        return next;
      }
      if (request.state === "selected") {
        if (request.abandonedFundingAttemptId) {
          if (request.abandonedFundingAttemptId !== attemptId)
            throw new Error(
              "This selected quote is funding-closed by a different exact abandoned attempt.",
            );
          if (
            JSON.stringify(request.settlementTerms) !==
            JSON.stringify(settlementTerms)
          )
            throw new Error(
              "Funding abandonment replay changed canonical settlement terms.",
            );
          return request;
        }
        const next = validateRequest({
          ...request,
          settlementTerms,
          abandonedFundingAttemptId: attemptId,
        });
        this.#requests.set(target.intentDigest, next);
        this.#persist();
        return next;
      }
      if (
        request.state !== "funding-pending" ||
        request.fundingAttemptId !== attemptId
      )
        throw new Error(
          "Only an exact selected pre-wallet attempt or its matching pre-submission funding lease may be abandoned.",
        );
      if (
        JSON.stringify(request.settlementTerms) !==
        JSON.stringify(settlementTerms)
      )
        throw new Error(
          "Funding abandonment changed canonical settlement terms.",
        );
      const { fundingAttemptId: _discard, ...rest } = request;
      const next = validateRequest({
        ...rest,
        state: "selected",
        abandonedFundingAttemptId: attemptId,
      });
      this.#requests.set(target.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  observeFunded(input) {
    return this.#serialize(() => {
      const { request, target } = this.#exactRequest(
        input,
        "Funded observation",
      );
      this.#confirmedSelectionRecord(request, "Funded observation");
      if (
        !["funding-pending", "funding-unknown", "funded"].includes(
          request.state,
        )
      )
        throw new Error(
          "Funding was observed without an exact server funding lease.",
        );
      if (
        request.state !== "funded" &&
        request.fundingAttemptId !== requireText(input.attemptId, "attemptId")
      )
        throw new Error(
          "Funded observation does not own the exact funding lease.",
        );
      const deal = validateDeal(target);
      const prior = this.#deals.get(target.dealId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(deal))
        throw new Error(
          "Deal identity is already bound to another request or reservation.",
        );
      if (!prior) this.#deals.set(target.dealId, deal);
      const next = validateRequest({ ...request, state: "funded" });
      this.#requests.set(target.intentDigest, next);
      this.#persist();
      return prior ?? deal;
    });
  }

  bindDeal(input) {
    return this.#serialize(() => {
      const { request, target } = this.#exactRequest(input, "Deal binding");
      if (!["funded", "filled", "settled", "expired"].includes(request.state))
        throw new Error(
          "Deal binding requires an authoritative funded or terminal observation.",
        );
      const deal = validateDeal(target);
      const prior = this.#deals.get(target.dealId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(deal))
        throw new Error(
          "Deal identity is already bound to another request or reservation.",
        );
      if (!prior) {
        this.#deals.set(target.dealId, deal);
        this.#persist();
      }
      return prior ?? deal;
    });
  }

  acquireReleaseLease(input) {
    return this.#serialize(() => {
      const binding = requestBinding(input);
      const leaseId = requireText(input.releaseLeaseId, "releaseLeaseId");
      let request = this.#requests.get(binding.intentDigest);
      if (!request) {
        const stamp = requireTimestamp(input.now, "now");
        const owner = this.#rfqs.get(binding.rfqId);
        if (owner && owner !== binding.intentDigest)
          throw new Error(
            "RFQ identity is already reserved by another request.",
          );
        request = validateRequest({
          ...binding,
          createdAt: stamp,
          expiresAt: stamp,
          fanoutComplete: true,
          makerPlans: [],
          state: "release-check",
          releaseLeaseId: leaseId,
        });
        this.#requests.set(binding.intentDigest, request);
        this.#rfqs.set(binding.rfqId, binding.intentDigest);
        this.#persist();
        return request;
      }
      assertRequestBinding(request, binding, "Release lease");
      if (["release-check", "release-pending"].includes(request.state)) {
        if (request.releaseLeaseId !== leaseId)
          throw new Error("Another exact release lease owns this request.");
        return request;
      }
      if (request.state === "released") return request;
      if (!["open", "selected", "ticket-ready"].includes(request.state))
        throw new Error(
          `Request release is blocked while durable state is ${request.state}.`,
        );
      if (
        [...this.#deals.values()].some(
          (deal) => deal.intentDigest === binding.intentDigest,
        )
      )
        throw new Error(
          "Request release is blocked by a durable funded deal association.",
        );
      const next = validateRequest({
        ...request,
        state: "release-check",
        releaseLeaseId: leaseId,
      });
      this.#requests.set(binding.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  observeFundedDuringRelease(input) {
    return this.#serialize(() => {
      const binding = requestBinding(input);
      const leaseId = requireText(input.releaseLeaseId, "releaseLeaseId");
      const request = this.#requests.get(binding.intentDigest);
      assertRequestBinding(request, binding, "Release-funded observation");
      if (
        request.state !== "release-check" ||
        request.releaseLeaseId !== leaseId
      )
        throw new Error(
          "Only the exact release lease may record its escrow observation.",
        );
      if (!request.selection)
        throw new Error(
          "Observed funding has no exact durable selection; request remains fenced.",
        );
      const deal = validateDeal({
        ...binding,
        dealId: binding.rfqId,
        ...request.selection,
      });
      const prior = this.#deals.get(deal.dealId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(deal))
        throw new Error(
          "Observed deal conflicts with the durable exact selection.",
        );
      if (!prior) this.#deals.set(deal.dealId, deal);
      const { releaseLeaseId: _discard, ...rest } = request;
      const next = validateRequest({ ...rest, state: "funded" });
      this.#requests.set(binding.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  async #releaseRecords(records, release, now, reason) {
    const unresolved = [];
    for (const current of records) {
      const key = keyOf(current);
      if (["released", "expired", "consumed"].includes(current.state)) continue;
      if (current.expiresAt <= now) {
        this.#records.set(
          key,
          validateRecord({ ...current, state: "expired" }),
        );
        this.#persist();
        continue;
      }
      const pending = validateRecord({ ...current, state: "release-pending" });
      this.#records.set(key, pending);
      this.#persist();
      try {
        if (await release(pending, reason)) {
          this.#records.set(
            key,
            validateRecord({ ...pending, state: "released" }),
          );
          this.#persist();
          continue;
        }
      } catch (error) {
        if (this.#failed) throw error;
        /* maker may have committed; retry the durable pending attempt */
      }
      unresolved.push(clone(this.#records.get(key)));
    }
    return Object.freeze(unresolved);
  }

  async #releaseLoser(record, release, now) {
    const key = keyOf(record);
    const active = this.#activeLoserReleases.get(key);
    if (active) return active;
    const attempt = (async () => {
      const pending = await this.#serialize(() => {
        const current = this.#records.get(key);
        if (
          !current ||
          ["released", "expired", "consumed"].includes(current.state)
        )
          return null;
        if (current.expiresAt <= now) {
          this.#records.set(
            key,
            validateRecord({ ...current, state: "expired" }),
          );
          this.#persist();
          return null;
        }
        const next = validateRecord({ ...current, state: "release-pending" });
        this.#records.set(key, next);
        this.#persist();
        return clone(next);
      });
      if (!pending) return null;
      let released = false;
      try {
        released = await release(
          pending,
          "losing quote released after durable selection confirmation",
        );
      } catch (error) {
        if (this.#failed) throw error;
        // The maker may have committed. The durable pending record is retried.
      }
      return this.#serialize(() => {
        const current = this.#records.get(key);
        if (
          !current ||
          ["released", "expired", "consumed"].includes(current.state)
        )
          return null;
        if (!released) return clone(current);
        const next = validateRecord({ ...current, state: "released" });
        this.#records.set(key, next);
        this.#persist();
        return null;
      });
    })();
    this.#activeLoserReleases.set(key, attempt);
    try {
      return await attempt;
    } finally {
      if (this.#activeLoserReleases.get(key) === attempt)
        this.#activeLoserReleases.delete(key);
    }
  }

  async releaseLosers(intentDigest, release, now) {
    const digest = requireHex32(intentDigest, "intentDigest");
    if (typeof release !== "function")
      throw new Error(
        "Losing quote cleanup accepts no caller-supplied winner; an exact release callback is required.",
      );
    const stamp = requireTimestamp(now, "now");
    const losers = await this.#serialize(() => {
      const request = this.#requests.get(digest);
      if (!request)
        throw new Error("Losing quote cleanup requires a durable request.");
      const winner = this.#confirmedSelectionRecord(
        request,
        "Losing quote cleanup",
      );
      return [...this.#records.values()]
        .filter(
          (record) =>
            record.intentDigest === digest && keyOf(record) !== keyOf(winner),
        )
        .map(clone);
    });
    const unresolved = [];
    for (const loser of losers) {
      const result = await this.#releaseLoser(loser, release, stamp);
      if (result) unresolved.push(result);
    }
    return Object.freeze(unresolved);
  }

  releaseIntent(input, release, now, reason = "client released RFQ") {
    return this.#serialize(async () => {
      const binding = requestBinding(input);
      const leaseId = requireText(input.releaseLeaseId, "releaseLeaseId");
      let request = this.#requests.get(binding.intentDigest);
      assertRequestBinding(request, binding, "Release");
      if (request.state === "released")
        return { released: true, unresolved: Object.freeze([]) };
      if (
        !["release-check", "release-pending"].includes(request.state) ||
        request.releaseLeaseId !== leaseId
      )
        throw new Error(
          "Only the exact release lease may release maker reservations.",
        );
      const stamp = requireTimestamp(now, "now");
      if (stamp >= request.expiresAt && !request.fanoutComplete)
        request = validateRequest({
          ...request,
          fanoutComplete: true,
          makerPlans: request.makerPlans.map((plan) =>
            plan.state === "planned" ? { ...plan, state: "expired" } : plan,
          ),
        });
      request = validateRequest({ ...request, state: "release-pending" });
      this.#requests.set(binding.intentDigest, request);
      this.#persist();
      const unresolved = await this.#releaseRecords(
        [...this.#records.values()].filter(
          (record) => record.intentDigest === binding.intentDigest,
        ),
        release,
        stamp,
        reason,
      );
      const released = request.fanoutComplete && !unresolved.length;
      if (released) {
        request = validateRequest({ ...request, state: "released" });
        this.#requests.set(binding.intentDigest, request);
        this.#persist();
      }
      return { released, unresolved };
    });
  }

  releaseSelected(
    input,
    release,
    now,
    reason = "released exact selected reservation",
  ) {
    return this.#serialize(async () => {
      const { request, target } = this.#exactRequest(input, "Selected release");
      const deal = this.#deals.get(target.dealId);
      if (
        !deal ||
        JSON.stringify(deal) !== JSON.stringify(validateDeal(target)) ||
        !["funded", "expired"].includes(request.state)
      )
        throw new Error(
          "Selected release target does not match the durable funded deal association.",
        );
      if (request.state === "expired")
        return { released: true, unresolved: Object.freeze([]) };
      const records = [...this.#records.values()].filter(
        (record) =>
          record.intentDigest === target.intentDigest &&
          record.reservationId === target.reservationId &&
          record.makerId === target.makerId &&
          record.fence === target.fence &&
          record.quoteDigest === target.quoteDigest &&
          ["selected", "release-pending", "released", "expired"].includes(
            record.state,
          ),
      );
      if (records.length !== 1)
        throw new Error("Exact selected reservation is unavailable.");
      const unresolved = await this.#releaseRecords(
        records,
        release,
        requireTimestamp(now, "now"),
        reason,
      );
      return { released: unresolved.length === 0, unresolved };
    });
  }

  terminalize(input, outcome) {
    return this.#serialize(() => {
      if (!["filled", "settled", "expired", "refunded"].includes(outcome))
        throw new Error("Coordinator terminal outcome is invalid.");
      const { request, target } = this.#exactRequest(input, "Terminal outcome");
      const deal = this.#deals.get(target.dealId);
      if (
        !deal ||
        JSON.stringify(deal) !== JSON.stringify(validateDeal(target))
      )
        throw new Error(
          "Terminal target does not match the durable deal association.",
        );
      if (request.state === outcome) return request;
      const allowed =
        (request.state === "funded" &&
          ["filled", "expired"].includes(outcome)) ||
        (request.state === "filled" && outcome === "settled") ||
        (request.state === "expired" && outcome === "refunded");
      if (!allowed)
        throw new Error(`Cannot terminalize ${request.state} as ${outcome}.`);
      const key = `${target.intentDigest}\0${target.reservationId}\0${target.makerId}`;
      const record = this.#records.get(key);
      if (record && outcome === "filled")
        this.#records.set(
          key,
          validateRecord({ ...record, state: "consumed" }),
        );
      const next = validateRequest({ ...request, state: outcome });
      this.#requests.set(target.intentDigest, next);
      this.#persist();
      return next;
    });
  }

  recover(release, now) {
    return this.#serialize(async () => {
      const stamp = requireTimestamp(now, "now");
      const releasable = [...this.#records.values()].filter(
        (record) => record.state === "release-pending",
      );
      const unresolved = await this.#releaseRecords(
        releasable,
        release,
        stamp,
        "recovered pending coordinator release",
      );
      for (const request of this.#requests.values()) {
        const expiredFanout =
          !request.fanoutComplete && stamp >= request.expiresAt;
        const completed = expiredFanout
          ? validateRequest({
              ...request,
              fanoutComplete: true,
              makerPlans: request.makerPlans.map((plan) =>
                plan.state === "planned" ? { ...plan, state: "expired" } : plan,
              ),
            })
          : request;
        const pending = [...this.#records.values()].some(
          (record) =>
            record.intentDigest === completed.intentDigest &&
            !["released", "expired", "consumed"].includes(record.state),
        );
        const canRelease =
          completed.state === "release-pending" &&
          completed.fanoutComplete &&
          !pending;
        this.#requests.set(
          completed.intentDigest,
          canRelease
            ? validateRequest({ ...completed, state: "released" })
            : completed,
        );
      }
      this.#persist();
      return unresolved;
    });
  }

  list() {
    return Object.freeze([...this.#records.values()].map(clone));
  }
  listRequests() {
    return Object.freeze([...this.#requests.values()].map(clone));
  }
  listDeals() {
    return Object.freeze([...this.#deals.values()].map(clone));
  }
}

export function createLocalnetReservationCoordinator(path, options) {
  return new LocalnetReservationCoordinator(path, options);
}
