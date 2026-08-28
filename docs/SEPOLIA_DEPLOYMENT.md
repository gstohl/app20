# APP20 Sepolia evidence and blocked production manifest

APP20 is localnet-final. This repository intentionally contains **no funding, credential-creation, broadcast, declaration, deployment, or live fee-estimation command** for Sepolia.

## What remains

- `deployments/sepolia/deployment-manifest.template.json` is the canonical production template. It remains `releaseReady: false`, with `deploymentAllowed: false`, zero class hashes/addresses, empty audit/evidence arrays, and false approvals.
- `deployments/sepolia/deployment-manifest.schema.json` describes that blocked template.
- [`evidence/historical-sepolia-proofs/`](evidence/historical-sepolia-proofs/) records an App20Mail one-off proof and the historical/localnet App20Escrow/ClaimTicket proof. Every record is `runtimeAllowed: false`, `productionEligible: false`, and separated from `deployments/` so it cannot look like a canonical candidate.
- Sierra/CASM copies are not retained under a live-looking Sepolia deployment namespace. Their SHA-256/class-hash attestations remain in the historical records.

No local-test token artifact or identity is included in Sepolia evidence.

## Offline validation

These commands read only checked-in JSON and do not contact a network:

```bash
npm run sepolia:manifest:validate
npm run sepolia:evidence:validate
```

The first validates only the intentionally blocked production template. The second validates the immutable evidence index/digests, exact proof identities/status labels, deny flags, absence of the old `deployments/sepolia/candidates/` namespace, and continued separation from the blocked production manifest.

## Historical fact boundary

The one-off deployer was publicly verified as `ACCEPTED_ON_L1`; the retained proof does not separately attest its execution status. App20Mail declaration/deployment were verified as `ACCEPTED_ON_L1` and `SUCCEEDED`. The legacy escrow proof deployment was verified as `ACCEPTED_ON_L2` and `SUCCEEDED`; its historical ClaimTicket class was declared and pinned by that escrow. These facts prove only that the recorded source/artifacts were deployable at that time. They do not prove audit, custody, constructor provenance beyond the recorded checks, independent reproducibility, production eligibility, canonical escrow/claim design, or release approval.

Any future Sepolia deployment work requires a new approved scope and new tooling. Historical addresses/hashes must never be copied into runtime constants, build variables, `strk20.json`, or the production manifest.
