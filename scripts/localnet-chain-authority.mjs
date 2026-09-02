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
import { fillsDigest as takeFillsDigest } from "../packages/private-intents/src/take-signature.ts";
import {
  LOCALNET_CHAIN_AUTHORITY_SERVER_SENTINEL,
  assertLocalnetEscrowArtifactIdentity,
  decodeLocalnetEscrowEvent,
} from "./localnet-chain-decoder.mjs";
import { canonicalLocalnetTakeExpected } from "./localnet-deal-validator.mjs";

export { LOCALNET_CHAIN_AUTHORITY_SERVER_SENTINEL };
export const LOCALNET_CHAIN_AUTHORITY_SCHEMA =
  "app20/localnet-chain-authority/v1";
export const LOCALNET_CHAIN_AUTHORITY_SOURCE = "localnet-chain-authority";
const HEX_32 = /^0x[0-9a-f]{64}$/;
const STATUSES = new Set([
  "authoritative",
  "stale",
  "disagreement",
  "reorged",
  "quarantined",
]);

function canonicalFelt(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value))
    throw new Error(`${label} must be a lowercase canonical felt.`);
  const parsed = BigInt(value);
  if (
    parsed === 0n ||
    parsed >= 1n << 252n ||
    value !== `0x${parsed.toString(16)}`
  )
    throw new Error(`${label} must be a nonzero canonical felt.`);
  return value;
}
function hex32(value, label) {
  if (typeof value !== "string" || !HEX_32.test(value))
    throw new Error(`${label} must be a lowercase 32-byte digest.`);
  return value;
}
function text(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    value.length > 512
  )
    throw new Error(`${label} is invalid.`);
  return value.trim();
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive safe integer.`);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}
function positiveDecimal(value, label) {
  const string = typeof value === "bigint" ? value.toString() : value;
  if (typeof string !== "string" || !/^[1-9][0-9]*$/.test(string))
    throw new Error(`${label} must be a positive canonical decimal string.`);
  return string;
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function digestLocalnetAuthorityQuery(input) {
  return digest(canonicalLocalnetAuthorityQuery(input));
}

export function canonicalLocalnetAuthorityQuery(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Localnet authority query is required.");
  const runtimeEpoch = text(input.runtimeEpoch, "runtimeEpoch");
  if (!/^[0-9a-f]{32}$/.test(runtimeEpoch))
    throw new Error("runtimeEpoch is invalid.");
  if (input.lifecycle === "v3") {
    const query = {
      lifecycle: "v3",
      runtimeEpoch,
      chainId: canonicalFelt(input.chainId, "chainId"),
      account: canonicalFelt(input.account, "account"),
      rfqId: canonicalFelt(input.rfqId, "rfqId"),
      dealId: canonicalFelt(input.dealId, "dealId"),
      intentDigest: hex32(input.intentDigest, "intentDigest"),
      rfqDigest: hex32(input.rfqDigest, "rfqDigest"),
      commitmentDigest: hex32(input.commitmentDigest, "commitmentDigest"),
      outcome: "settled",
      expected: canonicalLocalnetTakeExpected(input.expected),
      transactions: Object.freeze({
        take: canonicalFelt(input.transactions?.take, "take transaction"),
      }),
    };
    if (query.rfqId !== query.dealId)
      throw new Error(
        "Localnet v3 authority requires RFQ and deal identity equality.",
      );
    return Object.freeze(query);
  }
  const outcome = input.outcome;
  if (outcome !== "settled" && outcome !== "refunded")
    throw new Error("Localnet authority outcome must be settled or refunded.");
  const query = {
    runtimeEpoch,
    chainId: canonicalFelt(input.chainId, "chainId"),
    account: canonicalFelt(input.account, "account"),
    rfqId: canonicalFelt(input.rfqId, "rfqId"),
    dealId: canonicalFelt(input.dealId, "dealId"),
    intentDigest: hex32(input.intentDigest, "intentDigest"),
    commitmentDigest: hex32(input.commitmentDigest, "commitmentDigest"),
    reservationId: hex32(input.reservationId, "reservationId"),
    reservationFence: positiveDecimal(
      input.reservationFence,
      "reservationFence",
    ),
    quoteDigest: hex32(input.quoteDigest, "quoteDigest"),
    makerId: text(input.makerId, "makerId"),
    sellToken: canonicalFelt(input.sellToken, "sellToken"),
    sellAmount: positiveDecimal(input.sellAmount, "sellAmount"),
    buyToken: canonicalFelt(input.buyToken, "buyToken"),
    buyAmount: positiveDecimal(input.buyAmount, "buyAmount"),
    deadline: positiveInteger(input.deadline, "deadline"),
    ticketAddress: canonicalFelt(input.ticketAddress, "ticketAddress"),
    outcome,
    transactions: Object.freeze(
      Object.fromEntries(
        (outcome === "settled"
          ? ["fund", "fill", "claim"]
          : ["fund", "timeout"]
        ).map((stage) => [
          stage,
          canonicalFelt(input.transactions?.[stage], `${stage} transaction`),
        ]),
      ),
    ),
  };
  if (query.rfqId !== query.dealId)
    throw new Error(
      "Localnet authority requires RFQ and deal identity equality.",
    );
  return Object.freeze(query);
}

function expectedStages(query) {
  if (query.lifecycle === "v3") return ["take"];
  return query.outcome === "settled"
    ? ["fund", "fill", "claim"]
    : ["fund", "timeout"];
}

function coordinateAfter(left, right) {
  return (
    left.blockNumber > right.blockNumber ||
    (left.blockNumber === right.blockNumber &&
      (left.transactionIndex > right.transactionIndex ||
        (left.transactionIndex === right.transactionIndex &&
          left.eventIndex > right.eventIndex)))
  );
}

function validatePersistedLifecycle(value, query) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const stages = expectedStages(query);
  if (value.length !== 0 && value.length !== stages.length)
    throw new Error("Authority journal lifecycle is incomplete.");
  let prior;
  const lifecycle = value.map((item, index) => {
    const stage = text(item?.stage, "authority lifecycle stage");
    const coordinate = Object.freeze({
      stage,
      transactionHash: canonicalFelt(
        item?.transactionHash,
        "authority lifecycle transaction",
      ),
      blockNumber: nonnegativeInteger(
        item?.blockNumber,
        "authority lifecycle block number",
      ),
      blockHash: canonicalFelt(
        item?.blockHash,
        "authority lifecycle block hash",
      ),
      transactionIndex: nonnegativeInteger(
        item?.transactionIndex,
        "authority transaction index",
      ),
      eventIndex: nonnegativeInteger(item?.eventIndex, "authority event index"),
    });
    if (
      stage !== stages[index] ||
      coordinate.transactionHash !== query.transactions[stage]
    ) {
      throw new Error("Authority journal lifecycle changed its exact query.");
    }
    if (prior && !coordinateAfter(coordinate, prior))
      throw new Error(
        "Authority journal lifecycle coordinates are out of order.",
      );
    prior = coordinate;
    if (stage !== "take") return coordinate;
    if (
      !Array.isArray(item.fillEvents) ||
      item.fillEvents.length !== query.expected.fills.length
    )
      throw new Error("Authority journal v3 lifecycle fills are incomplete.");
    const fillEvents = item.fillEvents.map((fill, fillIndex) => {
      const expected = query.expected.fills[fillIndex];
      const exact = Object.freeze({
        stage: text(fill?.stage, "authority fill lifecycle stage"),
        lockId: canonicalFelt(fill?.lockId, "authority fill lock id"),
        transactionHash: canonicalFelt(
          fill?.transactionHash,
          "authority fill transaction",
        ),
        blockNumber: nonnegativeInteger(
          fill?.blockNumber,
          "authority fill block number",
        ),
        blockHash: canonicalFelt(fill?.blockHash, "authority fill block hash"),
        transactionIndex: nonnegativeInteger(
          fill?.transactionIndex,
          "authority fill transaction index",
        ),
        eventIndex: nonnegativeInteger(
          fill?.eventIndex,
          "authority fill event index",
        ),
      });
      if (
        exact.stage !== "lockTaken" ||
        exact.lockId !== expected.lockId ||
        exact.transactionHash !== coordinate.transactionHash ||
        exact.blockNumber !== coordinate.blockNumber ||
        exact.blockHash !== coordinate.blockHash ||
        exact.transactionIndex !== coordinate.transactionIndex ||
        exact.eventIndex >= coordinate.eventIndex
      )
        throw new Error(
          "Authority journal v3 fill changed its exact take binding.",
        );
      return exact;
    });
    if (
      new Set(fillEvents.map((fill) => fill.eventIndex)).size !==
      fillEvents.length
    )
      throw new Error(
        "Authority journal v3 lifecycle reused a fill coordinate.",
      );
    return Object.freeze({
      ...coordinate,
      fillEvents: Object.freeze(fillEvents),
    });
  });
  return Object.freeze(lifecycle);
}

function assertDecodedBinding(decoded, query) {
  if (decoded.dealId !== query.dealId)
    throw new Error("Decoded event is bound to another deal.");
  if (query.lifecycle === "v3") {
    if (
      decoded.stage !== "take" ||
      decoded.tokenA !== query.expected.tokenA ||
      decoded.totalA !== query.expected.totalA ||
      decoded.tokenB !== query.expected.tokenB ||
      decoded.totalB !== query.expected.totalB ||
      decoded.fillCount !== query.expected.fills.length ||
      decoded.fillsDigest !==
        takeFillsDigest(
          query.expected.fills.map((fill) => ({
            lockId: fill.lockId,
            amountA: BigInt(fill.amountA),
          })),
        )
    )
      throw new Error("Decoded DealTaken does not match exact v3 take terms.");
    return;
  }
  if (decoded.stage === "fund") {
    if (
      decoded.sellToken !== query.sellToken ||
      decoded.sellAmount !== query.sellAmount ||
      decoded.buyToken !== query.buyToken ||
      decoded.buyAmount !== query.buyAmount ||
      decoded.deadline !== query.deadline ||
      decoded.ticketAddress !== query.ticketAddress
    )
      throw new Error(
        "Decoded fund event does not match exact settlement terms.",
      );
  } else if (decoded.stage === "fill") {
    if (
      decoded.sellToken !== query.sellToken ||
      decoded.sellAmount !== query.sellAmount ||
      decoded.buyToken !== query.buyToken ||
      decoded.buyAmount !== query.buyAmount
    )
      throw new Error(
        "Decoded fill event does not match exact settlement terms.",
      );
  } else if (decoded.stage === "claim") {
    if (decoded.token !== query.buyToken || decoded.amount !== query.buyAmount)
      throw new Error(
        "Decoded claim does not match the selected maker amount.",
      );
  } else if (
    decoded.token !== query.sellToken ||
    decoded.amount !== query.sellAmount
  ) {
    throw new Error("Decoded timeout does not return exact taker principal.");
  }
}

function normalizeObservation(
  raw,
  query,
  artifact,
  readerId,
  now,
  maxAgeSeconds,
  finalityDepth,
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`Reader ${readerId} returned no observation.`);
  if (raw.runtimeEpoch !== query.runtimeEpoch || raw.chainId !== query.chainId)
    throw new Error(`Reader ${readerId} observed another runtime or chain.`);
  const observedArtifact = assertLocalnetEscrowArtifactIdentity(raw.artifact);
  if (canonicalJson(observedArtifact) !== canonicalJson(artifact))
    throw new Error(`Reader ${readerId} observed another escrow artifact.`);
  const observedAt = positiveInteger(raw.observedAt, "reader observedAt");
  const head = {
    number: nonnegativeInteger(raw.head?.number, "reader head number"),
    hash: canonicalFelt(raw.head?.hash, "reader head hash"),
  };
  const finalizedHead = nonnegativeInteger(
    raw.finalizedHead,
    "reader finalized head",
  );
  if (observedAt > now + 5 || now - observedAt > maxAgeSeconds)
    throw Object.assign(new Error(`Reader ${readerId} observation is stale.`), {
      authorityStatus: "stale",
    });
  if (finalizedHead > head.number)
    throw new Error(
      `Reader ${readerId} finalized head exceeds its observed head.`,
    );
  const stages = expectedStages(query);
  if (!Array.isArray(raw.lifecycle) || raw.lifecycle.length !== stages.length)
    throw new Error(`Reader ${readerId} returned an incomplete lifecycle.`);
  const coordinates = new Set();
  let priorCoordinate;
  const lifecycle = raw.lifecycle.map((item, index) => {
    if (!item || typeof item !== "object" || item.stage !== stages[index])
      throw new Error(`Reader ${readerId} lifecycle ordering is invalid.`);
    const transactionHash = canonicalFelt(
      item.transactionHash,
      "lifecycle transaction hash",
    );
    if (transactionHash !== query.transactions[item.stage])
      throw new Error(`Reader ${readerId} returned a substituted transaction.`);
    const blockNumber = nonnegativeInteger(
      item.blockNumber,
      "lifecycle block number",
    );
    const blockHash = canonicalFelt(item.blockHash, "lifecycle block hash");
    const transactionIndex = nonnegativeInteger(
      item.transactionIndex,
      "lifecycle transaction index",
    );
    const eventIndex = nonnegativeInteger(
      item.eventIndex,
      "lifecycle event index",
    );
    const block = item.block;
    if (
      !block ||
      nonnegativeInteger(block.number, "canonical block number") !==
        blockNumber ||
      canonicalFelt(block.hash, "canonical block hash") !== blockHash ||
      !Array.isArray(block.transactions) ||
      canonicalFelt(
        block.transactions[transactionIndex],
        "canonical block transaction",
      ) !== transactionHash
    )
      throw new Error(
        "Lifecycle transaction is not a member of its canonical block number.",
      );
    const coordinate = { blockNumber, transactionIndex, eventIndex };
    const coordinateKey = `${blockNumber}:${transactionIndex}:${eventIndex}`;
    if (coordinates.has(coordinateKey))
      throw new Error("Lifecycle event coordinate was reused.");
    if (priorCoordinate && !coordinateAfter(coordinate, priorCoordinate))
      throw new Error("Lifecycle event coordinates are out of order.");
    coordinates.add(coordinateKey);
    priorCoordinate = coordinate;
    const decoded = decodeLocalnetEscrowEvent(item.event, artifact);
    if (decoded.stage !== item.stage)
      throw new Error(
        "Lifecycle stage does not match its decoded event selector.",
      );
    assertDecodedBinding(decoded, query);
    if (
      head.number - blockNumber < finalityDepth ||
      finalizedHead < blockNumber
    )
      throw Object.assign(
        new Error("Lifecycle event has not reached local fixture finality."),
        { authorityStatus: "stale" },
      );
    let fillEvents;
    if (item.stage === "take") {
      if (
        !Array.isArray(item.fillEvents) ||
        item.fillEvents.length !== query.expected.fills.length
      )
        throw new Error(
          `Reader ${readerId} returned incomplete LockTaken events.`,
        );
      let priorFillEventIndex = -1;
      fillEvents = item.fillEvents.map((fillEvent, fillIndex) => {
        const fillEventIndex = nonnegativeInteger(
          fillEvent?.eventIndex,
          "LockTaken event index",
        );
        const fillCoordinateKey = `${blockNumber}:${transactionIndex}:${fillEventIndex}`;
        if (
          coordinates.has(fillCoordinateKey) ||
          fillEventIndex <= priorFillEventIndex ||
          fillEventIndex >= eventIndex
        )
          throw new Error(
            "LockTaken event coordinate is duplicated or out of order.",
          );
        coordinates.add(fillCoordinateKey);
        priorFillEventIndex = fillEventIndex;
        const fillDecoded = decodeLocalnetEscrowEvent(
          fillEvent?.event,
          artifact,
        );
        const expectedFill = query.expected.fills[fillIndex];
        if (
          fillDecoded.stage !== "lockTaken" ||
          fillDecoded.dealId !== query.dealId ||
          fillDecoded.lockId !== expectedFill.lockId ||
          fillDecoded.amountA !== expectedFill.amountA ||
          fillDecoded.amountB !== expectedFill.amountB
        )
          throw new Error(
            "Decoded LockTaken does not match its exact expected fill.",
          );
        return Object.freeze({
          stage: "lockTaken",
          lockId: fillDecoded.lockId,
          transactionHash,
          blockNumber,
          blockHash,
          transactionIndex,
          eventIndex: fillEventIndex,
          decoded: fillDecoded,
        });
      });
    }
    return Object.freeze({
      stage: item.stage,
      transactionHash,
      blockNumber,
      blockHash,
      transactionIndex,
      eventIndex,
      decoded,
      ...(fillEvents ? { fillEvents: Object.freeze(fillEvents) } : {}),
    });
  });
  return Object.freeze({
    runtimeEpoch: query.runtimeEpoch,
    chainId: query.chainId,
    artifact,
    observedAt,
    head,
    finalizedHead,
    lifecycle: Object.freeze(lifecycle),
  });
}

function browserProjection(row) {
  const takeEvidence =
    row.query.lifecycle === "v3" && row.canonicalLifecycle.length === 1
      ? {
          fillsDigest: takeFillsDigest(
            row.query.expected.fills.map((fill) => ({
              lockId: fill.lockId,
              amountA: BigInt(fill.amountA),
            })),
          ),
          lockTaken: Object.freeze(
            row.query.expected.fills.map((fill) =>
              Object.freeze({
                lockId: fill.lockId,
                amountA: fill.amountA,
              }),
            ),
          ),
        }
      : {};
  return Object.freeze({
    source: LOCALNET_CHAIN_AUTHORITY_SOURCE,
    runtimeEpoch: row.runtimeEpoch,
    chainId: row.chainId,
    account: row.account,
    rfqId: row.rfqId,
    dealId: row.dealId,
    lifecycle: row.query.lifecycle === "v3" ? "v3" : "v2",
    status: row.status,
    revision: row.revision,
    observedAt: row.observedAt,
    validUntil: row.validUntil,
    ...takeEvidence,
  });
}

function validatePersistedRow(value, runtimeEpoch, chainId) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Authority journal row is invalid.");
  if (!STATUSES.has(value.status))
    throw new Error("Authority journal status is invalid.");
  if (value.runtimeEpoch !== runtimeEpoch || value.chainId !== chainId)
    throw new Error("Authority journal contains cross-runtime data.");
  const query = canonicalLocalnetAuthorityQuery(value.query);
  const row = {
    key: text(value.key, "authority row key"),
    runtimeEpoch,
    chainId,
    query,
    account: canonicalFelt(value.account, "authority account"),
    rfqId: canonicalFelt(value.rfqId, "authority RFQ"),
    dealId: canonicalFelt(value.dealId, "authority deal"),
    market: text(value.market, "authority market"),
    queryDigest: hex32(value.queryDigest, "authority query digest"),
    status: value.status,
    reasonCode: text(value.reasonCode, "authority reason code"),
    revision: positiveInteger(value.revision, "authority revision"),
    observedAt: positiveInteger(value.observedAt, "authority observedAt"),
    validUntil: positiveInteger(value.validUntil, "authority validUntil"),
    marketQuarantined: value.marketQuarantined === true,
    canonicalLifecycle: validatePersistedLifecycle(
      value.canonicalLifecycle,
      query,
    ),
  };
  if (row.validUntil <= row.observedAt)
    throw new Error("Authority journal validity window is invalid.");
  const expectedKey = `${query.chainId}|${query.account}|${query.rfqId}`;
  if (
    row.key !== expectedKey ||
    row.queryDigest !== digest(query) ||
    row.runtimeEpoch !== query.runtimeEpoch ||
    row.chainId !== query.chainId ||
    row.account !== query.account ||
    row.rfqId !== query.rfqId ||
    row.dealId !== query.dealId
  )
    throw new Error(
      "Authority journal row contradicts its exact query binding.",
    );
  if (
    (row.status === "authoritative" ||
      row.status === "reorged" ||
      row.status === "quarantined" ||
      row.marketQuarantined) &&
    row.canonicalLifecycle.length !== expectedStages(query).length
  )
    throw new Error(
      "Authority journal terminal status lacks a complete lifecycle.",
    );
  return Object.freeze(row);
}

export class LocalnetChainAuthority {
  #path;
  #artifact;
  #readers;
  #rows = new Map();
  #revision = 0;
  #now;
  #maxAgeSeconds;
  #finalityDepth;
  #faultInjector;
  #failed = false;
  #tail = Promise.resolve();

  constructor(options) {
    this.#path = text(options.path, "authority journal path");
    this.#artifact = assertLocalnetEscrowArtifactIdentity(options.artifact);
    if (!Array.isArray(options.readers) || options.readers.length < 2)
      throw new Error(
        "Localnet authority requires at least two modeled readers.",
      );
    const ids = options.readers.map((reader) => text(reader.id, "reader id"));
    if (new Set(ids).size !== ids.length)
      throw new Error("Localnet authority reader identities must be unique.");
    if (
      options.readers.some(
        (reader) =>
          reader.independence !== "same-devnet-fixture" ||
          typeof reader.observe !== "function",
      )
    )
      throw new Error(
        "Local readers must be explicitly labelled same-devnet fixtures.",
      );
    this.#readers = Object.freeze([...options.readers]);
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#maxAgeSeconds = options.maxAgeSeconds ?? 30;
    this.#finalityDepth = options.finalityDepth ?? 2;
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
        "Localnet authority journal is not valid JSON; refusing implicit reset.",
      );
    }
    if (
      value?.schema !== LOCALNET_CHAIN_AUTHORITY_SCHEMA ||
      value.runtimeEpoch !== this.#artifact.runtimeEpoch ||
      value.chainId !== this.#artifact.chainId ||
      canonicalJson(value.artifact) !== canonicalJson(this.#artifact) ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Array.isArray(value.rows)
    )
      throw new Error(
        "Localnet authority journal is invalid; refusing implicit reset.",
      );
    this.#revision = value.revision;
    for (const raw of value.rows) {
      const row = validatePersistedRow(raw, value.runtimeEpoch, value.chainId);
      if (this.#rows.has(row.key) || row.revision > this.#revision)
        throw new Error(
          "Localnet authority journal has invalid row revisions.",
        );
      this.#rows.set(row.key, row);
    }
  }

  #serialize() {
    return `${JSON.stringify(
      {
        schema: LOCALNET_CHAIN_AUTHORITY_SCHEMA,
        runtimeEpoch: this.#artifact.runtimeEpoch,
        chainId: this.#artifact.chainId,
        artifact: this.#artifact,
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
    if (this.#failed)
      throw new Error(
        "Localnet authority fail-stopped after uncertain persistence.",
      );
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
        "Localnet authority persistence became uncertain; process is fail-stopped.",
        { cause: error },
      );
    }
  }

  #enqueue(operation) {
    const run = this.#tail.then(operation);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async verify(input) {
    return this.#enqueue(async () => {
      if (this.#failed) throw new Error("Localnet authority is fail-stopped.");
      const query = canonicalLocalnetAuthorityQuery(input.query);
      if (
        query.runtimeEpoch !== this.#artifact.runtimeEpoch ||
        query.chainId !== this.#artifact.chainId
      )
        throw new Error(
          "Authority query is outside this runtime composition root.",
        );
      const market = text(input.market, "market").toLowerCase();
      const key = `${query.chainId}|${query.account}|${query.rfqId}`;
      const queryDigest = digest(query);
      const prior = this.#rows.get(key);
      if (
        prior &&
        (prior.queryDigest !== queryDigest || prior.market !== market)
      ) {
        throw new Error(
          "Authority key was reused with another exact query or market binding.",
        );
      }
      const now = positiveInteger(this.#now(), "authority clock");
      const outcomes = await Promise.allSettled(
        this.#readers.map((reader) => reader.observe(query)),
      );
      let status = "authoritative";
      let reasonCode = "quorum-finalized";
      let canonicalLifecycle = [];
      let normalized = [];
      try {
        normalized = outcomes.map((outcome, index) => {
          if (outcome.status !== "fulfilled")
            throw Object.assign(
              new Error(`Reader ${this.#readers[index].id} is unavailable.`),
              { authorityStatus: "disagreement" },
            );
          return normalizeObservation(
            outcome.value,
            query,
            this.#artifact,
            this.#readers[index].id,
            now,
            this.#maxAgeSeconds,
            this.#finalityDepth,
          );
        });
        const first = canonicalJson({ ...normalized[0], observedAt: 0 });
        if (
          normalized
            .slice(1)
            .some((item) => canonicalJson({ ...item, observedAt: 0 }) !== first)
        )
          throw Object.assign(new Error("Local readers disagree."), {
            authorityStatus: "disagreement",
          });
        canonicalLifecycle = normalized[0].lifecycle.map((item) => ({
          stage: item.stage,
          transactionHash: item.transactionHash,
          blockNumber: item.blockNumber,
          blockHash: item.blockHash,
          transactionIndex: item.transactionIndex,
          eventIndex: item.eventIndex,
          ...(item.fillEvents
            ? {
                fillEvents: item.fillEvents.map((fill) => ({
                  stage: fill.stage,
                  lockId: fill.lockId,
                  transactionHash: fill.transactionHash,
                  blockNumber: fill.blockNumber,
                  blockHash: fill.blockHash,
                  transactionIndex: fill.transactionIndex,
                  eventIndex: fill.eventIndex,
                })),
              }
            : {}),
        }));
      } catch (error) {
        status = error?.authorityStatus === "stale" ? "stale" : "disagreement";
        reasonCode =
          status === "stale"
            ? "observation-stale-or-unfinalized"
            : "reader-unavailable-or-disagreement";
      }
      if (prior?.marketQuarantined) {
        status = "reorged";
        reasonCode = "canonical-membership-lost";
        canonicalLifecycle = prior.canonicalLifecycle;
      } else if (
        status === "authoritative" &&
        prior?.canonicalLifecycle?.length > 0 &&
        canonicalJson(prior.canonicalLifecycle) !==
          canonicalJson(canonicalLifecycle)
      ) {
        status = "reorged";
        reasonCode = "canonical-membership-lost";
      } else if (
        status !== "authoritative" &&
        prior?.canonicalLifecycle?.length > 0
      ) {
        // A reader outage, stale head, or disagreement is not proof of a
        // canonical replacement. Retain the last agreed coordinates so a
        // later successful quorum can detect an actual reorg.
        canonicalLifecycle = prior.canonicalLifecycle;
      }
      this.#revision += 1;
      const row = validatePersistedRow(
        {
          key,
          runtimeEpoch: query.runtimeEpoch,
          chainId: query.chainId,
          account: query.account,
          rfqId: query.rfqId,
          dealId: query.dealId,
          market,
          query,
          queryDigest,
          status,
          reasonCode,
          revision: this.#revision,
          observedAt: now,
          validUntil: now + this.#maxAgeSeconds,
          marketQuarantined:
            status === "reorged" ||
            status === "quarantined" ||
            prior?.marketQuarantined === true,
          canonicalLifecycle,
        },
        query.runtimeEpoch,
        query.chainId,
      );
      const before = this.#rows;
      this.#rows = new Map(this.#rows).set(key, row);
      try {
        this.#persist();
      } catch (error) {
        this.#rows = before;
        throw error;
      }
      return browserProjection(row);
    });
  }

  snapshot(input) {
    const key = `${canonicalFelt(input.chainId, "snapshot chainId")}|${canonicalFelt(input.account, "snapshot account")}|${canonicalFelt(input.rfqId, "snapshot RFQ")}`;
    const row = this.#rows.get(key);
    if (!row) return undefined;
    const now = positiveInteger(this.#now(), "authority clock");
    if (row.status === "authoritative" && now >= row.validUntil) {
      return Object.freeze({ ...browserProjection(row), status: "stale" });
    }
    return browserProjection(row);
  }

  exactQueryForProjection(projection) {
    const key = `${canonicalFelt(projection.chainId, "projection chainId")}|${canonicalFelt(projection.account, "projection account")}|${canonicalFelt(projection.rfqId, "projection RFQ")}`;
    const row = this.#rows.get(key);
    if (
      !row ||
      row.runtimeEpoch !== projection.runtimeEpoch ||
      row.dealId !== projection.dealId
    )
      throw new Error("Authority projection has no durable exact query.");
    return row.query;
  }

  async reverifyAll() {
    const pending = [...this.#rows.values()].map((row) => ({
      query: row.query,
      market: row.market,
    }));
    const projections = [];
    for (const input of pending) projections.push(await this.verify(input));
    return Object.freeze(projections);
  }

  reconciliationEvidence(input) {
    const query = canonicalLocalnetAuthorityQuery(input);
    const key = `${query.chainId}|${query.account}|${query.rfqId}`;
    const row = this.#rows.get(key);
    if (!row || row.queryDigest !== digest(query)) return undefined;
    return Object.freeze({
      status: row.status,
      revision: row.revision,
      queryDigest: row.queryDigest,
      marketQuarantined: row.marketQuarantined,
      canonicalLifecycle: row.canonicalLifecycle,
    });
  }

  hasQueryDigest(queryDigest) {
    return [...this.#rows.values()].some(
      (row) => row.queryDigest === queryDigest,
    );
  }

  listOperatorSummaries() {
    return Object.freeze(
      [...this.#rows.values()].map((row) =>
        Object.freeze({
          reference: row.queryDigest.slice(0, 14),
          status: row.status,
          revision: row.revision,
          market: row.market,
          marketQuarantined: row.marketQuarantined,
          observedAt: row.observedAt,
        }),
      ),
    );
  }
}

export function createLocalnetChainAuthority(options) {
  return new LocalnetChainAuthority(options);
}
