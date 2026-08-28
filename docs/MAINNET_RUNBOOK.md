# APP20 Mainnet scoring runbook — archived

This runbook is superseded by [`LOCALNET_SCOPE_DECISION.md`](LOCALNET_SCOPE_DECISION.md). APP20 is localnet-final; no Mainnet APP20 helper/escrow deployment or scoring broadcast path is shipped or authorized.

The former executable helper-deployment command and script were removed. Mainnet remains available only for Ready wallet actions already described by the product network policy. Production Private Desk/RFQ and authoritative browser receipts remain disabled. Live APP20 helper constants are hard-coded to `0x0`, and `strk20.json` must not be populated with historical Sepolia proof values.

Historical design facts retained for future review:

- the canonical Mainnet STRK20 pool is `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`;
- App20Mail source takes one pinned pool constructor argument;
- any future Mainnet helper requires independent review, reproducible artifact/class-hash evidence, explicit deployment/value approval, real transaction verification, and a newly approved operational runbook;
- no future approval for App20Mail would authorize canonical App20Escrow/App20Claim or production RFQ.

Do not reconstruct deployment commands from repository history without a new scoped security review and explicit human approval.
