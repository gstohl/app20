import type { RequestFn } from "@starknet-io/types-js";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  StarknetWalletApi,
  type StandardEventsChangeProperties,
  type StandardEventsOnMethod,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";
import { useState } from "react";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { setLocalnetRuntimeEpoch } from "./localnet-runtime-epoch";
import styles from "./localnet-wallet.module.css";

export const LOCALNET_DEV_WALLET_SENTINEL =
  "APP20_LOCALNET_DEV_WALLET_SENTINEL_7C91E2";

const SELECTED_IDENTITY_KEY = "app20/localnet-wallet/identity/v1";
const WALLET_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMxMTE4MjciLz48cGF0aCBkPSJNMTcgMzJoMzBNMzIgMTd2MzAiIHN0cm9rZT0iIzdkZDNmYyIgc3Ryb2tlLXdpZHRoPSI3IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSI3IiBmaWxsPSIjZjhmYWZjIi8+PC9zdmc+" as const;

type IdentityId = "alice" | "bob";

export type LocalnetIdentity = {
  id: IdentityId;
  label: string;
  address: string;
};

export type LocalnetWalletConfig = {
  walletName: string;
  runtimeEpoch: string;
  chainId: string;
  rpcUrl: string;
  poolAddress: string;
  helperAddress: string;
  escrowAddress: string;
  tokenAddress: string;
  counterTokenAddress: string;
  proofMode: string;
  identities: LocalnetIdentity[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type ApiRequest = (path: string, init?: RequestInit) => Promise<unknown>;

type WalletApiCall = {
  type: string;
  params?: Record<string, unknown>;
};

function isIdentityId(value: string | null): value is IdentityId {
  return value === "alice" || value === "bob";
}

function requireIdentity(
  identities: LocalnetIdentity[],
  identityId: IdentityId,
): LocalnetIdentity {
  const identity = identities.find(({ id }) => id === identityId);
  if (!identity) throw new Error(`Localnet identity ${identityId} is missing.`);
  return identity;
}

/** Wallet Standard implementation used only by the gated localnet build. */
export class App20LocalnetWallet implements WalletWithStarknetFeatures {
  readonly version = "1.0.0" as const;
  /** Stable artifact sentinel: release scanners must reject this development wallet. */
  readonly releaseSentinel = LOCALNET_DEV_WALLET_SENTINEL;
  readonly name: string;
  readonly icon = WALLET_ICON;
  readonly chains: readonly `${string}:${string}`[];
  readonly features;

  private connected = false;
  private selectedIdentityId: IdentityId;
  private activeIdentityRequests = 0;
  private readonly changeListeners = new Set<
    (properties: StandardEventsChangeProperties) => void
  >();

  constructor(
    readonly config: LocalnetWalletConfig,
    private readonly storage: StorageLike,
    private readonly apiRequest: ApiRequest,
  ) {
    this.name = config.walletName;
    this.chains = [`starknet:${config.chainId}`];
    const savedIdentity = storage.getItem(
      `${SELECTED_IDENTITY_KEY}/${config.runtimeEpoch}`,
    );
    this.selectedIdentityId = isIdentityId(savedIdentity)
      ? savedIdentity
      : "alice";
    requireIdentity(config.identities, this.selectedIdentityId);

    const request = (async (call: WalletApiCall) =>
      this.handleRequest(call)) as RequestFn;
    const on: StandardEventsOnMethod = (event, listener) => {
      if (event !== "change") return () => {};
      this.changeListeners.add(listener);
      return () => this.changeListeners.delete(listener);
    };

    this.features = {
      [StandardConnect]: {
        version: "1.0.0" as const,
        connect: async () => {
          this.connected = true;
          this.emitAccounts();
          return { accounts: this.accounts };
        },
      },
      [StandardDisconnect]: {
        version: "1.0.0" as const,
        disconnect: async () => {
          this.connected = false;
          this.emitAccounts();
        },
      },
      [StandardEvents]: {
        version: "1.0.0" as const,
        on,
      },
      [StarknetWalletApi]: {
        id: "app20-localnet-dev",
        version: "1.0.0" as const,
        walletVersion: "0.1.0-dev",
        request,
      },
    };
  }

  get accounts() {
    if (!this.connected) return [];
    const identity = this.selectedIdentity;
    return [
      {
        address: identity.address,
        publicKey: new Uint8Array(),
        chains: this.chains,
        features: [StarknetWalletApi] as const,
        label: `${identity.label} · localnet devnet`,
      },
    ];
  }

  get selectedIdentity(): LocalnetIdentity {
    return requireIdentity(this.config.identities, this.selectedIdentityId);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  selectIdentity(identityId: IdentityId): void {
    requireIdentity(this.config.identities, identityId);
    if (identityId === this.selectedIdentityId) return;
    if (this.activeIdentityRequests > 0)
      throw new Error(
        "Localnet wallet identity is locked by an in-flight account request.",
      );
    this.selectedIdentityId = identityId;
    this.storage.setItem(
      `${SELECTED_IDENTITY_KEY}/${this.config.runtimeEpoch}`,
      identityId,
    );
    if (this.connected) this.emitAccounts();
  }

  private emitAccounts(): void {
    const properties = { accounts: this.accounts };
    for (const listener of this.changeListeners) listener(properties);
  }

  private async identityRequest(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.connected)
      throw new Error(
        "Connect the Localnet (dev) wallet before using account methods.",
      );
    const identity = this.selectedIdentity;
    this.activeIdentityRequests += 1;
    try {
      return await this.apiRequest(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runtimeEpoch: this.config.runtimeEpoch,
          identity: identity.id,
          ...payload,
        }),
      });
    } finally {
      this.activeIdentityRequests -= 1;
    }
  }

  private async handleRequest(call: WalletApiCall): Promise<unknown> {
    switch (call.type) {
      case "wallet_requestAccounts":
        if (!this.connected) {
          this.connected = true;
          this.emitAccounts();
        }
        return [this.selectedIdentity.address];
      case "wallet_getPermissions":
        return this.connected ? ["accounts"] : [];
      case "wallet_requestChainId":
        return this.config.chainId;
      case "wallet_supportedWalletApi":
      case "wallet_supportedSpecs":
        return ["0.10"];
      case "wallet_addInvokeTransaction":
        return this.identityRequest("/invoke", { calls: call.params?.calls });
      case "wallet_strk20InvokeTransaction":
        return this.identityRequest("/privacy", {
          actions: call.params?.actions,
        });
      case "wallet_strk20Balances":
        return this.identityRequest("/balances", {
          tokens: call.params?.tokens ?? [],
        });
      default:
        throw new Error(
          `Localnet (dev) does not implement wallet method ${call.type}.`,
        );
    }
  }
}

