import { useEffect, useRef, useState } from 'react';
import { RpcProvider } from 'starknet';
import { defaultMakerConfig } from '@/lib/mainnet-maker-config';
import { useStoreWallet } from '@/app/components/Wallet/walletContext';
import { useFrontendProvider } from '@/app/components/client/provider/providerContext';
import { providerIndexForChain } from '@/utils/constants';
import { amount, decodeAnswer, felt, generateTransportKey, open, publicKey, randomRequestId, requestCall, seal, coordinatesKey, type MakerAnswer } from '@app20/private-intents/starknet-maker';
import { readMakerAnswer, readMakerPage, verifyMakerBook, type MakerBookConfig, type RegisteredMaker } from '@/lib/starknet-maker-client';
import { beginMakerSettlement, loadMakerRequests, saveMakerBatch, saveMakerRequest, type SavedMakerRequest } from '@/lib/maker-request-store';
import { buildPrivateSettlementActions, decodeExecutableAnswer, settlementCommitment, type ExecutableMakerAnswer, type SettlementDeployment } from '@app20/private-intents/private-settlement';
import { readExecutableQuote, verifySettlement } from '@/lib/starknet-maker-client';
import { submitActions, transactionHashFromError, transactionStateFromError } from '@/lib/strk20';
import { useRfqPresentationClock } from './ui/rfq-presentation-clock';
import { humanUnits } from './human-units';
import styles from './independent-makers.module.css';
import desk from './rfq.module.css';
import { MAX_COMPARISON_MAKERS, rankQuotes } from '@/lib/quote-comparison';

