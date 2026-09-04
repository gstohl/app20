"use client";

import { useActiveStarknetSession } from "@/app/active-session";
import {
  useLocalnetNoteMaturity,
  type LocalnetNoteMaturityState,
} from "@/app/use-localnet-note-maturity";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  configuredMarketPair,
  networkForProviderIndex,
  resolveSessionTokenNetwork,
  type App20TokenNetwork,
  type CanonicalPairResolution,
} from "@/lib/token-registry";
import { MIN_STRK20_WALLET_API, type Strk20Capability } from "@/lib/strk20";
import { describeNoteMaturity } from "@/lib/note-maturity";
import { LOCALNET_PROVIDER_INDEX } from "@/utils/constants";
import { useMemo, type ReactNode } from "react";

const FUNDING_ACTIONS = [
  { label: "Shield", specAction: "deposit" },
  { label: "Unshield", specAction: "withdraw" },
  { label: "Private transfer", specAction: "transfer" },
] as const;

const NETWORK_LABELS: Readonly<Record<App20TokenNetwork, string>> = {
  mainnet: "Mainnet",
  sepolia: "Sepolia",
  localnet: "Localnet demo",
};

export type FundingReadinessModel = Readonly<{
  ready: boolean;
  localnetDemo: boolean;
  walletLabel: string;
  networkLabel: string;
  actionDeclarationAvailable: boolean;
  capabilitySummary: string;
  blockers: readonly string[];
  pair:
    | Readonly<{
        eligible: true;
        tokenA: { symbol: string; address: string; decimals: number };
        tokenB: { symbol: string; address: string; decimals: number };
      }>
    | Readonly<{ eligible: false; reason: string }>;
  noteMaturity: Readonly<{
    exposed: boolean;
    label: string;
    detail: string;
  }>;
}>;

type FundingMaturityEstimate = Exclude<
  LocalnetNoteMaturityState,
  Readonly<{ kind: "idle" }>
>;

export type FundingReadinessInput = Readonly<{
  isConnected: boolean;
  address: string;
  capability: Strk20Capability | null;
  network: App20TokenNetwork | null;
  pair: CanonicalPairResolution | null;
  sessionCompatible: boolean;
  sessionReason?: string;
  maturityEstimate?: FundingMaturityEstimate;
}>;

function shortAddress(address: string): string {
  return address.length > 20
    ? `${address.slice(0, 10)}…${address.slice(-6)}`
    : address;
}

/**
 * Produce readiness from public network configuration and wallet declarations.
 * This function deliberately has no account object and cannot request balances.
 */
