import React from 'react';
import {AbsoluteFill, Composition, registerRoot, useCurrentFrame, interpolate} from 'remotion';

type Receipt = {hash: string; blockNumber: number; finality: string};
type Scene = {kind?: 'capture' | 'evidence' | 'closing' | 'intro'; motionOpening?: number; confidential?: boolean; browserPath?: string; title: string; caption: string; label: string};
type Props = {scene: Scene; index: number; total: number; receipts: Receipt[]; verifiedAt: string};
const orange = '#f47736';
const muted = '#b5b8b2';

function DemoFrame({scene, index, total, receipts, verifiedAt}: Props) {
  const frame = useCurrentFrame();
  const reveal = (delay = 0) => interpolate(frame, [delay, delay + 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opening = scene.kind === 'intro' || (scene.motionOpening && frame < scene.motionOpening * 30);
  const graphic = scene.kind === 'evidence' || scene.kind === 'closing' || !!opening;
  return <AbsoluteFill style={{background: graphic ? '#0b0d0c' : 'transparent', color: '#f6f4ed', fontFamily: 'Arial, sans-serif'}}>
    <div style={{position: 'absolute', inset: '0 0 auto', height: 58, background: '#0b0d0c', borderBottom: '1px solid #343832', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px'}}>
      <strong style={{fontSize: 29, letterSpacing: -1}}>APP<span style={{color: orange}}>[20]</span></strong>
      <span style={{fontSize: 18, color: muted, letterSpacing: 2}}>CHAT / RFQ / AGENTS</span>
      <span style={{padding: '6px 12px', border: '1px solid #5c4736', color: '#ffad79', fontSize: 15, letterSpacing: .8}}>{scene.label}</span>
    </div>

    {!graphic && <div style={{position: 'absolute', left: 94, top: 86, width: 1732, height: 854, borderRadius: 18, border: '2px solid #555963', boxShadow: '0 18px 38px #0008', overflow: 'hidden'}}>
      <div style={{height: 46, background: '#e8e9ed', display: 'flex', alignItems: 'center', gap: 9, padding: '0 20px', color: '#555b65'}}>
        {['#ff5f57', '#febc2e', '#28c840'].map(color => <span key={color} style={{width: 13, height: 13, borderRadius: '50%', background: color}} />)}
        <div style={{position: 'absolute', left: 510, width: 710, textAlign: 'center', fontSize: 17, background: '#f7f7f9', padding: '5px 0', borderRadius: 7}}>{scene.browserPath ?? `app20.io${scene.label.startsWith('CHAT') ? '/chat' : scene.title.includes('SDK') ? '/agents' : scene.title.includes('maker') ? '/rfq/maker' : '/rfq'}`}</div>
      </div>
    </div>}

    {opening && <div style={{position: 'absolute', top: 58, bottom: 110, left: 0, right: 0, overflow: 'hidden', background: 'radial-gradient(ellipse at 75% 50%, #252d42 0%, #0b0d0c 65%)'}}>
      <div style={{position: 'absolute', width: 650, height: 650, border: '1px solid #f4773640', borderRadius: '50%', right: 80, top: 90, transform: `scale(${1 + frame / 2400})`}} />
      <div style={{position: 'absolute', left: 96, top: 125, right: 96, opacity: reveal(), transform: `translateY(${30 * (1 - reveal())}px)`}}>
        <div style={{color: orange, fontSize: 22, letterSpacing: 5}}>APP20 / STARKNET</div>
        <h1 style={{fontSize: 91, lineHeight: 1.08, letterSpacing: -4, margin: '32px 0 54px'}}>{scene.kind === 'intro' ? <>Start a conversation.<br/>Agree on the trade.</> : <>From conversation<br/>to a clear quote.</>}</h1>
        <div style={{display: 'flex', gap: 20}}>{(scene.kind === 'intro' ? ['01  ENCRYPTED CHAT', '02  COMPARE QUOTES', '03  PRIVATE SETTLEMENT'] : ['YOUR AMOUNT', 'YOUR MINIMUM', 'YOUR CONFIRMATION']).map((text, i) => <div key={text} style={{opacity: reveal(12 + i * 9), transform: `translateY(${20 * (1 - reveal(12 + i * 9))}px)`, padding: '26px 32px', background: '#141714', border: '1px solid #555343', borderTop: '2px solid #f47736', fontSize: 23, letterSpacing: 1}}>{text}</div>)}</div>
      </div>
    </div>}

    {scene.kind === 'evidence' && <div style={{position: 'absolute', top: 122, left: 80, right: 80}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
        <h1 style={{fontSize: 49, margin: 0, letterSpacing: -1}}>Three confirmed mainnet swaps</h1>
        <span style={{fontSize: 19, color: muted}}>Rechecked {new Date(verifiedAt).toISOString().slice(0, 10)}</span>
      </div>
      <p style={{fontSize: 25, color: muted, margin: '16px 0 32px'}}>Real STRK20 proofs. Executed through the APP20 Node SDK.</p>
      {receipts.map((receipt, i) => <div key={receipt.hash} style={{background: '#141714', border: '1px solid #384038', borderLeft: '4px solid #71dc98', padding: '22px 28px', marginBottom: 16}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24}}>
          <span style={{color: orange, fontSize: 24, width: 118}}>SWAP {i + 1}</span>
          <strong style={{fontSize: 36, flex: 1}}>0.01 shielded STRK <span style={{color: muted}}>→</span> 0.001 shielded USDC</strong>
          <span style={{fontSize: 19, color: '#92e8ad'}}>{receipt.finality === 'ACCEPTED_ON_L1' ? 'L1 CONFIRMED' : 'L2 CONFIRMED'}</span>
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 20, color: muted, fontSize: 19}}>
          <span style={{fontFamily: 'monospace'}}>{receipt.hash}</span>
          <span>Block {receipt.blockNumber.toLocaleString('en-US')}</span>
        </div>
      </div>)}
      <div style={{display: 'flex', gap: 38, marginTop: 28, color: '#a8deb4', fontSize: 22}}>
        <span>✓ Successful receipts</span><span>✓ QuoteFilled events</span><span>✓ APP20 + STRK20 traces</span><span>✓ Contract class hashes</span>
      </div>
      <p style={{fontSize: 22, color: muted, marginTop: 24}}>One operator controlled maker and taker. These are controlled settlement tests.</p>
    </div>}

    {scene.kind === 'closing' && <div style={{position: 'absolute', top: 162, left: 110, right: 110, opacity: reveal(), transform: `translateY(${24 * (1 - reveal())}px)`}}>
      <p style={{color: orange, letterSpacing: 3, fontSize: 22}}>BUILT ON STARKNET</p>
      <h1 style={{fontSize: 86, lineHeight: 1.12, letterSpacing: -3, margin: '24px 0 40px'}}>Conversations.<br/>Clear terms. Private settlement.</h1>
      <strong style={{fontSize: 58, color: orange}}>app20.io</strong>
      <div style={{display: 'flex', gap: 24, marginTop: 54}}>
        {(scene.confidential ? [['CONFIDENTIAL RFQ', 'Local execution · real proofs pending'], ['CHAT', 'Localnet · mainnet deployment pending'], ['AGENTS', 'Separate approvals + durable recovery']] : [['RFQ', 'Compare, review and settle'], ['CHAT', 'Localnet · mainnet deployment pending'], ['AGENTS', 'Node.js SDK + permissionless makers']]).map(([title, text]) => <div key={title} style={{flex: 1, padding: '24px', borderTop: '2px solid #454d43', background: '#141714'}}><strong style={{fontSize: 22, color: orange}}>{title}</strong><p style={{fontSize: 23, lineHeight: 1.4, marginBottom: 0}}>{text}</p></div>)}
      </div>
      <p style={{fontSize: 22, lineHeight: 1.5, color: muted, marginTop: 30}}>{scene.confidential ? 'Public activity and timing remain visible. A hosted prover sees the private payload. Mainnet activation is pending.' : 'Funding and trade amounts are public. The relay and proving provider can access proving payloads.'}</p>
    </div>}

    <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 110, background: '#0b0d0c', borderTop: '1px solid #343832', padding: '16px 32px', boxSizing: 'border-box'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', gap: 28}}><strong style={{fontSize: 27}}>{scene.title}</strong><span style={{color: muted, fontSize: 19, whiteSpace: 'nowrap'}}> {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span></div>
      <p style={{fontSize: 21, color: muted, lineHeight: 1.3, margin: '8px 0 0', maxWidth: 1740}}>{scene.caption}</p>
      <div style={{position: 'absolute', bottom: 0, left: 0, height: 3, width: `${100 * (index + 1) / total}%`, background: orange}} />
    </div>
  </AbsoluteFill>;
}

registerRoot(() => <Composition id="DemoFrame" component={DemoFrame} width={1920} height={1080} fps={30} durationInFrames={1} defaultProps={{scene: {title: '', caption: '', label: ''}, index: 0, total: 1, receipts: [], verifiedAt: '2026-09-07T00:00:00Z'}} />);
