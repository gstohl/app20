# Development SDK artifact

The repository and demo use a pinned runtime artifact of
`@starkware-libs/starknet-privacy-sdk@0.14.3-rc.5`, built from the public
`starkware-libs/starknet-privacy` repository at tag
`PRIVACY-0.14.3-RC.5` (commit
`66e3caae8c0201227a6719696d004e30d90aea65`). Its checksum is recorded in
`vendor/SHA256SUMS` in the source repository.

The artifact makes one packaging-only change: it omits the Node devnet test
harness and its `starknet-devnet` dependency. Production SDK code, ABI data,
the call-based mock provider, and discovery/prover providers are unchanged.
This prevents the runnable demo from shipping an unused archive-extraction
package with known advisories.

Published consumers should install the matching official SDK release from
GitHub Packages once its runtime dependency set is approved. The vendored
artifact is for reproducible development of this repository and demo.
