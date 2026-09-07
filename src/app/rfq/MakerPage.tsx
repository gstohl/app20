import MakerSetup from './MakerSetup';
import { RfqNavigation } from './RfqNavigation';
import styles from './rfq.module.css';

export default function MakerPage() {
  return <main className={styles.page} aria-label="Maker workspace">
    <h1 className={styles.workspaceTitle}>Maker recovery</h1>
    <RfqNavigation />
    <MakerSetup />
  </main>;
}
