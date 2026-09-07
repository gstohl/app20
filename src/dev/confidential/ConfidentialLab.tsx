import { useEffect, useState } from 'react';
import styles from '@/app/rfq/confidential-rfq.module.css';

type Session = { id: string; amountA: string; amountB: string; deadline: number; timestamp: number; registered: boolean; settled: boolean; balanceA: string; balanceB: string; status: 'setup' | 'funding' | 'ready' | 'settled' | 'refundable' | 'closed'; pending?: unknown; hashes: { action: string; hash: string }[] };
type State = { ready: boolean; bootFailed: boolean; busy: boolean; sessions: Session[] };
const format = (value: string) => { const n = BigInt(value); const fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return `${n / 10n ** 18n}${fraction ? '.' + fraction : ''}`; };
function units(value: string) { if (!/^\d+(?:\.\d{1,18})?$/.test(value)) throw new Error('Enter an amount with up to 18 decimal places.'); const [whole, fraction = ''] = value.split('.'); return BigInt(whole + fraction.padEnd(18, '0')).toString(); }
async function api(path: string, body?: unknown) {
  const response = await fetch('/__app20_confidential' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { cache: 'no-store', credentials: 'same-origin' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Local operation failed.'); return result;
}

export default function ConfidentialLab() {
  const [state, setState] = useState<State>(), [selected, setSelected] = useState<string>(), [amountA, setA] = useState('1'), [amountB, setB] = useState('0.001'), [working, setWorking] = useState(''), [error, setError] = useState('');
  useEffect(() => { let alive = true; let timer: ReturnType<typeof setTimeout>; const refresh = async () => { try { const next = await api('/state'); if (alive) setState(next); } catch { if (alive) setError('The local workspace is unavailable.'); } if (alive) timer = setTimeout(refresh, 2500); }; void refresh(); return () => { alive = false; clearTimeout(timer); }; }, []);
  const session = state?.sessions.find(s => s.id === selected) ?? state?.sessions.at(-1);
  const busy = Boolean(working || state?.busy), pending = Boolean(session?.pending), expired = session ? session.timestamp >= session.deadline : false;
  async function run(label: string, path: string, body: unknown) { setWorking(label); setError(''); try { const updated = await api(path, body); setSelected(updated.id); setState(await api('/state')); } catch (e) { setError(e instanceof Error ? e.message : 'Local operation failed.'); } finally { setWorking(''); } }
  const act = (action: string, label: string) => void run(label, '/action', { id: session?.id, action });
  return <>
    <div className={styles.notice}><strong>Local network · simulated proofs</strong><br />This workspace controls both disposable demo wallets. The shared SDK executes the real escrow and pool contracts locally.</div>
    {working && <p role="status" className={styles.notice}>{working}…</p>}
    {error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p>}
    {!state?.ready ? <section className={styles.card}><h2>{state?.bootFailed ? 'Local startup failed' : 'Preparing the local wallets'}</h2><p>Registering the controlled wallets and shielding their test balances before the trade.</p></section> : <>
      <form className={styles.card} onSubmit={event => { event.preventDefault(); try { void run('Creating the agreed escrow', '/session', { amountA: units(amountA), amountB: units(amountB) }); } catch (e) { setError((e as Error).message); } }}>
        <div className={styles.row}><h2>Agree on a swap</h2><span className={styles.badge}>STRK / ETH · local quote</span></div>
        <div className={styles.fields}><label>Alice sends · STRK<input inputMode="decimal" value={amountA} onChange={e => setA(e.target.value)} disabled={busy} /></label><label>Bob sends · ETH<input inputMode="decimal" value={amountB} onChange={e => setB(e.target.value)} disabled={busy} /></label></div>
        <button className={styles.button} disabled={busy}>Create escrow for these terms</button>
        <p>Each party approves the same amounts and destinations. Funding is separate; an incomplete trade can be refunded after one hour.</p>
      </form>
      {session && <section className={styles.card} aria-label="Confidential swap session">
        {state.sessions.length > 1 && <label>Escrow session <select value={session.id} disabled={busy} onChange={e => setSelected(e.target.value)}>{state.sessions.map((item, i) => <option key={item.id} value={item.id}>Swap {i + 1} · {format(item.amountA)} STRK / {format(item.amountB)} ETH</option>)}</select></label>}
        <div className={styles.row}><span className={styles.badge}>{session.status === 'ready' ? 'Both sides funded' : session.settled ? 'Exchange complete' : session.status === 'refundable' ? 'Refunds available' : session.status === 'closed' ? 'Funds recovered' : 'Awaiting ' + (session.registered ? 'funding' : 'joint setup')}</span><span>Deadline {new Date(session.deadline * 1000).toLocaleTimeString()}</span></div>
        <h2 className={styles.amount}>{format(session.amountA)} STRK <span aria-hidden="true">⇄</span> {format(session.amountB)} ETH</h2>
        {!session.registered && <button className={styles.button} disabled={busy || pending || expired} onClick={() => act('setup', 'Both demo parties are approving setup')}>Approve setup with both demo wallets</button>}
        {session.registered && <div className={styles.funding}>
          <article><h3>Alice · STRK</h3><p>{format(session.balanceA)} STRK in escrow</p><button className={styles.button} disabled={busy || pending || expired || session.settled || BigInt(session.balanceA) >= BigInt(session.amountA)} onClick={() => act('fundA', 'Alice is funding her side')}>Fund Alice’s side</button>{expired && BigInt(session.balanceA) > 0n && <p><button className={`${styles.button} ${styles.secondary}`} disabled={busy || pending} onClick={() => act('refundA', 'Alice is recovering her STRK')}>Refund Alice</button></p>}</article>
          <article><h3>Bob · ETH</h3><p>{format(session.balanceB)} ETH in escrow</p><button className={styles.button} disabled={busy || pending || expired || session.settled || BigInt(session.balanceB) >= BigInt(session.amountB)} onClick={() => act('fundB', 'Bob is funding his side')}>Fund Bob’s side</button>{expired && BigInt(session.balanceB) > 0n && <p><button className={`${styles.button} ${styles.secondary}`} disabled={busy || pending} onClick={() => act('refundB', 'Bob is recovering his ETH')}>Refund Bob</button></p>}</article>
        </div>}
        {session.status === 'ready' && <button className={styles.button} disabled={busy || pending} onClick={() => act('settle', 'Both parties are approving and proving the exchange')}>Approve both sides & exchange</button>}
        {session.settled && <p className={styles.notice}>Both assets were delivered as encrypted notes in one local transaction.</p>}
        {session.registered && !expired && !session.settled && <p><button className={`${styles.button} ${styles.secondary}`} disabled={busy} onClick={() => act('expire', 'Advancing the local clock')}>Advance local time to refund</button></p>}
        {pending && <button className={`${styles.button} ${styles.secondary}`} disabled={busy} onClick={() => act('reconcile', 'Checking the pending receipt')}>Check pending submission</button>}
        <details className={styles.history}><summary>Local transaction history</summary>{session.hashes.map(item => <div key={item.hash}>{item.action}: {item.hash}</div>)}<div>Escrow: {session.id}</div></details>
      </section>}
    </>}
    <section className={styles.disclosure}><h2>Private amounts, visible activity</h2><p>Settlement amounts and assets stay encrypted inside the pool. Escrow activity, timing and fees remain visible. A hosted prover would receive the private payload; this local test simulates proving.</p></section>
  </>;
}