export function createFundingReadinessModel({
  isConnected,
  address,
  capability,
  network,
  pair,
  sessionCompatible,
  sessionReason,
  maturityEstimate,
}: FundingReadinessInput): FundingReadinessModel {
  const localnetDemo = network === "localnet";
  const blockers: string[] = [];
  const mismatchReason =
    sessionReason?.trim() ||
    "The connected account and selected network do not match.";

  if (!isConnected || !address) {
    blockers.push("No wallet is connected.");
  } else if (!sessionCompatible) {
    blockers.push(mismatchReason);
  }
  if (!localnetDemo) {
    blockers.push(
      "Funding actions are enabled only for the build-gated localnet demo; public-network execution remains unavailable.",
    );
  }
  if (isConnected && !capability) {
    blockers.push(
      "The connected wallet has not exposed a reviewed STRK20 capability declaration.",
    );
  } else if (isConnected && capability && !capability.versionSupported) {
    blockers.push(
      `The wallet does not declare Wallet API/spec ${MIN_STRK20_WALLET_API} or newer.`,
    );
  } else if (isConnected && capability && !capability.supported) {
    blockers.push(
      `The wallet declaration is incomplete for APP20 (${capability.missingMethods.join(", ") || "required methods unavailable"}).`,
    );
  }

  let pairModel: FundingReadinessModel["pair"];
  const pairBoundToLocalnet =
    localnetDemo && (!isConnected || sessionCompatible);
  if (!pair?.ok) {
    const reason = pair
      ? pair.message
      : "The active network has no reviewed canonical STRK/USDC asset identity.";
    pairModel = { eligible: false, reason };
    blockers.push(reason);
  } else if (pairBoundToLocalnet) {
    pairModel = {
      eligible: true,
      tokenA: {
        symbol: pair.pair.tokenA.symbol,
        address: pair.pair.tokenA.address,
        decimals: pair.pair.tokenA.decimals,
      },
      tokenB: {
        symbol: pair.pair.tokenB.symbol,
        address: pair.pair.tokenB.address,
        decimals: pair.pair.tokenB.decimals,
      },
    };
  } else if (localnetDemo) {
    pairModel = { eligible: false, reason: mismatchReason };
  } else {
    pairModel = {
      eligible: false,
      reason:
        "The canonical pair is not eligible here: only localnet demo asset identities are approved for this flow.",
    };
    blockers.push(pairModel.reason);
  }

  const actionDeclarationAvailable = Boolean(
    isConnected && capability?.supported,
  );
  const walletLabel =
    isConnected && address
      ? `${capability?.walletName ?? "Connected wallet"} · ${shortAddress(address)}`
      : "No wallet connected";
  const capabilitySummary = isConnected
    ? capability
      ? capability.supported
        ? `Declared Wallet API/spec ≥ ${MIN_STRK20_WALLET_API}; required account methods are present`
        : capability.versionSupported
          ? "Version declared, but the reviewed account-method surface is incomplete"
          : `Below reviewed Wallet API/spec ${MIN_STRK20_WALLET_API}`
      : "No reviewed declaration exposed"
    : "Unavailable until a wallet connects";

  const noteMaturity: FundingReadinessModel["noteMaturity"] =
    !isConnected || !address
      ? {
          exposed: false,
          label: "Unavailable · no wallet connected",
          detail:
            "APP20 cannot derive note age without a connected public account.",
        }
      : maturityEstimate?.kind === "ready"
        ? {
            exposed: true,
            label: "Chain-derived estimate",
            detail: `${describeNoteMaturity(maturityEstimate.status)} This is an estimate from public deposit events; APP20 never reads private balances.`,
          }
        : maturityEstimate?.kind === "loading"
          ? {
              exposed: true,
              label: "Chain-derived estimate pending",
              detail:
                "Reading public pool deposit events; APP20 never reads private balances.",
            }
          : maturityEstimate?.kind === "error"
            ? {
                exposed: true,
                label: "Chain-derived estimate unavailable",
                detail: `${maturityEstimate.message} APP20 never reads private balances.`,
              }
            : {
                exposed: false,
                label: "Not exposed by this wallet",
                detail:
                  "APP20 did not request a private balance, infer note age, or fabricate maturity evidence.",
              };

  return {
    ready: blockers.length === 0,
    localnetDemo,
    walletLabel,
    networkLabel: network ? NETWORK_LABELS[network] : "Unknown network",
    actionDeclarationAvailable,
    capabilitySummary,
    blockers,
    pair: pairModel,
    noteMaturity,
  };
}

