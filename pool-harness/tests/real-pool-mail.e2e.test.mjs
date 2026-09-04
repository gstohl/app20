import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OutsideExecutionVersion, constants, hash, json, num } from "starknet";
import { withHelperFundingPreflight } from "../../scripts/escrow-funding-preflight.mjs";
import {
	CorePrivateTransfersProver,
	passphraseViewingKeyProvider,
} from "@starkware-libs/starknet-privacy-client";
import {
	createEmptyRegistry,
	createPrivateTransfers,
} from "@starkware-libs/starknet-privacy-sdk";
import {
	ContractDiscoveryProvider,
	Devnet,
	ScreeningCallMockProofProvider,
	createDevnetTestEnv,
} from "@starkware-libs/starknet-privacy-sdk/testing";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD_DIR = join(ROOT, ".e2e-build", "real-pool-mail");
const APP20_SCARB = join(ROOT, "vendor", "bin", "app20-scarb");
const SHIELD_AMOUNT = 100n;
const RECOVERY_DUST = 7n;
const UNRELATED_HELPER_BALANCE = 11n;
const PLAINTEXT = "hello through APP20's real pool";
const PASSPHRASE = "app20-real-pool-mail-e2e";
const TX_TIMEOUT = 600_000;

function buildApp20Artifacts() {
	assert.equal(
		existsSync(APP20_SCARB),
		true,
		"missing pinned APP20 Scarb; run npm run pool:setup",
	);
	execFileSync(APP20_SCARB, ["build"], {
		cwd: join(ROOT, "cairo"),
		stdio: "inherit",
	});

	mkdirSync(BUILD_DIR, { recursive: true });
	execFileSync(
		join(ROOT, "node_modules", ".bin", "esbuild"),
		[
			"src/lib/mail.ts",
			"src/lib/strk20.ts",
			"--bundle",
			"--platform=node",
			"--format=esm",
			"--target=node24",
			`--outdir=${BUILD_DIR}`,
			"--outbase=src/lib",
			"--define:import.meta.env={}",
			"--alias:@=./src",
		],
		{ cwd: ROOT, stdio: "inherit" },
	);
}

async function waitForSuccess(node, transactionHash, label) {
	assert.ok(transactionHash, `${label} did not return a transaction hash`);
	const receipt = await node.waitForTransaction(transactionHash);
	assert.equal(receipt.isSuccess(), true, `${label} transaction must succeed`);
	return receipt;
}

async function createBlocks(rpcUrl, count = 10) {
	for (let index = 0; index < count; index += 1) {
		const response = await fetch(rpcUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: index + 1,
				method: "devnet_createBlock",
			}),
		});
		assert.equal(response.ok, true, "devnet_createBlock must return HTTP 200");
		const payload = await response.json();
		assert.equal(payload.error, undefined, "devnet_createBlock must succeed");
	}
}

async function tokenBalance(node, token, account) {
	const balance = await node.callContract({
		contractAddress: token,
		entrypoint: "balance_of",
		calldata: [account],
	});
	assert.equal(balance.length, 2, "ERC-20 balance_of must return a u256");
	return BigInt(balance[0]) + (BigInt(balance[1]) << 128n);
}

function feltEqual(left, right) {
	return BigInt(left) === BigInt(right);
}

function toCoreCallAndProof(prepared) {
	return {
		call: {
			contractAddress: prepared.call.contract_address,
			entrypoint: prepared.call.entry_point,
			calldata: prepared.call.calldata,
		},
		proof: {
			data: prepared.proof.data,
			output: prepared.proof.output,
			proofFacts: prepared.proof.proof_facts,
		},
	};
}

/**
 * Broadcast a client-prepared pool call exactly like Devnet.executeOutside, but
 * retain reverted receipts and their hashes for the nullifier assertion.
 */
async function broadcastPrepared(devnet, env, prepared) {
	const callAndProof = withHelperFundingPreflight(
		toCoreCallAndProof(prepared),
		prepared.fundingActions,
		{ mailHelperAddress: prepared.fundingMailHelperAddress },
	);
	await createBlocks(devnet.url);

	const nowSeconds = Math.floor(Date.now() / 1_000);
	const outsideTransaction = await env.admin.getOutsideTransaction(
		{
			caller: env.admin.address,
			execute_after: nowSeconds - 3_600,
			execute_before: nowSeconds + 3_600,
		},
		callAndProof.call,
		OutsideExecutionVersion.V2,
	);
	const response = await env.admin.executeFromOutside(outsideTransaction, {
		proofFacts: callAndProof.proof.proofFacts,
		proof: callAndProof.proof.data,
	});
	const receipt = await env.node.waitForTransaction(response.transaction_hash);
	return { transactionHash: response.transaction_hash, receipt };
}