export function registerLocalnetWalletStandard(
  wallet: WalletWithStarknetFeatures,
  target: Window,
): () => void {
  const registrations: Array<() => void> = [];
  const register = (api: {
    register: (next: WalletWithStarknetFeatures) => () => void;
  }) => {
    registrations.push(api.register(wallet));
  };
  const onAppReady = (event: Event) => {
    register(
      (
        event as CustomEvent<{
          register: (next: WalletWithStarknetFeatures) => () => void;
        }>
      ).detail,
    );
  };

  target.addEventListener("wallet-standard:app-ready", onAppReady);
  target.dispatchEvent(
    new CustomEvent("wallet-standard:register-wallet", {
      detail: register,
    }),
  );

  return () => {
    target.removeEventListener("wallet-standard:app-ready", onAppReady);
    for (const unregister of registrations) unregister();
  };
}

async function readApiResponse(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = (await response.json()) as {
    result?: unknown;
    error?: string;
  };
  if (!response.ok || payload.error) {
    const message = payload.error ?? `Localnet wallet HTTP ${response.status}.`;
    const error = new Error(message) as Error & {
      app20SubmissionOutcome?: "not-submitted";
      code?: string;
      httpStatus?: number;
    };
    if (
      path === "/privacy" &&
      response.status === 400 &&
      /^Insufficient balance for token \S+: need \d+ more \(total available: \d+\)$/.test(
        message,
      )
    ) {
      // This exact local prover error is raised by note selection before the
      // backend reaches devnet.executeOutside. Attest that narrow boundary so
      // generic wallet failures remain unknown in the submission layer.
      error.app20SubmissionOutcome = "not-submitted";
      error.code = "APP20_LOCALNET_PRE_SUBMISSION_INSUFFICIENT_BALANCE";
      error.httpStatus = response.status;
    }
    throw error;
  }
  return payload.result;
}

