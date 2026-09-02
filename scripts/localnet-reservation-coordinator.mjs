import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  decodeSolverQuoteV3,
  digestSolverQuoteV3,
  evaluatePriceSchedule,
} from "../packages/private-intents/src/index.ts";
import { canonicalLocalnetTakeExpected } from "./localnet-deal-validator.mjs";

const DOMAIN = "app20/localnet-reservation-coordinator/v4";
const PREVIOUS_DOMAIN = "app20/localnet-reservation-coordinator/v3";
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

export const LOCALNET_COORDINATOR_MAX_ATTEMPT_ID_BYTES = 128;
export const LOCALNET_COORDINATOR_MAX_V3_MAKERS = 16;
export const LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS = 8;
export const LOCALNET_COORDINATOR_MAX_V3_ACTIVE_PER_ACCOUNT = 4;
export const LOCALNET_COORDINATOR_MAX_V3_ACTIVE_GLOBAL = 64;
export const LOCALNET_COORDINATOR_MAX_V3_ADMISSIONS_PER_WINDOW = 8;
export const LOCALNET_COORDINATOR_V3_ADMISSION_WINDOW_SECONDS = 60;
export const LOCALNET_COORDINATOR_MAX_V3_REQUESTS = 256;
export const LOCALNET_COORDINATOR_MAX_JOURNAL_BYTES = 4 * 1024 * 1024;
const LOCALNET_COORDINATOR_MAX_TEXT_BYTES = 1024;
const V3_ACTIVE_STATES = new Set(["open", "take-pending", "take-unknown"]);
const V3_EXPIRY_SOURCE_STATES = new Set([
  "open",
  "take-pending",
  "take-unknown",
]);

class CoordinatorJournalCapacityError extends Error {}

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
  const maxBytes = /(?:attemptId|AttemptId|LeaseId)$/.test(label)
    ? LOCALNET_COORDINATOR_MAX_ATTEMPT_ID_BYTES
    : LOCALNET_COORDINATOR_MAX_TEXT_BYTES;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    Buffer.byteLength(value.trim()) > maxBytes
  )
    throw new Error(
      `${label} is required, bounded, and must not contain a NUL byte.`,
    );
  return value.trim();
}

function requireAttemptId(value, label = "attemptId") {
  const attemptId = requireText(value, label);
  if (Buffer.byteLength(attemptId) > LOCALNET_COORDINATOR_MAX_ATTEMPT_ID_BYTES)
    throw new Error(
      `${label} exceeds the local coordinator attempt-id byte limit.`,
    );
  return attemptId;
}

