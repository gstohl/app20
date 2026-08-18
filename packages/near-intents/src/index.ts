import { assertCrossChainIntent, type CrossChainIntentV1 } from "@app20/domain";

export const ONE_CLICK_PRODUCTION_ORIGIN =
  "https://1click.chaindefuser.com" as const;
export const ONE_CLICK_HAS_TESTNET = false as const;

export type OneClickDepositAccountType =
  | "ORIGIN_CHAIN"
  | "INTENTS"
  | "CONFIDENTIAL_INTENTS";

export type OneClickRecipientAccountType =
  | "DESTINATION_CHAIN"
  | "INTENTS"
  | "CONFIDENTIAL_INTENTS";

export type OneClickSwapType =
  | "EXACT_INPUT"
  | "EXACT_OUTPUT"
  | "FLEX_INPUT"
  | "ANY_INPUT";

export type OneClickExecutionStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export type OneClickToken = {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain?: string;
  price?: number;
};

export type DryQuoteRequest = {
  dry: true;
  swapType: OneClickSwapType;
  slippageTolerance: number;
  originAsset: string;
  depositMode?: "SIMPLE" | "MEMO";
  depositType: OneClickDepositAccountType;
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: OneClickDepositAccountType;
  recipient: string;
  recipientType: OneClickRecipientAccountType;
  deadline: string;
  confidentiality?: "public" | "basic" | "advanced";
};

export type StrictDryQuote = {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
};

export type StrictDryQuoteResponse = {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: DryQuoteRequest;
  quote: StrictDryQuote;
};

export type QuoteVerificationEvidence = Readonly<{
  verified: true;
  algorithm: string;
  keyId: string;
  signedPayloadDigest: string;
}>;

export type VerifiedDryQuote = Readonly<{
  verified: true;
  request: Readonly<DryQuoteRequest>;
  response: Readonly<StrictDryQuoteResponse>;
  verification: QuoteVerificationEvidence;
}>;

