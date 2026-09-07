import PrivyRailGate from "@/app/components/PrivyRailGate";
import SecondaryRailShell from "@/app/components/SecondaryRailShell";
import { lazy, Suspense } from "react";

const PrivySepoliaVault = lazy(() => import("@/app/rfq/PrivySepoliaVault"));

export default function PrivyRecoveryPage() {
  return (
    <PrivyRailGate>
      <SecondaryRailShell
        boundary="Shielded wallet and recovery"
        title="Privy wallet"
        summary="Register, shield, transfer and withdraw with your Privy account. Proving uses HTTPS: APP20/Cloudflare and the provider can access proving payloads."
      >
        <Suspense fallback={<p>Loading recovery…</p>}>
          <PrivySepoliaVault />
        </Suspense>
      </SecondaryRailShell>
    </PrivyRailGate>
  );
}
