const DEFAULT_TIMEOUT_MS = 5_000;
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
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      `${client.solverId}: ${payload.error ?? `HTTP ${response.status}`}`,
    );
  }
  return payload.result;
}
