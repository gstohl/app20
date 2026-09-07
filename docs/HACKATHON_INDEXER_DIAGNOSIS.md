# Submission indexer diagnosis — September 7, 2026

The public `projects.json` record for `quietline` / `gstohl/app20` contains all three hashes from our root `strk20.json`, but marks them `not found on mainnet` and marks both contracts `network: unknown`. This is verification failure, not a missing manifest.

The upstream indexer defaults to `https://rpc.starknet.lava.build`. On September 7 this endpoint and its `/rpc/v0_10` variant returned HTTP 410: endpoint discontinued. The indexer converts failed HTTP requests into null, then labels null receipts as missing transactions. Its deployed RPC environment override is not public, so the exact endpoint used by the last run is unconfirmed.

A fresh read-only check through `https://api.cartridge.gg/x/starknet/mainnet` returned all three receipts as SUCCEEDED / ACCEPTED_ON_L1, with events from the STRK20 pool and APP20 private-swap contract. The saved local responses are in `artifacts/hackathon/v6/receipt-recheck.json` and `hub-rpc-diagnosis.json`.

Suggested upstream correction: configure a working MAINNET_RPC_URL and rerun the indexer; distinguish RPC unavailability from an actual missing transaction. No report has been sent.

Sources: [indexer source](https://github.com/starkience/strk20-hackathon/blob/main/scripts/build-projects.mjs), [generated project records](https://github.com/starkience/strk20-hackathon/blob/main/projects.json).

The public video URL is independently still missing from `strk20.json`.
