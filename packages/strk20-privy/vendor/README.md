# Vendored development SDK

`starkware-libs-starknet-privacy-sdk-0.14.3-rc.5.tgz` is an `npm pack`
artifact built from the public `starkware-libs/starknet-privacy` repository at:

- tag: `PRIVACY-0.14.3-RC.5`
- commit: `66e3caae8c0201227a6719696d004e30d90aea65`
- package: `@starkware-libs/starknet-privacy-sdk@0.14.3-rc.5`
- SHA-256: see `SHA256SUMS`

It makes the repository and demo reproducible without placing a GitHub Packages
token in source control. This runtime artifact makes one packaging-only change:
it omits the Node devnet test harness and its `starknet-devnet` dependency. The
production SDK, ABI, mock proof utility used by this package, and discovery/prover
providers are unchanged. This avoids shipping an unused archive-extraction
package with known advisories in the demo runtime.

Published consumers should install the matching official SDK release from GitHub
Packages once its runtime dependency set is approved, rather than relying on this
repository-relative file.
