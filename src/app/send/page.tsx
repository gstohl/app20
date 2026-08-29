import SecondaryRailShell from "@/app/components/SecondaryRailShell";
import { Link } from "@tanstack/react-router";

export default function SendPage() {
  return (
    <SecondaryRailShell
      boundary="Public boundary · unavailable in this build"
      title="Public send"
      summary="A public send exposes sender, recipient, amount, and timing on-chain. It is separate from RFQ, Mail, and funding."
    >
      <section aria-label="Public send availability">
        <h2>Unavailable in this build</h2>
        <p>
          Public send is not implemented here, so nothing on this page can move
          value. Use a payment request when you need someone to pay you, or
          return to RFQ for a private maker trade.
        </p>
        <Link to="/pay">Open payment request</Link>
      </section>
    </SecondaryRailShell>
  );
}