export function FundingReadinessPanelView({
  model,
  children,
}: {
  model: FundingReadinessModel;
  children?: ReactNode;
}) {
  return (
    <>
      <section
        className="panel-frame funding-readiness-panel"
        aria-labelledby="funding-readiness-title"
        style={{ margin: 16, padding: 16 }}
      >
        <p style={{ marginTop: 0 }}>FUNDING READINESS · DECLARATIONS ONLY</p>
        <h2 id="funding-readiness-title">Wallet and network readiness</h2>
        <p>
          This check uses wallet capability declarations and the reviewed token
          registry. It never requests a private balance to discover features.
        </p>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <dt>Connected wallet</dt>
            <dd>{model.walletLabel}</dd>
          </div>
          <div>
            <dt>Active network</dt>
            <dd>{model.networkLabel}</dd>
          </div>
          <div>
            <dt>STRK20 declaration</dt>
            <dd>{model.capabilitySummary}</dd>
          </div>
          <div>
            <dt>Readiness</dt>
            <dd>
              {model.ready ? "Ready for localnet demo funding" : "Unavailable"}
            </dd>
          </div>
        </dl>

        {model.blockers.length ? (
          <div role="status">
            <strong>Fail-closed reasons</strong>
            <ul>
              {model.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <h3>Wallet-declared STRK20 action surface</h3>
        <ul>
          {FUNDING_ACTIONS.map((action) => (
            <li key={action.specAction}>
              <strong>{action.label}</strong> (<code>{action.specAction}</code>)
              {" — "}
              {model.actionDeclarationAvailable
                ? `declared through the wallet's ≥ ${MIN_STRK20_WALLET_API} STRK20 spec surface`
                : "not declared to APP20 on the reviewed capability surface"}
            </li>
          ))}
        </ul>

        <h3>Canonical STRK/USDC asset eligibility</h3>
        {model.pair.eligible ? (
          <dl>
            {[model.pair.tokenA, model.pair.tokenB].map((token) => (
              <div key={token.address}>
                <dt>{token.symbol}</dt>
                <dd>
                  <code>{token.address}</code> · {token.decimals} decimals ·
                  reviewed localnet demo identity
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>
            <strong>Unavailable.</strong> {model.pair.reason}
          </p>
        )}

        <h3>Note maturity</h3>
        <p>
          <strong>{model.noteMaturity.label}.</strong>{" "}
          {model.noteMaturity.detail}
        </p>

        <h3>Public funding legs</h3>
        <ul>
          <li>
            Shield is a public deposit; its amount and timing are public and
            correlatable.
          </li>
          <li>
            Unshield is a public withdrawal; its amount and timing are public
            and correlatable.
          </li>
          <li>
            Shield and unshield are separate wallet operations and are never
            bundled with RFQ acceptance.
          </li>
        </ul>
        <p role="note">
          <strong>Funding does not prove settlement.</strong> Wallet state, this
          readiness panel, and a funding transaction are not RFQ settlement
          authority.
        </p>
      </section>

      {model.ready ? children : null}
    </>
  );
}

export default function FundingReadinessPanel({
  children,
}: {
  children?: ReactNode;
}) {
  const session = useActiveStarknetSession();
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const capability = useStoreWallet((state) => state.strk20Capability);
  const selectedNetwork = networkForProviderIndex(providerIndex);
  const boundNetwork = resolveSessionTokenNetwork({
    selectedNetwork,
    sessionNetwork: session.network,
    connected: session.connected,
    compatible: session.compatible,
    reason: session.reason,
  });
  const network = boundNetwork.ok ? boundNetwork.network : selectedNetwork;
  const { maturity } = useLocalnetNoteMaturity({
    enabled: Boolean(
      isConnected &&
        address &&
        network === "localnet" &&
        providerIndex === LOCALNET_PROVIDER_INDEX &&
        session.compatible,
    ),
    address,
  });
  const maturityEstimate = maturity.kind === "idle" ? undefined : maturity;

  const model = useMemo(() => {
    const pair = network ? configuredMarketPair(network) : null;
    return createFundingReadinessModel({
      isConnected,
      address,
      capability,
      network,
      pair,
      sessionCompatible: session.compatible,
      sessionReason: session.reason,
      maturityEstimate,
    });
  }, [
    isConnected,
    address,
    capability,
    network,
    session.compatible,
    session.reason,
    maturityEstimate,
  ]);

  return (
    <FundingReadinessPanelView model={model}>
      {children}
    </FundingReadinessPanelView>
  );
}
