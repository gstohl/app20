import { assertPriceSchedule } from "../packages/private-intents/src/index.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_U128 = (1n << 128n) - 1n;
const HEX_32 = /^0x[0-9a-f]{64}$/;
const FELT = /^0x[0-9a-f]{1,64}$/;

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required.`);
  return value;
}

function canonicalHex32(value, label) {
  const text = requiredText(value, label);
  if (!HEX_32.test(text))
    throw new Error(
      `${label} must be a canonical lowercase 32-byte hex value.`,
    );
  return text;
}

function canonicalFelt(value, label) {
  const text = requiredText(value, label);
  if (!FELT.test(text) || BigInt(text) === 0n)
    throw new Error(`${label} must be a nonzero canonical lowercase felt.`);
  const canonical = `0x${BigInt(text).toString(16)}`;
  if (text !== canonical)
    throw new Error(`${label} must be a nonzero canonical lowercase felt.`);
  return canonical;
}

function positiveBigInt(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))
    throw new Error(`${label} must be a positive canonical decimal string.`);
  return BigInt(value);
}

function canonicalRpcFelt(value, label, allowZero = false) {
  const text = requiredText(value, label);
  if (!FELT.test(text)) {
    throw new Error(`${label} must be a canonical lowercase felt.`);
  }
  const felt = BigInt(text);
  const canonical = `0x${felt.toString(16)}`;
  if (text !== canonical || (!allowZero && felt === 0n)) {
    throw new Error(`${label} must be a canonical lowercase felt.`);
  }
  return canonical;
}

function rpcU128(value, label) {
  const felt = BigInt(canonicalRpcFelt(value, label, true));
  if (felt > MAX_U128) throw new Error(`${label} must fit in u128.`);
  return felt;
}

function rpcBoolean(value, label) {
  const felt = BigInt(canonicalRpcFelt(value, label, true));
  if (felt !== 0n && felt !== 1n) {
    throw new Error(`${label} must be a Cairo boolean.`);
  }
  return felt === 1n;
}

function hexAmount(value, label, allowZero = false) {
  if (
    typeof value !== "bigint" ||
    value < 0n ||
    value > MAX_U128 ||
    (!allowZero && value === 0n)
  ) {
    throw new Error(
      `${label} must be ${allowZero ? "a" : "a positive"} u128 bigint.`,
    );
  }
  return `0x${value.toString(16)}`;
}

export function parseLocalnetMakerReconciliationTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Maker reconciliation target is missing.");
  }
  if (value.lifecycle === "v3") {
    if (
      !Number.isSafeInteger(value.authorityRevision) ||
      value.authorityRevision <= 0
    ) {
      throw new Error(
        "Maker v3 reconciliation authorityRevision must be a positive safe integer.",
      );
    }
    return Object.freeze({
      lifecycle: "v3",
      rfqDigest: canonicalHex32(value.rfqDigest, "target.rfqDigest"),
      rfqFelt: canonicalFelt(value.rfqFelt, "target.rfqFelt"),
      lockId: canonicalFelt(value.lockId, "target.lockId"),
      quoteDigest: canonicalHex32(value.quoteDigest, "target.quoteDigest"),
      tokenA: canonicalFelt(value.tokenA, "target.tokenA"),
      tokenB: canonicalFelt(value.tokenB, "target.tokenB"),
      takenA: positiveBigInt(value.takenA, "target.takenA"),
      takenB: positiveBigInt(value.takenB, "target.takenB"),
      transactionHash: canonicalFelt(
        value.transactionHash,
        "target.transactionHash",
      ),
      authorityRevision: value.authorityRevision,
      idempotencyKey: requiredText(
        value.idempotencyKey,
        "target.idempotencyKey",
      ),
    });
  }
  if (value.lifecycle !== undefined) {
    throw new Error("Maker reconciliation target lifecycle is unsupported.");
  }
  return Object.freeze({
    reservationId: value.reservationId,
    intentDigest: value.intentDigest,
    fence: BigInt(value.fence),
    quoteDigest: value.quoteDigest,
    dealId: value.dealId,
    sellToken: value.sellToken,
    sellAmount: BigInt(value.sellAmount),
    buyToken: value.buyToken,
    buyAmount: BigInt(value.buyAmount),
    deadline: value.deadline,
    ticketAddress: value.ticketAddress,
  });
}

export function parseLocalnetEscrowLockResult(result) {
  if (!Array.isArray(result) || result.length !== 20) {
    throw new Error("Escrow get_lock result must contain exactly 20 felts.");
  }
  const statusValue = BigInt(canonicalRpcFelt(result[19], "lock status", true));
  if (statusValue !== 0n && statusValue !== 1n) {
    throw new Error("Escrow lock status is unsupported.");
  }
  const pointsLengthValue = BigInt(
    canonicalRpcFelt(result[5], "lock schedule length", true),
  );
  if (pointsLengthValue > 4n) {
    throw new Error("Escrow lock schedule length is invalid.");
  }
  const pointsLength = Number(pointsLengthValue);
  if (
    (statusValue === 0n && pointsLength !== 0) ||
    (statusValue === 1n && pointsLength < 1)
  ) {
    throw new Error("Escrow lock schedule length does not match its status.");
  }
  const schedule = Object.freeze(
    Array.from({ length: pointsLength }, (_, index) =>
      Object.freeze({
        a: rpcU128(result[6 + index * 2], `lock p${index}_a`),
        b: rpcU128(result[7 + index * 2], `lock p${index}_b`),
      }),
    ),
  );
  if (statusValue === 1n) assertPriceSchedule(schedule);
  const expiryValue = BigInt(canonicalRpcFelt(result[4], "lock expiry", true));
  if (
    expiryValue > BigInt(Number.MAX_SAFE_INTEGER) ||
    (statusValue === 1n && expiryValue === 0n)
  ) {
    throw new Error("Escrow lock expiry is not a safe positive timestamp.");
  }
  return Object.freeze({
    tokenA: canonicalRpcFelt(result[0], "lock token A", statusValue === 0n),
    tokenB: canonicalRpcFelt(result[1], "lock token B", statusValue === 0n),
    rfqId: canonicalRpcFelt(result[2], "lock RFQ id", statusValue === 0n),
    takerCommitment: canonicalRpcFelt(result[3], "lock taker commitment", true),
    expiry: Number(expiryValue),
    schedule,
    remainingB: rpcU128(result[14], "lock remaining collateral"),
    earnedA: rpcU128(result[15], "lock earned proceeds"),
    ticket: canonicalRpcFelt(result[16], "lock ticket", statusValue === 0n),
    proceedsSettled: rpcBoolean(result[17], "lock proceeds settlement flag"),
    collateralReleased: rpcBoolean(result[18], "lock collateral release flag"),
    status: statusValue === 1n ? "open" : "empty",
  });
}

export function buildLocalnetMakerLockActions(
  request,
  { escrowAddress, recoveryAddress },
) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Maker lock action request must be an object.");
  }
  assertPriceSchedule(request.schedule);
  if (!Number.isSafeInteger(request.expiry) || request.expiry <= 0) {
    throw new Error("Maker lock expiry must be a positive safe timestamp.");
  }
  const escrow = canonicalFelt(escrowAddress, "escrowAddress");
  const recovery = canonicalFelt(recoveryAddress, "recoveryAddress");
  const tokenA = canonicalFelt(request.tokenA, "tokenA");
  const tokenB = canonicalFelt(request.tokenB, "tokenB");
  if (tokenA === tokenB) {
    throw new Error("Maker lock tokens must differ.");
  }
  const points = [...request.schedule];
  while (points.length < 4) points.push({ a: 0n, b: 0n });
  return Object.freeze([
    Object.freeze({
      type: "withdraw",
      token: tokenB,
      amount: hexAmount(
        request.schedule[request.schedule.length - 1].b,
        "schedule max payout",
      ),
      recipient: escrow,
    }),
    Object.freeze({
      type: "transfer",
      token: canonicalFelt(request.ticket, "lock ticket"),
      amount: "OPEN",
      recipient: recovery,
    }),
    Object.freeze({
      type: "invoke",
      contract: escrow,
      calldata: Object.freeze([
        "0x4",
        tokenB,
        tokenA,
        canonicalFelt(request.rfqFelt, "rfqFelt"),
        canonicalRpcFelt(request.takerCommitment, "takerCommitment", true),
        `0x${BigInt(request.expiry).toString(16)}`,
        `0x${BigInt(request.schedule.length).toString(16)}`,
        ...points.flatMap((point) => [
          hexAmount(point.a, "schedule amount", true),
          hexAmount(point.b, "schedule payout", true),
        ]),
        canonicalFelt(request.lockId, "lockId"),
        "${poolAddress}",
        "${openNoteIds[0]}",
      ]),
    }),
  ]);
}

export function buildLocalnetMakerSettlementActions(
  request,
  { escrowAddress, recoveryAddress },
) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Maker settlement action request must be an object.");
  }
  if (request.operation !== "0x6" && request.operation !== "0x7") {
    throw new Error("Maker settlement operation must be 0x6 or 0x7.");
  }
  const escrow = canonicalFelt(escrowAddress, "escrowAddress");
  return Object.freeze([
    Object.freeze({
      type: "withdraw",
      token: canonicalFelt(request.ticket, "lock ticket"),
      amount: "0x1",
      recipient: escrow,
    }),
    Object.freeze({
      type: "transfer",
      token: canonicalFelt(request.outputToken, "outputToken"),
      amount: "OPEN",
      recipient: canonicalFelt(recoveryAddress, "recoveryAddress"),
    }),
    Object.freeze({
      type: "invoke",
      contract: escrow,
      calldata: Object.freeze([
        request.operation,
        canonicalFelt(request.lockId, "lockId"),
        "${poolAddress}",
        "${openNoteIds[0]}",
      ]),
    }),
  ]);
}

export function parseLocalnetMakerFillRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Maker fill request must be an object.");
  if (!Number.isSafeInteger(body.deadline) || body.deadline <= 0)
    throw new Error("deadline must be a positive safe integer timestamp.");
  if (typeof body.fence !== "string" || !/^[1-9][0-9]*$/.test(body.fence))
    throw new Error("fence must be a positive canonical decimal string.");
  return Object.freeze({
    reservationId: canonicalHex32(body.reservationId, "reservationId"),
    intentDigest: canonicalHex32(body.intentDigest, "intentDigest"),
    fence: BigInt(body.fence),
    quoteDigest: canonicalHex32(body.quoteDigest, "quoteDigest"),
    dealId: canonicalFelt(body.dealId, "dealId"),
    sellToken: canonicalFelt(body.sellToken, "sellToken"),
    sellAmount: positiveBigInt(body.sellAmount, "sellAmount"),
    buyToken: canonicalFelt(body.buyToken, "buyToken"),
    buyAmount: positiveBigInt(body.buyAmount, "buyAmount"),
    deadline: body.deadline,
    ticketAddress: canonicalFelt(body.ticketAddress, "ticketAddress"),
  });
}

export function dispatchLocalnetMakerFill(maker, body, now) {
  return maker.fill(parseLocalnetMakerFillRequest(body), now);
}

export async function requestLocalnetMaker(
  client,
  pathname,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const response = await fetch(`${client.endpoint}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${client.authToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      `${client.solverId}: ${payload.error ?? `HTTP ${response.status}`}`,
    );
  }
  return payload.result === undefined ? payload : payload.result;
}

export async function requestLocalnetMakerGet(
  client,
  pathname,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const response = await fetch(`${client.endpoint}${pathname}`, {
    method: "GET",
    headers: { authorization: `Bearer ${client.authToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      `${client.solverId}: ${payload.error ?? `HTTP ${response.status}`}`,
    );
  }
  return payload.result === undefined ? payload : payload.result;
}
