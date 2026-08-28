import PrivyRailGate from "@/app/components/PrivyRailGate";
import { lazy, Suspense } from "react";

const PrivySepoliaVault = lazy(() => import("@/app/rfq/PrivySepoliaVault"));
export default function PrivyRecoveryPage() {
  return <PrivyRailGate><main><strong>RECOVERY · NOT RFQ EXECUTION</strong><h1>Privy Sepolia recovery</h1><p>Recovery is a separate wallet operation and never proves RFQ settlement.</p><Suspense fallback={<p>Loading recovery…</p>}><PrivySepoliaVault/></Suspense></main></PrivyRailGate>;
}
