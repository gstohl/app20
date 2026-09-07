# APP20 — three-minute demo voiceover

Delivery: calm, conversational, approximately 125–135 words per minute. Read only the quoted text. Leave a short pause after each sentence and let the cursor arrive before naming a control. This script describes the current rehearsal accurately; do not describe the simulated RFQ confirmation as a real mainnet trade.

| Time | Visual | Voiceover |
| --- | --- | --- |
| 0:00–0:20 | Live RFQ page; cursor introduces the amount and minimum fields. | “This is APP20: a workspace for private conversations and trading on Starknet. You can negotiate directly with another person, or ask independent makers for quotes. Let’s follow both paths. This recording combines the live interface with clearly labelled localnet and simulated demonstrations.” |
| 0:20–0:50 | Bob writes a message to Alice; pause on the composed message and its confirmation. | “First, Bob opens a conversation with Alice and asks for a price. The message is encrypted before it is submitted. Alice opens it with her chat key and can reply in the same conversation. The message content is private, but transaction timing and some activity metadata remain visible. Here, Alice and Bob are running on localnet.” |
| 0:50–1:30 | Alice attaches terms; Bob reviews the fixed offer. Use a labelled cut between the two identities. | “Alice can attach a fixed offer instead of leaving the terms buried in a message. She specifies the amount, the quoted asset, and an expiry. Bob can review those terms in the conversation before acting. There is an important distinction here: a Chat offer is a negotiation record. Paying it does not guarantee that the other asset will arrive. For an atomic exchange of both assets, use the funded RFQ flow.” |
| 1:30–1:55 | Enter the sell amount, then the minimum receive amount. | “In RFQ, start with what you want to sell and the minimum you are willing to receive. That minimum is your limit. You don’t need to pick a maker first: request quotes and let the app compare the replies. Nothing swaps just because you ask for a price.” |
| 1:55–2:20 | Pause on the best preliminary quote, then request its funded offer. | “The app compares eligible replies and shows the best price. Replies below your minimum are excluded. These first prices are preliminary; they do not reserve funds. When you choose to continue, only the selected maker is asked for a funded offer. You can still choose a particular maker under Advanced.” |
| 2:20–3:00 | Review the changed funded price; cursor pauses over the confirmation control; show the simulated settled state. | “Now review the funded terms. Here, the final price changed, so APP20 asks for another explicit review. Your minimum still applies. Confirming executes the atomic swap, with the received asset returning to the shielded balance. This confirmation uses a simulated wallet and RPC, not mainnet evidence. Maker funding and trade amounts are public, and our remote proving infrastructure can see the proving payload. Private trading should make those boundaries clear, alongside the price and the terms.” |

## Recording and edit notes

- Keep the cursor visible. Move to a control, pause, click, then pause on the result.
- Keep footage at normal speed. Use clear cuts to omit setup or waiting, never accelerated scrolling or typing.
- Leave the minimum, best quote, changed funded price, and final state visible for several seconds each.
- Maintain the localnet/fixture labels throughout. The three mainnet proof transactions are still outstanding.
- For the actual submission, replace the simulated RFQ segment with real execution footage and verified receipts, then rewrite the corresponding narration. Do not merely remove the rehearsal label.
