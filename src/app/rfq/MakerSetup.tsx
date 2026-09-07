import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { RpcProvider, type Call } from 'starknet';
import { useStoreWallet } from '@/app/components/Wallet/walletContext';
import { useFrontendProvider } from '@/app/components/client/provider/providerContext';
import { MAINNET_MAKER_CONFIG as config } from '@/lib/mainnet-maker-config';
import { verifySettlement } from '@/lib/starknet-maker-client';
import { makerRegistration, makerInventoryCalls, makerOperatorConfig } from '@/lib/maker-setup';
import { felt } from '@app20/private-intents/starknet-maker';
import { humanUnits } from './human-units';
import styles from './maker-setup.module.css';

type Pending = { label: string; hash?: string };
const tokens = [config.sellToken, config.buyToken];
export default function MakerSetup() {
  const address = useStoreWallet(s => s.address), chain = useStoreWallet(s => s.chain), wallet = useStoreWallet(s => s.myWalletAccount);
  const [step, setStep] = useState<'register' | 'inventory' | 'bot'>('register');
  const [key, setKey] = useState(''), [days, setDays] = useState(7);
  const [token, setToken] = useState(config.buyToken.address), [quantity, setQuantity] = useState('');
  const [inventory, setInventory] = useState<Record<string, string>>({});
  const [keyExpiry, setKeyExpiry] = useState(0), [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending>();
  const [reverse, setReverse] = useState(false), [price, setPrice] = useState(''), [spread, setSpread] = useState(50);
  const [maxSell, setMaxSell] = useState(''), [maxBuy, setMaxBuy] = useState(''), [hours, setHours] = useState(1);
  const [maxFee, setMaxFee] = useState(''), [totalFees, setTotalFees] = useState('');
  const generation = useRef(0);
  const scope = `app20/maker-setup/v1/${config.chainId}/${config.settlement.address}/${address}`;
  const connected = Boolean(wallet && address && chain && (() => { try { return felt(chain) === felt(config.chainId); } catch { return false; } })());
  useEffect(() => {
    generation.current++; setInventory({}); setKeyExpiry(0); setRevision(0); setPending(undefined); setNotice(''); setKey('');
    try { const saved = localStorage.getItem(scope); if (saved) setPending(JSON.parse(saved)); } catch { setNotice('Recovery storage is unavailable.'); }
    return () => { generation.current++; };
  }, [scope, chain]);
  const provider = () => new RpcProvider({ nodeUrl: config.rpcUrl });
  function assertWallet(epoch: number) {
    const live = useStoreWallet.getState();
    if (!connected || epoch !== generation.current || live.address !== address || live.chain !== chain || live.myWalletAccount !== wallet || useFrontendProvider.getState().currentFrontendProviderIndex !== 0) throw new Error('Connect your maker wallet on mainnet.');
  }
  async function refresh(p: RpcProvider, epoch: number) {
    const head = await verifySettlement(p, config, config.settlement, false);
    const record = await p.callContract({ contractAddress: config.address, entrypoint: 'maker', calldata: [felt(address)] }, head.block);
    const balances = await Promise.all(tokens.map(async t => {
      const v = await p.callContract({ contractAddress: config.settlement.address, entrypoint: 'available', calldata: [felt(address), t.address] }, head.block);
      return [t.address, (BigInt(v[0]) + (BigInt(v[1]) << 128n)).toString()];
    }));
    if (epoch !== generation.current) return;
    setRevision(Number(BigInt(record[4]))); setKeyExpiry(Number(BigInt(record[5]))); setInventory(Object.fromEntries(balances));
  }
  async function run(task: (p: RpcProvider, epoch: number) => Promise<void>) {
    if (busy) return; setBusy(true); setNotice(''); const epoch = generation.current;
    try { assertWallet(epoch); await task(provider(), epoch); }
    catch (e) { if (epoch === generation.current) setNotice(e instanceof Error ? e.message : 'Maker operation failed.'); }
    finally { setBusy(false); }
  }
  async function submit(p: RpcProvider, epoch: number, label: string, calls: Call[]) {
    if (!navigator.locks) throw new Error('This browser cannot safely coordinate wallet actions across tabs. Use a current browser.');
    await navigator.locks.request(scope, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('Another tab is using this maker account.');
      if (localStorage.getItem(scope)) throw new Error('Check the pending transaction before submitting another.');
      assertWallet(epoch);
      await verifySettlement(p, config, config.settlement, !['Withdraw inventory', 'Deactivate maker'].includes(label));
      assertWallet(epoch);
      const attempt: Pending = { label };
      localStorage.setItem(scope, JSON.stringify(attempt)); setPending(attempt);
      try {
        const tx = await wallet!.execute(calls);
        attempt.hash = tx.transaction_hash; localStorage.setItem(scope, JSON.stringify(attempt));
        if (epoch === generation.current) { setPending({ ...attempt }); setNotice('Transaction submitted. You can return here to check confirmation.'); }
        const receipt = await p.waitForTransaction(tx.transaction_hash, { retryInterval: 3000 });
        if (!receipt.isSuccess() && !receipt.isReverted()) throw new Error('Confirmation is still pending.');
        if (localStorage.getItem(scope) !== JSON.stringify(attempt)) {
          if (epoch === generation.current) { const latest = localStorage.getItem(scope); setPending(latest ? JSON.parse(latest) : undefined); }
          return;
        }
        localStorage.removeItem(scope);
        if (epoch !== generation.current) return;
        setPending(undefined); await refresh(p, epoch);
        setNotice(receipt.isSuccess() ? `${label} confirmed.` : 'Transaction reverted. Funds were not moved by this operation; network fees may apply.');
      } catch (error) {
        if (!attempt.hash && typeof error === 'object' && error && 'code' in error && error.code === 4001) {
          localStorage.removeItem(scope); if (epoch === generation.current) { setPending(undefined); setNotice('Wallet request declined. No transaction was submitted.'); }
          return;
        }
        throw new Error(attempt.hash ? 'Confirmation is pending. Use Check transaction before trying again.' : 'Wallet submission did not complete. Check wallet activity before retrying; this attempt is saved.');
      }
    });
  }
  async function reconcile(p: RpcProvider, epoch: number) {
    const saved = localStorage.getItem(scope); if (!saved) { setPending(undefined); return; }
    const attempt: Pending = JSON.parse(saved);
    if (!attempt.hash) throw new Error('No transaction hash was returned. Inspect this account in your wallet before manually resolving the saved attempt; do not submit it again blindly.');
    const receipt = await p.getTransactionReceipt(attempt.hash);
    if (!receipt.isSuccess() && !receipt.isReverted()) throw new Error('Transaction is still pending.');
    if (localStorage.getItem(scope) !== saved) throw new Error('Another tab updated this transaction. Refresh maker status before continuing.');
    localStorage.removeItem(scope); if (epoch !== generation.current) return;
    setPending(undefined); await refresh(p, epoch); setNotice(receipt.isSuccess() ? `${attempt.label} confirmed.` : 'Transaction reverted. You may review and retry.');
  }
  function download() {
    try {
      const value = makerOperatorConfig({ account: address, reverse, price, spread, maxSell, maxBuy, priceHours: hours, maxFee, totalFees, keyValidUntil: keyExpiry }, Math.floor(Date.now() / 1000));
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'operator.json'; link.click(); URL.revokeObjectURL(url); setNotice('Public bot settings downloaded. No private key is included.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Check your settings.'); }
  }
  const sell = reverse ? config.buyToken : config.sellToken, buy = reverse ? config.sellToken : config.buyToken;
  return <section className={styles.panel} aria-label="Become a maker">
    <header><h2>Become a maker</h2><p>Anyone can register, fund quotes and run a bot. No approval from APP20 is needed.</p><Link to="/agents">Agent guide and bot download →</Link></header>
    {!connected && <p role="status">Connect the wallet you want to use as your maker account.</p>}
    <nav aria-label="Maker setup steps">{(['register', 'inventory', 'bot'] as const).map((value, i) => <button key={value} aria-pressed={step === value} onClick={() => setStep(value)}>{i + 1}. {value === 'register' ? 'Register' : value === 'inventory' ? 'Inventory' : 'Run bot'}</button>)}</nav>
    <button disabled={!connected || busy} onClick={() => void run(refresh)}>Refresh maker status</button>
    {revision > 0 && <p>Key revision {revision} · {keyExpiry * 1000 > Date.now() ? `registered until ${new Date(keyExpiry * 1000).toLocaleString()}` : 'registration inactive'}</p>}
    {step === 'register' && <div className={styles.section}>
      <h3>Register your bot’s public key</h3><p>Create the encryption key on the machine running your bot. Paste only the public JSON printed by <code>node app20-maker.mjs --init-key ./maker-key.json</code>.</p>
      <label>Public P-256 key<textarea value={key} onChange={e => setKey(e.target.value)} placeholder={'{"kty":"EC","crv":"P-256","x":"…","y":"…"}'} spellCheck={false} /></label>
      <label>Registration days<input type="number" min="1" max="30" value={days} onChange={e => setDays(Number(e.target.value))} /></label>
      <p>Registration costs gas. Registering again rotates your key and invalidates unanswered requests; funded quotes remain valid.</p>
      <button disabled={!connected || busy || !!pending || !key} onClick={() => void run(async (p, epoch) => { const head = await verifySettlement(p, config, config.settlement); await submit(p, epoch, 'Register maker', [await makerRegistration(key, days, head.timestamp)]); })}>Review registration in wallet</button>
      {revision > 0 && <button disabled={!connected || busy || !!pending} onClick={() => void run((p, e) => submit(p, e, 'Deactivate maker', [{ contractAddress: config.address, entrypoint: 'deactivate', calldata: [] }]))}>Deactivate new requests</button>}
    </div>}
    {step === 'inventory' && <div className={styles.section}>
      <h3>Fund quotes or withdraw proceeds</h3><p>Inventory is public. Fund the token your customer receives. Reserved quotes cannot be withdrawn until filled or expired.</p>
      <dl>{tokens.map(t => <div key={t.address}><dt>Available {t.symbol}</dt><dd>{inventory[t.address] === undefined ? 'Refresh to load' : humanUnits(BigInt(inventory[t.address]), t.decimals)}</dd></div>)}</dl>
      <label>Token<select value={token} onChange={e => setToken(e.target.value)}>{tokens.map(t => <option key={t.address} value={t.address}>{t.symbol}</option>)}</select></label>
      <label>Amount<input inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
      <p>Funding approves and deposits this exact amount in one transaction. Withdrawals go to your connected maker wallet. Your wallet shows network fees.</p>
      <button disabled={!connected || busy || !!pending || !quantity} onClick={() => void run((p, e) => submit(p, e, 'Fund inventory', makerInventoryCalls('fund', token, quantity)))}>Review funding in wallet</button>
      <button disabled={!connected || busy || !!pending || !quantity} onClick={() => void run((p, e) => submit(p, e, 'Withdraw inventory', makerInventoryCalls('withdraw', token, quantity)))}>Review withdrawal in wallet</button>
    </div>}
    {step === 'bot' && <div className={styles.section}>
      <h3>Set your quoting limits</h3><p>The bot runs on your machine or server. Leaving this page does not start or stop it. Prices are your inputs; they are not refreshed by an oracle.</p>
      <label>Customer sells<select value={reverse ? 'reverse' : 'forward'} onChange={e => { setReverse(e.target.value === 'reverse'); setPrice(''); setMaxSell(''); setMaxBuy(''); }}><option value="forward">STRK → USDC</option><option value="reverse">USDC → STRK</option></select></label>
      <label>{buy.symbol} per 1 {sell.symbol}, before spread<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label>
      <label>Spread in basis points (100 = 1%)<input type="number" min="0" max="9999" value={spread} onChange={e => setSpread(Number(e.target.value))} /></label>
      <label>Maximum customer sell ({sell.symbol})<input inputMode="decimal" value={maxSell} onChange={e => setMaxSell(e.target.value)} /></label>
      <label>Maximum output per quote ({buy.symbol})<input inputMode="decimal" value={maxBuy} onChange={e => setMaxBuy(e.target.value)} /></label>
      <label>Price valid for hours (maximum 24)<input type="number" min="0.1" max="24" step="0.1" value={hours} onChange={e => setHours(Number(e.target.value))} /></label>
      <label>Maximum fee per transaction (STRK)<input inputMode="decimal" value={maxFee} onChange={e => setMaxFee(e.target.value)} /></label>
      <label>Total bot gas budget (STRK)<input inputMode="decimal" value={totalFees} onChange={e => setTotalFees(e.target.value)} /></label>
      <button disabled={!connected || busy} onClick={download}>Download operator.json</button>
      <p>Keep <code>maker-state.json</code> between restarts to retain fee accounting and pending-transaction recovery. No profit is guaranteed.</p>
      <Link to="/agents">Download the bot and follow the run commands →</Link>
    </div>}
    {pending && <aside role="status"><p>{pending.label}: {pending.hash ?? 'wallet outcome unknown'}</p><button disabled={busy || !connected} onClick={() => void run(reconcile)}>Check transaction</button></aside>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
  </section>;
}
