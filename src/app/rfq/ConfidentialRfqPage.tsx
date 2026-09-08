import { lazy, Suspense, useEffect, useState } from "react";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { MAINNET_DEPLOYMENT } from "@/lib/mainnet-deployment";
import { parseDecimalToBaseUnits, formatBaseUnits } from "@/lib/otc";
import { feltEquals } from "@/lib/addresses";
import { useConfidentialTrading } from "./useConfidentialTrading";
import desk from "./rfq.module.css";
import styles from "./confidential-rfq.module.css";

const LocalLab = import.meta.env.DEV && import.meta.env.VITE_CONFIDENTIAL_RFQ_LAB
  ? lazy(() => import("@/dev/confidential/ConfidentialLab")) : undefined;
const tokens = [MAINNET_DEPLOYMENT.sellToken, MAINNET_DEPLOYMENT.buyToken];
type Trading = ReturnType<typeof useConfidentialTrading>;
type Room = Trading["rooms"][number];
type Action = "advance" | "recover" | "refund";
const stateNames: Record<Room["state"], string> = {
  requesting: "Waiting for a quote", quote: "Quote received", deploying: "Setting up your swap", setup: "Private setup ready",
  fund: "Ready to fund", waiting: "Waiting for the other side", settle: "Ready to settle", settled: "Swap settled",
  refundable: "Funds can be recovered", refunded: "Funds recovered", declined: "Quote declined", attention: "Check this swap",
};
const actionNames: Partial<Record<Room["state"], string>> = {
  quote: "Review & set up swap", setup: "Approve private setup", fund: "Fund my side", settle: "Review & settle",
  attention: "Check transaction", refundable: "Recover my funds", waiting: "Check status",
};
function tokenFor(address: string) { return tokens.find(token => feltEquals(token.address, address)); }
function amountLabel(value: string | undefined, address: string) {
  const token = tokenFor(address);
  if (value === undefined) return "Awaiting quote";
  if (!/^\d{1,78}$/.test(value)) return "Amount unavailable";
  return token ? `${formatBaseUnits(value, token.decimals)} ${token.symbol}` : `${value} base units`;
}
function readAmount(value: string, decimals: number) {
  if (!value.trim()) return { error: "", units: undefined };
  try {
    if (value.length > 96) throw new Error("Enter a shorter amount.");
    const units = parseDecimalToBaseUnits(value, decimals);
    if (BigInt(units) >= 2n ** 128n) throw new Error("This amount is too large for a confidential swap.");
    return { units, error: "" };
  } catch (error) { return { units: undefined, error: error instanceof Error ? error.message : "Enter a valid amount." }; }
}
function Deadline({ value }: { value: number }) {
  const date = new Date(value * 1000);
  return <time dateTime={date.toISOString()}>{date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</time>;
}
function orderedQuotes(rooms: Room[]) {
  const groups = new Map<string, Room[]>();
  for (const room of rooms) {
    const key = `${room.sellToken}/${room.buyToken}/${room.sellAmount}/${room.minimumAmount}`;
    groups.set(key, [...(groups.get(key) ?? []), room]);
  }
  return [...groups.values()].flatMap(group => [...group].sort((a, b) => {
    const left = /^\d{1,78}$/.test(a.buyAmount ?? "") ? BigInt(a.buyAmount!) : -1n;
    const right = /^\d{1,78}$/.test(b.buyAmount ?? "") ? BigInt(b.buyAmount!) : -1n;
    return left === right ? 0 : left > right ? -1 : 1;
  }));
}
function RoomCard({ room, now, disabled, onAction }: { room: Room; now: number; disabled: boolean; onAction(action: Action, id: string): void }) {
  const expiredQuote = room.state === "quote" && room.quoteExpiresAt !== undefined && room.quoteExpiresAt <= now;
  const expiredSwap = room.deadline !== undefined && room.deadline <= now;
  const valueAction = ["quote", "setup", "fund", "settle"].includes(room.state);
  const termsReady = !!tokenFor(room.sellToken) && !!tokenFor(room.buyToken) && /^\d{1,78}$/.test(room.buyAmount ?? "") && /^\d{1,78}$/.test(room.minimumAmount) && BigInt(room.buyAmount!) >= BigInt(room.minimumAmount) && !!room.deadline;
  const label = actionNames[room.state];
  const action: Action = room.state === "refundable" ? "refund" : room.state === "attention" || room.state === "waiting" ? "recover" : "advance";
  const waitingForExpiryRefresh = valueAction && expiredSwap && room.state !== "quote";
  const hash = room.transactionHash && /^0x[0-9a-f]{1,64}$/i.test(room.transactionHash) ? room.transactionHash : undefined;
  return <article className={styles.roomCard} aria-label={`Swap with ${room.makerName}`}>
    <header className={styles.roomHeading}>
      <h4>{room.makerName}</h4>
      <span className={styles.roomState} data-state={room.state}>{expiredQuote ? "Quote expired" : stateNames[room.state]}</span>
    </header>
    <dl className={styles.roomAmounts}>
      <div><dt>You sell</dt><dd>{amountLabel(room.sellAmount, room.sellToken)}</dd></div>
      <div><dt>You receive</dt><dd>{amountLabel(room.buyAmount, room.buyToken)}</dd></div>
      <div><dt>Your minimum</dt><dd>{amountLabel(room.minimumAmount, room.buyToken)}</dd></div>
      {room.deadline !== undefined && <div><dt>Refund available after</dt><dd><Deadline value={room.deadline} /></dd></div>}
    </dl>
    <div className={styles.counterparty}><span>Counterparty</span><code>{room.makerAddress}</code></div>
    {room.state === "quote" && room.quoteExpiresAt !== undefined && <p className={styles.roomNote}>Quote valid until <Deadline value={room.quoteExpiresAt} />.</p>}
    {room.message && <p className={styles.roomNote}>{room.message}</p>}
    {room.state === "quote" && !expiredQuote && <p className={styles.roomNote}>Set up the agreed swap first. Funding your side is a separate approval.</p>}
    {room.state === "setup" && <p className={styles.roomNote}>Approve the shared escrow setup. This step does not transfer your trade amount.</p>}
    {room.state === "fund" && <p className={styles.roomNote}>Move {amountLabel(room.sellAmount, room.sellToken)} from your shielded balance into this swap. After the deadline, you can recover your side if the swap has not settled.</p>}
    {room.state === "settle" && <p className={styles.roomNote}>Approve these exact terms to settle both assets together as encrypted notes.</p>}
    {valueAction && !expiredQuote && <p className={styles.roomNote}>Review the pool and network fees in your wallet before approving.</p>}
    {expiredQuote && <p className={styles.roomNote}>Request a fresh quote to continue.</p>}
    {waitingForExpiryRefresh && <p className={styles.roomNote}>The deadline has passed. Check the transaction before recovering your funds.</p>}
    <div className={styles.roomActions}>
      {label && !expiredQuote && !waitingForExpiryRefresh && <button type="button" className={styles.roomAction} disabled={disabled || (valueAction && (!termsReady || expiredSwap))} onClick={() => onAction(action, room.id)}>{label}</button>}
      {waitingForExpiryRefresh && <button type="button" className={styles.roomAction} disabled={disabled} onClick={() => onAction("recover", room.id)}>Check transaction</button>}
      {hash && <a href={`https://voyager.online/tx/${hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}
    </div>
  </article>;
}
function TradingTicket() {
  const trading = useConfidentialTrading();
  const [reverse, setReverse] = useState(false), [sell, setSell] = useState(""), [minimum, setMinimum] = useState(""), [maker, setMaker] = useState("");
  const [localError, setLocalError] = useState<string | null>(null), [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(timer); }, []);
  const sellToken = tokens[reverse ? 1 : 0]!, buyToken = tokens[reverse ? 0 : 1]!;
  const sellInput = readAmount(sell, sellToken.decimals), minimumInput = readAmount(minimum, buyToken.decimals);
  const validAmounts = sellInput.units !== undefined && minimumInput.units !== undefined;
  const makers = trading.makers.filter(value => value.expiresAt > now);
  const selectedMaker = makers.find(value => value.account === maker)?.account;
  const busy = trading.busy !== null;
  const busyMessage = trading.busy === "quotes" ? "Requesting quotes…" : "Waiting for your wallet and the network…";
  const activeQuotes = orderedQuotes(trading.rooms.filter(room => room.state === "quote" || room.state === "requesting"));
  const records = trading.rooms.filter(room => room.state !== "quote" && room.state !== "requesting");
  const availability = !validAmounts ? "Enter the amount to sell and the minimum you want to receive."
    : !trading.connected ? "Connect your wallet to request private quotes."
    : !trading.compatible ? "Use a Ready wallet with STRK20 support on Starknet mainnet."
    : makers.length === 0 ? "No makers are online right now. Refresh to check again."
    : `Request an encrypted quote from ${selectedMaker ? "your selected maker" : `${makers.length} available ${makers.length === 1 ? "maker" : "makers"}`}.`;
  const invoke = (work: () => unknown) => { setLocalError(null); void Promise.resolve().then(work).catch(error => setLocalError(error instanceof Error ? error.message : "The action did not finish. Check this swap before trying again.")); };
  const onAction = (action: Action, id: string) => invoke(() => trading[action](id));
  return <section className={`${desk.privateIntentDesk} ${styles.ticket}`} aria-label="Confidential swap">
    <header className={desk.privateIntentHeader}>
      <h2 className={styles.ticketTitle}>Instant RFQ</h2>
      <div className={desk.ticketPromise}><span>Confidential swap</span></div>
    </header>
    <form className={desk.privateIntentForm} onSubmit={event => {
      event.preventDefault();
      if (!validAmounts || busy) return;
      if (!trading.connected) { useStoreWallet.getState().setSelectWalletUI(true); return; }
      if (!trading.compatible || !makers.length) return;
      invoke(() => trading.requestQuotes({ sellToken: sellToken.address, buyToken: buyToken.address, sellAmount: sellInput.units!, minimumAmount: minimumInput.units!, ...(selectedMaker ? { maker: selectedMaker } : {}) }));
    }}>
      <div className={desk.swapAssetStack}>
        <label className={desk.swapAssetCard}>
          <span className={desk.swapAssetHead}><b>You sell</b><small>Shielded balance</small></span>
          <span className={desk.swapAssetControl}><input aria-label={`You sell (${sellToken.symbol})`} aria-invalid={!!sellInput.error} aria-describedby={sellInput.error ? "rfq-sell-error" : undefined} inputMode="decimal" maxLength={96} placeholder="0.00" value={sell} onChange={event => setSell(event.target.value)} autoComplete="off" /><strong>{sellToken.symbol}</strong></span>
        </label>
        <button className={desk.swapDirection} type="button" aria-label="Reverse swap direction" title="Reverse swap direction" disabled={busy} onClick={() => { setReverse(value => !value); setSell(""); setMinimum(""); }}>⇅</button>
        <label className={desk.swapAssetCard}>
          <span className={desk.swapAssetHead}><b>Minimum receive</b><small>Set by you</small></span>
          <span className={desk.swapAssetControl}><input aria-label={`Minimum you receive (${buyToken.symbol})`} aria-invalid={!!minimumInput.error} aria-describedby={minimumInput.error ? "rfq-minimum-error" : undefined} inputMode="decimal" maxLength={96} placeholder="0.00" value={minimum} onChange={event => setMinimum(event.target.value)} autoComplete="off" /><strong>{buyToken.symbol}</strong></span>
        </label>
      </div>
      {sellInput.error && <p id="rfq-sell-error" className={styles.inputError}>Sell amount: {sellInput.error}</p>}
      {minimumInput.error && <p id="rfq-minimum-error" className={styles.inputError}>Minimum receive: {minimumInput.error}</p>}
      <label className={styles.makerField}>Quote from<select aria-label="Quote from" value={selectedMaker ?? ""} disabled={busy || makers.length === 0} onChange={event => setMaker(event.target.value)}><option value="">Best available makers</option>{makers.map(value => <option key={value.account} value={value.account}>{value.name}</option>)}</select></label>
      <button className={desk.privateIntentQuoteButton} type="submit" disabled={!validAmounts || busy || (trading.connected && (!trading.compatible || makers.length === 0))} aria-describedby="rfq-availability">Request quotes</button>
      <p id="rfq-availability" className={styles.availability}>{availability}</p>
      {busy && <p className={styles.tradingStatus} role="status">{busyMessage}</p>}
      {(localError || trading.error) && <p className={styles.inputError} role="alert">{localError || trading.error}</p>}
    </form>
    <section className={styles.swapRecords} aria-label="Active quotes">
      <div className={styles.recordsHeading}><h3>Active quotes</h3><button type="button" className={styles.refreshButton} disabled={busy} onClick={() => invoke(trading.refresh)}>Refresh</button></div>
      {activeQuotes.length ? <div className={styles.roomList}>{activeQuotes.map(room => <RoomCard key={room.id} room={room} now={now} disabled={busy || !trading.connected || !trading.compatible} onAction={onAction} />)}</div> : <p>Quotes will appear here, with the best return first for the same trade.</p>}
    </section>
    <section className={styles.swapRecords} aria-label="Swap records">
      <h3>Swap records</h3>
      {records.length ? <div className={styles.roomList}>{records.map(room => <RoomCard key={room.id} room={room} now={now} disabled={busy || !trading.connected || !trading.compatible} onAction={onAction} />)}</div> : <p>{trading.connected ? "Your swaps will appear here." : "Connect your wallet to see your swaps."}</p>}
    </section>
    <details className={styles.privacyDetails}>
      <summary>Privacy &amp; fees</summary>
      <p>Quotes stay between counterparties. Both sides approve the same terms; both assets settle together as encrypted notes.</p>
      <p>Activity, timing and fees remain public. Shielding and unshielding reveal their token amounts. A hosted proving service can access the private data it proves.</p>
      <p>Funding is a separate approval. Review the final amounts and wallet fees before continuing. Keep this browser’s saved swap data until settlement or recovery is complete.</p>
    </details>
  </section>;
}
export default function ConfidentialRfqPage() {
  return <main className={`${desk.page} ${styles.ticketPage}`} aria-label="Confidential RFQ">
    <h1 className={desk.workspaceTitle}>Confidential RFQ</h1>
    {LocalLab ? <div className={styles.labWorkspace}><Suspense fallback={<p>Opening your workspace…</p>}><LocalLab /></Suspense></div> : <TradingTicket />}
  </main>;
}
