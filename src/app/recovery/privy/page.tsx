import PrivyRailGate from "@/app/components/PrivyRailGate";
import SecondaryRailShell from "@/app/components/SecondaryRailShell";
import { lazy, Suspense } from "react";

const PrivySepoliaVault = lazy(() => import("@/app/rfq/PrivySepoliaVault"));

export default function PrivyRecoveryPage() {
  return (
    <PrivyRailGate>
      <SecondaryRailShell
        boundary="Recovery · not RFQ execution"
        title="Privy Sepolia recovery"
        summary="Recovery is a separate wallet operation on its own rail. It never proves RFQ settlement and cannot fund, fill, claim, or refund a maker trade."
      >
        <Suspense fallback={<p>Loading recovery…</p>}>
          <PrivySepoliaVault />
        </Suspense>
      </SecondaryRailShell>
    </PrivyRailGate>
  );
}
