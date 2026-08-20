import type { WALLET_API } from "@starknet-io/types-js";
import {
  buildEscrowClaimActions,
  buildEscrowTimeoutActions,
} from "@/lib/escrow-actions";

const API_BASE =
  import.meta.env.VITE_LOCALNET_WALLET_URL ?? "/__quietline_localnet_wallet";

export type LocalnetSolverQuote = {
  solverId: string;
  buyAmount: bigint;
  solverInventory: bigint;
  sellToken: string;
  buyToken: string;
  provenance: string;
};

export type LocalnetIntentTerms = {
  dealId: string;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  buyAmount: bigint;
};

export type LocalnetMarketToken = {
  symbol: "STRK" | "USDC";
  address: string;
  decimals: 6 | 18;
};

const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d+))?$/;
const ESCROW_AMOUNT_LIMIT = 2n ** 128n;

export function parseLocalnetTokenAmount(
  value: string,
  token: LocalnetMarketToken,
): bigint {
  const match = DECIMAL_AMOUNT.exec(value.trim());
  if (!match) {
    throw new Error(`Enter a positive decimal ${token.symbol} amount.`);
  }
  const fraction = match[2] ?? "";
  if (fraction.length > token.decimals) {
    throw new Error(
      `${token.symbol} supports at most ${token.decimals} decimal places.`,
    );
  }
  const scale = 10n ** BigInt(token.decimals);
  const amount =
    BigInt(match[1]) * scale +
    BigInt(fraction.padEnd(token.decimals, "0") || "0");
  if (amount <= 0n) {
    throw new Error(`${token.symbol} amount must be greater than zero.`);
  }
  if (amount >= ESCROW_AMOUNT_LIMIT) {
    throw new Error(`${token.symbol} amount does not fit the escrow.`);
  }
  return amount;
}

export function formatLocalnetTokenAmount(
  amount: bigint,
  token: LocalnetMarketToken,
  maxFraction: number = token.decimals,
): string {
  if (amount < 0n) throw new Error("Token amount cannot be negative.");
  const scale = 10n ** BigInt(token.decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(token.decimals, "0")
    .slice(0, Math.max(0, Math.min(maxFraction, token.decimals)))
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

type ApiResult = Record<string, unknown>;

function asRecord(value: unknown): ApiResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The local solver returned a malformed response.");
  }
  return value as ApiResult;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The local solver omitted ${label}.`);
  }
  return value;
}

function asPositiveBigInt(value: unknown, label: string): bigint {
  const text = asString(value, label);
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    throw new Error(`The local solver returned an invalid ${label}.`);
  }
  const parsed = BigInt(text);
  if (parsed <= 0n) {
    throw new Error(`The local solver returned an empty ${label}.`);
  }
  return parsed;
}

async function postLocalnet(path: string, body: object): Promise<ApiResult> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The local solver returned unreadable JSON.");
  }
  const envelope = asRecord(payload);
  if (!response.ok) {
    throw new Error(
      typeof envelope.error === "string"
        ? envelope.error
        : "The local solver rejected the request.",
    );
  }
  return asRecord(envelope.result);
}

export async function requestLocalnetSolverQuote(input: {
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
}): Promise<LocalnetSolverQuote> {
  const result = await postLocalnet("/private-intents/quote", {
    sellToken: input.sellToken,
    sellAmount: input.sellAmount.toString(),
    buyToken: input.buyToken,
  });
  return {
    solverId: asString(result.solverId, "solverId"),
    buyAmount: asPositiveBigInt(result.buyAmount, "buyAmount"),
    solverInventory: asPositiveBigInt(
      result.solverInventory,
      "solverInventory",
    ),
    sellToken: asString(result.sellToken, "sellToken"),
    buyToken: asString(result.buyToken, "buyToken"),
    provenance: asString(result.provenance, "provenance"),
  };
}

export async function askLocalnetSolverToFill(
  terms: LocalnetIntentTerms,
): Promise<string> {
  const result = await postLocalnet("/private-intents/solve", {
    dealId: terms.dealId,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
  });
  return asString(result.transaction_hash, "solver transaction hash");
}

export async function expireLocalnetPrivateIntent(
  terms: LocalnetIntentTerms,
): Promise<number> {
  const result = await postLocalnet("/private-intents/expire", {
    dealId: terms.dealId,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
  });
  if (
    typeof result.expiredAt !== "number" ||
    !Number.isSafeInteger(result.expiredAt)
  ) {
    throw new Error("The local solver returned an invalid expiry timestamp.");
  }
  return result.expiredAt;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createLocalnetIntentId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(31));
  const value = `0x${bytesToHex(bytes)}`;
  bytes.fill(0);
  return value;
}

export async function ensureLocalnetEscrowTicket(input: {
  dealId: string;
}): Promise<string> {
  const result = await postLocalnet("/escrow/ensure-ticket", input);
  return asString(result.ticketAddress, "ticketAddress");
}

export async function readLocalnetEscrowDeal(
  dealId: string,
): Promise<ApiResult> {
  return postLocalnet("/escrow/deal", { dealId });
}

export function buildLocalnetIntentPayoutActions(input: {
  operation: "claim" | "timeout";
  escrowAddress: string;
  recoveryAddress: string;
  ticketAddress: string;
  dealId: string;
  payoutToken: string;
}): WALLET_API.STRK20_ACTION[] {
  const builder =
    input.operation === "claim"
      ? buildEscrowClaimActions
      : buildEscrowTimeoutActions;
  return builder(input);
}
