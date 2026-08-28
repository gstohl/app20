import { Link } from "@tanstack/react-router";
export default function SendPage() { return <main><strong>PUBLIC BOUNDARY</strong><h1>Public send</h1><p>Public sends expose sender, recipient, amount, and timing on-chain. They are separate from RFQ, Mail, and funding. This separated surface does not submit in this build.</p><Link to="/pay">Open payment request</Link></main>; }
