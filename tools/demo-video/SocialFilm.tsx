import React from 'react';
import {AbsoluteFill, Composition, Easing, interpolate, registerRoot, useCurrentFrame} from 'remotion';

type Receipt = {hash: string; blockNumber: number; finality: string};
type Scene = {
  kind?: 'capture' | 'evidence' | 'closing' | 'intro';
  browserPath?: string;
  title: string;
  caption: string;
  label: string;
};
type Props = {scene: Scene; index: number; total: number; receipts: Receipt[]; verifiedAt: string};

const background = '#111214';
const foreground = '#f5f4f0';
const muted = '#b9bbc0';
const orange = '#f47736';
const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

function DemoFrame({scene, index, total}: Props) {
  const frame = useCurrentFrame();
  const closing = scene.kind === 'closing';
  const reveal = (delay: number) => interpolate(frame, [delay, delay + 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const logo = reveal(0);
  const tagline = reveal(8);
  const address = reveal(16);

  return <AbsoluteFill style={{background: closing ? background : 'transparent', color: foreground, fontFamily, pointerEvents: 'none'}}>
    {!closing && <>
      {/* Leave x60 y72, 1800x900 transparent for the captured page beneath this overlay. */}
      <div style={{position: 'absolute', left: 0, top: 0, width: 1920, height: 72, background}} />
      <div style={{position: 'absolute', left: 0, top: 72, width: 60, height: 900, background}} />
      <div style={{position: 'absolute', left: 1860, top: 72, width: 60, height: 900, background}} />
      <div style={{position: 'absolute', left: 0, top: 972, width: 1920, height: 108, background}} />

      <div style={{position: 'absolute', left: 58, top: 36, width: 1804, height: 940, boxSizing: 'border-box', border: '2px solid #62656b', borderRadius: 0, boxShadow: '0 10px 24px #0004'}} />
      <div style={{position: 'absolute', left: 60, top: 38, width: 1800, height: 34, background: '#d7d8db', color: '#484b51', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{position: 'absolute', left: 14, display: 'flex', gap: 7}}>
          {['#ed655a', '#e8b747', '#62bc61'].map(color => <span key={color} style={{display: 'block', width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: 'inset 0 0 0 1px #00000012'}} />)}
        </div>
        <span style={{fontSize: 15, fontWeight: 500, letterSpacing: .15}}>{scene.browserPath ?? 'app20.io/rfq'}</span>
        <span style={{position: 'absolute', right: 14, fontSize: 11, fontWeight: 600, letterSpacing: 1.15}}>{scene.label || 'PRODUCT PREVIEW'}</span>
      </div>
    </>}

    {closing && <div style={{position: 'absolute', left: 60, top: 72, width: 1800, height: 900, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{fontSize: 132, fontWeight: 750, lineHeight: 1.1, letterSpacing: -6, opacity: logo, transform: `translateY(${18 * (1 - logo)}px)`}}>APP<span style={{color: orange}}>[20]</span></div>
      <p style={{fontSize: 40, fontWeight: 400, letterSpacing: -.7, lineHeight: 1.3, margin: '30px 0 0', opacity: tagline, transform: `translateY(${12 * (1 - tagline)}px)`}}>Encrypted conversations. Clear terms.</p>
      <p style={{fontSize: 32, fontWeight: 600, letterSpacing: .3, lineHeight: 1.2, margin: '38px 0 0', color: orange, opacity: address, transform: `translateY(${10 * (1 - address)}px)`}}>app20.io</p>
    </div>}

    <div style={{position: 'absolute', left: 0, top: 990, width: 1920, height: 90, background, padding: '9px 60px 10px', boxSizing: 'border-box'}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 24}}>
        <strong style={{fontSize: 27, fontWeight: 650, lineHeight: 1.2, letterSpacing: -.4}}>{scene.title}</strong>
        <span style={{fontSize: 14, lineHeight: 1.2, color: muted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'}}>{String(index + 1).padStart(2, '0')} / {String(Math.max(total, 1)).padStart(2, '0')}</span>
      </div>
      <p style={{fontSize: 20, lineHeight: 1.25, fontWeight: 400, color: muted, margin: '5px 0 0'}}>{scene.caption}</p>
      <div style={{position: 'absolute', left: 60, bottom: 0, width: 1800 * Math.min(1, Math.max(0, (index + 1) / Math.max(total, 1))), height: 2, background: orange}} />
    </div>
  </AbsoluteFill>;
}

registerRoot(() => <Composition id="DemoFrame" component={DemoFrame} width={1920} height={1080} fps={30} durationInFrames={1} defaultProps={{scene: {title: '', caption: '', label: 'PRODUCT PREVIEW'}, index: 0, total: 1, receipts: [], verifiedAt: ''}} />);
