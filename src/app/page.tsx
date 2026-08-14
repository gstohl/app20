"use client";

import { Link } from "@tanstack/react-router";
import styles from "./uni.module.css";
import SelectWallet from "./components/client/WalletHandle/SelectWallet";
import WalletAccountV6Tag from "./components/client/WalletHandle/WalletAccountV6Tag";

export default function Page() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Link className={styles.brand} to="/" aria-label="Quietline home">
          <span className={styles.brandMark}>Q</span>
          <span>Quietline</span>
        </Link>
        <SelectWallet variant="nav" />
      </nav>

      <header className={styles.hero}>
        <div className={styles.eyebrow}>STRK20 PRIVATE MAIL</div>
        <h1 className={styles.heroTitle}>
          Write in private.
          <br />
          <span className={styles.heroAccent}>Send a memo with the money.</span>
        </h1>
        <p className={styles.heroSub}>
          Quietline is encrypted on-chain mail on Starknet. Connect Ready for
          shielded STRK actions, then open the inbox to register a mail key,
          compose ciphertext, and decrypt messages locally.
        </p>
        <Link className={styles.inboxLink} to="/inbox">
          Open inbox →
        </Link>
      </header>

      <main>
        <WalletAccountV6Tag />
      </main>

      <footer className={styles.footer}>
        <a
          href="https://github.com/gstohl/quietline"
          target="_blank"
          rel="noreferrer"
        >
          Quietline repo
        </a>
        <span className={styles.footerDot}>·</span>
        <span>Powered by STRK20 and starknet.js 10.4.0</span>
      </footer>
    </div>
  );
}