function positiveLimit(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive safe integer.`);
  return value;
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

function sameTicketSettlementTerms(left, right) {
  return Boolean(
    left &&
    right &&
    left.sellToken === right.sellToken &&
    left.sellAmount === right.sellAmount &&
    left.buyToken === right.buyToken &&
    left.buyAmount === right.buyAmount &&
    left.deadline === right.deadline,
  );
}

function sameSettlementTerms(left, right) {
  return Boolean(
    sameTicketSettlementTerms(left, right) &&
    left.ticketAddress === right.ticketAddress,
  );
}

function validateTicketAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator funding-ticket authorization is invalid.");
  return Object.freeze({
    ticketAttemptId: requireAttemptId(value.ticketAttemptId, "ticketAttemptId"),
    dealId: requireFelt(value.dealId, "dealId"),
    ticketAddress: requireFelt(value.ticketAddress, "ticketAddress"),
    settlementTerms: validateSettlementTerms(value.settlementTerms),
  });
}

function sameTicketAuthorization(left, right) {
  return Boolean(
    left &&
    right &&
    left.ticketAttemptId === right.ticketAttemptId &&
    left.dealId === right.dealId &&
    left.ticketAddress === right.ticketAddress &&
    sameSettlementTerms(left.settlementTerms, right.settlementTerms),
  );
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

function sameMakerPlans(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (plan, index) =>
        plan.makerId === right[index].makerId &&
        plan.state === right[index].state,
    )
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
          ticketAttemptId: requireAttemptId(
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
          fundingAttemptId: requireAttemptId(
            value.fundingAttemptId,
            "fundingAttemptId",
          ),
        }),
    ...(value.releaseLeaseId === undefined
      ? {}
      : {
          releaseLeaseId: requireAttemptId(
            value.releaseLeaseId,
            "releaseLeaseId",
          ),
        }),
    ...(value.abandonedFundingAttemptId === undefined
      ? {}
      : {
          abandonedFundingAttemptId: requireAttemptId(
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
          authorityReason: requireText(
            value.authorityReason,
            "authorityReason",
          ),
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
        !sameSettlementTerms(request.ticketAuthorization.settlementTerms, {
          ...request.ticketSettlementTerms,
          ticketAddress: request.ticketAuthorization.ticketAddress,
        })))
  )
    throw new Error(
      "Coordinator ticket authorization contradicts its request identity or settlement terms.",
    );
  return clone(request);
}

const V3_REQUEST_STATES = new Set([
  "open",
  "take-pending",
  "take-unknown",
  "taken",
  "expired",
]);
const V3_REFUSAL_CODES = new Set([
  "bucket",
  "insufficient-inventory",
  "policy",
  "lock-failed",
  "expired",
]);

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  try {
    return Object.freeze(structuredClone(value));
  } catch {
    throw new Error(`${label} must contain only cloneable wire values.`);
  }
}

function validateV3MakerPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator v3 maker plan must be an object.");
  const makerId = requireText(value.makerId, "makerId");
  const state = value.state;
  if (!["planned", "quoted", "refused", "unavailable"].includes(state))
    throw new Error("Coordinator v3 maker plan state is invalid.");
  if (state === "planned") return Object.freeze({ makerId, state });
  const quoteDigest = requireHex32(value.quoteDigest, "quoteDigest");
  if (state === "quoted") {
    const quote = jsonObject(value.quote, "Coordinator v3 quote wire");
    const decoded = decodeSolverQuoteV3(quote);
    if (decoded.solverId !== makerId)
      throw new Error("Coordinator v3 quote changed its maker identity.");
    return Object.freeze({ makerId, state, quoteDigest, quote });
  }
  const refusal = jsonObject(value.refusal, "Coordinator v3 refusal wire");
  if (!V3_REFUSAL_CODES.has(refusal.code))
    throw new Error("Coordinator v3 refusal code is invalid.");
  const reason = requireText(refusal.reason, "refusal reason");
  return Object.freeze({
    makerId,
    state,
    quoteDigest,
    refusal: Object.freeze({ code: refusal.code, reason }),
  });
}

function validateClosedTake(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator closed take attempt is invalid.");
  return Object.freeze({
    attemptId: requireAttemptId(value.attemptId, "closed take attemptId"),
    expected: canonicalLocalnetTakeExpected(value.expected),
  });
}

function validateV3Request(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator v3 request must be an object.");
  if (
    !Array.isArray(value.makerPlans) ||
    value.makerPlans.length < 1 ||
    value.makerPlans.length > LOCALNET_COORDINATOR_MAX_V3_MAKERS
  )
    throw new Error(
      "Coordinator v3 maker plans must contain a bounded non-empty cohort.",
    );
  const makerPlans = value.makerPlans.map(validateV3MakerPlan);
  makerPlans.sort((left, right) => left.makerId.localeCompare(right.makerId));
  if (
    new Set(makerPlans.map((plan) => plan.makerId)).size !== makerPlans.length
  )
    throw new Error("Coordinator v3 maker plans contain a duplicate maker.");
  const closedTakeAttempts = (value.closedTakeAttempts ?? []).map(
    validateClosedTake,
  );
  if (
    closedTakeAttempts.length > LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS ||
    new Set(closedTakeAttempts.map((attempt) => attempt.attemptId)).size !==
      closedTakeAttempts.length
  )
    throw new Error(
      "Coordinator v3 closed take attempts exceed their cap or contain a duplicate.",
    );
  const request = {
    lifecycle: "v3",
    rfqDigest: requireHex32(value.rfqDigest, "rfqDigest"),
    intentDigest: requireHex32(value.intentDigest, "intentDigest"),
    rfqId: requireFelt(value.rfqId, "rfqId"),
    account: requireFelt(value.account, "account"),
    chainId: requireText(value.chainId, "chainId").toLowerCase(),
    createdAt: requireTimestamp(value.createdAt, "createdAt"),
    admittedAt: requireTimestamp(
      value.admittedAt ?? value.createdAt,
      "admittedAt",
    ),
    expiresAt: requireTimestamp(value.expiresAt, "expiresAt"),
    market: requireText(value.market, "market").toLowerCase(),
    fanoutComplete: value.fanoutComplete === true,
    makerPlans: Object.freeze(makerPlans),
    state: value.state,
    closedTakeAttempts: Object.freeze(closedTakeAttempts),
    ...(value.expected === undefined
      ? {}
      : { expected: canonicalLocalnetTakeExpected(value.expected) }),
    ...(value.takeAttemptId === undefined
      ? {}
      : {
          takeAttemptId: requireAttemptId(value.takeAttemptId, "takeAttemptId"),
        }),
    ...(value.takeTransactionHash === undefined
      ? {}
      : {
          takeTransactionHash: requireFelt(
            value.takeTransactionHash,
            "takeTransactionHash",
          ),
        }),
    ...(value.transcriptDigest === undefined
      ? {}
      : {
          transcriptDigest: requireHex32(
            value.transcriptDigest,
            "transcriptDigest",
          ),
        }),
    ...(value.expiredAt === undefined
      ? {}
      : { expiredAt: requireTimestamp(value.expiredAt, "expiredAt") }),
    ...(value.expiredFromState === undefined
      ? {}
      : { expiredFromState: value.expiredFromState }),
  };
  if (value.lifecycle !== "v3" || !V3_REQUEST_STATES.has(request.state))
    throw new Error("Coordinator v3 request lifecycle or state is invalid.");
  if (
    request.expiresAt <= request.createdAt ||
    request.admittedAt >= request.expiresAt
  )
    throw new Error(
      "Coordinator v3 request expiry must follow creation and admission.",
    );
  if (
    request.fanoutComplete &&
    makerPlans.some((plan) => plan.state === "planned")
  )
    throw new Error(
      "Coordinator v3 fanout completion contradicts maker outcomes.",
    );
  if (
    ["take-pending", "take-unknown", "taken"].includes(request.state) &&
    (!request.takeAttemptId || !request.expected)
  )
    throw new Error(
      "Coordinator v3 take state requires an exact attempt and terms.",
    );
  if (
    request.state === "open" &&
    (request.takeAttemptId || request.expected || request.takeTransactionHash)
  )
    throw new Error(
      "Coordinator open v3 request contains an active take lease.",
    );
  if (request.state === "expired") {
    if (
      !request.expiredAt ||
      request.expiredAt < request.expiresAt ||
      !V3_EXPIRY_SOURCE_STATES.has(request.expiredFromState) ||
      (request.expiredFromState === "open" &&
        (request.takeAttemptId ||
          request.expected ||
          request.takeTransactionHash)) ||
      (request.expiredFromState !== "open" &&
        (!request.takeAttemptId || !request.expected)) ||
      (request.expiredFromState === "take-pending" &&
        request.takeTransactionHash)
    )
      throw new Error(
        "Coordinator expired v3 request has invalid expiry provenance or take evidence.",
      );
  } else if (request.expiredAt || request.expiredFromState) {
    throw new Error(
      "Coordinator non-expired v3 request carries expiry provenance.",
    );
  }
  return Object.freeze(request);
}

function sameV3Request(left, right) {
  return (
    left.rfqDigest === right.rfqDigest &&
    left.intentDigest === right.intentDigest &&
    left.rfqId === right.rfqId &&
    left.account === right.account &&
    left.chainId === right.chainId &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    left.market === right.market &&
    left.makerPlans.length === right.makerPlans.length &&
    left.makerPlans.every(
      (plan, index) => plan.makerId === right.makerPlans[index].makerId,
    )
  );
}

function sameTakeExpected(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function digestLocalnetV3Refusal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("V3 refusal wire is required.");
  const wire = {
    makerId: requireText(value.makerId, "makerId"),
    code: value.code,
    reason: requireText(value.reason, "refusal reason"),
  };
  if (!V3_REFUSAL_CODES.has(wire.code))
    throw new Error("V3 refusal code is invalid.");
  return `0x${createHash("sha256").update(JSON.stringify(wire)).digest("hex")}`;
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
    sameMakerPlans(left.makerPlans, right.makerPlans)
  );
}

function sameDeal(left, right) {
  return Boolean(
    left &&
    right &&
    left.intentDigest === right.intentDigest &&
    left.rfqId === right.rfqId &&
    left.account === right.account &&
    left.chainId === right.chainId &&
    left.dealId === right.dealId &&
    left.reservationId === right.reservationId &&
    left.makerId === right.makerId &&
    left.fence === right.fence &&
    left.quoteDigest === right.quoteDigest,
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
  #v3Requests = new Map();
  #v3Rfqs = new Map();
  #tail = Promise.resolve();
  #activeReleases = new Map();
  #durableAuthority;
  #durableSerialized;
  #failed = false;
  #faultInjector;
  #clock;
  #limits;
  #maxJournalBytes;

  constructor(path, options = {}) {
    this.#path = path;
    this.#faultInjector = options.faultInjector;
    this.#clock = options.now ?? (() => Math.floor(Date.now() / 1_000));
    if (typeof this.#clock !== "function")
      throw new Error("Coordinator clock must be a function.");
    this.#limits = Object.freeze({
      maxClosedTakeAttempts: positiveLimit(
        options.maxClosedTakeAttempts ??
          LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS,
        "Coordinator closed-take cap",
      ),
      maxV3ActivePerAccount: positiveLimit(
        options.maxV3ActivePerAccount ??
          LOCALNET_COORDINATOR_MAX_V3_ACTIVE_PER_ACCOUNT,
        "Coordinator per-account v3 active cap",
      ),
      maxV3ActiveGlobal: positiveLimit(
        options.maxV3ActiveGlobal ?? LOCALNET_COORDINATOR_MAX_V3_ACTIVE_GLOBAL,
        "Coordinator global v3 active cap",
      ),
      maxV3AdmissionsPerWindow: positiveLimit(
        options.maxV3AdmissionsPerWindow ??
          LOCALNET_COORDINATOR_MAX_V3_ADMISSIONS_PER_WINDOW,
        "Coordinator v3 admission rate",
      ),
      v3AdmissionWindowSeconds: positiveLimit(
        options.v3AdmissionWindowSeconds ??
          LOCALNET_COORDINATOR_V3_ADMISSION_WINDOW_SECONDS,
        "Coordinator v3 admission window",
      ),
      maxV3Requests: positiveLimit(
        options.maxV3Requests ?? LOCALNET_COORDINATOR_MAX_V3_REQUESTS,
        "Coordinator retained v3 request cap",
      ),
    });
    if (
      this.#limits.maxClosedTakeAttempts >
      LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS
    )
      throw new Error(
        "Coordinator closed-take cap cannot exceed the journal schema maximum.",
      );
    this.#maxJournalBytes = positiveLimit(
      options.maxJournalBytes ?? LOCALNET_COORDINATOR_MAX_JOURNAL_BYTES,
      "Coordinator journal byte limit",
    );
    if (!existsSync(path)) {
      this.#durableAuthority = this.#captureAuthority();
      return;
    }
    if (statSync(path).size > this.#maxJournalBytes)
      throw new Error("Localnet reservation coordinator journal is too large.");
    this.#durableSerialized = readFileSync(path, "utf8");
    let journal;
    try {
      journal = JSON.parse(this.#durableSerialized);
    } catch {
      throw new Error("Localnet reservation coordinator journal is invalid.");
    }
    const current = journal?.domain === DOMAIN && journal?.version === 4;
    const previous =
      journal?.domain === PREVIOUS_DOMAIN && journal?.version === 3;
    const legacy = journal?.domain === LEGACY_DOMAIN && journal?.version === 2;
    if (
      (!current && !previous && !legacy) ||
      !Array.isArray(journal.records) ||
      !Array.isArray(journal.requests) ||
      !Array.isArray(journal.deals) ||
      (current && !Array.isArray(journal.v3Requests))
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
    for (const value of journal.v3Requests ?? []) {
      const request = validateV3Request(value);
      if (
        request.closedTakeAttempts.length > this.#limits.maxClosedTakeAttempts
      )
        throw new Error(
          "Coordinator journal exceeds the configured closed-take cap.",
        );
      if (this.#v3Requests.has(request.rfqDigest))
        throw new Error("Coordinator journal contains a duplicate v3 request.");
      const prior = this.#v3Rfqs.get(request.rfqId);
      if (prior && prior !== request.rfqDigest)
        throw new Error(
          "Coordinator journal contains a duplicate v3 RFQ felt.",
        );
      if (this.#rfqs.has(request.rfqId))
        throw new Error(
          "Coordinator journal contains a cross-lifecycle RFQ identity collision.",
        );
      this.#v3Requests.set(request.rfqDigest, request);
      this.#v3Rfqs.set(request.rfqId, request.rfqDigest);
    }
    if (this.#v3Requests.size > this.#limits.maxV3Requests)
      throw new Error(
        "Coordinator journal exceeds the retained v3 request cap.",
      );
    this.#expireV3Requests(this.#now());
    this.#durableAuthority = this.#captureAuthority();
    if (this.#serializedAuthority() !== this.#durableSerialized)
      this.#persist();
  }

  #now() {
    return requireTimestamp(this.#clock(), "coordinator clock");
  }

  #expireV3Requests(stamp) {
    let changed = false;
    for (const [digest, request] of this.#v3Requests) {
      if (V3_ACTIVE_STATES.has(request.state) && stamp >= request.expiresAt) {
        this.#v3Requests.set(
          digest,
          validateV3Request({
            ...request,
            state: "expired",
            expiredAt: stamp,
            expiredFromState: request.state,
          }),
        );
        changed = true;
      }
    }
    return changed;
  }

  #assertV3Admission(request, stamp) {
    if (request.expiresAt <= stamp)
      throw new Error("Coordinator refuses an already-expired v3 request.");
    if (this.#v3Requests.size >= this.#limits.maxV3Requests)
      throw new Error("Coordinator retained v3 request quota is full.");
    const active = [...this.#v3Requests.values()].filter((candidate) =>
      V3_ACTIVE_STATES.has(candidate.state),
    );
    if (active.length >= this.#limits.maxV3ActiveGlobal)
      throw new Error("Coordinator global v3 concurrency quota is full.");
    if (
      active.filter((candidate) => candidate.account === request.account)
        .length >= this.#limits.maxV3ActivePerAccount
    )
      throw new Error("Coordinator account v3 concurrency quota is full.");
    const windowStart = stamp - this.#limits.v3AdmissionWindowSeconds;
    const recentForAccount = [...this.#v3Requests.values()].filter(
      (candidate) =>
        candidate.account === request.account &&
        candidate.admittedAt > windowStart,
    ).length;
    if (recentForAccount >= this.#limits.maxV3AdmissionsPerWindow)
      throw new Error("Coordinator account v3 admission rate was exceeded.");
  }

  #closedTakeAttempts(request, attemptId, expected) {
    if (request.closedTakeAttempts.length >= this.#limits.maxClosedTakeAttempts)
      throw new Error("Coordinator v3 closed-take attempt quota is full.");
    return [...request.closedTakeAttempts, { attemptId, expected }];
  }

  #captureAuthority() {
    return Object.freeze({
      records: new Map(this.#records),
      requests: new Map(this.#requests),
      deals: new Map(this.#deals),
      rfqs: new Map(this.#rfqs),
      v3Requests: new Map(this.#v3Requests),
      v3Rfqs: new Map(this.#v3Rfqs),
    });
  }

  #restoreAuthority(authority) {
    this.#records = new Map(authority.records);
    this.#requests = new Map(authority.requests);
    this.#deals = new Map(authority.deals);
    this.#rfqs = new Map(authority.rfqs);
    this.#v3Requests = new Map(authority.v3Requests);
    this.#v3Rfqs = new Map(authority.v3Rfqs);
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
    const v3Requests = [...this.#v3Requests.values()].sort((a, b) =>
      a.rfqDigest.localeCompare(b.rfqDigest),
    );
    const serialized = `${JSON.stringify({ version: 4, domain: DOMAIN, requests, records, deals, v3Requests }, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > this.#maxJournalBytes)
      throw new CoordinatorJournalCapacityError(
        "Coordinator journal exceeds its byte limit.",
      );
    return serialized;
  }

  #serialize(operation) {
    const run = this.#tail.then(() => {
      if (this.#failed)
        throw new Error(
          "Coordinator is fail-stopped after an uncertain durable journal failure; reopen it from disk before retrying.",
        );
      if (this.#expireV3Requests(this.#now())) this.#persist();
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
      const rollback = `${this.#path}.${process.pid}.${randomBytes(8).toString("hex")}.rollback.tmp`;
      try {
        writeFileSync(rollback, serialized, { mode: 0o600, flag: "wx" });
        const file = openSync(rollback, "r");
        try {
          fsyncSync(file);
        } finally {
          closeSync(file);
        }
        renameSync(rollback, this.#path);
        chmodSync(this.#path, 0o600);
      } finally {
        if (existsSync(rollback)) unlinkSync(rollback);
      }
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
      temporary = `${this.#path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      this.#checkpoint("serialize");
      candidate = this.#serializedAuthority();
      this.#checkpoint("mkdir");
      mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
      this.#checkpoint("write");
      writeFileSync(temporary, candidate, { mode: 0o600, flag: "wx" });
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
      this.#restoreAuthority(durableAuthority);
      if (error instanceof CoordinatorJournalCapacityError && !renamed) {
        if (temporary && existsSync(temporary)) unlinkSync(temporary);
        throw error;
      }
      this.#failed = true;
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
      if (this.#v3Rfqs.has(request.rfqId))
        throw new Error(
          "RFQ identity is already reserved by a v3 request lifecycle.",
        );
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

  async register(input, release) {
    const prepared = await this.#serialize(() => {
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
        return Object.freeze({ record: clone(prior), release: false });
      }
      if (request.state !== "open") {
        const pending = validateRecord({ ...record, state: "release-pending" });
        this.#records.set(key, pending);
        this.#persist();
        return Object.freeze({ record: clone(pending), release: true });
      }
      this.#records.set(key, record);
      this.#persist();
      return Object.freeze({ record: clone(record), release: false });
    });
    if (!prepared.release) return prepared.record;

    await this.#releaseRecord(
      prepared.record,
      release,
      this.#now(),
      "late reservation released behind request tombstone",
    );
    return this.#serialize(() => {
      const key = keyOf(prepared.record);
      const current = this.#records.get(key);
      const request = this.#requests.get(prepared.record.intentDigest);
      if (!current || !request)
        throw new Error("Late reservation lost its durable request binding.");
      if (["released", "expired", "consumed"].includes(current.state))
        return current;
      if (
        request.state !== "release-check" &&
        request.state !== "release-pending" &&
        !TERMINAL_REQUEST_STATES.has(request.state)
      )
        throw new Error(
          "Late reservation conflicts with an active funding state.",
        );
      if (request.state !== "release-pending") {
        this.#requests.set(
          request.intentDigest,
          validateRequest({ ...request, state: "release-pending" }),
        );
        this.#persist();
      }
      return clone(this.#records.get(key));
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
      const revision = requireTimestamp(
        input.authorityRevision,
        "authorityRevision",
      );
      const reason = requireText(input.authorityReason, "authorityReason");
      if (request.state === "authority-quarantined") {
        if (
          request.authorityRevision === revision &&
          request.authorityReason === reason
        )
          return request;
        if (revision <= request.authorityRevision)
          throw new Error("Authority quarantine revision must increase.");
      } else if (
        !["filled", "settled", "expired", "refunded"].includes(request.state)
      ) {
        throw new Error(
          "Only an observed terminal request can enter authority quarantine.",
        );
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
          !sameTicketSettlementTerms(
            request.ticketSettlementTerms,
            ticketSettlementTerms,
          )
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
        !sameTicketSettlementTerms(
          request.ticketSettlementTerms,
          ticketSettlementTerms,
        )
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
          !sameTicketAuthorization(
            request.ticketAuthorization,
            ticketAuthorization,
          )
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
        !sameSettlementTerms(
          request.ticketAuthorization.settlementTerms,
          settlementTerms,
        )
      )
        throw new Error(
          "Funding preparation changed the ticket-authorized canonical settlement terms or address.",
        );
      if (request.state === "funding-pending") {
        if (request.fundingAttemptId !== attemptId)
          throw new Error(
            "Another exact funding attempt already owns the request lease.",
          );
        if (!sameSettlementTerms(request.settlementTerms, settlementTerms))
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
          !sameTicketSettlementTerms(
            request.ticketSettlementTerms,
            settlementTerms,
          ) ||
          !sameSettlementTerms(
            request.ticketAuthorization.settlementTerms,
            settlementTerms,
          ) ||
          !sameSettlementTerms(request.settlementTerms, settlementTerms)
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
          !sameSettlementTerms(request.settlementTerms, settlementTerms)
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
          if (!sameSettlementTerms(request.settlementTerms, settlementTerms))
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
      if (!sameSettlementTerms(request.settlementTerms, settlementTerms))
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
      if (prior && !sameDeal(prior, deal))
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
      if (prior && !sameDeal(prior, deal))
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
        if (this.#v3Rfqs.has(binding.rfqId))
          throw new Error(
            "RFQ identity is already reserved by a v3 request lifecycle.",
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
      if (prior && !sameDeal(prior, deal))
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
    for (const record of records) {
      const result = await this.#releaseRecord(record, release, now, reason);
      if (result) unresolved.push(result);
    }
    return Object.freeze(unresolved);
  }

  async #releaseRecord(record, release, now, reason) {
    const key = keyOf(record);
    const active = this.#activeReleases.get(key);
    if (active)
      return this.#serialize(() => {
        const current = this.#records.get(key);
        return !current ||
          ["released", "expired", "consumed"].includes(current.state)
          ? null
          : clone(current);
      });
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
        released = await release(pending, reason);
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
    this.#activeReleases.set(key, attempt);
    try {
      return await attempt;
    } finally {
      if (this.#activeReleases.get(key) === attempt)
        this.#activeReleases.delete(key);
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
      const result = await this.#releaseRecord(
        loser,
        release,
        stamp,
        "losing quote released after durable selection confirmation",
      );
      if (result) unresolved.push(result);
    }
    return Object.freeze(unresolved);
  }

  async releaseIntent(input, release, now, reason = "client released RFQ") {
    const stamp = requireTimestamp(now, "now");
    const prepared = await this.#serialize(() => {
      const binding = requestBinding(input);
      const leaseId = requireAttemptId(input.releaseLeaseId, "releaseLeaseId");
      let request = this.#requests.get(binding.intentDigest);
      assertRequestBinding(request, binding, "Release");
      if (request.state === "released")
        return Object.freeze({ binding, leaseId, records: [], done: true });
      if (
        !["release-check", "release-pending"].includes(request.state) ||
        request.releaseLeaseId !== leaseId
      )
        throw new Error(
          "Only the exact release lease may release maker reservations.",
        );
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
      return Object.freeze({
        binding,
        leaseId,
        records: [...this.#records.values()]
          .filter((record) => record.intentDigest === binding.intentDigest)
          .map(clone),
        done: false,
      });
    });
    if (prepared.done) return { released: true, unresolved: Object.freeze([]) };

    await this.#releaseRecords(prepared.records, release, stamp, reason);
    return this.#serialize(() => {
      let request = this.#requests.get(prepared.binding.intentDigest);
      assertRequestBinding(request, prepared.binding, "Release completion");
      if (request.state === "released")
        return { released: true, unresolved: Object.freeze([]) };
      if (
        request.state !== "release-pending" ||
        request.releaseLeaseId !== prepared.leaseId
      )
        throw new Error(
          "Exact release lease changed while maker callbacks were in flight.",
        );
      const unresolved = Object.freeze(
        [...this.#records.values()]
          .filter(
            (record) =>
              record.intentDigest === prepared.binding.intentDigest &&
              !["released", "expired", "consumed"].includes(record.state),
          )
          .map(clone),
      );
      const released = request.fanoutComplete && unresolved.length === 0;
      if (released) {
        request = validateRequest({ ...request, state: "released" });
        this.#requests.set(prepared.binding.intentDigest, request);
        this.#persist();
      }
      return { released, unresolved };
    });
  }

  async releaseSelected(
    input,
    release,
    now,
    reason = "released exact selected reservation",
  ) {
    const stamp = requireTimestamp(now, "now");
    const prepared = await this.#serialize(() => {
      const { request, target } = this.#exactRequest(input, "Selected release");
      const deal = this.#deals.get(target.dealId);
      if (
        !sameDeal(deal, validateDeal(target)) ||
        !["funded", "expired"].includes(request.state)
      )
        throw new Error(
          "Selected release target does not match the durable funded deal association.",
        );
      if (request.state === "expired")
        return Object.freeze({ target, records: [], done: true });
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
      return Object.freeze({
        target,
        records: records.map(clone),
        done: false,
      });
    });
    if (prepared.done) return { released: true, unresolved: Object.freeze([]) };

    await this.#releaseRecords(prepared.records, release, stamp, reason);
    return this.#serialize(() => {
      const { target } = this.#exactRequest(
        input,
        "Selected release completion",
      );
      const deal = this.#deals.get(target.dealId);
      if (!sameDeal(deal, validateDeal(prepared.target)))
        throw new Error(
          "Selected release binding changed while its callback was in flight.",
        );
      const unresolved = Object.freeze(
        [...this.#records.values()]
          .filter(
            (record) =>
              record.intentDigest === target.intentDigest &&
              record.reservationId === target.reservationId &&
              record.makerId === target.makerId &&
              record.fence === target.fence &&
              record.quoteDigest === target.quoteDigest &&
              !["released", "expired", "consumed"].includes(record.state),
          )
          .map(clone),
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
      if (!sameDeal(deal, validateDeal(target)))
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

  beginV3Request(input) {
    return this.#serialize(() => {
      if (!Array.isArray(input.makerIds) || input.makerIds.length === 0)
        throw new Error(
          "Coordinator v3 request requires an invited maker cohort.",
        );
      const admittedAt = this.#now();
      const request = validateV3Request({
        lifecycle: "v3",
        rfqDigest: input.rfqDigest,
        intentDigest: input.intentDigest,
        rfqId: input.rfqId,
        account: input.account,
        chainId: input.chainId,
        createdAt: input.createdAt,
        admittedAt,
        expiresAt: input.expiresAt,
        market: input.market,
        fanoutComplete: false,
        makerPlans: input.makerIds.map((makerId) => ({
          makerId,
          state: "planned",
        })),
        state: "open",
        closedTakeAttempts: [],
      });
      const prior = this.#v3Requests.get(request.rfqDigest);
      if (prior) {
        if (!sameV3Request(prior, request))
          throw new Error(
            "V3 RFQ digest was reused with another principal or request binding.",
          );
        return prior;
      }
      this.#assertV3Admission(request, admittedAt);
      const v3Owner = this.#v3Rfqs.get(request.rfqId);
      if (v3Owner && v3Owner !== request.rfqDigest)
        throw new Error("V3 RFQ felt is already reserved by another request.");
      if (this.#rfqs.has(request.rfqId))
        throw new Error(
          "V3 RFQ felt is already reserved by a legacy request lifecycle.",
        );
      this.#v3Requests.set(request.rfqDigest, request);
      this.#v3Rfqs.set(request.rfqId, request.rfqDigest);
      this.#persist();
      return request;
    });
  }

  recordV3Quote(rfqDigest, makerId, value) {
    return this.#serialize(async () => {
      const digest = requireHex32(rfqDigest, "rfqDigest");
      const maker = requireText(makerId, "makerId");
      const request = this.#v3Requests.get(digest);
      if (!request)
        throw new Error("Cannot journal a quote for an unknown v3 request.");
      const plan = request.makerPlans.find((entry) => entry.makerId === maker);
      if (!plan)
        throw new Error("V3 quote maker was not in the durable cohort.");
      const quote = jsonObject(value.quote, "Coordinator v3 quote wire");
      const decoded = decodeSolverQuoteV3(quote);
      const quoteDigest = requireHex32(value.quoteDigest, "quoteDigest");
      if (
        decoded.solverId !== maker ||
        decoded.rfqDigest !== digest ||
        (await digestSolverQuoteV3(decoded)) !== quoteDigest
      )
        throw new Error(
          "V3 quote does not match its durable maker and RFQ digest.",
        );
      if (plan.state === "quoted") {
        if (
          plan.quoteDigest !== quoteDigest ||
          JSON.stringify(plan.quote) !== JSON.stringify(quote)
        )
          throw new Error("V3 maker replay changed its quote wire.");
        return request;
      }
      if (plan.state !== "planned")
        throw new Error("V3 maker outcome cannot change after journaling.");
      const next = validateV3Request({
        ...request,
        makerPlans: request.makerPlans.map((entry) =>
          entry.makerId === maker
            ? { makerId: maker, state: "quoted", quoteDigest, quote }
            : entry,
        ),
      });
      this.#v3Requests.set(digest, next);
      this.#persist();
      return next;
    });
  }

  recordV3Refusal(rfqDigest, makerId, refusal, state = "refused") {
    return this.#serialize(() => {
      const digest = requireHex32(rfqDigest, "rfqDigest");
      const maker = requireText(makerId, "makerId");
      if (state !== "refused" && state !== "unavailable")
        throw new Error("V3 refusal journal state is invalid.");
      const wire = {
        code: refusal?.code,
        reason: requireText(refusal?.reason, "refusal reason"),
      };
      if (!V3_REFUSAL_CODES.has(wire.code))
        throw new Error("V3 refusal code is invalid.");
      const quoteDigest = digestLocalnetV3Refusal({ makerId: maker, ...wire });
      const request = this.#v3Requests.get(digest);
      if (!request)
        throw new Error("Cannot journal a refusal for an unknown v3 request.");
      const plan = request.makerPlans.find((entry) => entry.makerId === maker);
      if (!plan)
        throw new Error("V3 refusal maker was not in the durable cohort.");
      if (plan.state === state) {
        if (
          plan.quoteDigest !== quoteDigest ||
          JSON.stringify(plan.refusal) !== JSON.stringify(wire)
        )
          throw new Error("V3 maker replay changed its refusal wire.");
        return request;
      }
      if (plan.state !== "planned")
        throw new Error("V3 maker outcome cannot change after journaling.");
      const next = validateV3Request({
        ...request,
        makerPlans: request.makerPlans.map((entry) =>
          entry.makerId === maker
            ? {
                makerId: maker,
                state,
                quoteDigest,
                refusal: wire,
              }
            : entry,
        ),
      });
      this.#v3Requests.set(digest, next);
      this.#persist();
      return next;
    });
  }

  completeV3Fanout(rfqDigest) {
    return this.#serialize(() => {
      const digest = requireHex32(rfqDigest, "rfqDigest");
      const request = this.#v3Requests.get(digest);
      if (!request) throw new Error("Cannot complete an unknown v3 fanout.");
      if (request.makerPlans.some((plan) => plan.state === "planned"))
        throw new Error(
          "Cannot complete v3 fanout with an ambiguous maker outcome.",
        );
      if (request.fanoutComplete) return request;
      const next = validateV3Request({ ...request, fanoutComplete: true });
      this.#v3Requests.set(digest, next);
      this.#persist();
      return next;
    });
  }

  journalV3Transcript(rfqDigest, transcriptDigest) {
    return this.#serialize(() => {
      const digest = requireHex32(rfqDigest, "rfqDigest");
      const transcript = requireHex32(transcriptDigest, "transcriptDigest");
      const request = this.#v3Requests.get(digest);
      if (!request)
        throw new Error(
          "Cannot journal a transcript for an unknown v3 request.",
        );
      if (!request.fanoutComplete)
        throw new Error("V3 transcript requires a complete durable fanout.");
      if (request.transcriptDigest) {
        if (request.transcriptDigest !== transcript)
          throw new Error(
            "Another transcript digest is already bound to this v3 RFQ.",
          );
        return request;
      }
      const next = validateV3Request({
        ...request,
        transcriptDigest: transcript,
      });
      this.#v3Requests.set(digest, next);
      this.#persist();
      return next;
    });
  }

  #exactV3Take(input, action) {
    const rfqId = requireFelt(input.rfqId, "rfqId");
    const dealId = requireFelt(input.dealId, "dealId");
    if (rfqId !== dealId)
      throw new Error("V3 take deal identity must equal its RFQ felt.");
    const digest = this.#v3Rfqs.get(rfqId);
    const request = digest ? this.#v3Requests.get(digest) : undefined;
    if (
      !request ||
      request.account !== requireFelt(input.account, "account") ||
      request.chainId !== requireText(input.chainId, "chainId").toLowerCase() ||
      (input.intentDigest !== undefined &&
        request.intentDigest !==
          requireHex32(input.intentDigest, "intentDigest"))
    )
      throw new Error(`${action} does not match the durable v3 RFQ principal.`);
    if (!request.fanoutComplete)
      throw new Error(`${action} requires a complete durable v3 fanout.`);
    if (!request.transcriptDigest)
      throw new Error(`${action} requires a durable fair-loss transcript.`);
    const expected = canonicalLocalnetTakeExpected(input.expected);
    for (const fill of expected.fills) {
      const plan = request.makerPlans.find(
        (candidate) =>
          candidate.state === "quoted" &&
          decodeSolverQuoteV3(candidate.quote).lockId === fill.lockId,
      );
      if (!plan)
        throw new Error(
          "V3 take contains a lock outside its durable quote fanout.",
        );
      const quote = decodeSolverQuoteV3(plan.quote);
      if (
        quote.sellToken !== expected.tokenA ||
        quote.buyToken !== expected.tokenB ||
        evaluatePriceSchedule(quote.schedule, BigInt(fill.amountA)) !==
          BigInt(fill.amountB)
      )
        throw new Error(
          "V3 take fill does not match its quoted schedule and tokens.",
        );
    }
    return { request, expected };
  }

  #takeHash(request, input) {
    if (input.transactionHash === undefined) return request.takeTransactionHash;
    const transactionHash = requireFelt(
      input.transactionHash,
      "transactionHash",
    );
    if (
      request.takeTransactionHash &&
      request.takeTransactionHash !== transactionHash
    )
      throw new Error("V3 take attempt changed its transaction hash.");
    return transactionHash;
  }

  prepareTake(input, attemptId) {
    return this.#serialize(() => {
      const { request, expected } = this.#exactV3Take(
        input,
        "V3 take preparation",
      );
      const attempt = requireAttemptId(attemptId);
      const closed = request.closedTakeAttempts.find(
        (entry) => entry.attemptId === attempt,
      );
      if (closed)
        throw new Error(
          "V3 take attempt is durably closed and cannot be prepared again.",
        );
      if (request.state === "take-unknown")
        throw new Error(
          "V3 take outcome is unknown; reconcile the exact attempt first.",
        );
      if (request.state === "taken")
        throw new Error("V3 take is already authoritatively recorded.");
      if (request.state === "expired")
        throw new Error("V3 RFQ expiry permanently closes take submission.");
      if (
        request.state === "open" &&
        request.closedTakeAttempts.length >= this.#limits.maxClosedTakeAttempts
      )
        throw new Error("Coordinator v3 closed-take attempt quota is full.");
      if (request.state === "take-pending") {
        if (
          request.takeAttemptId !== attempt ||
          !sameTakeExpected(request.expected, expected)
        )
          throw new Error(
            "Another exact v3 take attempt owns the durable lease.",
          );
        return request;
      }
      const next = validateV3Request({
        ...request,
        state: "take-pending",
        takeAttemptId: attempt,
        expected,
      });
      this.#v3Requests.set(request.rfqDigest, next);
      this.#persist();
      return next;
    });
  }

  markTakeUnknown(input, attemptId) {
    return this.#serialize(() => {
      const { request, expected } = this.#exactV3Take(input, "V3 take unknown");
      const attempt = requireAttemptId(attemptId);
      if (
        !["take-pending", "take-unknown", "expired"].includes(request.state) ||
        request.takeAttemptId !== attempt ||
        !sameTakeExpected(request.expected, expected)
      )
        throw new Error(
          "Only the exact active v3 take lease may become unknown.",
        );
      const takeTransactionHash = this.#takeHash(request, input);
      if (
        (request.state === "take-unknown" ||
          (request.state === "expired" &&
            request.expiredFromState === "take-unknown")) &&
        request.takeTransactionHash === takeTransactionHash
      )
        return request;
      const next = validateV3Request({
        ...request,
        state: request.state === "expired" ? "expired" : "take-unknown",
        ...(request.state === "expired"
          ? { expiredFromState: "take-unknown" }
          : {}),
        ...(takeTransactionHash ? { takeTransactionHash } : {}),
      });
      this.#v3Requests.set(request.rfqDigest, next);
      this.#persist();
      return next;
    });
  }

  abandonTake(input, attemptId) {
    return this.#serialize(() => {
      const { request, expected } = this.#exactV3Take(
        input,
        "V3 take abandonment",
      );
      const attempt = requireAttemptId(attemptId);
      const closed = request.closedTakeAttempts.find(
        (entry) => entry.attemptId === attempt,
      );
      if (closed) {
        if (!sameTakeExpected(closed.expected, expected))
          throw new Error(
            "V3 take abandonment replay changed its exact terms.",
          );
        return request;
      }
      if (
        request.state === "take-unknown" ||
        request.state === "taken" ||
        (request.state === "expired" &&
          request.expiredFromState === "take-unknown")
      )
        throw new Error(
          "Only an absent pre-submission v3 take may be abandoned.",
        );
      if (
        (request.state === "take-pending" || request.state === "expired") &&
        (request.takeAttemptId !== attempt ||
          !sameTakeExpected(request.expected, expected))
      )
        throw new Error(
          "Another exact v3 take attempt owns the durable lease.",
        );
      if (request.state === "expired" && !request.takeAttemptId)
        throw new Error("An expired v3 RFQ cannot create an abandonment.");
      const {
        expected: _expected,
        takeAttemptId: _takeAttemptId,
        takeTransactionHash: _takeTransactionHash,
        ...rest
      } = request;
      const next = validateV3Request({
        ...rest,
        state: request.state === "expired" ? "expired" : "open",
        ...(request.state === "expired" ? { expiredFromState: "open" } : {}),
        closedTakeAttempts: this.#closedTakeAttempts(
          request,
          attempt,
          expected,
        ),
      });
      this.#v3Requests.set(request.rfqDigest, next);
      this.#persist();
      return next;
    });
  }

  observeTaken(input, attemptId) {
    return this.#serialize(() => {
      const { request, expected } = this.#exactV3Take(
        input,
        "V3 take observation",
      );
      const attempt = requireAttemptId(attemptId);
      if (
        !["take-pending", "take-unknown", "taken", "expired"].includes(
          request.state,
        ) ||
        request.takeAttemptId !== attempt ||
        !sameTakeExpected(request.expected, expected)
      )
        throw new Error(
          "Observed v3 take does not own the exact durable lease.",
        );
      const takeTransactionHash = this.#takeHash(request, input);
      if (
        request.state === "taken" &&
        request.takeTransactionHash === takeTransactionHash
      )
        return request;
      const {
        expiredAt: _expiredAt,
        expiredFromState: _expiredFromState,
        ...activeRequest
      } = request;
      const next = validateV3Request({
        ...activeRequest,
        state: "taken",
        ...(takeTransactionHash ? { takeTransactionHash } : {}),
      });
      this.#v3Requests.set(request.rfqDigest, next);
      this.#persist();
      return next;
    });
  }

  markTakeAbsent(input, attemptId) {
    return this.#serialize(() => {
      const { request, expected } = this.#exactV3Take(input, "V3 take absence");
      const attempt = requireAttemptId(attemptId);
      const closed = request.closedTakeAttempts.find(
        (entry) => entry.attemptId === attempt,
      );
      if (closed) {
        if (!sameTakeExpected(closed.expected, expected))
          throw new Error("V3 take absence replay changed its exact terms.");
        return request;
      }
      if (
        !["take-pending", "take-unknown", "expired"].includes(request.state) ||
        request.takeAttemptId !== attempt ||
        !sameTakeExpected(request.expected, expected)
      )
        throw new Error(
          "V3 take absence does not own the exact durable lease.",
        );
      const {
        expected: _expected,
        takeAttemptId: _takeAttemptId,
        takeTransactionHash: _takeTransactionHash,
        ...rest
      } = request;
      const next = validateV3Request({
        ...rest,
        state: request.state === "expired" ? "expired" : "open",
        ...(request.state === "expired" ? { expiredFromState: "open" } : {}),
        closedTakeAttempts: this.#closedTakeAttempts(
          request,
          attempt,
          expected,
        ),
      });
      this.#v3Requests.set(request.rfqDigest, next);
      this.#persist();
      return next;
    });
  }

  async recover(release, now) {
    const stamp = requireTimestamp(now, "now");
    const releasable = await this.#serialize(() =>
      [...this.#records.values()]
        .filter((record) => record.state === "release-pending")
        .map(clone),
    );
    await this.#releaseRecords(
      releasable,
      release,
      stamp,
      "recovered pending coordinator release",
    );
    return this.#serialize(() => {
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
      this.#expireV3Requests(stamp);
      this.#persist();
      return Object.freeze(
        [...this.#records.values()]
          .filter((record) => record.state === "release-pending")
          .map(clone),
      );
    });
  }

  getV3Request(rfqDigest) {
    const request = this.#v3Requests.get(requireHex32(rfqDigest, "rfqDigest"));
    return request ? clone(request) : undefined;
  }
  getV3RequestForRfq(rfqId) {
    const digest = this.#v3Rfqs.get(requireFelt(rfqId, "rfqId"));
    if (!digest) return undefined;
    const request = this.#v3Requests.get(digest);
    return request ? clone(request) : undefined;
  }
  listV3Requests() {
    return Object.freeze([...this.#v3Requests.values()].map(clone));
  }
  getRequest(intentDigest) {
    const request = this.#requests.get(
      requireHex32(intentDigest, "intentDigest"),
    );
    return request ? clone(request) : undefined;
  }
  getRequestForRfq(rfqId) {
    const intentDigest = this.#rfqs.get(requireFelt(rfqId, "rfqId"));
    if (!intentDigest) return undefined;
    const request = this.#requests.get(intentDigest);
    return request ? clone(request) : undefined;
  }
  getDeal(dealId) {
    const deal = this.#deals.get(requireFelt(dealId, "dealId"));
    return deal ? clone(deal) : undefined;
  }
  hasDealForIntent(intentDigest) {
    const digest = requireHex32(intentDigest, "intentDigest");
    for (const deal of this.#deals.values()) {
      if (deal.intentDigest === digest) return true;
    }
    return false;
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
