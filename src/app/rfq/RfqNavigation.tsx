import { Link, useRouterState } from '@tanstack/react-router';
import styles from './rfq.module.css';

export function RfqNavigation() {
  const pathname = useRouterState({ select: state => state.location.pathname });
  return <nav className={styles.deskSubnav} aria-label="RFQ workspace">
    <Link to="/rfq" activeOptions={{ exact: true }} aria-current={pathname === '/rfq' ? 'page' : undefined}>Overview</Link>
    <Link to="/rfq/confidential" aria-current={pathname === '/rfq/confidential' ? 'page' : undefined}>Confidential RFQ</Link>
    <Link to="/rfq/maker" aria-current={pathname === '/rfq/maker' ? 'page' : undefined}>Maker recovery</Link>
    <Link to="/funding" title="Separate shielding and unshielding; amounts are public" aria-current={pathname === '/funding' ? 'page' : undefined}>Wallet funding</Link>
  </nav>;
}
