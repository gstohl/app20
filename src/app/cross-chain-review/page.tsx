import SecondaryRailShell from "@/app/components/SecondaryRailShell";
import IntentsPage from "@/app/intents/page";

export default function CrossChainReviewPage() {
  return (
    <SecondaryRailShell
      boundary="Dry review only"
      title="Cross-chain review"
      summary="This compatibility surface does not request, fund, bridge, fill, or settle an RFQ. Nothing here is submitted anywhere."
    >
      <IntentsPage />
    </SecondaryRailShell>
  );
}