export async function initializeLocalnetDevWallet(): Promise<App20LocalnetWallet> {
  const baseUrl = import.meta.env.VITE_LOCALNET_WALLET_URL;
  if (!baseUrl) {
    throw new Error(
      "VITE_LOCALNET_WALLET_URL is missing in the dev-wallet build.",
    );
  }
  const apiRequest: ApiRequest = (path, init) =>
    readApiResponse(baseUrl, path, init);
  const config = (await apiRequest("/config")) as LocalnetWalletConfig;
  setLocalnetRuntimeEpoch(config.runtimeEpoch);
  const wallet = new App20LocalnetWallet(
    config,
    window.localStorage,
    apiRequest,
  );
  registerLocalnetWalletStandard(wallet, window);
  return wallet;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

export function LocalnetDevTools({
  wallet,
  variant = "sidebar",
}: {
  wallet: App20LocalnetWallet;
  variant?: "banner" | "sidebar";
}) {
  const [selectedId, setSelectedId] = useState(wallet.selectedIdentity.id);
  const [copied, setCopied] = useState("");
  const connectedAddress = useStoreWallet((state) => state.address);

  function selectIdentity(identityId: IdentityId) {
    wallet.selectIdentity(identityId);
    setSelectedId(identityId);
    setCopied("");
  }

  async function copyAddress(identity: LocalnetIdentity) {
    try {
      await navigator.clipboard.writeText(identity.address);
      setCopied(identity.id);
    } catch {
      setCopied("error");
    }
  }

  return (
    <aside
      className={styles.banner}
      data-testid="localnet-wallet-standard"
      data-dev-wallet-symbol={LOCALNET_DEV_WALLET_SENTINEL}
      data-variant={variant}
    >
      <strong className={styles.mark}>LOCAL DEMO</strong>
      <div className={styles.identities}>
        <span>Act as</span>
        {wallet.config.identities.map((identity) => (
          <button
            key={identity.id}
            data-localnet-identity={identity.id}
            type="button"
            aria-pressed={selectedId === identity.id}
            onClick={() => selectIdentity(identity.id)}
          >
            {identity.label}
          </button>
        ))}
      </div>
      <span className={styles.address}>
        {shortAddress(wallet.selectedIdentity.address)}
      </span>
      <span className={styles.meta}>
        {connectedAddress
          ? "account change is live"
          : "connect Localnet (dev) after choosing an identity"}
      </span>
      <div className={styles.copies}>
        {wallet.config.identities.map((identity) => (
          <button
            key={`copy:${identity.id}`}
            type="button"
            onClick={() => void copyAddress(identity)}
          >
            {copied === identity.id
              ? `${identity.label} copied`
              : `Copy ${identity.label}`}
          </button>
        ))}
        {copied === "error" ? <span>Clipboard denied.</span> : null}
        <span>Pool {shortAddress(wallet.config.poolAddress)}</span>
        <span>Mail {shortAddress(wallet.config.helperAddress)}</span>
        <span>Escrow {shortAddress(wallet.config.escrowAddress)}</span>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(
              wallet.config.counterTokenAddress,
            )
          }
        >
          Copy escrow leg-B
        </button>
      </div>
    </aside>
  );
}
