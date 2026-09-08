# Mainnet Chat evidence

Updated September 8, 2026. A real-proof Chat self-message succeeded on mainnet in [transaction 0x382800b8…](https://starkscan.co/tx/0x382800b805219f0c8639459c353976618ae38fdb6468dd28f1e71ecec7bcf62), block **14529927**. The public record is [chat-message-2026-09-08.json](../deployments/mainnet/chat-message-2026-09-08.json).

## Verified message

The operator used the official STRK20 Core SDK and the authenticated APP20/Starkscan hosted prover. Publicnode accepted the real proof-bearing transaction. Verification established:

- A successful included receipt and exactly one `MessagePosted` event from the pinned Chat helper.
- The event decrypts to the expected message using the locally retained Chat key.
- The helper's bound replay slot is consumed at the receipt block.
- The execution trace calls the canonical pool's `apply_actions` and the helper's `privacy_invoke_with_computation`.
- Both contract class hashes match their pins at the receipt block.
- Private STRK note discovery at blocks 14529926 and 14529927 reports the same balance.
- The proof includes encrypted note creation, note consumption and the encrypted callback, with no public deposit, withdrawal, OPEN note or helper funding.

Plain messages include a private transfer of 1 base unit of STRK back to the sender. This supplies the pool's note replay protection and preserves the shielded balance. A callback alone is insufficient: the real pool rejects it with `NO_REPLAY_PROTECTION`. Pool and network fees remain public and apply separately.

The helper is deployed at `0x501331396a00e95a4b520502ff73155412e056bd42bc41cb115deb656d97ae4`, with class hash `0x2e6fd0b464b0a7a1c8793b5d18609609e167af5ce7916e28821af34b5de4b12`. The verified STRK20 pool is `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.

## Recheck without signing or broadcasting

On the operator machine with its protected journal and viewing key:

```sh
node scripts/mainnet-chat-proof.mjs --mode evidence --transaction 0x382800b805219f0c8639459c353976618ae38fdb6468dd28f1e71ecec7bcf62
```

Evidence mode authenticates the expected encrypted event and checks the replay slot. The additional trace/class and fixed-block balance comparison are recorded in the public evidence. Exact balances, note material, viewing keys, encrypted proof journals and prover diagnostics stay in owner-only storage outside the repository. The published record contains the balance-equality result, not the private balances or message plaintext.

## Remaining evidence

This was an operator-controlled self-message, not a two-user wallet exchange. Ready extension acceptance, a Chat payment to another mainnet account and confidential atomic swap settlement remain unverified. The installed wallet adapter must preserve computation, proof facts and replay protection; no public-transfer fallback is permitted.

The three September 7 hashes in `strk20.json` remain valid evidence of the earlier swap protocol with public funded terms. This new message has its own pool-backed receipt and durable record. Deployment and registration transactions are setup evidence and must not replace qualifying pool interactions. Do not describe the old swaps as proof of the new confidential escrow.

Hosted proving exposes the private witness to APP20/Cloudflare and the proving provider. The successful transaction does not establish secrecy from that infrastructure.
