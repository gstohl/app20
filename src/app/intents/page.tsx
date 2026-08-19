import {
  CROSS_CHAIN_STAGES,
  digestCrossChainIntent,
  type CrossChainIntentV1,
} from "@app20/domain";
import {
  DryOnlyNearIntentsClient,
  ONE_CLICK_HAS_TESTNET,
  assertDryQuoteSatisfiesIntent,
  mapCrossChainIntentToDryQuote,
  type DryQuoteRequest,
  type OneClickQuoteVerifier,
  type OneClickToken,
  type OneClickTransport,
  type QuoteVerificationEvidence,
  type VerifiedDryQuote,
} from "@app20/near-intents";
import { useMemo, useState } from "react";
import styles from "./intents.module.css";

const REVIEW_STAGES = CROSS_CHAIN_STAGES.filter((stage) =>
  [
    "DRAFT",
    "PREFLIGHT_POLICY",
    "QUOTING",
    "AWAITING_REVIEW",
    "AWAITING_SIGNATURE",
    "SOURCE_FINALIZED",
    "SETTLEMENT_PENDING",
    "DESTINATION_CONFIRMING",
    "COMPLETED",
    "REFUND_PENDING",
    "REFUNDED",
  ].includes(stage),
);

const STRK_ASSET_ID = "nep141:starknet.omft.near";
const WNEAR_ASSET_ID = "nep141:wrap.near";

const FIXTURE_TOKENS: readonly OneClickToken[] = [
  {
    assetId: STRK_ASSET_ID,
    symbol: "STRK",
    decimals: 18,
    blockchain: "starknet",
  },
  {
    assetId: WNEAR_ASSET_ID,
    symbol: "wNEAR",
    decimals: 24,
    blockchain: "near",
  },
];

const DEFAULT_DESTINATION_ADDRESS = "review-fixture.near";
const DEFAULT_REFUND_ADDRESS = "0x123";
const DESTINATION_CHAIN_ID = "near:mainnet";
const REFUND_CHAIN_ID = "starknet:SN_MAIN";

/**
 * Shared encrypted-book storage prefix from the vault slice. This page never
 * writes it: the vault module owns AES-GCM persistence under
 * `${prefix}${selfAddress}`; the stub below stays session-only so it cannot
 * corrupt that encrypted payload.
 */
export const ADDRESS_BOOK_STORAGE_PREFIX = "app20/address-book/v1/";

export type AddressBookEntry = Readonly<{
  label: string;
  address: string;
  chainId?: string;
}>;

/**
 * Resolves either a raw address or a saved book label (`name` or `@name`,
 * case-insensitive). Entries scoped to a different chain never resolve, so a
 * Starknet label cannot silently become a NEAR destination.
 */
export function resolveAddressBookInput(
  input: string,
  entries: readonly AddressBookEntry[],
  chainId?: string,
): { address: string; entry?: AddressBookEntry } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { address: "" };
  const label = (
    trimmed.startsWith("@") ? trimmed.slice(1) : trimmed
  ).toLowerCase();
  const entry = entries.find(
    (candidate) =>
      candidate.label.toLowerCase() === label &&
      (chainId === undefined ||
        candidate.chainId === undefined ||
        candidate.chainId === chainId),
  );
  if (entry) return { address: entry.address, entry };
  return { address: trimmed };
}

