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
import styles from "./privy-vault.module.css";

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
    return (
      <section className={styles.statePanel} aria-live="polite">
        <div className={styles.stateTopline}>
          <span className={styles.stateDot} aria-hidden="true" />
          <span>SEPOLIA RECOVERY DESK</span>
        </div>
        <div className={styles.stateCopy}>
          <p className={styles.eyebrow}>PRIVY SIGNER INITIALIZATION</p>
          <h2>Preparing the browser signer.</h2>
          <p>
            APP20 is waiting for Privy and the embedded Starknet wallet proxy.
            No proof, discovery scan, or signing request has started.
          </p>
        </div>
        <dl className={styles.stateFacts}>
          <div><dt>NETWORK</dt><dd>SEPOLIA ONLY</dd></div>
          <div><dt>SUBMISSION</dt><dd>BUILD-ONLY BY DEFAULT</dd></div>
          <div><dt>FALLBACK</dt><dd>NONE</dd></div>
        </dl>
      </section>
    );
  }

  if (!authenticated) {
    return (
      <section className={styles.loginPanel} aria-labelledby="privy-login-title">
        <header className={styles.loginHeader}>
          <div>
            <p className={styles.eyebrow}>SEPOLIA / PRIVY SIGNER</p>
            <h2 id="privy-login-title">Open the testnet recovery vault.</h2>
            <p className={styles.loginLead}>
              A separate recovery desk for browser-owned Sepolia accounts. It
              never selects a Ready account and cannot request a Mainnet
              signature, proof, discovery scan, or submission.
            </p>
          </div>
          <span className={styles.safetyPill}>TESTNET ONLY</span>
        </header>

        <div className={styles.loginBody}>
          <dl className={styles.loginGuardrails}>
            <div>
              <dt>IDENTITY</dt>
              <dd>Privy authorizes Starknet hashes after explicit login.</dd>
            </div>
            <div>
              <dt>PRIVATE STATE</dt>
              <dd>Viewing keys and recovered notes stay in this browser.</dd>
            </div>
            <div>
              <dt>NETWORK RAIL</dt>
              <dd>Hard-bound to Starknet Sepolia; Ready is not a fallback.</dd>
            </div>
            <div>
              <dt>PROVER TRUST</dt>
              <dd>The final remote prover sees the witness after OHTTP.</dd>
            </div>
          </dl>
          <div className={styles.loginAction}>
            <span>RECOVERY SESSION</span>
            <strong>Identity first. Private scan only when requested.</strong>
            <p>
              The bootstrap receives public account metadata. The relay sees
              OHTTP ciphertext, not recovered notes or viewing keys.
            </p>
            <button className={styles.primaryAction} type="button" onClick={login}>
              SIGN IN TO PRIVY <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
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
  const wallets = bootstrapQuery.data?.wallets ?? [];
  const visibleError =
    error ??
    clientState.error ??
    (bootstrapQuery.error ? safeError(bootstrapQuery.error) : undefined);

  return (
    <div className={styles.layout}>
      <aside className={`${styles.panel} ${styles.accountRail}`} aria-label="Privy Sepolia accounts">
        <header className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionKicker}>PRIVY / SEPOLIA</span>
            <strong className={styles.sectionTitle}>Recovery accounts</strong>
          </div>
          <span className={styles.sectionMeta}>{wallets.length} ON FILE</span>
        </header>

        <div className={styles.accountList}>
          {wallets.map((wallet, index) => {
            const address = bootstrapQuery.data
              ? computeBrowserAccountAddress(
                  wallet.publicKey,
                  bootstrapQuery.data.readyClassHash,
                )
              : wallet.privyAddress;
            const active = wallet.walletId === selectedId;
            return (
              <button
                type="button"
                className={`${styles.accountButton} ${active ? styles.activeAccount : ""}`}
                key={wallet.walletId}
                onClick={() => setSelectedId(wallet.walletId)}
                aria-pressed={active}
              >
                <span className={styles.accountIndex}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={styles.accountIdentity}>
                  <b className={styles.accountName}>
                    {wallet.displayName ?? `ACCOUNT ${index + 1}`}
                  </b>
                  <code className={styles.accountAddress}>{short(address)}</code>
                  <em className={styles.authTag}>
                    {authorizationLabel(wallet.authorization.kind)}
                  </em>
                </span>
                <span className={styles.accountChevron} aria-hidden="true">›</span>
              </button>
            );
          })}
          {!wallets.length && !bootstrapQuery.isLoading ? (
            <div className={styles.emptyAccounts}>
              <strong>NO STARKNET ACCOUNTS</strong>
              <span>Create a user-only Sepolia wallet to begin recovery.</span>
            </div>
          ) : null}
          {bootstrapQuery.isLoading ? (
            <div className={styles.emptyAccounts} aria-live="polite">
              <strong>LOADING ACCOUNT REGISTRY</strong>
              <span>Reading public wallet and quorum metadata.</span>
            </div>
          ) : null}
        </div>

        <div className={styles.railActions}>
          <button
            type="button"
            className={styles.railButton}
            onClick={addWallet}
            disabled={Boolean(busy)}
          >
            <span aria-hidden="true">＋</span> USER-ONLY ACCOUNT
          </button>
          <button
            type="button"
            className={`${styles.railButton} ${styles.railButtonSecondary}`}
            onClick={handleLogout}
          >
            DISCONNECT PRIVY
          </button>
        </div>
      </aside>

      <section className={styles.workspace} aria-label="Sepolia vault workspace">
        <section className={`${styles.panel} ${styles.metrics}`} aria-label="Vault balances">
          <article className={styles.metric}>
            <span className={styles.metricLabel}>PUBLIC STRK</span>
            <strong className={styles.metricValue}>
              {formatUnits(accountQuery.data?.balance, 18, 5)}
            </strong>
            <small className={styles.metricMeta}>VISIBLE ON SEPOLIA</small>
          </article>
          <article className={`${styles.metric} ${styles.privateMetric}`}>
            <span className={styles.metricLabel}>SHIELDED STRK</span>
            <strong className={styles.metricValue}>
              {formatUnits(privateTotal, 18, 5)}
            </strong>
            <small className={styles.metricMeta}>
              {currentPrivate?.status === "ready"
                ? `${notes.length} NOTE(S) RECOVERED`
                : "EXPLICIT SCAN REQUIRED"}
            </small>
          </article>
          <article className={styles.metric}>
            <span className={styles.metricLabel}>SUBMISSION MODE</span>
            <strong className={styles.metricValue}>
              {buildOnly ? "BUILD" : "LIVE"}
            </strong>
            <small className={styles.metricMeta}>NEVER ENABLED FOR MAINNET</small>
          </article>
        </section>

        <section className={`${styles.panel} ${styles.accountPanel}`} aria-labelledby="privy-account-title">
          <header className={styles.sectionHeader}>
            <div className={styles.addressHeading}>
              <span className={styles.sectionKicker}>STARKNET ACCOUNT / SEPOLIA</span>
              <strong className={styles.sectionTitle} id="privy-account-title">
                Active recovery account
              </strong>
            </div>
          </header>

          {selected?.authorization.kind === "shared-recovery" ? (
            <div className={styles.warning} role="status">
              <strong>LEGACY APPLICATION SIGNER</strong>
              <span>Recover funds, then rotate this shared authorization.</span>
            </div>
          ) : null}

          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>DEPLOYMENT</dt>
              <dd>{accountQuery.data?.deployed ? "DEPLOYED" : "COUNTERFACTUAL"}</dd>
            </div>
            <div className={styles.fact}>
              <dt>QUORUM</dt>
              <dd>
                {selected
                  ? `${selected.authorization.threshold}/${
                      selected.authorization.userSignerCount +
                      selected.authorization.appSignerCount
                    }`
                  : "—"}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>SECURE SIGNER</dt>
              <dd>{walletsReady ? "READY" : "INITIALIZING"}</dd>
            </div>
          </dl>

          {buildOnly ? (
            <div className={`${styles.warning} ${styles.buildWarning}`} role="status">
              <strong>BUILD-ONLY SAFETY MODE</strong>
              <span>
                Proofs and calls can be reviewed. No private transaction will
                be submitted from this rail.
              </span>
            </div>
          ) : null}

          <div className={styles.operationInputs}>
            <label className={styles.field}>
              <span>AMOUNT / STRK</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                aria-label="STRK amount"
              />
            </label>
            <label className={`${styles.field} ${styles.recipientField}`}>
              <span>RECIPIENT / BLANK = SELF UNSHIELD</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                aria-label="Recipient address"
              />
            </label>
          </div>

          <div className={styles.operationActions}>
            {accountQuery.data?.deployed ? null : (
              <button
                className={styles.actionButton}
                type="button"
                onClick={() => runAction("deploy")}
                disabled={actionDisabled}
              >
                DEPLOY ACCOUNT
              </button>
            )}
            <button
              className={styles.actionButton}
              type="button"
              onClick={() => runAction("register")}
              disabled={actionDisabled || !accountQuery.data?.deployed}
            >
              {buildOnly ? "BUILD REGISTER" : "REGISTER"}
            </button>
            <button
              className={`${styles.actionButton} ${styles.actionPrimary}`}
              type="button"
              onClick={() => runAction("shield")}
              disabled={actionDisabled || !accountQuery.data?.deployed}
            >
              {buildOnly ? "BUILD SHIELD ↓" : "SHIELD ↓"}
            </button>
            <button
              className={styles.actionButton}
              type="button"
              onClick={() => runAction("transfer")}
              disabled={
                actionDisabled ||
                !accountQuery.data?.deployed ||
                !recipient.trim()
              }
            >
              {buildOnly ? "BUILD PRIVATE SEND →" : "SEND PRIVATE →"}
            </button>
            <button
              className={styles.actionButton}
              type="button"
              onClick={() => runAction("unshield")}
              disabled={actionDisabled || !accountQuery.data?.deployed}
            >
              {buildOnly ? "BUILD UNSHIELD ↑" : "UNSHIELD ↑"}
            </button>
            <button
              className={`${styles.actionButton} ${styles.recoverAction}`}
              type="button"
              onClick={() => scanPrivate()}
              disabled={actionDisabled || !accountQuery.data?.deployed}
            >
              RECOVER BALANCE
            </button>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.notePanel}`} aria-labelledby="recovered-notes-title">
          <header className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionKicker}>BROWSER-OWNED STATE</span>
              <strong className={styles.sectionTitle} id="recovered-notes-title">
                Recovered notes
              </strong>
            </div>
            <span className={styles.sectionMeta}>
              {currentPrivate?.status === "scanning" ? "SCANNING" : `${notes.length} LOCAL`}
            </span>
          </header>
          {notes.length ? (
            <div className={styles.noteTable} role="table" aria-label="Recovered private notes">
              <div className={styles.tableHeader} role="row">
                <span role="columnheader">NOTE</span>
                <span role="columnheader">AMOUNT</span>
                <span role="columnheader">BLOCK</span>
                <span role="columnheader">STATE</span>
              </div>
              {notes.map((note, index) => (
                <div className={styles.tableRow} role="row" key={`${note.id}:${index}`}>
                  <div className={styles.noteId} role="cell">
                    <details>
                      <summary>{short(note.id, 10, 7)}</summary>
                      <code>{note.id}</code>
                    </details>
                  </div>
                  <strong className={styles.noteAmount} role="cell">
                    {formatUnits(note.amount, 18, 6)} STRK
                  </strong>
                  <span role="cell">
                    {note.created === undefined ? "—" : `#${note.created}`}
                  </span>
                  <span
                    className={note.mature ? styles.matureState : styles.waitingState}
                    role="cell"
                  >
                    {note.mature ? "MATURE" : "WAITING"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyNotes}>
              <span className={styles.emptyNoteMark} aria-hidden="true">◇</span>
              <div>
                <strong>NO PRIVATE STATE DISPLAYED</strong>
                <p>
                  Notes remain hidden until you explicitly authorize a local
                  recovery scan for this account.
                </p>
              </div>
            </div>
          )}
        </section>
      </section>

      <aside className={`${styles.panel} ${styles.statusRail}`} aria-label="Privy trust state">
        <header className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionKicker}>RECOVERY BOUNDARY</span>
            <strong className={styles.sectionTitle}>Trust state</strong>
          </div>
          <span className={styles.testnetMarker}>SEP</span>
        </header>

        <dl className={styles.trustList}>
          <div className={styles.trustRow}>
            <dt>NETWORK</dt><dd className={styles.goodState}>SEPOLIA ONLY</dd>
          </div>
          <div className={styles.trustRow}>
            <dt>SUBMISSION</dt><dd>{buildOnly ? "BUILD-ONLY" : "LIVE / SEPOLIA"}</dd>
          </div>
          <div className={styles.trustRow}>
            <dt>RELAY</dt><dd>OHTTP CIPHERTEXT</dd>
          </div>
          <div className={styles.trustRow}>
            <dt>APP BACKEND</dt><dd>NO WITNESS</dd>
          </div>
          <div className={styles.trustRow}>
            <dt>REMOTE PROVER</dt><dd className={styles.cautionState}>SEES WITNESS</dd>
          </div>
          <div className={styles.trustRow}>
            <dt>READY FALLBACK</dt><dd>DISABLED</dd>
          </div>
        </dl>

        <button
          className={styles.exportAction}
          type="button"
          onClick={backupWallet}
          disabled={!selected || Boolean(busy)}
        >
          EXPORT ACTIVE WALLET
        </button>

        <p className={styles.disclosure}>
          The remote prover sees the decrypted witness after OHTTP
          decapsulation. Mail plaintext is separately encrypted before proving.
        </p>

        {busy ? (
          <div className={styles.progress} role="status">
            <span className={styles.progressDot} aria-hidden="true" />
            {busy}
          </div>
        ) : null}
        {visibleError ? (
          <div className={styles.error} role="alert">{visibleError}</div>
        ) : null}

        <section className={styles.activity} aria-labelledby="privy-activity-title">
          <header className={styles.activityHeader}>
            <strong id="privy-activity-title">LOCAL ACTIVITY</strong>
            <span>{activities.length}/6</span>
          </header>
          {activities.map((activity) => (
            <div className={styles.activityItem} key={activity.id}>
              <span>{activity.label}</span>
              {activity.transactionHash ? (
                <a
                  className={styles.activityLink}
                  href={`https://sepolia.voyager.online/tx/${activity.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  RECEIPT ↗
                </a>
              ) : null}
            </div>
          ))}
          {activities.length ? null : (
            <p className={styles.emptyActivity}>No local vault activity yet.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

export default function PrivySepoliaVault() {
  if (!PRIVY_APP_ID || !PRIVY_CLIENT_ID) {
    return (
      <section className={styles.unconfiguredPanel} aria-labelledby="privy-unconfigured-title">
        <header className={styles.unconfiguredHeader}>
          <div>
            <p className={styles.eyebrow}>SEPOLIA / PRIVY RECOVERY</p>
            <h2 id="privy-unconfigured-title">Recovery vault not configured.</h2>
          </div>
          <span className={styles.blockedPill}>OFFLINE</span>
        </header>
        <p className={styles.unconfiguredLead}>
          This rail stays unavailable until the public Privy application IDs
          and reviewed OHTTP key pins are configured. APP20 will not fall back
          to a different Ready account.
        </p>
        <dl className={styles.configChecklist}>
          <div>
            <dt>PUBLIC APP ID</dt>
            <dd className={PRIVY_APP_ID ? styles.configReady : styles.configMissing}>
              {PRIVY_APP_ID ? "PRESENT" : "MISSING"}
            </dd>
          </div>
          <div>
            <dt>PUBLIC CLIENT ID</dt>
            <dd className={PRIVY_CLIENT_ID ? styles.configReady : styles.configMissing}>
              {PRIVY_CLIENT_ID ? "PRESENT" : "MISSING"}
            </dd>
          </div>
          <div>
            <dt>NETWORK</dt>
            <dd>SEPOLIA ONLY</dd>
          </div>
          <div>
            <dt>MAINNET ACCESS</dt>
            <dd>NOT AVAILABLE</dd>
          </div>
        </dl>
        <p className={styles.unconfiguredNote}>
          Only public identifiers belong in <code>VITE_*</code>. Prover,
          discovery, RPC origins, authorization, and private keys remain Worker
          secrets and are never requested here.
        </p>
      </section>
    );
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
