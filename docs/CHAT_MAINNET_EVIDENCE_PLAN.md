# Additional mainnet evidence

Prepared September 7, 2026. No new transactions signed or submitted.

Retain the three verified RFQ swaps in `strk20.json`. Add a successful pool-backed Chat message and a Chat payment once the separate Chat helper is deployed and verified. Registration and deployment are setup evidence, not qualifying pool interactions. The current Chat contract invokes through the pool; verify pool and Chat events for each new receipt before adding it to the manifest.

The current App20Chat source rebuilt successfully with Scarb 2.18.0. The unsigned candidate is in the ignored local `artifacts/hackathon/v6/chat-mainnet-preparation/candidate.json`:

- Class hash: `0x2e6fd0b464b0a7a1c8793b5d18609609e167af5ce7916e28821af34b5de4b12`.
- Existing deployer: `0x2baf5bf273ff0ecf729e1b9d455889a2dfbc831c944e48a124367295d2d6bc3`.
- Predicted helper address, unique salt 1: `0x501331396a00e95a4b520502ff73155412e056bd42bc41cb115deb656d97ae4`.
- Read-only mainnet inspection at block 14512987 confirmed the expected pool class and a 6 STRK pool fee per invocation.

Execution order: declare the exact candidate, deploy it with the pinned pool constructor, verify class and pool storage, configure the Chat runtime address, register two controlled accounts, execute message and payment flows, then verify receipts/events and discovery before updating submission evidence and the video. Proving-provider compatibility must be checked before sending; a working receipt RPC alone does not establish proof submission compatibility.

The earlier deployment and demo consumed 63.910369825551435280 STRK of the 65 STRK fee ceiling. The remaining allowance cannot cover even one 6 STRK pool invocation. An additional total fee ceiling is required for this run; include declaration, deployment, registration, funding and at least two pool invocations plus network fees. No exact network-fee estimate has been produced. Payment principal must also be specified before payment execution.
