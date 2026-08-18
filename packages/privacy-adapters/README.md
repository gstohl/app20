# `@vlt20/privacy-adapters`

Fail-closed wallet and network policy plus normalized privacy intents for VLT20.

## Deployment policy

| Network | Ready Wallet Standard adapter | Privy browser adapter | Localnet adapter |
| --- | --- | --- | --- |
| Mainnet | Allowed | Blocked | Blocked |
| Sepolia | Allowed | Allowed | Blocked |
| Localnet | Blocked | Blocked | Build-gated only |

The policy is enforced before an adapter may sign, discover, prove, or submit. A hidden button is not a security boundary. `PolicyBoundPrivacyAdapter` separates `build()` from `submit()`, so build-only sessions cannot accidentally call the delegate submission method.

Ready identification uses the Wallet Standard feature ID, not its display name. This remains a product routing control rather than cryptographic brand attestation.

Canonical mail intents contain ciphertext only. They require an explicit reviewed helper-funding amount because the existing pool rejects an unfunded OPEN recovery note. No compiler may invent a default.
