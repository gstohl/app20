# Import provenance

- Source path: `/Users/dominik/orca/projects/strk20-privvy`
- Source Git HEAD: `f520aa7b845cd4d8a481d0204f9bb3e7f3b42ac6` (`f520aa7`)
- Import date (UTC): 2026-08-18
- Source state: the imported implementation files were untracked in the source repository.

## Explicit exclusions

The Next.js `demo/` tree was not imported. The import also excluded `.env`, `demo/.env.local`, `demo/tenants.json`, `demo/.next`, `node_modules`, `dist`, logs, TypeScript build-info files, caches, and all other ignored runtime artifacts or local configuration.

The safe placeholder-only `.env.example` was imported for development documentation. The vendored SDK tarball was imported only after `shasum -a 256 -c vendor/SHA256SUMS` succeeded.

`IMPORT_MANIFEST.sha256` records the exact imported snapshot at the application import commit `21d9b3b`. Later reviewed development intentionally changes package files, so verify the manifest against that commit rather than expecting it to match the current working tree.
