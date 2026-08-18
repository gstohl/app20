"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useExportWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assertNetworkPolicy, type PrivacyOperation } from "@app20/privacy-adapters";
import {
  PRIVY_APP_ID,
  PRIVY_CLIENT_ID,
} from "@/app/vault/privy-config";
import { useVaultMode } from "@/app/vault/vaultMode";
import {
  BrowserStrk20Client,
  computeBrowserAccountAddress,
  serviceDiscovery,
  serviceProver,
  type BrowserStrk20Session,
} from "@app20/privy/browser";
import { useEffect, useMemo, useRef, useState } from "react";

type AuthorizationKind =
  | "user-only"
  | "shared-recovery"
  | "multisig"
  | "unavailable";

type BootstrapWallet = {
  walletId: string;
  publicKey: string;
  privyAddress: string;
  displayName?: string;
  createdAt: number;
  exportedAt?: number;
  importedAt?: number;
  authorization: {
    kind: AuthorizationKind;
    threshold: number;
    userSignerCount: number;
    appSignerCount: number;
    browserSignable: boolean;
    appCanSignAlone: boolean;
  };
};

type BootstrapPayload = {
  network: "sepolia";
  rpcUrl: string;
  poolAddress: string;
  readyClassHash: string;
  strkToken: string;
  submissionMode: "live" | "build-only";
  ohttp: {
    prover: { gatewayUrl: string; relayUrl: string };
    discovery: { gatewayUrl: string; relayUrl: string };
  };
  wallets: BootstrapWallet[];
};

type PrivateBalances = Awaited<
  ReturnType<BrowserStrk20Session["balances"]>
>;

type PrivateState = {
  status: "idle" | "scanning" | "ready" | "error";
  balances?: PrivateBalances;
  error?: string;
};

type Activity = {
  id: number;
  label: string;
  transactionHash?: string;
};

const PROVER_KEY_CONFIG = import.meta.env.VITE_PROVER_OHTTP_KEY_CONFIG;
const DISCOVERY_KEY_CONFIG = import.meta.env.VITE_DISCOVERY_OHTTP_KEY_CONFIG;

function decodePinnedKey(value: string | undefined, label: string): Uint8Array {
  if (!value) throw new Error(`Missing reviewed ${label} OHTTP key configuration.`);
  try {
    const decoded = atob(value);
    const bytes = Uint8Array.from(decoded, (character) =>
      character.charCodeAt(0),
    );
    if (bytes.byteLength === 0) throw new Error("empty key");
    return bytes;
  } catch {
    throw new Error(`Invalid reviewed ${label} OHTTP key configuration.`);
  }
}

function parseAmount(value: string, decimals = 18): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match?.[1]) throw new Error("Enter a positive decimal amount.");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }
  const amount =
    BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

function formatUnits(
  value: bigint | undefined,
  decimals = 18,
  fractionDigits = 4,
): string {
  if (value === undefined) return "—";
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, fractionDigits)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function short(value: string, head = 8, tail = 6): string {
  return value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;
}

function authorizationLabel(kind: AuthorizationKind): string {
  switch (kind) {
    case "user-only":
      return "USER ONLY";
    case "shared-recovery":
      return "SHARED RECOVERY";
    case "multisig":
      return "QUORUM REQUIRED";
    case "unavailable":
      return "VIEW ONLY";
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/wallet proxy not initialized|secure signer/i.test(message)) {
    return "Privy's secure signer is still initializing. Wait a moment, then retry.";
  }
  if (/reject|cancel|denied/i.test(message)) return "The wallet request was rejected.";
  if (/insufficient|allowance|balance/i.test(message)) {
    return "The account has insufficient public balance or token allowance for this operation.";
  }
  if (/not deployed/i.test(message)) return "Deploy the Starknet account first.";
  if (/matur|block/i.test(message)) {
    return "Private state is not mature yet. Wait for additional Starknet blocks and retry.";
  }
  if (/missing reviewed|invalid reviewed/i.test(message)) return message;
  return "The privacy operation failed. No private request details were displayed.";
}

