import ReadyRailGate from "@/app/components/ReadyRailGate";
import SecondaryRailShell from "@/app/components/SecondaryRailShell";
import FundingReadinessPanel from "@/app/funding/FundingReadinessPanel";
import PrivacyWalletMenu from "@/app/rfq/PrivacyWalletMenu";

export default function FundingPage() {
  return (
    <ReadyRailGate moduleName="Funding">
      <SecondaryRailShell
        boundary="Funding · separate wallet operation"
        title="Shield / unshield"
        summary="Shielding and unshielding are explicit public-chain boundaries. They are never bundled with RFQ acceptance, they do not prove settlement, and their amounts and timing stay publicly correlatable."
      >
        <FundingReadinessPanel>
          <PrivacyWalletMenu showIdentity active />
        </FundingReadinessPanel>
      </SecondaryRailShell>
    </ReadyRailGate>
  );
}