function revertReason(receipt) {
	return String(
		receipt.revert_reason ??
			receipt.revertReason ??
			receipt.execution_result?.reason ??
			JSON.stringify(receipt),
	);
}

function parseMessageEvent(event) {
	assert.equal(
		event.keys.length,
		2,
		"MessagePosted must have selector and index keys",
	);
	assert.ok(event.data.length >= 7, "MessagePosted event data is truncated");

	const ciphertextLength = Number(BigInt(event.data[5]));
	assert.ok(
		Number.isSafeInteger(ciphertextLength) && ciphertextLength >= 0,
		"MessagePosted ciphertext length must be a non-negative safe integer",
	);
	assert.equal(
		event.data.length,
		7 + ciphertextLength,
		"MessagePosted ciphertext length must match its event data",
	);

	return {
		ephemeralPub: [event.data[0], event.data[1]],
		viewTag: Number(BigInt(event.data[2])),
		nonce: [event.data[3], event.data[4]],
		ciphertextFelts: event.data.slice(6, 6 + ciphertextLength),
		actionId: event.data[6 + ciphertextLength],
	};
}

async function messageEvents(node, helperAddress) {
	const selector = hash.getSelectorFromName("MessagePosted");
	const events = [];
	const seenTokens = new Set();
	let continuationToken;

	do {
		const chunk = await node.getEvents({
			address: helperAddress,
			from_block: { block_number: 0 },
			to_block: "latest",
			keys: [[selector]],
			chunk_size: 100,
			...(continuationToken ? { continuation_token: continuationToken } : {}),
		});
		events.push(...chunk.events);
		continuationToken = chunk.continuation_token;
		if (continuationToken) {
			assert.equal(
				seenTokens.has(continuationToken),
				false,
				"RPC must not repeat an event continuation token",
			);
			seenTokens.add(continuationToken);
		}
	} while (continuationToken);

	return events;
}

function makeAlicePrivacy(env) {
	const discovery = new ContractDiscoveryProvider(env.privacy);
	const proving = new ScreeningCallMockProofProvider(
		env.node,
		constants.StarknetChainId.SN_SEPOLIA,
	);
	const viewingKeyProvider = passphraseViewingKeyProvider(
		PASSPHRASE,
		env.alice.address,
	);
	const transfers = createPrivateTransfers({
		account: env.alice,
		viewingKeyProvider,
		provingProvider: proving,
		discoveryProvider: discovery,
		poolContractAddress: env.privacy.address,
	});
	const prover = new CorePrivateTransfersProver({
		signer: env.alice.signer,
		address: env.alice.address,
		passphrase: PASSPHRASE,
		node: env.node,
		discovery,
		prover: proving,
		poolContractAddress: env.privacy.address,
		// The mail flow never uses shadow accounts, but the client config requires
		// an address so the same full client can support them when requested.
		shadowAccountAnonymizerAddress: "0x1",
		storage: {
			// Contract discovery is authoritative for every transaction. Returning a
			// fresh registry also avoids committing speculative state for a reverted
			// replay before the wallet has observed its receipt.
			loadRegistry: async () => createEmptyRegistry(),
			saveRegistry: async () => {},
		},
	});
	// Wallet API actions describe outputs, while the wallet/compiler must return
	// selected-note surplus to the account. The pinned client adapter omits this
	// policy, so mirror the wallet seam used by the browser localnet.
	const coreTransfers = prover.transfers;
	assert.ok(coreTransfers && typeof coreTransfers.build === "function");
	const coreBuild = coreTransfers.build.bind(coreTransfers);
	coreTransfers.build = (...args) =>
		coreBuild(...args).surplusTo(env.alice.address, false);
	return { prover, transfers };
}

async function prepare(prover, actions, mailHelperAddress) {
	const prepared = await prover.prove(actions);
	prepared.fundingActions = actions;
	prepared.fundingMailHelperAddress = mailHelperAddress;
	assert.equal(
		prepared.proof.data,
		undefined,
		"devnet mail must use upstream's simulated proof",
	);
	assert.equal(
		prepared.proof.proof_facts.length,
		9,
		"devnet proof must carry the nine on-chain proof facts",
	);
	assert.equal(
		prepared.call.calldata.some(
			(item) => typeof item === "string" && item.includes("${"),
		),
		false,
		"vendored client must resolve every wallet placeholder before proving",
	);
	return prepared;
}