function transactionHash(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const hash = (value as Record<string, unknown>).transactionHash;
  return typeof hash === "string" ? hash : undefined;
}

function isProxyInitializationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Wallet proxy not initialized");
}

function PrivySepoliaVaultContent() {
  const {
    ready,
    authenticated,
    login,
    logout,
    getAccessToken,
    user,
  } = usePrivy();
  const { ready: walletsReady } = useWallets();
  const { signRawHash } = useSignRawHash();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const queryClient = useQueryClient();
  const setPrivyStatus = useVaultMode((state) => state.setPrivyStatus);
  const signRawHashRef = useRef(signRawHash);
  const getAccessTokenRef = useRef(getAccessToken);
  const signerReadyRef = useRef(false);
  const sessionsRef = useRef(new Map<string, BrowserStrk20Session>());
  const activityIdRef = useRef(0);
  const previousIdentityRef = useRef<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string>();
  const [privateState, setPrivateState] = useState<Record<string, PrivateState>>(
    {},
  );
  const [amount, setAmount] = useState("0.001");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [activities, setActivities] = useState<Activity[]>([]);

  signRawHashRef.current = signRawHash;
  getAccessTokenRef.current = getAccessToken;
  signerReadyRef.current = ready && authenticated && walletsReady;
  const identityKey = user?.id ?? "signed-out";

  const bootstrapQuery = useQuery({
    queryKey: ["privy-sepolia-bootstrap", identityKey],
    enabled: ready && authenticated && Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async (): Promise<BootstrapPayload> => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Privy authentication expired.");
      const response = await fetch("/api/privacy/bootstrap", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Privacy bootstrap failed.");
      const payload = (await response.json()) as BootstrapPayload;
      if (payload.network !== "sepolia") {
        throw new Error("Privy is restricted to Sepolia.");
      }
      return payload;
    },
  });

  const clientState = useMemo(() => {
    const payload = bootstrapQuery.data;
    if (!payload) return {} as { client?: BrowserStrk20Client; error?: string };
    try {
      return {
        client: new BrowserStrk20Client({
          network: "sepolia",
          rpcUrl: payload.rpcUrl,
          poolAddress: payload.poolAddress,
          readyClassHash: payload.readyClassHash,
          prover: serviceProver({
            url: payload.ohttp.prover.gatewayUrl,
            requestTimeoutMs: 180_000,
            submittable: payload.submissionMode === "live",
            ohttp: {
              relayUrl: payload.ohttp.prover.relayUrl,
              publicKeyConfig: decodePinnedKey(PROVER_KEY_CONFIG, "prover"),
            },
          }),
          discovery: serviceDiscovery(payload.ohttp.discovery.gatewayUrl, {
            ohttp: {
              relayUrl: payload.ohttp.discovery.relayUrl,
              publicKeyConfig: decodePinnedKey(
                DISCOVERY_KEY_CONFIG,
                "discovery",
              ),
            },
          }),
        }),
      };
    } catch (cause) {
      return { error: safeError(cause) };
    }
  }, [bootstrapQuery.data]);

  useEffect(() => {
    sessionsRef.current = new Map();
  }, [clientState.client]);

  useEffect(() => {
    const previous = previousIdentityRef.current;
    previousIdentityRef.current = identityKey;
    if (previous === undefined || previous === identityKey) return;
    sessionsRef.current = new Map();
    setSelectedId(undefined);
    setPrivateState({});
    setRecipient("");
    setActivities([]);
    setError(undefined);
    setBusy(undefined);
    queryClient.removeQueries({ queryKey: ["privy-sepolia-bootstrap"] });
    queryClient.removeQueries({ queryKey: ["privy-sepolia-public-account"] });
  }, [identityKey, queryClient]);

  useEffect(() => {
    const wallets = bootstrapQuery.data?.wallets ?? [];
    if (selectedId && wallets.some((wallet) => wallet.walletId === selectedId)) {
      return;
    }
    const preferred =
      wallets.find(
        (wallet) =>
          wallet.authorization.kind === "user-only" &&
          wallet.authorization.browserSignable,
      ) ?? wallets.find((wallet) => wallet.authorization.browserSignable) ?? wallets[0];
    setSelectedId(preferred?.walletId);
  }, [bootstrapQuery.data, selectedId]);

  const selected = bootstrapQuery.data?.wallets.find(
    (wallet) => wallet.walletId === selectedId,
  );
  const selectedAddress =
    selected && bootstrapQuery.data
      ? computeBrowserAccountAddress(
          selected.publicKey,
          bootstrapQuery.data.readyClassHash,
        )
      : undefined;

  useEffect(() => {
    setPrivyStatus(authenticated, selectedAddress);
    return () => setPrivyStatus(false);
  }, [authenticated, selectedAddress, setPrivyStatus]);

  async function signHash(wallet: BootstrapWallet, hash: `0x${string}`) {
    if (!signerReadyRef.current) {
      throw new Error("Privy's secure signer is still initializing.");
    }
    const accessToken = await getAccessTokenRef.current();
    if (!accessToken) throw new Error("Privy authentication expired.");
    const request = () =>
      signRawHashRef.current({
        address: wallet.privyAddress,
        chainType: "starknet",
        hash,
      });
    try {
      return await request();
    } catch (cause) {
      if (!isProxyInitializationError(cause)) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 800));
      await getAccessTokenRef.current();
      return request();
    }
  }

  async function sessionFor(wallet: BootstrapWallet) {
    const existing = sessionsRef.current.get(wallet.walletId);
    if (existing) return existing;
    if (!clientState.client) throw new Error("Privacy client is unavailable.");
    const session = await clientState.client.session(
      {
        walletId: wallet.walletId,
        publicKey: wallet.publicKey,
        privyAddress: wallet.privyAddress,
      },
      (hash) => signHash(wallet, hash),
    );
    sessionsRef.current.set(wallet.walletId, session);
    return session;
  }

  const accountQuery = useQuery({
    queryKey: [
      "privy-sepolia-public-account",
      identityKey,
      selectedId,
      selectedAddress,
    ],
    enabled: Boolean(selected && clientState.client),
    queryFn: async () => {
      if (!selected) throw new Error("No Privy wallet selected.");
      const session = await sessionFor(selected);
      const [balances, deployed] = await Promise.all([
        session.publicBalances(),
        session.isDeployed(),
      ]);
      return {
        deployed,
        balance: balances.tokens[0]?.balance ?? 0n,
      };
    },
  });

  function addActivity(label: string, hash?: string) {
    setActivities((current) => [
      { id: ++activityIdRef.current, label, ...(hash ? { transactionHash: hash } : {}) },
      ...current,
    ].slice(0, 6));
  }

  function setWalletPrivateState(walletId: string, state: PrivateState) {
    setPrivateState((current) => ({ ...current, [walletId]: state }));
  }

  async function scanPrivate(announce = true) {
    if (!selected) return undefined;
    assertNetworkPolicy({
      network: "sepolia",
      adapter: "privy",
      operation: "private-read",
      submissionMode: bootstrapQuery.data?.submissionMode ?? "build-only",
    });
    setBusy("RECOVERING PRIVATE BALANCE");
    setError(undefined);
    setWalletPrivateState(selected.walletId, { status: "scanning" });
    try {
      const session = await sessionFor(selected);
      const balances = await session.balances();
      setWalletPrivateState(selected.walletId, { status: "ready", balances });
      if (announce) addActivity("PRIVATE BALANCE RECOVERED");
      return balances;
    } catch (cause) {
      const message = safeError(cause);
      setWalletPrivateState(selected.walletId, { status: "error", error: message });
      setError(message);
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  async function runAction(
    action: "deploy" | "register" | "shield" | "transfer" | "unshield",
  ) {
    if (!selected) return;
    if (!selected.authorization.browserSignable) {
      setError("The current Privy signer cannot satisfy this wallet quorum alone.");
      return;
    }
    const operation: PrivacyOperation =
      action === "deploy" ? "connect" : action === "transfer" ? "private-transfer" : action;
    assertNetworkPolicy({
      network: "sepolia",
      adapter: "privy",
      operation,
      submissionMode: bootstrapQuery.data?.submissionMode ?? "build-only",
    });
    setBusy(`${action.toUpperCase()} IN PROGRESS`);
    setError(undefined);
    try {
      const session = await sessionFor(selected);
      let result: unknown;
      switch (action) {
        case "deploy":
          await session.ensureDeployed();
          break;
        case "register":
          result = await session.register();
          break;
        case "shield":
          result = await session.shield({ amount: parseAmount(amount) });
          break;
        case "transfer":
          if (!recipient.trim()) throw new Error("Enter a recipient address.");
          result = await session.transfer({
            recipient: recipient.trim(),
            amount: parseAmount(amount),
          });
          break;
        case "unshield":
          result = await session.unshield({
            recipient: recipient.trim() || undefined,
            amount: parseAmount(amount),
          });
          break;
      }
      const hash = transactionHash(result);
      const builtOnly =
        result !== undefined &&
        typeof result === "object" &&
        (result as Record<string, unknown>).submitted === false;
      addActivity(
        `${action.toUpperCase()} ${builtOnly ? "BUILT / NOT SUBMITTED" : "COMPLETE"}`,
        hash,
      );
      await queryClient.invalidateQueries({
        queryKey: [
          "privy-sepolia-public-account",
          identityKey,
          selected.walletId,
        ],
      });
      if (action !== "deploy" && !builtOnly) await scanPrivate(false);
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setBusy(undefined);
    }
  }

  function clearPrivyState() {
    sessionsRef.current = new Map();
    setSelectedId(undefined);
    setPrivateState({});
    setAmount("0.001");
    setRecipient("");
    setActivities([]);
    setError(undefined);
    setBusy(undefined);
    setPrivyStatus(false);
    queryClient.removeQueries({ queryKey: ["privy-sepolia-bootstrap"] });
    queryClient.removeQueries({ queryKey: ["privy-sepolia-public-account"] });
  }

  async function handleLogout() {
    clearPrivyState();
    await fetch("/api/privacy/logout", { method: "POST" }).catch(
      () => undefined,
    );
    await logout();
  }

  async function addWallet() {
    setBusy("CREATING PRIVY WALLET");
    setError(undefined);
    try {
      await createWallet({ chainType: "starknet" });
      await bootstrapQuery.refetch();
      addActivity("USER-ONLY WALLET CREATED");
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function backupWallet() {
    if (!selected) return;
    setBusy("OPENING PRIVY EXPORT");
    setError(undefined);
    try {
      await exportWallet({ address: selected.privyAddress });
      addActivity("PRIVY BACKUP FLOW CLOSED");
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setBusy(undefined);
    }
  }

  if (!ready) {
    return <div className="privy-vault-empty">INITIALIZING PRIVY…</div>;
  }
  if (!authenticated) {
    return (
      <section className="privy-login panel-frame">
        <p>SEPOLIA / PRIVY SIGNER</p>
        <h2>Open the testnet recovery vault.</h2>
        <span>
          Privy authorizes Starknet hashes. Viewing keys and recovered notes
          remain in this browser. The app bootstrap receives public account
          metadata, the relay sees OHTTP ciphertext, and the remote prover sees
          the decrypted witness.
        </span>
        <button type="button" onClick={login}>CONNECT PRIVY IDENTITY →</button>
      </section>
    );
  }

  const currentPrivate = selected ? privateState[selected.walletId] : undefined;
  const privateTotal = currentPrivate?.balances
    ?.filter(
      (balance) =>
        bootstrapQuery.data &&
        BigInt(balance.token) === BigInt(bootstrapQuery.data.strkToken),
    )
    .reduce((sum, balance) => sum + balance.amount, 0n);
  const notes = currentPrivate?.balances?.flatMap((balance) =>
    balance.notes.map((note) => ({ ...note, balanceToken: balance.token })),
  ) ?? [];
  const actionDisabled = Boolean(busy) || !walletsReady || !selected;
  const buildOnly = bootstrapQuery.data?.submissionMode !== "live";

  return (
    <div className="privy-vault-layout">
      <aside className="privy-account-rail panel-frame">
        <div className="panel-heading">
          <span>PRIVY / SEPOLIA</span>
          <strong>Testnet accounts</strong>
        </div>
        <div className="privy-account-list">
          {(bootstrapQuery.data?.wallets ?? []).map((wallet, index) => {
            const address = bootstrapQuery.data
              ? computeBrowserAccountAddress(
                  wallet.publicKey,
                  bootstrapQuery.data.readyClassHash,
                )
              : wallet.privyAddress;
            return (
              <button
                type="button"
                className={wallet.walletId === selectedId ? "is-active" : ""}
                key={wallet.walletId}
                onClick={() => setSelectedId(wallet.walletId)}
              >
                <small>{String(index + 1).padStart(2, "0")}</small>
                <span><b>{wallet.displayName ?? `ACCOUNT ${index + 1}`}</b><code>{short(address)}</code></span>
                <em>{authorizationLabel(wallet.authorization.kind)}</em>
              </button>
            );
          })}
        </div>
        <button type="button" className="rail-button" onClick={addWallet} disabled={Boolean(busy)}>
          + USER-ONLY ACCOUNT
        </button>
        <button type="button" className="rail-button" onClick={handleLogout}>
          DISCONNECT PRIVY
        </button>
      </aside>

      <section className="privy-vault-workspace">
        <div className="privy-metrics panel-frame">
          <article><span>PUBLIC STRK</span><strong>{formatUnits(accountQuery.data?.balance, 18, 5)}</strong><small>VISIBLE ON SEPOLIA</small></article>
          <article><span>SHIELDED STRK</span><strong>{formatUnits(privateTotal, 18, 5)}</strong><small>{currentPrivate?.status === "ready" ? `${notes.length} NOTE(S)` : "EXPLICIT SCAN REQUIRED"}</small></article>
          <article><span>SUBMISSION</span><strong>{bootstrapQuery.data?.submissionMode === "live" ? "LIVE" : "BUILD"}</strong><small>PRIVY IS NEVER ENABLED FOR MAINNET</small></article>
        </div>

        <section className="privy-account-panel panel-frame">
          <div className="panel-heading">
            <span>STARKNET ACCOUNT ADDRESS</span>
            <strong>{selectedAddress ? short(selectedAddress, 12, 10) : "NO ACCOUNT"}</strong>
          </div>
          {selected?.authorization.kind === "shared-recovery" ? (
            <div className="vault-warning">Legacy application signer detected. Recover funds and rotate that authorization.</div>
          ) : null}
          <div className="privy-account-facts">
            <span><small>DEPLOYMENT</small><b>{accountQuery.data?.deployed ? "DEPLOYED" : "COUNTERFACTUAL"}</b></span>
            <span><small>QUORUM</small><b>{selected ? `${selected.authorization.threshold}/${selected.authorization.userSignerCount + selected.authorization.appSignerCount}` : "—"}</b></span>
            <span><small>SECURE SIGNER</small><b>{walletsReady ? "READY" : "INITIALIZING"}</b></span>
          </div>
          {buildOnly ? (
            <div className="vault-warning">
              BUILD-ONLY SAFETY MODE: proofs and calls may be reviewed, but no
              private transaction will be submitted.
            </div>
          ) : null}
          <div className="privy-operation-inputs">
            <label><span>AMOUNT / STRK</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" /></label>
            <label><span>RECIPIENT / BLANK = SELF UNSHIELD</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" spellCheck={false} /></label>
          </div>
          <div className="privy-operation-actions">
            {!accountQuery.data?.deployed ? <button type="button" onClick={() => runAction("deploy")} disabled={actionDisabled}>DEPLOY</button> : null}
            <button type="button" onClick={() => runAction("register")} disabled={actionDisabled || !accountQuery.data?.deployed}>{buildOnly ? "BUILD REGISTER" : "REGISTER"}</button>
            <button type="button" onClick={() => runAction("shield")} disabled={actionDisabled || !accountQuery.data?.deployed}>{buildOnly ? "BUILD SHIELD ↓" : "SHIELD ↓"}</button>
            <button type="button" onClick={() => runAction("transfer")} disabled={actionDisabled || !accountQuery.data?.deployed || !recipient.trim()}>{buildOnly ? "BUILD PRIVATE SEND →" : "SEND PRIVATE →"}</button>
            <button type="button" onClick={() => runAction("unshield")} disabled={actionDisabled || !accountQuery.data?.deployed}>{buildOnly ? "BUILD UNSHIELD ↑" : "UNSHIELD ↑"}</button>
            <button type="button" onClick={() => scanPrivate()} disabled={actionDisabled || !accountQuery.data?.deployed}>RECOVER BALANCE</button>
          </div>
        </section>

        <section className="privy-note-panel panel-frame">
          <div className="panel-heading"><span>BROWSER ONLY</span><strong>Recovered notes</strong></div>
          {notes.length ? (
            <div className="privy-note-table">
              <div><span>NOTE</span><span>AMOUNT</span><span>BLOCK</span><span>STATE</span></div>
              {notes.map((note, index) => (
                <div key={`${note.id}:${index}`}>
                  <details><summary>{short(note.id, 10, 7)}</summary><code>{note.id}</code></details>
                  <strong>{formatUnits(note.amount, 18, 6)} STRK</strong>
                  <span>{note.created === undefined ? "—" : `#${note.created}`}</span>
                  <span>{note.mature ? "MATURE" : "WAITING"}</span>
                </div>
              ))}
            </div>
          ) : <p className="vault-empty-copy">No private state is displayed until you explicitly authorize a local scan.</p>}
        </section>
      </section>

      <aside className="privy-status-rail panel-frame">
        <div className="panel-heading"><span>RECOVERY</span><strong>Trust state</strong></div>
        <div className="privy-trust-list">
          <span><small>NETWORK</small><b>SEPOLIA ONLY</b></span>
          <span><small>RELAY</small><b>OHTTP CIPHERTEXT</b></span>
          <span><small>APP BACKEND</small><b>NO WITNESS</b></span>
          <span><small>REMOTE PROVER</small><b>SEES WITNESS</b></span>
        </div>
        <button type="button" onClick={backupWallet} disabled={!selected || Boolean(busy)}>EXPORT ACTIVE WALLET</button>
        <p className="vault-disclosure">The remote prover sees the decrypted witness after OHTTP decapsulation. Mail plaintext is separately encrypted before proving.</p>
        {busy ? <div className="vault-progress">{busy}</div> : null}
        {error ?? clientState.error ?? bootstrapQuery.error ? <div className="vault-error">{error ?? clientState.error ?? safeError(bootstrapQuery.error)}</div> : null}
        <div className="privy-activity">
          <strong>LOCAL ACTIVITY</strong>
          {activities.map((activity) => (
            <span key={activity.id}>{activity.label}{activity.transactionHash ? <a href={`https://sepolia.voyager.online/tx/${activity.transactionHash}`} target="_blank" rel="noreferrer">RECEIPT ↗</a> : null}</span>
          ))}
        </div>
      </aside>
    </div>
  );
}

export default function PrivySepoliaVault() {
  if (!PRIVY_APP_ID || !PRIVY_CLIENT_ID) {
    return <div className="privy-vault-empty">PRIVY SEPOLIA IS NOT CONFIGURED</div>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{ embeddedWallets: { ethereum: { createOnLogin: "off" } } }}
    >
      <PrivySepoliaVaultContent />
    </PrivyProvider>
  );
}