type Token = { address: string; symbol: string; decimals: number };
type Config = MakerBookConfig & { rpcUrl: string; sellToken: Token; buyToken: Token; settlement?: SettlementDeployment };
export function parseMakerConfig(raw: string | undefined): Config | undefined {
  if (!raw) return undefined;
  const v = JSON.parse(raw) as Config;
  felt(v.address); felt(v.classHash); felt(v.chainId);
  if (v.settlement) { felt(v.settlement.address); felt(v.settlement.classHash); felt(v.settlement.pool); felt(v.settlement.poolClassHash); }
  if (!Number.isSafeInteger(v.fromBlock) || v.fromBlock < 0) throw new Error('Invalid maker deployment block.');
  const url = new URL(v.rpcUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Maker RPC must use HTTPS without embedded credentials.');
  for (const token of [v.sellToken, v.buyToken]) {
    felt(token.address);
    if (!Number.isSafeInteger(token.decimals) || token.decimals < 0 || token.decimals > 18 || !/^[A-Za-z0-9]{1,12}$/.test(token.symbol)) throw new Error('Invalid maker token metadata.');
  }
  if (felt(v.sellToken.address) === felt(v.buyToken.address)) throw new Error('Maker market needs two tokens.');
  return v;
}
export function parseMakerAmount(value: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`This token supports ${decimals} decimal places.`);
  const result = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`).toString();
  amount(result); return result;
}
let deploymentConfig: Config | undefined;
let configurationError = false;
try { deploymentConfig = parseMakerConfig(import.meta.env.VITE_MAKER_BOOK_CONFIG ?? defaultMakerConfig); } catch { configurationError = true; }

export default function IndependentMakers() {
  const [reverse, setReverse] = useState(false);
  const config = deploymentConfig && (reverse ? { ...deploymentConfig, sellToken: deploymentConfig.buyToken, buyToken: deploymentConfig.sellToken } : deploymentConfig);
  const tokenFor = (address: string) => [deploymentConfig?.sellToken, deploymentConfig?.buyToken].find(token => token && felt(token.address) === felt(address));
  const address = useStoreWallet(s => s.address);
  const chain = useStoreWallet(s => s.chain);
  const wallet = useStoreWallet(s => s.myWalletAccount);
  const network = useFrontendProvider(s => s.currentFrontendProviderIndex);
  const [makers, setMakers] = useState<RegisteredMaker[]>([]);
  const [makerAddress, setMakerAddress] = useState('');
  const [comparisonId, setComparisonId] = useState<string>();
  const [direct, setDirect] = useState(false);
  const [nextOffset, setNextOffset] = useState<number>();
  const [sell, setSell] = useState('');
  const [minimum, setMinimum] = useState('');
  const [saved, setSaved] = useState<SavedMakerRequest[]>([]);
  const [answers, setAnswers] = useState<Record<string, MakerAnswer | ExecutableMakerAnswer>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [poolFee, setPoolFee] = useState<string>();
  const [reviewId, setReviewId] = useState<string>();
  const capable = useStoreWallet(s => s.isStrk20Capable);
  const now = useRfqPresentationClock();
  const generation = useRef(0);
  const operation = useRef(false);
  const connected = Boolean(config && wallet && address && chain && providerIndexForChain(config.chainId) === network && (() => { try { return felt(chain) === felt(config!.chainId); } catch { return false; } })());
  useEffect(() => {
    const epoch = ++generation.current;
    setComparisonId(undefined); setDirect(false); setMakers([]); setMakerAddress(''); setNextOffset(undefined); setAnswers({}); setSaved([]); setNotice(''); setReviewId(undefined); setPoolFee(undefined);
    void loadMakerRequests().then(rows => { if (epoch === generation.current) { setSaved(rows); const latest = rows.filter(row => row.stage && row.scope.taker === address && row.scope.chainId === chain).sort((a, b) => a.scope.expiresAt - b.scope.expiresAt).at(-1); setComparisonId(latest?.comparisonId); } }).catch(() => { if (epoch === generation.current) setNotice('Quote recovery storage is unavailable.'); });
    return () => { generation.current++; };
  }, [address, chain, network]);
  const requests = saved.filter(row => {
    try { return Boolean(config && felt(row.scope.taker) === felt(address) && felt(row.scope.book) === felt(config.address) && felt(row.scope.chainId) === felt(config.chainId)); }
    catch { return false; }
  });
  const pendingSettlement = requests.some(row => row.settlementAttempt?.status === 'prepared' || row.settlementAttempt?.status === 'submitted');
  async function run(action: (provider: RpcProvider, epoch: number) => Promise<void>) {
    if (!config || operation.current) return;
    operation.current = true;
    const epoch = generation.current;
    setBusy(true); setNotice('');
    try { await action(new RpcProvider({ nodeUrl: config.rpcUrl }), epoch); }
    catch (error) { if (epoch === generation.current) setNotice(error instanceof Error ? error.message : 'Maker request failed.'); }
    finally { operation.current = false; setBusy(false); }
  }
  function assertWallet(epoch: number) {
    const current = useStoreWallet.getState();
    if (!connected || epoch !== generation.current || current.address !== address || current.chain !== chain || current.myWalletAccount !== wallet || useFrontendProvider.getState().currentFrontendProviderIndex !== network) throw new Error('Wallet or network changed. Please try again.');
  }
  async function refresh(provider: RpcProvider, epoch: number, offset = 0) {
    const page = await readMakerPage(provider, config!, offset);
    if (epoch !== generation.current) return;
    setMakers(previous => offset ? [...previous, ...page.makers] : page.makers);
    setNextOffset(page.nextOffset);
    if (!offset) setMakerAddress(page.makers[0]?.address ?? '');
    if (!page.makers.length && !page.nextOffset) setNotice('No makers are available yet. A funded maker must come online before you can request a quote.');
  }
  async function prepareRequest(provider: RpcProvider, selected: RegisteredMaker, terms: SavedMakerRequest['terms'], group: string, firm: boolean): Promise<SavedMakerRequest> {
    const head = await verifyMakerBook(provider, config!);
    const liveKey = await provider.callContract({ contractAddress: config!.address, entrypoint: 'maker', calldata: [selected.address] }, head.block);
    if (liveKey.length !== 6 || Number(BigInt(liveKey[4]!)) !== selected.revision || Number(BigInt(liveKey[5]!)) <= head.timestamp) throw new Error('A maker key changed or expired. Get fresh quotes.');
    const scope = { chainId: felt(config!.chainId), book: felt(config!.address), id: randomRequestId(), maker: selected.address, taker: felt(address), revision: selected.revision, expiresAt: Math.min(head.timestamp + (firm ? 1800 : 600), selected.validUntil) };
    const keys = await generateTransportKey();
    return { scope, terms, replyKey: keys, status: 'prepared', comparisonId: group, stage: firm ? 'reservation' : 'comparison', ...(firm ? { settlementSecret: randomRequestId() } : {}) };
  }
  async function broadcast(epoch: number, rows: SavedMakerRequest[], selected: RegisteredMaker[], reserveGroup?: string) {
    const calls = [];
    for (const row of rows) {
      const replyKey = await crypto.subtle.exportKey('jwk', row.replyKey.publicKey);
      const commitment = row.settlementSecret ? settlementCommitment(row.scope.chainId, config!.settlement!.address, row.settlementSecret) : undefined;
      const maker = selected.find(value => value.address === row.scope.maker)!;
      const payload = await seal(row.scope, 'request', { ...row.terms, replyKey, ...(commitment ? { settlementCommitment: commitment } : {}) }, await publicKey(maker.key));
      calls.push(requestCall(row.scope, payload));
    }
    assertWallet(epoch);
    await saveMakerBatch(rows, reserveGroup);
    assertWallet(epoch);
    setSaved(previous => [...previous, ...rows]);
    setComparisonId(rows[0]!.comparisonId);
    try {
      setNotice(reserveGroup ? 'Approve the request for one funded offer. This does not execute a swap.' : `Approve comparison requests to ${rows.length} maker${rows.length === 1 ? '' : 's'}. Each request costs gas; no inventory is reserved.`);
      const result = await wallet!.execute(calls);
      for (const row of rows) await persist({ ...row, status: 'submitted', transactionHash: result.transaction_hash }, epoch);
      if (epoch === generation.current) setNotice('Request submitted. Replies will appear here automatically while this page is open.');
    } catch {
      throw new Error('Submission was not confirmed here. Check these records and wallet activity before sending another request.');
    }
  }
  async function request(provider: RpcProvider, epoch: number) {
    assertWallet(epoch);
    const existing = await loadMakerRequests();
    if (existing.some(row => row.scope.taker === felt(address) && row.scope.book === felt(config!.address) && row.scope.chainId === felt(config!.chainId) && ((row.settlementAttempt?.status === 'prepared' || row.settlementAttempt?.status === 'submitted') || (row.stage && row.scope.expiresAt > Math.floor(Date.now() / 1000) && row.settlementAttempt?.status !== 'confirmed' && (row.stage === 'reservation' || row.status === 'prepared'))))) throw new Error('An earlier request or reservation is still active or unconfirmed. Check its records or wait for expiry before starting again.');
    const terms = { sellToken: felt(config!.sellToken.address), buyToken: felt(config!.buyToken.address), sellAmount: parseMakerAmount(sell, config!.sellToken.decimals), minBuyAmount: parseMakerAmount(minimum, config!.buyToken.decimals) };
    let page = await readMakerPage(provider, config!);
    if (!direct && page.totalCount > 20) {
      const pageIndex = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32 * Math.ceil(page.totalCount / 20));
      if (pageIndex) page = await readMakerPage(provider, config!, pageIndex * 20);
    }
    assertWallet(epoch);
    setMakers(page.makers); setNextOffset(page.nextOffset);
    let selected = page.makers;
    if (direct) {
      selected = makers.filter(m => m.address === makerAddress);
      if (!selected.length) throw new Error('Choose an active maker under Advanced.');
      if (!config!.settlement) throw new Error('Funded settlement is not configured.');
      await verifySettlement(provider, config!, config!.settlement);
    } else {
      // Randomize a bounded registry page so registration order does not rank prices.
      selected = selected.map(maker => ({ maker, order: crypto.getRandomValues(new Uint32Array(1))[0]! })).sort((a, b) => a.order - b.order).slice(0, MAX_COMPARISON_MAKERS).map(value => value.maker);
    }
    if (!selected.length) throw new Error('No active makers found on this registry page. Try Advanced to discover more makers.');
    const group = randomRequestId();
    const rows: SavedMakerRequest[] = [];
    for (const maker of selected) rows.push(await prepareRequest(provider, maker, terms, group, direct));
    await broadcast(epoch, rows, selected, direct ? group : undefined);
  }
  async function reserve(provider: RpcProvider, epoch: number, preliminary: SavedMakerRequest) {
    assertWallet(epoch);
    if (!config!.settlement || !preliminary.comparisonId || !preliminary.indicativeAnswer) throw new Error('A current preliminary quote is required.');
    decodeAnswer(preliminary.indicativeAnswer, preliminary.scope, preliminary.terms, Math.floor(Date.now() / 1000));
    await verifySettlement(provider, config!, config!.settlement);
    const head = await verifyMakerBook(provider, config!);
    const values = await provider.callContract({ contractAddress: config!.address, entrypoint: 'maker', calldata: [preliminary.scope.maker] }, head.block);
    if (values.length !== 6) throw new Error('Maker registration changed. Get fresh quotes.');
    const selected = { address: preliminary.scope.maker, revision: Number(BigInt(values[4]!)), validUntil: Number(BigInt(values[5]!)), key: coordinatesKey(values.slice(0, 4)) };
    const row = await prepareRequest(provider, selected, preliminary.terms, preliminary.comparisonId, true);
    row.expectedBuyAmount = preliminary.indicativeAnswer.buyAmount;
    await broadcast(epoch, [row], [selected], preliminary.comparisonId);
  }
  async function persist(row: SavedMakerRequest, epoch: number) {
    await saveMakerRequest(row);
    if (epoch === generation.current) setSaved(previous => previous.map(old => old.scope.id === row.scope.id ? row : old));
  }
  async function check(provider: RpcProvider, epoch: number, row: SavedMakerRequest) {
    if (row.settlementAttempt && row.settlementAttempt.status !== 'reverted') {
      if (!config!.settlement || !row.executableAnswer) throw new Error('Restore the settlement deployment configuration to check this trade.');
      const chainState = await readExecutableQuote(provider, config!, config!.settlement, row.scope, row.terms, row.executableAnswer, false);
      const tx = row.settlementAttempt.transactionHash;
      if (tx) {
        const receipt = await provider.getTransactionReceipt(tx);
        if (receipt.isSuccess() && chainState.status === 2) {
          await persist({ ...row, settlementAttempt: { status: 'confirmed', transactionHash: tx } }, epoch);
          if (epoch === generation.current) setNotice('Swap settled. Your receive asset is in your shielded balance.');
          return;
        }
        if (receipt.isReverted()) {
          await persist({ ...row, settlementAttempt: { status: 'reverted', transactionHash: tx } }, epoch);
          if (epoch === generation.current) setNotice('The swap reverted. The atomic exchange did not transfer your sell amount; wallet/network fees may still apply. Check the quote again before retrying.');
          return;
        }
      }
      throw new Error(chainState.status === 2 ? 'This quote was filled. Check your wallet’s shielded balance and transaction activity.' : 'Settlement is unresolved. Check wallet activity; do not submit another payment.');
    }
    const payload = await readMakerAnswer(provider, config!, row.scope);
    if (!payload) { if (epoch === generation.current) setNotice('No quote yet. The maker may be offline or unable to meet your minimum.'); return; }
    const body = await open(row.scope, 'quote', payload, row.replyKey);
    let answer: MakerAnswer | ExecutableMakerAnswer;
    if (config!.settlement && row.settlementSecret) {
      answer = decodeExecutableAnswer(body, row.scope, row.terms, config!.settlement, settlementCommitment(row.scope.chainId, config!.settlement.address, row.settlementSecret), Math.floor(Date.now() / 1000));
      const reservation = await readExecutableQuote(provider, config!, config!.settlement, row.scope, row.terms, answer);
      if (reservation.status !== 1 || reservation.expired) throw new Error('This quote is no longer reserved.');
      const fee = await provider.callContract({ contractAddress: config!.settlement.pool, entrypoint: 'get_fee_amount', calldata: [] }, reservation.head.block);
      if (fee.length !== 1 || BigInt(fee[0]!) < 0n || BigInt(fee[0]!) >= 1n << 128n) throw new Error('Cannot verify the current pool fee.');
      if (epoch === generation.current) setPoolFee(BigInt(fee[0]!).toString());
      await persist({ ...row, executableAnswer: answer }, epoch);
    } else {
      try { answer = decodeAnswer(body, row.scope, row.terms, Math.floor(Date.now() / 1000)); }
      catch { await persist({ ...row, replyRejected: true, indicativeAnswer: undefined }, epoch); if (epoch === generation.current) setNotice('A reply was excluded because it expired or did not meet your terms. Other valid offers remain eligible.'); return; }
      if (config!.settlement) {
        const head = await verifySettlement(provider, config!, config!.settlement);
        const available = await provider.callContract({ contractAddress: config!.settlement.address, entrypoint: 'available', calldata: [row.scope.maker, row.terms.buyToken] }, head.block);
        if (available.length !== 2 || available.some(value => BigInt(value) < 0n || BigInt(value) >= 1n << 128n)) throw new Error('Could not verify maker inventory.');
        if (BigInt(available[0]!) + (BigInt(available[1]!) << 128n) < BigInt(answer.buyAmount)) {
          await persist({ ...row, replyRejected: true, indicativeAnswer: undefined }, epoch);
          if (epoch === generation.current) setNotice('A reply was excluded because its maker no longer has enough available inventory.');
          return;
        }
      }
      await persist({ ...row, indicativeAnswer: answer }, epoch);
    }
    if (epoch === generation.current) setAnswers(previous => ({ ...previous, [row.scope.id]: answer }));
  }
  async function accept(provider: RpcProvider, epoch: number, original: SavedMakerRequest) {
    assertWallet(epoch);
    const row = (await loadMakerRequests()).find(value => value.scope.id === original.scope.id);
    if (!row?.settlementSecret || !row.executableAnswer || !config!.settlement || !capable || !useStoreWallet.getState().isStrk20Capable) throw new Error('A funded quote and privacy-enabled wallet are required.');
    decodeExecutableAnswer(row.executableAnswer, row.scope, row.terms, config!.settlement, settlementCommitment(row.scope.chainId, config!.settlement.address, row.settlementSecret), Math.floor(Date.now() / 1000));
    if (row.settlementAttempt && row.settlementAttempt.status !== 'reverted') throw new Error('Check the existing settlement before trying again.');
    const state = await readExecutableQuote(provider, config!, config!.settlement, row.scope, row.terms, row.executableAnswer);
    if (state.status !== 1 || state.expired || Math.floor(Date.now() / 1000) >= row.executableAnswer.expiresAt) throw new Error('This quote is no longer executable.');
    const fee = await provider.callContract({ contractAddress: config!.settlement.pool, entrypoint: 'get_fee_amount', calldata: [] }, state.head.block);
    if (fee.length !== 1 || BigInt(fee[0]!).toString() !== poolFee) { setReviewId(undefined); throw new Error('The pool fee changed. Check the quote and review the new fee.'); }
    assertWallet(epoch);
    let current = await beginMakerSettlement(row.scope.id);
    if (epoch === generation.current) setSaved(previous => previous.map(old => old.scope.id === row.scope.id ? current : old));
    try {
      if (epoch === generation.current) setNotice('Prepare and approve the private swap in your wallet.');
      const result = await submitActions(wallet!, provider, buildPrivateSettlementActions(row.scope, row.terms, row.executableAnswer, row.settlementSecret, address), {
        timeoutMs: 60000,
        policy: () => { assertWallet(epoch); if (!useStoreWallet.getState().isStrk20Capable) throw new Error('Wallet privacy support changed.'); },
        onSubmitted: async transactionHash => {
          current = { ...current, settlementAttempt: { status: 'submitted', transactionHash } };
          await persist(current, epoch);
          if (epoch === generation.current) setNotice('Swap submitted. Waiting for on-chain confirmation…');
        },
      });
      const settled = await readExecutableQuote(provider, config!, config!.settlement, row.scope, row.terms, row.executableAnswer);
      if (settled.status !== 2) throw new Error('Successful transaction did not confirm this quote’s settlement.');
      await persist({ ...current, settlementAttempt: { status: 'confirmed', transactionHash: result.transactionHash } }, epoch);
      if (epoch === generation.current) { setNotice('Swap settled. Your receive asset is in your shielded balance.'); setReviewId(undefined); }
    } catch (error) {
      const tx = transactionHashFromError(error) ?? current.settlementAttempt?.transactionHash;
      const rejected = transactionStateFromError(error) === 'reverted';
      await persist({ ...current, settlementAttempt: { status: rejected ? 'reverted' : (tx ? 'submitted' : 'prepared'), ...(tx ? { transactionHash: tx } : {}) } }, epoch);
      throw new Error(rejected ? 'The swap was rejected or reverted. Check the quote before retrying.' : 'Settlement confirmation is pending. Use Check settlement; do not submit another payment.');
    }
  }
  const ranked = comparisonId ? rankQuotes(requests, comparisonId, now) : [];
  const recordRows = requests.filter(row => row.stage !== 'comparison');
  const selectedReservation = requests.find(row => row.comparisonId === comparisonId && row.stage === 'reservation');
  const groupRequests = requests.filter(row => row.comparisonId === comparisonId && row.stage === 'comparison');
  // Poll a bounded group; stop once a reservation is made, replies expire, or the wallet changes.
  useEffect(() => {
    if (!connected || busy || !comparisonId) return;
    const pending = selectedReservation ? [selectedReservation] : groupRequests;
    const unchecked = pending.filter(row => row.status === 'submitted' && !row.indicativeAnswer && !row.replyRejected && !row.executableAnswer && row.scope.expiresAt > now).slice(0, MAX_COMPARISON_MAKERS);
    if (!unchecked.length) return;
    const timer = setTimeout(() => void run(async (provider, epoch) => {
      for (const row of unchecked) {
        if (epoch !== generation.current) return;
        try { await check(provider, epoch, row); } catch (error) { if (epoch === generation.current) setNotice(error instanceof Error ? error.message : 'Could not check a reply.'); }
      }
    }), 15000);
    return () => clearTimeout(timer);
  }, [connected, busy, comparisonId, saved, address, chain]);
  return <section className={`${desk.privateIntentDesk} ${styles.swapDesk}`} aria-label="Private swap">
    <header className={desk.privateIntentHeader}>
      <div><h3>Compare & swap</h3></div>
      <div className={desk.ticketPromise}><span>Atomic swap</span></div>
    </header>
    {!config ? <p className={styles.notice} role="status">{configurationError ? 'Maker deployment configuration is invalid.' : 'The maker contract has not been configured for this build.'} A verified maker-book and settlement deployment are required to trade.</p> : <>
      <form className={desk.privateIntentForm} onSubmit={event => { event.preventDefault(); void run(request); }}>
        <div className={desk.swapAssetStack}>
          <label className={desk.swapAssetCard}>
            <span className={desk.swapAssetHead}><b>You sell</b><small>Shielded balance</small></span>
            <span className={desk.swapAssetControl}>
              <input aria-label={`You sell (${config.sellToken.symbol})`} inputMode="decimal" placeholder="0.00" value={sell} onChange={e => { setSell(e.target.value); setComparisonId(undefined); setReviewId(undefined); }} required disabled={busy} />
              <strong>{config.sellToken.symbol}</strong>
            </span>
          </label>
          <button className={desk.swapDirection} type="button" aria-label="Reverse swap direction" title="Reverse swap direction" disabled={busy} onClick={() => { setReverse(value => !value); setSell(''); setMinimum(''); setComparisonId(undefined); setReviewId(undefined); }}>⇅</button>
          <label className={desk.swapAssetCard}>
            <span className={desk.swapAssetHead}><b>Minimum receive</b><small>Set by you</small></span>
            <span className={desk.swapAssetControl}>
              <input aria-label={`Minimum you receive (${config.buyToken.symbol})`} inputMode="decimal" placeholder="0.00" value={minimum} onChange={e => { setMinimum(e.target.value); setComparisonId(undefined); setReviewId(undefined); }} required disabled={busy} />
              <strong>{config.buyToken.symbol}</strong>
            </span>
          </label>
        </div>
        <p className={styles.hint}>Compare up to {MAX_COMPARISON_MAKERS} makers. Only offers meeting your minimum are eligible. Nothing swaps until you review and confirm a funded offer.</p>
        <details className={styles.advanced}>
          <summary>Advanced · choose a maker</summary>
          <label className={styles.directToggle}><input type="checkbox" checked={direct} disabled={busy} onChange={event => setDirect(event.target.checked)} /> Request a fixed offer from one maker</label>
          <div className={styles.makerRow}>
            <label>Maker<select aria-label="Maker" value={makerAddress} onChange={event => setMakerAddress(event.target.value)} disabled={busy}><option value="">Choose a maker</option>{makers.map(m => <option key={m.address} value={m.address}>{m.address}</option>)}</select></label>
            <button type="button" disabled={busy} onClick={() => void run((p, e) => refresh(p, e))}>Find makers</button>
            {nextOffset !== undefined && <button type="button" disabled={busy} onClick={() => void run((p, e) => refresh(p, e, nextOffset))}>More makers</button>}
          </div>
          <p className={styles.hint}>Automatic comparison contacts up to {MAX_COMPARISON_MAKERS} active makers from a randomly chosen registry page. Each sees the request sent to them. A direct request reserves one maker’s inventory if they respond.</p>
        </details>
        <button className={desk.privateIntentQuoteButton} disabled={busy || !connected || (direct && !makerAddress) || pendingSettlement}>{busy ? 'Working…' : direct ? 'Request fixed offer' : 'Get quotes'} · gas required</button>
        {pendingSettlement && <p>Check your pending settlement before requesting another trade.</p>}
        {!connected && <p className={styles.hint}>Connect your privacy-enabled wallet to request a quote.</p>}
      </form>
      {groupRequests.length > 0 && <section className={styles.comparison} aria-label="Quote comparison">
        <h3>{selectedReservation ? 'Funded offer requested' : ranked.length ? 'Best offer received' : groupRequests.every(row => row.replyRejected || now >= row.scope.expiresAt) ? 'No eligible offers' : 'Waiting for quotes'}</h3>
        <p>{ranked.length} valid {ranked.length === 1 ? 'reply' : 'replies'} from {groupRequests.length} contacted {groupRequests.length === 1 ? 'maker' : 'makers'}. Preliminary prices do not reserve funds.</p>
        {ranked[0] && <>
          <strong className={styles.bestAmount}>{humanUnits(BigInt(ranked[0].indicativeAnswer.buyAmount), tokenFor(ranked[0].terms.buyToken)?.decimals ?? 18)} {tokenFor(ranked[0].terms.buyToken)?.symbol}</strong>
          <p>For {humanUnits(BigInt(ranked[0].terms.sellAmount), tokenFor(ranked[0].terms.sellToken)?.decimals ?? 18)} {tokenFor(ranked[0].terms.sellToken)?.symbol}. Minimum: {humanUnits(BigInt(ranked[0].terms.minBuyAmount), tokenFor(ranked[0].terms.buyToken)?.decimals ?? 18)} {tokenFor(ranked[0].terms.buyToken)?.symbol}.</p>
          <p>Ranked by receive amount. Pool and wallet/network fees are additional and shown at review.</p>
          {!selectedReservation && <button disabled={busy || !connected || pendingSettlement || !config.settlement} onClick={() => void run((p, e) => reserve(p, e, ranked[0]!))}>Request funded offer</button>}
          <details><summary>Compare replies</summary><ol>{ranked.map(row => <li key={row.scope.id}><code>{row.scope.maker.slice(0, 12)}…</code> · {humanUnits(BigInt(row.indicativeAnswer.buyAmount), tokenFor(row.terms.buyToken)?.decimals ?? 18)} {tokenFor(row.terms.buyToken)?.symbol} · expires {new Date(row.indicativeAnswer.expiresAt * 1000).toLocaleTimeString()}</li>)}</ol></details>
        </>}
        {!selectedReservation && <button className={styles.refreshReplies} disabled={busy || !connected} onClick={() => void run(async (provider, epoch) => { for (const row of groupRequests) { try { await check(provider, epoch, row); } catch (error) { if (epoch === generation.current) setNotice(error instanceof Error ? error.message : 'Could not check a reply.'); } } })}>Refresh replies</button>}
        {!selectedReservation && <p>Only the selected maker will reserve funds. Review its final price before swapping; it can differ from this estimate.</p>}
        {selectedReservation && <p>Check the funded offer in Swap records below. No other maker in this comparison will be asked to reserve funds.</p>}
      </section>}
      <section id="records" className={styles.records} aria-labelledby="swap-records-title">
      <h3 id="swap-records-title">Swap records</h3>
      {recordRows.length === 0 && <p className={styles.notice}>{connected ? 'No saved swaps for this wallet yet.' : 'Connect your wallet to see its saved swaps.'}</p>}
      {recordRows.length > 0 && <ul className={styles.requests}>{recordRows.map(row => {
        const answer = answers[row.scope.id] ?? row.executableAnswer ?? row.indicativeAnswer;
        const unresolved = Boolean(row.settlementAttempt && row.settlementAttempt.status !== 'reverted');
        const confirmed = row.settlementAttempt?.status === 'confirmed';
        const canAccept = answer?.kind === 'executable' && !unresolved && connected && capable && now < answer.expiresAt && poolFee !== undefined;
        return <li key={row.scope.id}>
          <span>{humanUnits(BigInt(row.terms.sellAmount), tokenFor(row.terms.sellToken)?.decimals ?? 18)} {tokenFor(row.terms.sellToken)?.symbol ?? row.terms.sellToken} → {tokenFor(row.terms.buyToken)?.symbol ?? row.terms.buyToken}</span><small>{row.settlementSecret ? 'Funded offer' : 'Quote request'}</small><details><summary>Request details</summary><p>Maker: <code>{row.scope.maker}</code></p><p>Request: <code>{row.scope.id}</code></p></details>
          {answer && <p>{confirmed ? 'Received' : answer.kind === 'executable' ? 'Reserved receive' : 'Indicative receive'}: {humanUnits(BigInt(answer.buyAmount), tokenFor(row.terms.buyToken)?.decimals ?? 18)} {tokenFor(row.terms.buyToken)?.symbol ?? row.terms.buyToken}. {confirmed ? '' : now >= answer.expiresAt ? 'Expired.' : `Expires ${new Date(answer.expiresAt * 1000).toLocaleTimeString()}.`}</p>}
          {confirmed ? <p role="status">Swap settled · receive asset shielded</p> : <button disabled={busy} onClick={() => void run((p, e) => check(p, e, row))}>{unresolved ? 'Check settlement' : 'Check quote'}</button>}
          {answer?.kind === 'executable' && !unresolved && <>
            {!capable && <p>Connect a privacy-enabled wallet to accept this quote.</p>}
            {reviewId !== row.scope.id ? <button disabled={busy || !canAccept} onClick={() => setReviewId(row.scope.id)}>Review swap</button> : <div className={styles.review} aria-label="Review private swap">
              {row.expectedBuyAmount && row.expectedBuyAmount !== answer.buyAmount && <p role="status">The funded price differs from the preliminary quote. Review the updated amounts below; your minimum still applies.</p>}
              <p>You pay {humanUnits(BigInt(row.terms.sellAmount), tokenFor(row.terms.sellToken)?.decimals ?? 18)} {tokenFor(row.terms.sellToken)?.symbol ?? row.terms.sellToken} from your shielded balance and receive {humanUnits(BigInt(answer.buyAmount), tokenFor(row.terms.buyToken)?.decimals ?? 18)} {tokenFor(row.terms.buyToken)?.symbol ?? row.terms.buyToken} shielded.</p>
              <p>Your minimum: {humanUnits(BigInt(row.terms.minBuyAmount), tokenFor(row.terms.buyToken)?.decimals ?? 18)} {tokenFor(row.terms.buyToken)?.symbol}. Allow time for proving and confirmation before expiry.</p>
              <p>Pool fee: {poolFee === undefined ? 'unavailable' : humanUnits(BigInt(poolFee), 18)} STRK, plus any wallet/network fees. The wallet will show the final transaction.</p>
              <button disabled={busy || !canAccept} onClick={() => void run((p, e) => accept(p, e, row))}>Confirm private swap</button><button disabled={busy} onClick={() => setReviewId(undefined)}>Back</button>
            </div>}
          </>}
        </li>;
      })}</ul>}
      {requests.some(row => row.stage === 'comparison') && <details className={styles.priceHistory}><summary>Price request history</summary><ul>{requests.filter(row => row.stage === 'comparison').map(row => <li key={row.scope.id}>
        <span>{humanUnits(BigInt(row.terms.sellAmount), tokenFor(row.terms.sellToken)?.decimals ?? 18)} {tokenFor(row.terms.sellToken)?.symbol} → {tokenFor(row.terms.buyToken)?.symbol} · maker {row.scope.maker.slice(0, 12)}… · {now >= row.scope.expiresAt ? 'Expired' : row.replyRejected ? 'Reply excluded' : row.indicativeAnswer ? 'Replied' : row.status === 'prepared' ? 'Submission unconfirmed' : 'Waiting'}</span>
        <button disabled={busy} onClick={() => setComparisonId(row.comparisonId)}>View comparison</button>
      </li>)}</ul></details>}
      </section>
    </>}
    {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
    <footer className={styles.details}>
      <p><a href="/chat">Negotiate in Chat</a> · Agree fixed amounts directly, then use Advanced to request a funded offer from that maker. Chat offer attachments remain separate from atomic RFQ settlement.</p>
      <details><summary>Privacy & fees</summary><p>Your payment and receive asset use shielded notes. Funded quote amounts, maker balances and settlement activity are public. Account addresses, the selected maker and timing are public. Each contacted maker can read its request. Comparison prices are encrypted; funded terms are public. Requests and replies are encrypted; their recipient keys and quote recovery are saved in this browser. Clearing storage removes your reply keys. Each request costs gas, and settlement also pays the pool fee shown before approval.</p></details>
      <details><summary>Run a maker</summary><p>Independent makers supply their own wallet, encryption key and price limits. The bot reserves its own inventory only for a funded offer and receives the sell asset when it fills. It needs only Starknet RPC and local storage. Spreads are not guaranteed profit.</p><p><a href="/rfq/maker">Become a maker</a> · <a href="/agents">Agent guide</a></p></details>
    </footer>
  </section>;
}
