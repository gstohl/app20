import ReadyRailGate from "@/app/components/ReadyRailGate";
import PrivacyWalletMenu from "@/app/rfq/PrivacyWalletMenu";

export default function FundingPage() {
  return <ReadyRailGate moduleName="Funding"><main><header><strong>FUNDING · SEPARATE WALLET OPERATION</strong><h1>Shield / unshield</h1><p>Shield and unshield are explicit public-chain boundaries. They are never bundled with RFQ acceptance, do not prove settlement, and may be timing-correlated.</p></header><PrivacyWalletMenu showIdentity active/></main></ReadyRailGate>;
}