export interface OneClickTransport {
  listTokens(signal?: AbortSignal): Promise<readonly OneClickToken[]>;
  requestQuote(
    request: Readonly<DryQuoteRequest>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export interface OneClickQuoteVerifier {
  verify(
    request: Readonly<DryQuoteRequest>,
    response: Readonly<StrictDryQuoteResponse>,
  ): Promise<QuoteVerificationEvidence | null>;
}

/** Throw to deny. It must resolve before requestQuote() can be invoked. */
export type QuotePreflight = (
  request: Readonly<DryQuoteRequest>,
) => Promise<void> | void;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function strictKeys(
  value: UnknownRecord,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined) {
    throw new Error(
      `${label} contains an unrecognized field (${unknownKey}); the pinned dry schema rejected it.`,
    );
  }
  const missingKey = required.find((key) => !Object.hasOwn(value, key));
  if (missingKey !== undefined) {
    throw new Error(`${label} is missing required field ${missingKey}.`);
  }
}

function stringField(
  value: UnknownRecord,
  key: string,
  label: string,
  maximumLength = 4096,
): string {
  const field = value[key];
  if (
    typeof field !== "string" ||
    field.length === 0 ||
    field.length > maximumLength ||
    field !== field.trim()
  ) {
    throw new Error(`${label}.${key} must be a non-empty bounded string.`);
  }
  return field;
}

function assertCanonicalTimestamp(label: string, value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new Error(`${label} must be a canonical RFC 3339 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  const normalizedInput = value.replace(".000Z", "Z");
  const normalizedParsed = Number.isFinite(parsed)
    ? new Date(parsed).toISOString().replace(".000Z", "Z")
    : "";
  if (normalizedParsed !== normalizedInput) {
    throw new Error(
      `${label} must be a real canonical RFC 3339 UTC timestamp.`,
    );
  }
}

function assertOpaqueValue(
  label: string,
  value: unknown,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f\s]/u.test(value)
  ) {
    throw new Error(`${label} is malformed.`);
  }
}

function oneClickAccountType(
  value:
    | "origin-chain"
    | "destination-chain"
    | "intents"
    | "confidential-intents",
): OneClickDepositAccountType | OneClickRecipientAccountType {
  switch (value) {
    case "origin-chain":
      return "ORIGIN_CHAIN";
    case "destination-chain":
      return "DESTINATION_CHAIN";
    case "intents":
      return "INTENTS";
    case "confidential-intents":
      return "CONFIDENTIAL_INTENTS";
  }
}

export function mapCrossChainIntentToDryQuote(
  intent: CrossChainIntentV1,
): DryQuoteRequest {
  assertCrossChainIntent(intent);
  const swapType = {
    "exact-input": "EXACT_INPUT",
    "exact-output": "EXACT_OUTPUT",
    "flex-input": "FLEX_INPUT",
  }[intent.swapMode] as DryQuoteRequest["swapType"];
  const confidentiality = {
    public: "public",
    "confidential-basic": "basic",
    "confidential-advanced": "advanced",
  }[intent.privacyMode] as DryQuoteRequest["confidentiality"];
  return {
    dry: true,
    swapType,
    slippageTolerance: intent.slippageBps,
    originAsset: intent.sourceAsset.assetId,
    depositType: oneClickAccountType(
      intent.fundingMode,
    ) as OneClickDepositAccountType,
    destinationAsset: intent.destinationAsset.assetId,
    amount: intent.amount,
    refundTo: intent.refundAccount.address,
    refundType: oneClickAccountType(
      intent.refundMode,
    ) as OneClickDepositAccountType,
    recipient: intent.destinationAccount.address,
    recipientType: oneClickAccountType(
      intent.deliveryMode,
    ) as OneClickRecipientAccountType,
    deadline: intent.deadline,
    confidentiality,
  };
}

const REQUEST_FIELDS = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositMode",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "deadline",
  "confidentiality",
] as const;

const REQUIRED_REQUEST_FIELDS = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "deadline",
] as const;

export function assertDryQuoteRequest(
  value: unknown,
): asserts value is DryQuoteRequest {
  const request = record(value, "DryQuoteRequest");
  strictKeys(
    request,
    "DryQuoteRequest",
    REQUEST_FIELDS,
    REQUIRED_REQUEST_FIELDS,
  );
  if (request.dry !== true) {
    throw new Error("APP20 permits only dry NEAR Intents quotes.");
  }
  if (
    typeof request.swapType !== "string" ||
    !["EXACT_INPUT", "EXACT_OUTPUT", "FLEX_INPUT", "ANY_INPUT"].includes(
      request.swapType,
    )
  ) {
    throw new Error("swapType is not supported by the pinned 1Click schema.");
  }
  if (request.swapType === "ANY_INPUT") {
    throw new Error(
      "APP20 dry mode does not permit partner-only ANY_INPUT quotes.",
    );
  }
  if (
    typeof request.depositType !== "string" ||
    !["ORIGIN_CHAIN", "INTENTS", "CONFIDENTIAL_INTENTS"].includes(
      request.depositType,
    )
  ) {
    throw new Error(
      "depositType is not supported by the pinned 1Click schema.",
    );
  }
  if (
    typeof request.refundType !== "string" ||
    !["ORIGIN_CHAIN", "INTENTS", "CONFIDENTIAL_INTENTS"].includes(
      request.refundType,
    )
  ) {
    throw new Error("refundType is not supported by the pinned 1Click schema.");
  }
  if (
    typeof request.recipientType !== "string" ||
    !["DESTINATION_CHAIN", "INTENTS", "CONFIDENTIAL_INTENTS"].includes(
      request.recipientType,
    )
  ) {
    throw new Error(
      "recipientType is not supported by the pinned 1Click schema.",
    );
  }
  if (Object.hasOwn(request, "depositMode")) {
    if (
      typeof request.depositMode !== "string" ||
      !["SIMPLE", "MEMO"].includes(request.depositMode)
    ) {
      throw new Error(
        "depositMode is not supported by the pinned 1Click schema.",
      );
    }
  }
  if (Object.hasOwn(request, "confidentiality")) {
    if (
      typeof request.confidentiality !== "string" ||
      !["public", "basic", "advanced"].includes(request.confidentiality)
    ) {
      throw new Error(
        "confidentiality is not supported by the pinned 1Click schema.",
      );
    }
  }
  if (
    !Number.isInteger(request.slippageTolerance) ||
    (request.slippageTolerance as number) < 0 ||
    (request.slippageTolerance as number) > 10_000
  ) {
    throw new Error(
      "slippageTolerance must be an integer between 0 and 10,000 basis points.",
    );
  }
  if (
    typeof request.amount !== "string" ||
    !/^[1-9][0-9]*$/.test(request.amount)
  ) {
    throw new Error("amount must be a canonical positive base-unit integer.");
  }
  assertOpaqueValue("originAsset", request.originAsset);
  assertOpaqueValue("destinationAsset", request.destinationAsset);
  assertOpaqueValue("refundTo", request.refundTo);
  assertOpaqueValue("recipient", request.recipient);
  assertCanonicalTimestamp("deadline", request.deadline);
}

function snapshotDryQuoteRequest(
  request: DryQuoteRequest,
): Readonly<DryQuoteRequest> {
  const snapshot: DryQuoteRequest = {
    dry: true,
    swapType: request.swapType,
    slippageTolerance: request.slippageTolerance,
    originAsset: request.originAsset,
    depositType: request.depositType,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    refundTo: request.refundTo,
    refundType: request.refundType,
    recipient: request.recipient,
    recipientType: request.recipientType,
    deadline: request.deadline,
    ...(request.depositMode === undefined
      ? {}
      : { depositMode: request.depositMode }),
    ...(request.confidentiality === undefined
      ? {}
      : { confidentiality: request.confidentiality }),
  };
  return Object.freeze(snapshot);
}

function assertEchoedRequest(
  echoed: UnknownRecord,
  request: Readonly<DryQuoteRequest>,
): void {
  assertDryQuoteRequest(echoed);
  const expected = request as UnknownRecord;
  for (const key of REQUEST_FIELDS) {
    if (Object.hasOwn(echoed, key) !== Object.hasOwn(expected, key)) {
      throw new Error(
        `quoteRequest.${key} presence does not match the reviewed dry request.`,
      );
    }
    if (echoed[key] !== expected[key]) {
      throw new Error(
        `quoteRequest.${key} does not match the reviewed dry request.`,
      );
    }
  }
}

const QUOTE_FIELDS = [
  "amountIn",
  "amountInFormatted",
  "amountInUsd",
  "minAmountIn",
  "amountOut",
  "amountOutFormatted",
  "amountOutUsd",
  "minAmountOut",
  "timeEstimate",
  "refundFee",
  "withdrawFee",
] as const;
const REQUIRED_QUOTE_FIELDS = QUOTE_FIELDS.slice(0, 9);

export function parseStrictDryQuoteResponse(
  raw: unknown,
  reviewedRequest: DryQuoteRequest,
): StrictDryQuoteResponse {
  assertDryQuoteRequest(reviewedRequest);
  const request = snapshotDryQuoteRequest(reviewedRequest);
  const response = record(raw, "QuoteResponse");
  strictKeys(
    response,
    "QuoteResponse",
    ["correlationId", "timestamp", "signature", "quoteRequest", "quote"],
    ["correlationId", "timestamp", "signature", "quoteRequest", "quote"],
  );
  const correlationId = stringField(
    response,
    "correlationId",
    "QuoteResponse",
    512,
  );
  const timestamp = stringField(response, "timestamp", "QuoteResponse", 32);
  assertCanonicalTimestamp("QuoteResponse.timestamp", timestamp);
  const signature = stringField(response, "signature", "QuoteResponse");
  const echoedRequest = record(response.quoteRequest, "quoteRequest");
  assertEchoedRequest(echoedRequest, request);

  const rawQuote = record(response.quote, "quote");
  strictKeys(rawQuote, "quote", QUOTE_FIELDS, REQUIRED_QUOTE_FIELDS);
  const timeEstimate = rawQuote.timeEstimate;
  if (
    typeof timeEstimate !== "number" ||
    !Number.isFinite(timeEstimate) ||
    timeEstimate < 0
  ) {
    throw new Error("quote.timeEstimate must be a non-negative finite number.");
  }
  const quote: StrictDryQuote = {
    amountIn: stringField(rawQuote, "amountIn", "quote"),
    amountInFormatted: stringField(rawQuote, "amountInFormatted", "quote"),
    amountInUsd: stringField(rawQuote, "amountInUsd", "quote"),
    minAmountIn: stringField(rawQuote, "minAmountIn", "quote"),
    amountOut: stringField(rawQuote, "amountOut", "quote"),
    amountOutFormatted: stringField(rawQuote, "amountOutFormatted", "quote"),
    amountOutUsd: stringField(rawQuote, "amountOutUsd", "quote"),
    minAmountOut: stringField(rawQuote, "minAmountOut", "quote"),
    timeEstimate,
  };
  for (const key of [
    "amountIn",
    "minAmountIn",
    "amountOut",
    "minAmountOut",
  ] as const) {
    if (!/^(0|[1-9][0-9]*)$/.test(quote[key])) {
      throw new Error(`quote.${key} must be a canonical base-unit integer.`);
    }
  }
  for (const key of ["refundFee", "withdrawFee"] as const) {
    if (Object.hasOwn(rawQuote, key)) {
      const fee = stringField(rawQuote, key, "quote");
      if (!/^(0|[1-9][0-9]*)$/.test(fee)) {
        throw new Error(`quote.${key} must be a canonical base-unit integer.`);
      }
      quote[key] = fee;
    }
  }
  const frozenQuote = Object.freeze(quote);
  return Object.freeze({
    correlationId,
    timestamp,
    signature,
    quoteRequest: request,
    quote: frozenQuote,
  });
}

export function assertDryQuoteSatisfiesIntent(
  intent: CrossChainIntentV1,
  candidate: StrictDryQuoteResponse,
): void {
  const expectedRequest = mapCrossChainIntentToDryQuote(intent);
  const response = parseStrictDryQuoteResponse(candidate, expectedRequest);
  if (
    intent.swapMode === "exact-input" &&
    response.quote.amountIn !== intent.amount
  ) {
    throw new Error("The provider quote changed the exact input amount.");
  }
  if (BigInt(response.quote.minAmountOut) < BigInt(intent.minimumOutput)) {
    throw new Error(
      "The provider quote is below the user-approved minimum output.",
    );
  }
  const explicitFees =
    BigInt(response.quote.refundFee ?? "0") +
    BigInt(response.quote.withdrawFee ?? "0");
  if (explicitFees > BigInt(intent.maximumFee)) {
    throw new Error(
      "The provider quote exceeds the user-approved explicit fee ceiling.",
    );
  }
}

const VERIFICATION_FIELDS = [
  "verified",
  "algorithm",
  "keyId",
  "signedPayloadDigest",
] as const;

export function parseQuoteVerificationEvidence(
  value: unknown,
): QuoteVerificationEvidence {
  if (value === null || value === false) {
    throw new Error("NEAR Intents quote signature verification failed.");
  }
  const evidence = record(value, "QuoteVerificationEvidence");
  strictKeys(
    evidence,
    "QuoteVerificationEvidence",
    VERIFICATION_FIELDS,
    VERIFICATION_FIELDS,
  );
  if (evidence.verified !== true) {
    throw new Error("NEAR Intents quote signature verification failed.");
  }
  assertOpaqueValue("QuoteVerificationEvidence.algorithm", evidence.algorithm);
  assertOpaqueValue("QuoteVerificationEvidence.keyId", evidence.keyId);
  assertOpaqueValue(
    "QuoteVerificationEvidence.signedPayloadDigest",
    evidence.signedPayloadDigest,
  );
  return Object.freeze({
    verified: true,
    algorithm: evidence.algorithm,
    keyId: evidence.keyId,
    signedPayloadDigest: evidence.signedPayloadDigest,
  });
}

export class DryOnlyNearIntentsClient {
  readonly mode = "dry-only" as const;
  readonly #listTokens: OneClickTransport["listTokens"];
  readonly #requestQuote: OneClickTransport["requestQuote"];
  readonly #verifyQuote: OneClickQuoteVerifier["verify"];

  constructor(transport: OneClickTransport, verifier: OneClickQuoteVerifier) {
    if (
      transport === null ||
      typeof transport !== "object" ||
      typeof transport.listTokens !== "function" ||
      typeof transport.requestQuote !== "function"
    ) {
      throw new Error("A dry-only 1Click transport is required.");
    }
    if (
      verifier === null ||
      typeof verifier !== "object" ||
      typeof verifier.verify !== "function"
    ) {
      throw new Error("A 1Click quote signature verifier is required.");
    }
    this.#listTokens = transport.listTokens.bind(transport);
    this.#requestQuote = transport.requestQuote.bind(transport);
    this.#verifyQuote = verifier.verify.bind(verifier);
  }

  async listTokens(signal?: AbortSignal): Promise<readonly OneClickToken[]> {
    const tokens = await this.#listTokens(signal);
    if (!Array.isArray(tokens)) {
      throw new Error("The 1Click token catalog must be an array.");
    }
    return tokens.map((token) => {
      assertOpaqueValue("token.assetId", token.assetId);
      assertOpaqueValue("token.symbol", token.symbol);
      if (
        !Number.isInteger(token.decimals) ||
        token.decimals < 0 ||
        token.decimals > 255
      ) {
        throw new Error("Token decimals must be an integer between 0 and 255.");
      }
      return Object.freeze({ ...token });
    });
  }

  async quote(
    candidate: DryQuoteRequest,
    preflight: QuotePreflight,
    signal?: AbortSignal,
  ): Promise<VerifiedDryQuote> {
    assertDryQuoteRequest(candidate);
    if (typeof preflight !== "function") {
      throw new Error("A quote policy preflight callback is required.");
    }
    const request = snapshotDryQuoteRequest(candidate);
    await preflight(request);
    const rawResponse = await this.#requestQuote(request, signal);
    const response = parseStrictDryQuoteResponse(rawResponse, request);
    const verification = parseQuoteVerificationEvidence(
      await this.#verifyQuote(request, response),
    );
    return Object.freeze({
      verified: true,
      request,
      response,
      verification,
    });
  }
}
