"use client";

import type { CSSProperties } from "react";
import styles from "./uni.module.css";
import SelectWallet from "./components/client/WalletHandle/SelectWallet";
import WalletAccountV6Tag from "./components/client/WalletHandle/WalletAccountV6Tag";
import {
  BtcCoin,
  EthCoin,
  StrkCoin,
  UsdcCoin,
  ZecCoin,
} from "./components/TokenIcons";

type BgToken = {
  Coin: (props: { size?: number }) => React.ReactElement;
  pos: CSSProperties;
  size: number;
  blur: number;
  opacity: number;
};

const BG_TOKENS: BgToken[] = [
  {
    Coin: StrkCoin,
    pos: { top: "30%", left: "3%" },
    size: 116,
    blur: 5,
    opacity: 0.55,
  },
  {
    Coin: BtcCoin,
    pos: { top: "38%", left: "18%" },
    size: 92,
    blur: 4,
    opacity: 0.5,
  },
  {
    Coin: ZecCoin,
    pos: { top: "64%", left: "9%" },
    size: 140,
    blur: 6,
    opacity: 0.5,
  },
  {
    Coin: EthCoin,
    pos: { top: "11%", left: "22%" },
    size: 84,
    blur: 4,
    opacity: 0.5,
  },
  {
    Coin: UsdcCoin,
    pos: { top: "86%", left: "20%" },
    size: 104,
    blur: 5,
    opacity: 0.5,
  },
  {
    Coin: EthCoin,
    pos: { top: "7%", right: "18%" },
    size: 128,
    blur: 5,
    opacity: 0.55,
  },
  {
    Coin: BtcCoin,
    pos: { top: "12%", right: "4%" },
    size: 96,
    blur: 4,
    opacity: 0.5,
  },
  {
    Coin: StrkCoin,
    pos: { top: "54%", right: "6%" },
    size: 132,
    blur: 6,
    opacity: 0.55,
  },
  {
    Coin: UsdcCoin,
    pos: { top: "76%", right: "9%" },
    size: 104,
    blur: 5,
    opacity: 0.5,
  },
  {
    Coin: ZecCoin,
    pos: { top: "88%", right: "20%" },
    size: 100,
    blur: 5,
    opacity: 0.48,
  },
];

export default function Page() {
  return (
    <div className={styles.page}>
      <div className={styles.aurora} aria-hidden>
        {BG_TOKENS.map((token, index) => (
          <span
            key={index}
            className={styles.tok}
            style={{
              ...token.pos,
              filter: `blur(${token.blur}px)`,
              opacity: token.opacity,
            }}
          >
            <token.Coin size={token.size} />
          </span>
        ))}
      </div>

      <nav className={styles.nav}>
        <a className={styles.brand} href="/" aria-label="Feltproof home">
          <span className={styles.brandMark}>F</span>
          <span>Feltproof</span>
        </a>
        <SelectWallet variant="nav" />
      </nav>

      <header className={styles.hero}>
        <div className={styles.eyebrow}>STRK20 PRIVATE POKER</div>
        <h1 className={styles.heroTitle}>
          Shield chips.
          <br />
          <span className={styles.heroAccent}>Keep your seat private.</span>
        </h1>
        <p className={styles.heroSub}>
          Feltproof is building provably fair poker on Starknet. Phase 1 connects
          Ready and exercises shield, private self-transfer, unshield, and balances
          with STRK on Sepolia.
        </p>
      </header>

      <main>
        <WalletAccountV6Tag />
      </main>

      <footer className={styles.footer}>
        <a
          href="https://github.com/gstohl/feltproof"
          target="_blank"
          rel="noreferrer"
        >
          Feltproof repo
        </a>
        <span className={styles.footerDot}>·</span>
        <span>Powered by STRK20 and starknet.js 10.4.0</span>
      </footer>
    </div>
  );
}
