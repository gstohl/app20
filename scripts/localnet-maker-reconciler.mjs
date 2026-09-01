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
import { createHash, randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  canonicalLocalnetAuthorityQuery,
  digestLocalnetAuthorityQuery,
} from "./localnet-chain-authority.mjs";

export const LOCALNET_MAKER_RECONCILIATION_SCHEMA =
  "app20/localnet-maker-reconciliation/v2";
const HEX_32 = /^0x[0-9a-f]{64}$/;
const AUTHORITY_STATUSES = new Set([
  "authoritative",
  "stale",
  "disagreement",
  "reorged",
  "quarantined",
]);
const JOURNAL_STATUSES = new Set([
  "consistent",
  "pending",
  "quarantine-pending",
  "quarantined",
  "release-pending",
  "released-terminal",
]);

function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error(`${label} is required.`);
  return value.trim();
}
function hex32(value, label) {
  if (typeof value !== "string" || !HEX_32.test(value))
    throw new Error(`${label} must be a canonical 32-byte digest.`);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer.`);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function reconciliationKey(query) {
  return query.lifecycle === "v3"
    ? `${query.runtimeEpoch}|${query.chainId}|${query.account}|${query.rfqId}|v3-take`
    : `${query.runtimeEpoch}|${query.chainId}|${query.account}|${query.rfqId}|${query.reservationId}`;
}
function effectAttemptId(query, authorityRevision, effect) {
  return `${effect}:${createHash("sha256")
    .update(
      `${reconciliationKey(query)}|${query.outcome}|${authorityRevision}|${effect}`,
    )
    .digest("hex")}`;
}
function exactTerminalMetadata(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Maker terminal reconciliation metadata is invalid.");
  if (value.outcome !== "settled" && value.outcome !== "refunded")
    throw new Error("Maker terminal reconciliation outcome is invalid.");
  return Object.freeze({
    attemptId: text(value.attemptId, "maker terminal attemptId"),
    authorityDigest: hex32(
      value.authorityDigest,
      "maker terminal authorityDigest",
    ),
    authorityRevision: positiveInteger(
      value.authorityRevision,
      "maker terminal authorityRevision",
    ),
    outcome: value.outcome,
    selectionFence: String(value.selectionFence),
    reconciledAt: positiveInteger(
      value.reconciledAt,
      "maker terminal reconciledAt",
    ),
  });
}
function exactReservation(value, query) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Maker reservation reconciliation input is missing.");
  const exact = {
    makerId: text(value.makerId, "reservation makerId"),
    intentDigest: hex32(value.intentDigest, "reservation intentDigest"),
    reservationId: hex32(value.reservationId, "reservationId"),
    fence: String(value.fence),
    quoteDigest: hex32(value.quoteDigest, "reservation quoteDigest"),
    sellToken: text(value.sellToken, "reservation sellToken"),
    sellAmount: String(value.sellAmount),
    buyToken: text(value.buyToken, "reservation buyToken"),
    buyAmount: String(value.buyAmount),
    deadline: value.deadline,
    ticketAddress: text(value.ticketAddress, "reservation ticketAddress"),
    state: text(value.state, "reservation state"),
    ...(value.settlementTransactionHash === undefined
      ? {}
      : {
          settlementTransactionHash: text(
            value.settlementTransactionHash,
            "settlement transaction",
          ),
        }),
    ...(value.terminalReconciliation === undefined
      ? {}
      : {
          terminalReconciliation: exactTerminalMetadata(
            value.terminalReconciliation,
          ),
        }),
  };
  for (const [left, right, label] of [
    [exact.makerId, query.makerId, "maker"],
    [exact.intentDigest, query.intentDigest, "intent"],
    [exact.reservationId, query.reservationId, "reservation"],
    [exact.fence, query.reservationFence, "fence"],
    [exact.quoteDigest, query.quoteDigest, "quote"],
    [exact.sellToken, query.sellToken, "sell asset"],
    [exact.sellAmount, query.sellAmount, "sell amount"],
    [exact.buyToken, query.buyToken, "buy asset"],
    [exact.buyAmount, query.buyAmount, "buy amount"],
    [exact.deadline, query.deadline, "deadline"],
    [exact.ticketAddress, query.ticketAddress, "ticket"],
  ])
    if (left !== right)
      throw new Error(
        `Maker reservation ${label} does not match authority query.`,
      );
  return Object.freeze(exact);
}
function exactCoordinator(value, query) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Coordinator reconciliation input is missing.");
  const selection = value.selection;
  const expectedState = query.outcome === "settled" ? "settled" : "refunded";
  if (
    value.state !== expectedState ||
    value.intentDigest !== query.intentDigest ||
    value.rfqId !== query.rfqId ||
    value.account !== query.account ||
    value.chainId !== query.chainId ||
    !selection ||
    selection.reservationId !== query.reservationId ||
    selection.makerId !== query.makerId ||
    String(selection.fence) !== query.reservationFence ||
    selection.quoteDigest !== query.quoteDigest
  )
    throw new Error("Coordinator does not bind the exact authority query.");
  return value;
}
function exactV3Coordinator(value, query, authority) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("V3 coordinator reconciliation input is missing.");
  if (
    value.lifecycle !== "v3" ||
    value.state !== "taken" ||
    value.rfqDigest !== query.rfqDigest ||
    value.intentDigest !== query.intentDigest ||
    value.rfqId !== query.rfqId ||
    value.account !== query.account ||
    value.chainId !== query.chainId ||
    JSON.stringify(value.expected) !== JSON.stringify(query.expected) ||
    !Array.isArray(value.makerPlans)
  )
    throw new Error("V3 coordinator does not bind the exact authority query.");
  const take = authority?.canonicalLifecycle?.[0];
  if (
    authority?.status === "authoritative" &&
    (authority.canonicalLifecycle.length !== 1 ||
      take?.stage !== "take" ||
      take.transactionHash !== query.transactions.take ||
      !Array.isArray(take.fillEvents) ||
      take.fillEvents.length !== query.expected.fills.length)
  )
    throw new Error("V3 authority lifecycle is not an exact take.");
  const fills = query.expected.fills.map((fill, index) => {
    const event = take?.fillEvents?.[index];
    if (
      authority?.status === "authoritative" &&
      (event.stage !== "lockTaken" ||
        event.lockId !== fill.lockId ||
        event.transactionHash !== query.transactions.take)
    )
      throw new Error("V3 authority changed an expected LockTaken binding.");
    const owners = value.makerPlans.filter(
      (plan) =>
        plan?.state === "quoted" &&
        plan.quote?.lockId === fill.lockId &&
        plan.quote?.rfqDigest === query.rfqDigest &&
        plan.quoteDigest,
    );
    if (owners.length !== 1)
      throw new Error("V3 coordinator cannot prove one maker owner for a taken lock.");
    return Object.freeze({
      makerId: text(owners[0].makerId, "v3 lock owner makerId"),
      quoteDigest: hex32(owners[0].quoteDigest, "v3 lock owner quote digest"),
      lockId: fill.lockId,
      amountA: fill.amountA,
      amountB: fill.amountB,
    });
  });
  return Object.freeze(fills);
}

function exactAuthority(value, query) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Authority reconciliation evidence is invalid.");
  if (!AUTHORITY_STATUSES.has(value.status))
    throw new Error("Authority reconciliation status is invalid.");
  const queryDigest = hex32(
    value.queryDigest,
    "authority reconciliation query digest",
  );
  if (queryDigest !== digestLocalnetAuthorityQuery(query))
    throw new Error(
      "Authority reconciliation evidence changed the exact query.",
    );
  if (typeof value.marketQuarantined !== "boolean")
    throw new Error("Authority reconciliation market quarantine is invalid.");
  return Object.freeze({
    status: value.status,
    revision: positiveInteger(value.revision, "authority revision"),
    queryDigest,
    marketQuarantined: value.marketQuarantined,
    canonicalLifecycle: Array.isArray(value.canonicalLifecycle)
      ? Object.freeze(
          value.canonicalLifecycle.map((item) =>
            Object.freeze({
              stage: text(item?.stage, "authority lifecycle stage"),
              transactionHash: text(
                item?.transactionHash,
                "authority lifecycle transaction",
              ),
              ...(Array.isArray(item?.fillEvents)
                ? {
                    fillEvents: Object.freeze(
                      item.fillEvents.map((fill) =>
                        Object.freeze({
                          stage: text(
                            fill?.stage,
                            "authority fill lifecycle stage",
                          ),
                          lockId: text(fill?.lockId, "authority fill lock id"),
                          transactionHash: text(
                            fill?.transactionHash,
                            "authority fill transaction",
                          ),
                        }),
                      ),
                    ),
                  }
                : {}),
            }),
          ),
        )
      : Object.freeze([]),
  });
}
function authorityRequiresQuarantine(authority) {
  return (
    authority.status === "disagreement" ||
    authority.status === "reorged" ||
    authority.status === "quarantined" ||
    authority.marketQuarantined
  );
}
function terminalMetadataMatches(reservation, query, authority) {
  const terminal = reservation.terminalReconciliation;
  const expectedState = query.outcome === "settled" ? "consumed" : "released";
  return Boolean(
    reservation.state === expectedState &&
      terminal &&
      terminal.authorityDigest === authority.queryDigest &&
      terminal.authorityRevision === authority.revision &&
      terminal.outcome === query.outcome &&
      terminal.selectionFence === query.reservationFence,
  );
}
function validateRow(value, runtimeEpoch) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.runtimeEpoch !== runtimeEpoch
  )
    throw new Error("Maker reconciliation journal row is invalid.");
  if (!JOURNAL_STATUSES.has(value.status))
    throw new Error("Maker reconciliation journal status is invalid.");
  if (
    value.authorityStatus !== "unavailable" &&
    !AUTHORITY_STATUSES.has(value.authorityStatus)
  )
    throw new Error(
      "Maker reconciliation journal authority status is invalid.",
    );
  if (value.outcome !== "settled" && value.outcome !== "refunded")
    throw new Error("Maker reconciliation journal outcome is invalid.");
  if (typeof value.marketQuarantined !== "boolean")
    throw new Error(
      "Maker reconciliation journal market quarantine is invalid.",
    );
  return Object.freeze({
    key: text(value.key, "reconciliation key"),
    runtimeEpoch,
    queryDigest: hex32(value.queryDigest, "reconciliation query digest"),
    outcome: value.outcome,
    authorityRevision: nonnegativeInteger(
      value.authorityRevision,
      "reconciliation authority revision",
    ),
    authorityStatus: value.authorityStatus,
    marketQuarantined: value.marketQuarantined,
    status: value.status,
    reasonCode: text(value.reasonCode, "reconciliation reason code"),
    effectAttemptId: text(
      value.effectAttemptId,
      "reconciliation effect attempt id",
    ),
    revision: positiveInteger(value.revision, "reconciliation revision"),
    updatedAt: positiveInteger(value.updatedAt, "reconciliation updatedAt"),
  });
}

export class LocalnetMakerReconciler {
  #path;
  #runtimeEpoch;
  #rows = new Map();
  #revision = 0;
  #now;
  #releaseTerminal;
  #quarantineAuthority;
  #releaseV3Terminal;
  #quarantineV3Authority;
  #faultInjector;
  #failed = false;
  #tail = Promise.resolve();

  constructor(options) {
    this.#path = text(options.path, "maker reconciliation journal path");
    this.#runtimeEpoch = text(options.runtimeEpoch, "runtimeEpoch");
    if (!/^[0-9a-f]{32}$/.test(this.#runtimeEpoch))
      throw new Error("Maker reconciliation runtime epoch is invalid.");
    if (typeof options.releaseTerminal !== "function")
      throw new Error(
        "Maker reconciliation requires an idempotent terminal release adapter.",
      );
    if (typeof options.quarantineAuthority !== "function")
      throw new Error(
        "Maker reconciliation requires an idempotent authority quarantine adapter.",
      );
    this.#releaseTerminal = options.releaseTerminal;
    this.#quarantineAuthority = options.quarantineAuthority;
    this.#releaseV3Terminal = options.releaseV3Terminal;
    this.#quarantineV3Authority = options.quarantineV3Authority;
    if (
      this.#releaseV3Terminal !== undefined &&
      typeof this.#releaseV3Terminal !== "function"
    )
      throw new Error("Maker v3 terminal adapter must be a function.");
    if (
      this.#quarantineV3Authority !== undefined &&
      typeof this.#quarantineV3Authority !== "function"
    )
      throw new Error("Maker v3 quarantine adapter must be a function.");
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#faultInjector = options.faultInjector;
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    if (existsSync(this.#path)) this.#load();
  }

  #load() {
    let value;
    try {
      value = JSON.parse(readFileSync(this.#path, "utf8"));
    } catch {
      throw new Error(
        "Maker reconciliation journal is not valid JSON; refusing implicit reset.",
      );
    }
    if (
      value?.schema !== LOCALNET_MAKER_RECONCILIATION_SCHEMA ||
      value.runtimeEpoch !== this.#runtimeEpoch ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Array.isArray(value.rows)
    )
      throw new Error(
        "Maker reconciliation journal is invalid; refusing implicit reset.",
      );
    this.#revision = value.revision;
    for (const raw of value.rows) {
      const row = validateRow(raw, this.#runtimeEpoch);
      if (this.#rows.has(row.key) || row.revision > this.#revision)
        throw new Error(
          "Maker reconciliation journal contains invalid revisions.",
        );
      this.#rows.set(row.key, row);
    }
  }

  #serialize() {
    return `${JSON.stringify(
      {
        schema: LOCALNET_MAKER_RECONCILIATION_SCHEMA,
        runtimeEpoch: this.#runtimeEpoch,
        revision: this.#revision,
        rows: [...this.#rows.values()].sort((a, b) =>
          a.key.localeCompare(b.key),
        ),
      },
      null,
      2,
    )}\n`;
  }
  #persist() {
    if (this.#failed) throw new Error("Maker reconciliation is fail-stopped.");
    let temporary;
    let renamed = false;
    try {
      temporary = `${this.#path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      this.#faultInjector?.("before-write");
      writeFileSync(temporary, this.#serialize(), { mode: 0o600, flag: "wx" });
      this.#faultInjector?.("after-write");
      chmodSync(temporary, 0o600);
      const file = openSync(temporary, "r");
      try {
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      this.#faultInjector?.("after-file-fsync");
      renameSync(temporary, this.#path);
      renamed = true;
      this.#faultInjector?.("after-rename");
      const directory = openSync(dirname(this.#path), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      this.#faultInjector?.("after-directory-fsync");
    } catch (error) {
      this.#failed = true;
      if (!renamed && temporary && existsSync(temporary)) {
        try {
          unlinkSync(temporary);
        } catch {
          // The instance is fail-stopped; leftover cleanup is best effort.
        }
      }
      throw new Error(
        "Maker reconciliation persistence became uncertain; process is fail-stopped.",
        { cause: error },
      );
    }
  }
  #publish(row) {
    const before = this.#rows;
    this.#rows = new Map(this.#rows).set(row.key, row);
    try {
      this.#persist();
    } catch (error) {
      this.#rows = before;
      throw error;
    }
    return row;
  }
  #next(query, status, reasonCode, authority, effect) {
    const prior = this.#rows.get(reconciliationKey(query));
    const authorityRevision =
      authority?.revision ?? prior?.authorityRevision ?? 0;
    const authorityStatus =
      authority?.status ?? prior?.authorityStatus ?? "unavailable";
    const marketQuarantined =
      authority?.marketQuarantined ?? prior?.marketQuarantined ?? false;
    this.#revision += 1;
    return validateRow(
      {
        key: reconciliationKey(query),
        runtimeEpoch: this.#runtimeEpoch,
        queryDigest: digestLocalnetAuthorityQuery(query),
        outcome: query.outcome,
        authorityRevision,
        authorityStatus,
        marketQuarantined,
        status,
        reasonCode,
        effectAttemptId: effectAttemptId(query, authorityRevision, effect),
        revision: this.#revision,
        updatedAt: this.#now(),
      },
      this.#runtimeEpoch,
    );
  }

  reconcile(input) {
    const run = this.#tail.then(async () => {
      if (this.#failed)
        throw new Error("Maker reconciliation is fail-stopped.");
      const query = canonicalLocalnetAuthorityQuery(input.query);
      if (query.runtimeEpoch !== this.#runtimeEpoch)
        throw new Error("Maker reconciliation rejected an old runtime epoch.");
      const key = reconciliationKey(query);
      const queryDigest = digestLocalnetAuthorityQuery(query);
      const prior = this.#rows.get(key);
      if (
        prior &&
        (prior.queryDigest !== queryDigest || prior.outcome !== query.outcome)
      )
        throw new Error(
          "Maker reconciliation rejected an equivocated exact binding.",
        );
      const authority = exactAuthority(input.authorityEvidence, query);
      if (authority && prior && authority.revision < prior.authorityRevision) {
        return Object.freeze({ ...prior, staleAuthorityIgnored: true });
      }
      if (
        authority &&
        prior &&
        authority.revision === prior.authorityRevision &&
        (authority.status !== prior.authorityStatus ||
          authority.marketQuarantined !== prior.marketQuarantined)
      )
        throw new Error(
          "Maker reconciliation rejected same-revision authority equivocation.",
        );

      if (query.lifecycle === "v3") {
        if (!authority)
          return this.#publish(
            this.#next(
              query,
              "pending",
              "authority-unavailable",
              undefined,
              "none",
            ),
          );
        const ownedFills = exactV3Coordinator(
          input.coordinator,
          query,
          authority,
        );
        if (
          !authorityRequiresQuarantine(authority) &&
          authority.status !== "authoritative"
        )
          return this.#publish(
            this.#next(
              query,
              "pending",
              "authority-not-currently-final",
              authority,
              "none",
            ),
          );
        if (authorityRequiresQuarantine(authority)) {
          if (
            prior?.status === "quarantined" &&
            prior.authorityRevision === authority.revision &&
            prior.authorityStatus === authority.status &&
            prior.marketQuarantined === authority.marketQuarantined
          )
            return prior;
          if (typeof this.#quarantineV3Authority !== "function")
            throw new Error("Maker v3 authority quarantine adapter is unavailable.");
          const pending = this.#publish(
            this.#next(
              query,
              "quarantine-pending",
              "maker-v3-authority-quarantine-pending",
              authority,
              "authority-quarantine",
            ),
          );
          await this.#quarantineV3Authority({
            attemptId: pending.effectAttemptId,
            authorityDigest: authority.queryDigest,
            authorityRevision: authority.revision,
            query,
            fills: ownedFills,
            reason:
              authority.status === "reorged" || authority.marketQuarantined
                ? "authority-reorged"
                : "authority-disagreement",
          });
          this.#faultInjector?.("after-quarantine-ack");
          return this.#publish(
            this.#next(
              query,
              "quarantined",
              "exact-maker-v3-authority-quarantine",
              authority,
              "authority-quarantine",
            ),
          );
        }
        if (
          prior?.status === "released-terminal" &&
          prior.authorityRevision === authority.revision &&
          prior.authorityStatus === authority.status
        )
          return prior;
        if (typeof this.#releaseV3Terminal !== "function")
          throw new Error("Maker v3 terminal reconciliation adapter is unavailable.");
        const pending = this.#publish(
          this.#next(
            query,
            "release-pending",
            "v3-terminal-release-pending",
            authority,
            "terminal-reconciliation",
          ),
        );
        await this.#releaseV3Terminal({
          attemptId: pending.effectAttemptId,
          authorityDigest: authority.queryDigest,
          authorityRevision: authority.revision,
          query,
          fills: ownedFills,
          settlementTransactionHash: query.transactions.take,
        });
        this.#faultInjector?.("after-terminal-ack");
        return this.#publish(
          this.#next(
            query,
            "released-terminal",
            "exact-authoritative-v3-terminal",
            authority,
            "terminal-reconciliation",
          ),
        );
      }

      exactCoordinator(input.coordinator, query);
      if (!authority)
        return this.#publish(
          this.#next(
            query,
            "pending",
            "authority-unavailable",
            undefined,
            "none",
          ),
        );
      if (
        !authorityRequiresQuarantine(authority) &&
        authority.status !== "authoritative"
      )
        return this.#publish(
          this.#next(
            query,
            "pending",
            "authority-not-currently-final",
            authority,
            "none",
          ),
        );

      if (authorityRequiresQuarantine(authority)) {
        if (
          prior?.status === "quarantined" &&
          prior.authorityRevision === authority.revision &&
          prior.authorityStatus === authority.status &&
          prior.marketQuarantined === authority.marketQuarantined
        )
          return prior;
        const pending = this.#publish(
          this.#next(
            query,
            "quarantine-pending",
            "maker-authority-quarantine-pending",
            authority,
            "authority-quarantine",
          ),
        );
        const reason =
          authority.status === "reorged" || authority.marketQuarantined
            ? "authority-reorged"
            : "authority-disagreement";
        await this.#quarantineAuthority({
          attemptId: pending.effectAttemptId,
          authorityDigest: authority.queryDigest,
          authorityRevision: authority.revision,
          query,
          reason,
        });
        this.#faultInjector?.("after-quarantine-ack");
        return this.#publish(
          this.#next(
            query,
            "quarantined",
            "exact-maker-authority-quarantine",
            authority,
            "authority-quarantine",
          ),
        );
      }

      const reservation = exactReservation(input.reservation, query);
      const stages = authority.canonicalLifecycle.map((item) => item.stage);
      const expected =
        query.outcome === "settled"
          ? ["fund", "fill", "claim"]
          : ["fund", "timeout"];
      if (JSON.stringify(stages) !== JSON.stringify(expected))
        throw new Error(
          "Authority lifecycle does not match the terminal outcome.",
        );
      if (query.outcome === "settled") {
        const fill = authority.canonicalLifecycle.find(
          (item) => item.stage === "fill",
        );
        if (
          !reservation.settlementTransactionHash ||
          fill?.transactionHash !== reservation.settlementTransactionHash
        )
          throw new Error(
            "A hash-only or substituted fill cannot consume maker inventory.",
          );
      } else if (reservation.settlementTransactionHash) {
        throw new Error(
          "Refund authority contradicts a maker custody fill transaction.",
        );
      }

      // A journal terminal is reusable only when the maker snapshot itself
      // carries the same terminal authority revision, outcome, digest, fence,
      // and consumed/released state. A quarantine acknowledgement followed by
      // a crash therefore cannot be mistaken for an already-released maker.
      if (terminalMetadataMatches(reservation, query, authority)) {
        if (
          prior?.status === "released-terminal" &&
          prior.authorityRevision === authority.revision &&
          prior.authorityStatus === authority.status
        )
          return prior;
        return this.#publish(
          this.#next(
            query,
            "released-terminal",
            "maker-already-exact-authoritative-terminal",
            authority,
            "terminal-reconciliation",
          ),
        );
      }

      const pending = this.#publish(
        this.#next(
          query,
          "release-pending",
          "terminal-release-pending",
          authority,
          "terminal-reconciliation",
        ),
      );
      await this.#releaseTerminal({
        attemptId: pending.effectAttemptId,
        authorityDigest: authority.queryDigest,
        authorityRevision: authority.revision,
        query,
        settlementTransactionHash:
          query.outcome === "settled" ? query.transactions.fill : undefined,
      });
      this.#faultInjector?.("after-terminal-ack");
      return this.#publish(
        this.#next(
          query,
          "released-terminal",
          "exact-authoritative-terminal",
          authority,
          "terminal-reconciliation",
        ),
      );
    });
    this.#tail = run.catch(() => undefined);
    return run;
  }

  listRecoveryBindings() {
    return Object.freeze(
      [...this.#rows.values()].map((row) =>
        Object.freeze({
          queryDigest: row.queryDigest,
          status: row.status,
          authorityRevision: row.authorityRevision,
        }),
      ),
    );
  }

  listOperatorSummaries() {
    return Object.freeze(
      [...this.#rows.values()].map((row) =>
        Object.freeze({
          reference: row.queryDigest.slice(0, 14),
          status: row.status,
          revision: row.revision,
          authorityRevision: row.authorityRevision,
          authorityStatus: row.authorityStatus,
          updatedAt: row.updatedAt,
        }),
      ),
    );
  }
}

export function createLocalnetMakerReconciler(options) {
  return new LocalnetMakerReconciler(options);
}