// Session-only stand-in for the shared vault AddressBookField. Same props and
// resolver semantics; swap the import once the vault module merges.
export function AddressBookField({
  id,
  label,
  chainId,
  value,
  onChange,
  entries,
  onSaveEntry,
  placeholder,
}: {
  id: string;
  label: string;
  chainId?: string;
  value: string;
  onChange: (next: string) => void;
  entries: readonly AddressBookEntry[];
  onSaveEntry?: (entry: AddressBookEntry) => void;
  placeholder?: string;
}) {
  const [saveLabel, setSaveLabel] = useState("");
  const resolved = resolveAddressBookInput(value, entries, chainId);
  const scoped = entries.filter(
    (entry) =>
      chainId === undefined ||
      entry.chainId === undefined ||
      entry.chainId === chainId,
  );
  const alreadySaved = entries.some(
    (entry) => entry.address === resolved.address,
  );
  const canSave =
    onSaveEntry !== undefined &&
    resolved.entry === undefined &&
    resolved.address.length > 0 &&
    !alreadySaved;

  return (
    <div className={styles.bookField}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        list={`${id}-book`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <datalist id={`${id}-book`}>
        {scoped.map((entry) => (
          <option key={entry.label} value={`@${entry.label}`}>
            {`${entry.label} · ${entry.address}`}
          </option>
        ))}
      </datalist>
      {resolved.entry ? (
        <p className={styles.bookResolved}>
          @{resolved.entry.label} → <code>{resolved.entry.address}</code>
        </p>
      ) : null}
      {canSave ? (
        <div className={styles.bookSave}>
          <input
            aria-label={`Book label for ${label}`}
            value={saveLabel}
            onChange={(event) => setSaveLabel(event.target.value)}
            placeholder="Save as label"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            disabled={saveLabel.trim().length === 0}
            onClick={() => {
              const nextLabel = saveLabel.trim();
              if (nextLabel.length === 0) return;
              onSaveEntry({
                label: nextLabel,
                address: resolved.address,
                ...(chainId === undefined ? {} : { chainId }),
              });
              setSaveLabel("");
            }}
          >
            Save
          </button>
        </div>
      ) : null}
    </div>
  );
}

export type ReviewAccounts = Readonly<{
  destinationAddress?: string;
  refundAddress?: string;
}>;

/** One reviewed reference route: 2.5 STRK on Starknet -> wNEAR on NEAR. */
export function buildReviewIntent(
  accounts: ReviewAccounts = {},
): CrossChainIntentV1 {
  return {
    version: 1,
    intentId: "app20-review-fixture-intent-0000000000000001",
    revision: 0,
    kind: "cross-chain",
    sourceAccount: {
      id: "starknet:SN_MAIN:0x123",
      chainId: "starknet:SN_MAIN",
      address: "0x123",
      signer: "ready",
      custody: "user",
      capabilities: ["strk20"],
      policyMode: "advisory",
    },
    destinationAccount: {
      chainId: DESTINATION_CHAIN_ID,
      address: accounts.destinationAddress ?? DEFAULT_DESTINATION_ADDRESS,
    },
    refundAccount: {
      chainId: REFUND_CHAIN_ID,
      address: accounts.refundAddress ?? DEFAULT_REFUND_ADDRESS,
    },
    sourceAsset: {
      chainId: "starknet:SN_MAIN",
      assetId: STRK_ASSET_ID,
      decimals: 18,
    },
    destinationAsset: {
      chainId: "near:mainnet",
      assetId: WNEAR_ASSET_ID,
      decimals: 24,
    },
    amount: "2500000000000000000",
    minimumOutput: "1180000000000000000000000",
    maximumFee: "30000000000000000000000",
    slippageBps: 100,
    deadline: "2030-01-01T00:10:00.000Z",
    providerId: "near-intents:1click",
    swapMode: "exact-input",
    fundingMode: "origin-chain",
    deliveryMode: "destination-chain",
    refundMode: "origin-chain",
    privacyMode: "public",
    disclosedTo: [
      "intents-provider",
      "solver",
      "source-chain",
      "destination-chain",
    ],
    createdAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:05:00.000Z",
  };
}

export type ReviewScenarioId =
  | "provider-honors-terms"
  | "funding-shaped-response"
  | "tampered-echoed-request"
  | "output-below-minimum";

export type ReviewScenario = Readonly<{
  id: ReviewScenarioId;
  name: string;
  summary: string;
  expectation: "verified" | "rejected";
}>;

export const REVIEW_SCENARIOS: readonly ReviewScenario[] = [
  {
    id: "provider-honors-terms",
    name: "Provider honors terms",
    summary:
      "The fixture echoes the reviewed request exactly and quotes inside every bound.",
    expectation: "verified",
  },
  {
    id: "funding-shaped-response",
    name: "Funding-shaped response",
    summary:
      "The fixture smuggles a depositAddress field. The pinned schema must reject it before signature verification.",
    expectation: "rejected",
  },
  {
    id: "tampered-echoed-request",
    name: "Tampered echoed request",
    summary:
      "The fixture echoes a different amount than the reviewed request. Echo equality must fail closed.",
    expectation: "rejected",
  },
  {
    id: "output-below-minimum",
    name: "Output below minimum",
    summary:
      "A correctly signed quote still fails when minAmountOut drops under the approved minimum output.",
    expectation: "rejected",
  },
] as const;

export type ReviewCheckStatus = "passed" | "failed" | "skipped";

export type ReviewCheck = Readonly<{
  id: string;
  label: string;
  status: ReviewCheckStatus;
  detail: string;
}>;

export type DryReviewReport = Readonly<{
  scenarioId: ReviewScenarioId;
  outcome: "verified" | "rejected";
  intentDigest: string;
  checks: readonly ReviewCheck[];
  transportCalls: number;
  verifierCalls: number;
  failure?: string;
  quote?: Readonly<{
    correlationId: string;
    amountIn: string;
    amountInFormatted: string;
    amountOut: string;
    amountOutFormatted: string;
    minAmountOut: string;
    timeEstimate: number;
    refundFee?: string;
    withdrawFee?: string;
  }>;
  provenance?: QuoteVerificationEvidence;
}>;

type Counters = { transport: number; verifier: number };

function fixtureQuote(request: Readonly<DryQuoteRequest>) {
  return {
    amountIn: request.amount,
    amountInFormatted: "2.5",
    amountInUsd: "1.61",
    minAmountIn: request.amount,
    amountOut: "1236500000000000000000000",
    amountOutFormatted: "1.2365",
    amountOutUsd: "1.60",
    minAmountOut: "1224135000000000000000000",
    timeEstimate: 47,
    refundFee: "12000000000000000000000",
    withdrawFee: "9000000000000000000000",
  };
}

function scenarioTransport(
  scenarioId: ReviewScenarioId,
  counters: Counters,
  order: string[],
): OneClickTransport {
  return {
    listTokens: async () => FIXTURE_TOKENS,
    requestQuote: async (request) => {
      counters.transport += 1;
      order.push("transport");
      const echoed: Record<string, unknown> = { ...request };
      const quote: Record<string, unknown> = fixtureQuote(request);
      if (scenarioId === "funding-shaped-response") {
        quote.depositAddress = "0x00feedc0de00feedc0de00feedc0de00feedc0de";
      }
      if (scenarioId === "tampered-echoed-request") {
        echoed.amount = "9999000000000000000000";
      }
      if (scenarioId === "output-below-minimum") {
        quote.amountOut = "1105000000000000000000000";
        quote.minAmountOut = "1100000000000000000000000";
      }
      return {
        correlationId: `review-fixture-${scenarioId}`,
        timestamp: "2030-01-01T00:00:01.000Z",
        signature: "ed25519:review-fixture-signature",
        quoteRequest: echoed,
        quote,
      };
    },
  };
}

function scenarioVerifier(counters: Counters): OneClickQuoteVerifier {
  return {
    verify: async () => {
      counters.verifier += 1;
      return {
        verified: true,
        algorithm: "ed25519",
        keyId: "near-1click-review-fixture-key",
        signedPayloadDigest:
          "0x5f1c3e2b9a8d7c6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f",
      };
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rejectedBeforeTransport(
  scenarioId: ReviewScenarioId,
  failure: string,
): DryReviewReport {
  return {
    scenarioId,
    outcome: "rejected",
    intentDigest: "",
    checks: [
      {
        id: "canonical-intent",
        label: "Canonical APP20 intent",
        status: "failed",
        detail: failure,
      },
      {
        id: "dry-mapping",
        label: "Pinned 1Click dry mapping",
        status: "skipped",
        detail: "No canonical intent exists to map.",
      },
      {
        id: "preflight-order",
        label: "Policy preflight before transport",
        status: "skipped",
        detail: "no calls recorded",
      },
      {
        id: "strict-echo",
        label: "Pinned response schema & echoed request",
        status: "skipped",
        detail: "The fixture transport was never consulted.",
      },
      {
        id: "provenance",
        label: "Quote signature provenance",
        status: "skipped",
        detail: "Never consulted — the intent failed closed first.",
      },
      {
        id: "intent-bounds",
        label: "Quote satisfies reviewed bounds",
        status: "skipped",
        detail: "No verified quote exists to compare against the intent.",
      },
    ],
    transportCalls: 0,
    verifierCalls: 0,
    failure,
  };
}

/**
 * Replays the dry-only connector against an in-memory fixture. Nothing leaves
 * the page: no quote HTTP, no deposit address, no wallet signature, no submit.
 */
export async function runDryReview(
  scenarioId: ReviewScenarioId,
  accounts: ReviewAccounts = {},
): Promise<DryReviewReport> {
  let intent: CrossChainIntentV1;
  let intentDigest: string;
  let dryRequest: DryQuoteRequest;
  try {
    intent = buildReviewIntent(accounts);
    intentDigest = await digestCrossChainIntent(intent);
    dryRequest = mapCrossChainIntentToDryQuote(intent);
  } catch (error) {
    return rejectedBeforeTransport(scenarioId, errorMessage(error));
  }
  const counters: Counters = { transport: 0, verifier: 0 };
  const order: string[] = [];
  const client = new DryOnlyNearIntentsClient(
    scenarioTransport(scenarioId, counters, order),
    scenarioVerifier(counters),
  );

  const checks: ReviewCheck[] = [
    {
      id: "canonical-intent",
      label: "Canonical APP20 intent",
      status: "passed",
      detail: `app20/intent/v1 digest ${intentDigest.slice(0, 18)}…`,
    },
    {
      id: "dry-mapping",
      label: "Pinned 1Click dry mapping",
      status: "passed",
      detail: `dry: true · ${dryRequest.swapType} · slippage ${dryRequest.slippageTolerance} bps`,
    },
  ];

  let verified: VerifiedDryQuote | undefined;
  let failure: string | undefined;
  try {
    verified = await client.quote(dryRequest, (request) => {
      order.push("preflight");
      if (request.dry !== true) {
        throw new Error("Policy preflight refused a non-dry request.");
      }
    });
  } catch (error) {
    failure = errorMessage(error);
  }

  const preflightFirst =
    order[0] === "preflight" &&
    (order.length === 1 || order[1] === "transport");
  checks.push({
    id: "preflight-order",
    label: "Policy preflight before transport",
    status: preflightFirst ? "passed" : "failed",
    detail: order.join(" → ") || "no calls recorded",
  });

  if (failure === undefined && verified !== undefined) {
    checks.push({
      id: "strict-echo",
      label: "Pinned response schema & echoed request",
      status: "passed",
      detail:
        "Every response field is allowlisted and the echoed request matches the reviewed dry request exactly.",
    });
    checks.push({
      id: "provenance",
      label: "Quote signature provenance",
      status: "passed",
      detail: `${verified.verification.algorithm} · ${verified.verification.keyId}`,
    });
  } else if (counters.verifier === 0) {
    checks.push({
      id: "strict-echo",
      label: "Pinned response schema & echoed request",
      status: "failed",
      detail: failure ?? "rejected",
    });
    checks.push({
      id: "provenance",
      label: "Quote signature provenance",
      status: "skipped",
      detail:
        "Never consulted — the response was rejected before signature verification.",
    });
  } else {
    checks.push({
      id: "strict-echo",
      label: "Pinned response schema & echoed request",
      status: "passed",
      detail: "The response parsed against the pinned dry schema.",
    });
    checks.push({
      id: "provenance",
      label: "Quote signature provenance",
      status: "failed",
      detail: failure ?? "verification failed",
    });
  }

  if (verified === undefined) {
    checks.push({
      id: "intent-bounds",
      label: "Quote satisfies reviewed bounds",
      status: "skipped",
      detail: "No verified quote exists to compare against the intent.",
    });
  } else {
    try {
      assertDryQuoteSatisfiesIntent(intent, verified.response);
      checks.push({
        id: "intent-bounds",
        label: "Quote satisfies reviewed bounds",
        status: "passed",
        detail: `minAmountOut ${verified.response.quote.minAmountOut} ≥ minimum ${intent.minimumOutput} and explicit fees stay inside the ${intent.maximumFee} ceiling.`,
      });
    } catch (error) {
      failure = errorMessage(error);
      checks.push({
        id: "intent-bounds",
        label: "Quote satisfies reviewed bounds",
        status: "failed",
        detail: failure,
      });
    }
  }

  const outcome = failure === undefined ? "verified" : "rejected";
  return {
    scenarioId,
    outcome,
    intentDigest,
    checks,
    transportCalls: counters.transport,
    verifierCalls: counters.verifier,
    ...(failure === undefined ? {} : { failure }),
    ...(verified !== undefined && outcome === "verified"
      ? {
          quote: {
            correlationId: verified.response.correlationId,
            amountIn: verified.response.quote.amountIn,
            amountInFormatted: verified.response.quote.amountInFormatted,
            amountOut: verified.response.quote.amountOut,
            amountOutFormatted: verified.response.quote.amountOutFormatted,
            minAmountOut: verified.response.quote.minAmountOut,
            timeEstimate: verified.response.quote.timeEstimate,
            ...(verified.response.quote.refundFee === undefined
              ? {}
              : { refundFee: verified.response.quote.refundFee }),
            ...(verified.response.quote.withdrawFee === undefined
              ? {}
              : { withdrawFee: verified.response.quote.withdrawFee }),
          },
        }
      : {}),
    ...(verified === undefined ? {} : { provenance: verified.verification }),
  };
}

type RunState =
  | { kind: "idle" }
  | { kind: "running"; scenarioId: ReviewScenarioId }
  | { kind: "done"; report: DryReviewReport }
  | { kind: "error"; message: string };

const STATUS_LABEL: Record<ReviewCheckStatus, string> = {
  passed: "PASS",
  failed: "FAIL",
  skipped: "SKIPPED",
};

const STATUS_CLASS: Record<ReviewCheckStatus, string> = {
  passed: styles.statusPassed,
  failed: styles.statusFailed,
  skipped: styles.statusSkipped,
};

export default function IntentsPage() {
  const intent = useMemo(() => buildReviewIntent(), []);
  const dryRequest = useMemo(
    () => mapCrossChainIntentToDryQuote(intent),
    [intent],
  );
  const [scenarioId, setScenarioId] = useState<ReviewScenarioId>(
    "provider-honors-terms",
  );
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [book, setBook] = useState<readonly AddressBookEntry[]>([]);
  const [destinationInput, setDestinationInput] = useState(
    DEFAULT_DESTINATION_ADDRESS,
  );
  const [refundInput, setRefundInput] = useState(DEFAULT_REFUND_ADDRESS);
  const busy = state.kind === "running";
  const selected =
    REVIEW_SCENARIOS.find((scenario) => scenario.id === scenarioId) ??
    REVIEW_SCENARIOS[0];

  const destination = resolveAddressBookInput(
    destinationInput,
    book,
    DESTINATION_CHAIN_ID,
  );
  const refund = resolveAddressBookInput(refundInput, book, REFUND_CHAIN_ID);

  const saveEntry = (entry: AddressBookEntry) => {
    setBook((current) => [
      ...current.filter(
        (existing) =>
          existing.label.toLowerCase() !== entry.label.toLowerCase(),
      ),
      entry,
    ]);
  };

  const replay = () => {
    if (busy) return;
    setState({ kind: "running", scenarioId });
    runDryReview(scenarioId, {
      destinationAddress: destination.address,
      refundAddress: refund.address,
    })
      .then((report) => setState({ kind: "done", report }))
      .catch((error) =>
        setState({ kind: "error", message: errorMessage(error) }),
      );
  };

  const terms: readonly { label: string; value: string; note?: string }[] = [
    {
      label: "Route",
      value: "STRK (Starknet) → wNEAR (NEAR)",
      note: `${FIXTURE_TOKENS.map((token) => token.symbol).join(" · ")} fixture catalog`,
    },
    {
      label: "Amount in",
      value: "2.5 STRK",
      note: `${intent.amount} base units`,
    },
    {
      label: "Minimum output",
      value: "1.18 wNEAR",
      note: `${intent.minimumOutput} base units`,
    },
    {
      label: "Fee ceiling",
      value: "0.03 wNEAR",
      note: `${intent.maximumFee} base units`,
    },
    { label: "Slippage", value: `${intent.slippageBps} bps` },
    { label: "Swap mode", value: dryRequest.swapType },
    {
      label: "Funding / delivery",
      value: `${dryRequest.depositType} → ${dryRequest.recipientType}`,
    },
    {
      label: "Destination",
      value: destination.address || "—",
      note: destination.entry
        ? `book @${destination.entry.label} · ${DESTINATION_CHAIN_ID}`
        : DESTINATION_CHAIN_ID,
    },
    {
      label: "Refund",
      value: refund.address || "—",
      note: refund.entry
        ? `book @${refund.entry.label} · ${intent.refundMode}`
        : `${intent.refundMode} · ${REFUND_CHAIN_ID}`,
    },
    { label: "Deadline", value: intent.deadline },
    { label: "Privacy mode", value: intent.privacyMode },
    { label: "Disclosed to", value: intent.disclosedTo.join(", ") },
  ];

  return (
    <section className={styles.page} aria-label="Cross-chain dry review desk">
      <header className={styles.bar}>
        <div>
          <p className={styles.eyebrow}>
            APP20 / CROSS-CHAIN INTENTS — DRY REVIEW
          </p>
          <span className={styles.boundary}>
            In-memory fixture replay. No deposit address, no quote HTTP, no
            wallet signature, no submit — a provider would learn route, amount,
            destination, refund, and timing once live.
          </span>
        </div>
        <strong className="review-only-stamp">
          REVIEW ONLY · CANNOT SUBMIT
        </strong>
      </header>

      <div className={styles.grid}>
        <section className={styles.main} aria-labelledby="intents-desk-title">
          <h2 className={styles.blockLabel} id="intents-desk-title">
            Reviewed terms — fixture route
          </h2>
          <dl className={styles.terms}>
            {terms.map((term) => (
              <div key={term.label}>
                <dt>{term.label}</dt>
                <dd>
                  {term.value}
                  {term.note ? <small>{term.note}</small> : null}
                </dd>
              </div>
            ))}
          </dl>

          <h2 className={styles.blockLabel}>Accounts — book-backed</h2>
          <div className={styles.accounts}>
            <AddressBookField
              id="intents-destination"
              label="Destination account (NEAR)"
              chainId={DESTINATION_CHAIN_ID}
              value={destinationInput}
              onChange={setDestinationInput}
              entries={book}
              onSaveEntry={saveEntry}
              placeholder="account.near or @label"
            />
            <AddressBookField
              id="intents-refund"
              label="Refund account (Starknet)"
              chainId={REFUND_CHAIN_ID}
              value={refundInput}
              onChange={setRefundInput}
              entries={book}
              onSaveEntry={saveEntry}
              placeholder="0x… or @label"
            />
          </div>
          <p className={styles.accountsNote}>
            Labels resolve from the APP20 address book; saves here stay in this
            session. A malformed address fails closed at the canonical-intent
            check — nothing is sent either way.
          </p>

          <h2 className={styles.blockLabel}>Fixture scenario</h2>
          <div
            className={styles.scenarioRow}
            role="group"
            aria-label="Dry review fixture scenarios"
          >
            {REVIEW_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                aria-pressed={scenario.id === scenarioId}
                className={
                  scenario.id === scenarioId ? styles.scenarioActive : undefined
                }
                onClick={() => setScenarioId(scenario.id)}
                disabled={busy}
              >
                <b>{scenario.name}</b>
                <span>
                  {scenario.expectation === "verified"
                    ? "EXPECT: VERIFIED"
                    : "EXPECT: REJECTED"}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={styles.runButton}
              onClick={replay}
              disabled={busy}
            >
              {busy ? "Replaying fixture…" : "Replay dry review (fixture)"}
            </button>
          </div>
          <p className={styles.scenarioSummary}>{selected.summary}</p>

          <section className={styles.result} aria-live="polite">
            {state.kind === "idle" ? (
              <p className={styles.idleNote}>
                Select a scenario and replay it. The desk shows every check the
                connector enforces, in order, including the ones that must fail
                closed.
              </p>
            ) : null}
            {state.kind === "running" ? (
              <p className={styles.idleNote}>Replaying {state.scenarioId}…</p>
            ) : null}
            {state.kind === "error" ? (
              <p className={styles.failureBox}>
                The review engine itself failed: {state.message}
              </p>
            ) : null}
            {state.kind === "done" ? (
              <>
                <p
                  className={
                    state.report.outcome === "verified"
                      ? styles.outcomeVerified
                      : styles.outcomeRejected
                  }
                >
                  {state.report.outcome === "verified"
                    ? "VERIFIED DRY QUOTE"
                    : "REJECTED — FAILED CLOSED"}
                </p>
                <ol className={styles.checks}>
                  {state.report.checks.map((check) => (
                    <li key={check.id}>
                      <span
                        className={`${styles.checkStatus} ${STATUS_CLASS[check.status]}`}
                      >
                        {STATUS_LABEL[check.status]}
                      </span>
                      <div>
                        <strong>{check.label}</strong>
                        <p>{check.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className={styles.counters}>
                  transport calls {state.report.transportCalls} · signature
                  verifier consulted {state.report.verifierCalls}×
                </p>
                {state.report.failure ? (
                  <p className={styles.failureBox}>
                    <b>Fail-closed error:</b> {state.report.failure}
                  </p>
                ) : null}
                {state.report.quote ? (
                  <dl className={styles.quote}>
                    <div>
                      <dt>Amount in</dt>
                      <dd>{state.report.quote.amountInFormatted} STRK</dd>
                    </div>
                    <div>
                      <dt>Amount out</dt>
                      <dd>{state.report.quote.amountOutFormatted} wNEAR</dd>
                    </div>
                    <div>
                      <dt>Min amount out</dt>
                      <dd>{state.report.quote.minAmountOut}</dd>
                    </div>
                    <div>
                      <dt>Time estimate</dt>
                      <dd>{state.report.quote.timeEstimate}s</dd>
                    </div>
                    <div>
                      <dt>Explicit fees</dt>
                      <dd>
                        {state.report.quote.refundFee ?? "0"} +{" "}
                        {state.report.quote.withdrawFee ?? "0"}
                      </dd>
                    </div>
                    <div>
                      <dt>Correlation</dt>
                      <dd>{state.report.quote.correlationId}</dd>
                    </div>
                  </dl>
                ) : null}
                {state.report.provenance ? (
                  <p className={styles.provenance}>
                    provenance {state.report.provenance.algorithm} ·{" "}
                    {state.report.provenance.keyId} ·{" "}
                    {state.report.provenance.signedPayloadDigest.slice(0, 18)}…
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        </section>

        <aside
          className={styles.rail}
          aria-labelledby="intent-disclosure-title"
        >
          <h2 className={styles.blockLabel} id="intent-disclosure-title">
            Disclosure — public boundary
          </h2>
          <dl className={styles.disclosure}>
            <div>
              <dt>Intents testnet</dt>
              <dd>{ONE_CLICK_HAS_TESTNET ? "Available" : "None"}</dd>
            </div>
            <div>
              <dt>Current mode</dt>
              <dd>Dry fixtures only</dd>
            </div>
            <div>
              <dt>Quote transport</dt>
              <dd>In-memory fixture, no HTTP</dd>
            </div>
            <div>
              <dt>Live verifier</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>Funding &amp; settlement</dt>
              <dd>Blocked pending Mainnet-only validation</dd>
            </div>
            <div>
              <dt>Custody window</dt>
              <dd>Trusted swapping agent in live 1Click</dd>
            </div>
            <div>
              <dt>Solver learns</dt>
              <dd>Route terms needed for execution</dd>
            </div>
            <div>
              <dt>Public</dt>
              <dd>Deposits, destination settlement, amount and timing</dd>
            </div>
          </dl>
          <p className={styles.railNote}>
            Amount and timing can reconnect source and destination activity.
            Confidential Intents does not make destination settlement private.
            APP20 does not promise unlinkability.
          </p>
          <ol
            className={styles.lifecycle}
            aria-label="Cross-chain lifecycle model"
          >
            {REVIEW_STAGES.map((stage, index) => (
              <li key={stage}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                {stage.replaceAll("_", " ")}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}
