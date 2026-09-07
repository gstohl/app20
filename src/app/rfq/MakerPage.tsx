import MakerSetup from './MakerSetup';
import { RfqNavigation } from './MainnetTradeWorkspace';
import styles from './rfq.module.css';

export default function MakerPage() {
  return <main className={styles.page} aria-label="Maker workspace">
    <h1 className={styles.workspaceTitle}>Private RFQ</h1>
    <RfqNavigation maker />
    <MakerSetup />
  </main>;
}
