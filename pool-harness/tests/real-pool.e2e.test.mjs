import assert from "node:assert/strict";
import { test } from "node:test";

// This package intentionally lives outside APP20's root npm workspace.
const sdkTestingSpecifier = [
	"@starkware-libs/starknet-privacy-sdk",
	"testing",
].join("/");
const { Devnet, createDevnetTestEnv } = await import(sdkTestingSpecifier);

const DEPOSIT_AMOUNT = 100n;
const TRANSFER_AMOUNT = 50n;
const EXPECTED_PRIVACY_CLASS_HASH =
	"0x7af31b00093e5ba2d51a0bd68b5cb4ef3b011af349ade4bb6aa3dbb108f153c";
// Public, canonical upstream test material. Never use this screening key outside devnet.
const TEST_ONLY_SCREENING_KEY = "0xCAFEBABE";

async function tokenBalance(node, token, account) {
	const balance = await node.callContract({
		contractAddress: token,
		entrypoint: "balance_of",
		calldata: [account],
	});
	assert.equal(balance.length, 2, "ERC-20 balance_of must return a u256");
	return BigInt(balance[0]) + (BigInt(balance[1]) << 128n);
}

test(
	"real privacy pool: register -> deposit -> private transfer -> discover -> withdraw",
	{ timeout: 300_000 },
	async () => {
		const devnet = new Devnet();

		try {
			const { env, transfers } = await createDevnetTestEnv(devnet);
			const poolClassHash = await env.node.getClassHashAt(
				env.privacy.address,
			);
			assert.equal(
				BigInt(poolClassHash),
				BigInt(EXPECTED_PRIVACY_CLASS_HASH),
				"devnet must deploy the pinned privacy_Privacy class",
			);

			const poolBalanceBefore = await tokenBalance(
				env.node,
				env.strk,
				env.privacy.address,
			);
			assert.equal(poolBalanceBefore, 0n, "new pool must start with zero STRK");

			await env.alice.execute({
				contractAddress: env.strk,
				entrypoint: "approve",
				calldata: [env.privacy.address, DEPOSIT_AMOUNT, 0n],
			});

			const bobRegistration = await transfers.bob
				.build()
				.register()
				.execute();
			assert.equal(
				bobRegistration.callAndProof.proof.data,
				undefined,
				"devnet registration must use upstream's simulated proof",
			);
			assert.equal(
				bobRegistration.callAndProof.proof.proofFacts.length,
				9,
				"registration must carry the nine on-chain proof facts",
			);
			const registrationReceipt = await devnet.executeOutside(
				bobRegistration.callAndProof,
			);
			assert.equal(registrationReceipt.isSuccess(), true);

			const sent = await transfers.alice
				.build({
					autoRegister: true,
					autoSetup: true,
					autoDiscover: { notes: "refresh", channels: "refresh" },
				})
				.with(env.strk)
				.deposit({ amount: DEPOSIT_AMOUNT })
				.transfer({
					recipient: env.bob.address,
					amount: TRANSFER_AMOUNT,
				})
				.surplusTo(env.alice.address)
				.execute();

			// This is upstream's devnet confidence boundary: real pool calldata and
			// proof facts, but no STARK proof bytes. The test-only signer also adds
			// the screening attestation required by the real contract.
			assert.equal(
				sent.callAndProof.proof.data,
				undefined,
				"devnet transfer must use upstream's simulated proof",
			);
			assert.equal(sent.callAndProof.proof.proofFacts.length, 9);
			const screeningSignature =
				sent.callAndProof.proof.additionalData?.signature;
			assert.ok(screeningSignature, "deposit must carry screening attestation");
			assert.ok(
				Number.isInteger(screeningSignature.issued_at) &&
					screeningSignature.issued_at > 0,
				"screening timestamp must be a positive integer",
			);
			assert.match(screeningSignature.sig_r, /^0x[0-9a-f]+$/i);
			assert.match(screeningSignature.sig_s, /^0x[0-9a-f]+$/i);

			const transferReceipt = await devnet.executeOutside(sent.callAndProof);
			assert.equal(transferReceipt.isSuccess(), true);
			assert.equal(
				await tokenBalance(env.node, env.strk, env.privacy.address),
				DEPOSIT_AMOUNT,
				"pool must custody the full 100 STRK base units",
			);

			const bobDiscovery = await transfers.bob.discoverNotes();
			const bobStrkNotes = bobDiscovery.notes.get(env.strk) ?? [];
			assert.equal(bobStrkNotes.length, 1, "Bob must discover one STRK note");
			assert.equal(bobStrkNotes[0].amount, TRANSFER_AMOUNT);

			const aliceDiscovery = await transfers.alice.discoverNotes();
			const aliceStrkNotes = aliceDiscovery.notes.get(env.strk) ?? [];
			assert.equal(
				aliceStrkNotes.length,
				1,
				"Alice must discover one surplus note",
			);
			assert.equal(aliceStrkNotes[0].amount, TRANSFER_AMOUNT);

			const bobPublicBalanceBefore = await tokenBalance(
				env.node,
				env.strk,
				env.bob.address,
			);
			const withdrawn = await transfers.bob
				.build({
					autoDiscover: { notes: "refresh", channels: "refresh" },
					autoSelectNotes: "naive",
				})
				.with(env.strk)
				.withdraw({
					amount: TRANSFER_AMOUNT,
					recipient: env.bob.address,
				})
				.execute();
			assert.equal(withdrawn.callAndProof.proof.data, undefined);
			assert.equal(withdrawn.callAndProof.proof.proofFacts.length, 9);
			const withdrawalReceipt = await devnet.executeOutside(
				withdrawn.callAndProof,
			);
			assert.equal(withdrawalReceipt.isSuccess(), true);

			const bobPublicBalanceAfter = await tokenBalance(
				env.node,
				env.strk,
				env.bob.address,
			);
			assert.equal(
				bobPublicBalanceAfter - bobPublicBalanceBefore,
				TRANSFER_AMOUNT,
				"withdrawal must add exactly 50 STRK base units to Bob",
			);
			assert.equal(
				await tokenBalance(env.node, env.strk, env.privacy.address),
				TRANSFER_AMOUNT,
				"pool must retain Alice's 50-unit private surplus",
			);

			const bobAfterWithdrawal = await transfers.bob.discoverNotes();
			assert.equal(
				(bobAfterWithdrawal.notes.get(env.strk) ?? []).length,
				0,
				"Bob's withdrawn note must be spent",
			);

			console.log("APP20 real-pool lifecycle passed:");
			console.log(`  privacy_Privacy: ${env.privacy.address}`);
			console.log(`  class hash: ${poolClassHash}`);
			console.log(`  screening key: ${TEST_ONLY_SCREENING_KEY} (TEST ONLY)`);
			console.log("  Bob discovered and withdrew: 50 STRK base units");
		} finally {
			await devnet.cleanup();
		}
	},
);