test("real privacy pool: APP20 localnet mail batch, recovery note, and action-id nullifier", {
	timeout: TX_TIMEOUT,
}, async () => {
	buildApp20Artifacts();
	const mail = await import(pathToFileURL(join(BUILD_DIR, "mail.js")).href);
	const strk20 = await import(pathToFileURL(join(BUILD_DIR, "strk20.js")).href);
	const devnet = new Devnet();
	const txHashes = {};

	try {
		const { env } = await createDevnetTestEnv(devnet);

		const artifactRoot = join(ROOT, "cairo", "target", "dev");
		const sierra = json.parse(
			readFileSync(
				join(artifactRoot, "app20_mail_App20Mail.contract_class.json"),
				"utf8",
			),
		);
		const casm = json.parse(
			readFileSync(
				join(artifactRoot, "app20_mail_App20Mail.compiled_contract_class.json"),
				"utf8",
			),
		);

		const declaration = await env.admin.declare({ contract: sierra, casm });
		txHashes.helperDeclare = declaration.transaction_hash;
		await waitForSuccess(
			env.node,
			declaration.transaction_hash,
			"App20Mail declaration",
		);

		const deployment = await env.admin.deployContract({
			classHash: declaration.class_hash,
			constructorCalldata: [env.privacy.address],
		});
		txHashes.helperDeploy = deployment.transaction_hash;
		await waitForSuccess(
			env.node,
			deployment.transaction_hash,
			"App20Mail deployment",
		);
		const helperAddress = deployment.contract_address ?? deployment.address;
		assert.ok(helperAddress, "App20Mail deployment must return an address");
		assert.equal(
			feltEqual(helperAddress, env.privacy.address),
			false,
			"helper address must not be the privacy pool address",
		);

		const aliceMail = mail.deriveKeypair(new Uint8Array(32).fill(0x41));
		const bobMail = mail.deriveKeypair(new Uint8Array(32).fill(0x42));
		const strangerMail = mail.deriveKeypair(new Uint8Array(32).fill(0x43));
		const alicePubkey = mail.publicKeyToFelts(aliceMail.publicKey);
		const bobPubkey = mail.publicKeyToFelts(bobMail.publicKey);

		const aliceRegistration = await env.alice.execute({
			contractAddress: helperAddress,
			entrypoint: "register_pubkey",
			calldata: alicePubkey,
		});
		txHashes.aliceMailRegistration = aliceRegistration.transaction_hash;
		await waitForSuccess(
			env.node,
			aliceRegistration.transaction_hash,
			"Alice mail-key registration",
		);

		const bobRegistration = await env.bob.execute({
			contractAddress: helperAddress,
			entrypoint: "register_pubkey",
			calldata: bobPubkey,
		});
		txHashes.bobMailRegistration = bobRegistration.transaction_hash;
		await waitForSuccess(
			env.node,
			bobRegistration.transaction_hash,
			"Bob mail-key registration",
		);

		const registeredBobKey = await env.node.callContract({
			contractAddress: helperAddress,
			entrypoint: "get_pubkey",
			calldata: [env.bob.address],
		});
		assert.deepEqual(
			registeredBobKey.map(BigInt),
			bobPubkey.map(BigInt),
			"Bob's mail public key must round-trip through App20Mail",
		);

		const { prover, transfers: aliceTransfers } = makeAlicePrivacy(env);
		const approve = await env.alice.execute({
			contractAddress: env.strk,
			entrypoint: "approve",
			calldata: [env.privacy.address, SHIELD_AMOUNT, 0n],
		});
		txHashes.shieldApprove = approve.transaction_hash;
		await waitForSuccess(
			env.node,
			approve.transaction_hash,
			"pool deposit approval",
		);

		const shieldPrepared = await prepare(prover, [
			{
				type: "deposit",
				token: env.strk,
				amount: num.toHex(SHIELD_AMOUNT),
			},
		]);
		const shield = await broadcastPrepared(devnet, env, shieldPrepared);
		txHashes.shield = shield.transactionHash;
		assert.equal(shield.receipt.isSuccess(), true, "Alice shield must succeed");
		assert.equal(
			await tokenBalance(env.node, env.strk, env.privacy.address),
			SHIELD_AMOUNT,
			"real pool must custody Alice's shielded STRK",
		);
		await createBlocks(devnet.url);

		const shieldDiscovery = await aliceTransfers.discoverNotes({
			tokens: [BigInt(env.strk)],
		});
		assert.ok(
			(shieldDiscovery.notes.get(env.strk) ?? []).some(
				(note) => note.amount === SHIELD_AMOUNT,
			),
			"Alice must discover her shielded STRK note",
		);

		const record = await mail.encryptMail(
			mail.publicKeyFromFelts(registeredBobKey),
			PLAINTEXT,
		);
		const actionId = strk20.computeActionId("mail", "real-pool-nullifier-e2e");
		assert.notEqual(
			BigInt(actionId),
			0n,
			"replay-protected action id must be non-zero",
		);
		const protectedActions = strk20.buildMailInvokeActions({
			helperAddress,
			recoveryAddress: env.alice.address,
			record,
			tokenAddress: env.strk,
			helperFundingAmount: RECOVERY_DUST,
			actionId,
		});
		assert.equal(protectedActions[0].type, "withdraw");
		assert.equal(protectedActions[0].amount, "0x7");
		assert.equal(protectedActions[0].recipient, helperAddress);
		assert.equal(protectedActions[1].amount, "OPEN");
		assert.equal(protectedActions[2].type, "compute_and_invoke");
		assert.equal(
			protectedActions[2].compute_calldata[1],
			strk20.OPEN_NOTE_ID_PLACEHOLDER,
		);
		assert.equal(
			protectedActions[2].invoke_calldata[1],
			strk20.POOL_ADDRESS_PLACEHOLDER,
		);
		assert.equal(
			protectedActions[2].invoke_calldata[2],
			strk20.OPEN_NOTE_ID_PLACEHOLDER,
		);

		// Unrelated or accidental helper funds must never be captured by the
		// next sender's recovery OPEN note.
		const unrelated = await env.alice.execute({
			contractAddress: env.strk,
			entrypoint: "transfer",
			calldata: [helperAddress, UNRELATED_HELPER_BALANCE, 0n],
		});
		await waitForSuccess(
			env.node,
			unrelated.transaction_hash,
			"unrelated helper balance transfer",
		);

		// Reproduce the old ambient-balance capture: request an OPEN recovery
		// without withdrawing fresh funds to the helper. The helper now returns
		// no deposit, so the pool fails closed and the whole message rolls back.
		const unfundedActions = protectedActions.slice(1);
		const unfundedPrepared = await prepare(
			prover,
			unfundedActions,
			helperAddress,
		);
		const unfundedMail = await broadcastPrepared(
			devnet,
			env,
			unfundedPrepared,
		);
		txHashes.unfundedMail = unfundedMail.transactionHash;
		assert.equal(
			unfundedMail.receipt.isReverted(),
			true,
			"OPEN recovery without fresh helper funding must revert",
		);
		assert.equal(
			await tokenBalance(env.node, env.strk, helperAddress),
			UNRELATED_HELPER_BALANCE,
			"unfunded Mail must not capture the helper's ambient balance",
		);
		assert.equal(
			(await messageEvents(env.node, helperAddress)).length,
			0,
			"unfunded OPEN failure must roll back the Mail event and replay slot",
		);

		const firstPrepared = await prepare(prover, protectedActions, helperAddress);
		const firstMail = await broadcastPrepared(devnet, env, firstPrepared);
		txHashes.firstMail = firstMail.transactionHash;
		assert.equal(
			firstMail.receipt.isSuccess(),
			true,
			"real-pool mail must succeed",
		);
		assert.equal(
			await tokenBalance(env.node, env.strk, helperAddress),
			UNRELATED_HELPER_BALANCE,
			"recovery must not capture the helper's unrelated pre-existing balance",
		);
		assert.equal(
			await tokenBalance(env.node, env.strk, env.privacy.address),
			SHIELD_AMOUNT,
			"atomic helper funding must return to pool custody through the recovery note",
		);

		const firstEvents = await messageEvents(env.node, helperAddress);
		assert.equal(firstEvents.length, 1, "first mail must emit one MessagePosted");
		assert.equal(
			feltEqual(firstEvents[0].from_address, helperAddress),
			true,
			"MessagePosted must come from the deployed App20Mail helper",
		);
		assert.equal(
			feltEqual(firstEvents[0].transaction_hash, firstMail.transactionHash),
			true,
			"MessagePosted must be emitted by the real-pool transaction",
		);
		const eventRecord = parseMessageEvent(firstEvents[0]);
		assert.equal(feltEqual(eventRecord.actionId, actionId), true);

		const decrypted = await mail.scanAndDecrypt(bobMail.privateKey, [
			eventRecord,
		]);
		assert.equal(decrypted.length, 1, "Bob must discover exactly one message");
		assert.equal(
			decrypted[0].plaintext,
			PLAINTEXT,
			"Bob must decrypt the exact sent plaintext",
		);
		assert.equal(
			(await mail.scanAndDecrypt(strangerMail.privateKey, [eventRecord])).length,
			0,
			"a wrong mail key must discover no message",
		);

		await createBlocks(devnet.url);
		const afterRecovery = await aliceTransfers.discoverNotes({
			tokens: [BigInt(env.strk)],
		});
		const aliceStrkNotes = afterRecovery.notes.get(env.strk) ?? [];
		assert.ok(
			aliceStrkNotes.some(
				(note) => note.amount === RECOVERY_DUST && note.open === true,
			),
			"Alice must discover the credited open recovery note",
		);
		const openNoteDepositSelector = hash.getSelectorFromName("OpenNoteDeposited");
		const recoveryEvent = firstMail.receipt.events.find(
			(event) =>
				feltEqual(event.from_address, env.privacy.address) &&
				feltEqual(event.keys[0], openNoteDepositSelector),
		);
		assert.ok(recoveryEvent, "real pool must emit OpenNoteDeposited");
		assert.equal(feltEqual(recoveryEvent.keys[1], helperAddress), true);
		assert.equal(feltEqual(recoveryEvent.keys[2], env.strk), true);
		assert.equal(BigInt(recoveryEvent.data[0]), RECOVERY_DUST);

		await createBlocks(devnet.url);
		const replayPrepared = await prepare(prover, protectedActions, helperAddress);
		const replay = await broadcastPrepared(devnet, env, replayPrepared);
		txHashes.replayedAction = replay.transactionHash;
		assert.equal(
			replay.receipt.isReverted(),
			true,
			"submitting the same non-zero action id twice must revert",
		);
		assert.match(
			revertReason(replay.receipt),
			/ACTION_ID_USED/,
			"replay must revert at App20Mail's action-id nullifier",
		);
		assert.equal(
			await tokenBalance(env.node, env.strk, helperAddress),
			UNRELATED_HELPER_BALANCE,
			"reverted replay must roll back its helper withdrawal and funding snapshot",
		);
		assert.equal(
			await tokenBalance(env.node, env.strk, env.privacy.address),
			SHIELD_AMOUNT,
			"reverted replay must preserve pool custody",
		);
		const countAfterReplay = await env.node.callContract({
			contractAddress: helperAddress,
			entrypoint: "message_count",
			calldata: [],
		});
		assert.equal(
			BigInt(countAfterReplay[0]),
			1n,
			"reverted replay must not append a second message",
		);

		const zeroActions = strk20.buildMailInvokeActions({
			helperAddress,
			recoveryAddress: env.alice.address,
			record,
			tokenAddress: env.strk,
			helperFundingAmount: RECOVERY_DUST,
			actionId: "0x0",
		});

		const zeroFirst = await broadcastPrepared(
			devnet,
			env,
			await prepare(prover, zeroActions, helperAddress),
		);
		txHashes.zeroActionFirst = zeroFirst.transactionHash;
		assert.equal(
			zeroFirst.receipt.isSuccess(),
			true,
			`first zero-id action must succeed: ${revertReason(zeroFirst.receipt)}`,
		);

		await createBlocks(devnet.url);
		const zeroSecond = await broadcastPrepared(
			devnet,
			env,
			await prepare(prover, zeroActions, helperAddress),
		);
		txHashes.zeroActionSecond = zeroSecond.transactionHash;
		assert.equal(
			zeroSecond.receipt.isSuccess(),
			true,
			"the same zero action id must remain repeatable",
		);

		const allEvents = await messageEvents(env.node, helperAddress);
		assert.equal(
			allEvents.length,
			3,
			"successful non-zero send plus two zero-id sends must emit three messages",
		);
		assert.deepEqual(
			allEvents.map((event) => BigInt(parseMessageEvent(event).actionId)),
			[BigInt(actionId), 0n, 0n],
		);

		console.log("APP20 real-pool mail flow passed:");
		console.log(`  privacy_Privacy: ${env.privacy.address}`);
		console.log(`  App20Mail: ${helperAddress}`);
		console.log(`  action id: ${actionId}`);
		for (const [label, transactionHash] of Object.entries(txHashes)) {
			console.log(`  ${label}: ${transactionHash}`);
		}
		console.log(`  decrypted: ${PLAINTEXT}`);
		console.log("  wrong-key messages: 0");
		console.log(
			`  nullifier: replay ${txHashes.replayedAction} reverted with ACTION_ID_USED`,
		);
		console.log(
			`  recovery: ${RECOVERY_DUST} STRK base units credited to Alice's open note`,
		);
	} finally {
		await devnet.cleanup();
	}
});
