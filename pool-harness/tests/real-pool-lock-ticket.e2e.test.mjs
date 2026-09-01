import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { OutsideExecutionVersion, constants, hash, json, num } from "starknet";
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
const APP20_SCARB = join(ROOT, "vendor", "bin", "app20-scarb");
const TX_TIMEOUT = 600_000;
const LOCK_ID = "0x101";
const RFQ_ID = "0x202";
const TAKER_SECRET = "0x303";
const DEAL_ID = RFQ_ID;
const COLLATERAL = 200n;
const TAKEN_A = 50n;
const TAKEN_B = 100n;
const OPEN_NOTE_ID = "${openNoteIds[0]}";
const POOL_ADDRESS = "${poolAddress}";

function buildArtifacts() {
	assert.equal(
		existsSync(APP20_SCARB),
		true,
		"missing pinned APP20 Scarb; run npm run pool:setup",
	);
	execFileSync(APP20_SCARB, ["build"], {
		cwd: join(ROOT, "cairo"),
		stdio: "inherit",
	});
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

async function broadcastPrepared(devnet, env, prepared) {
	const callAndProof = toCoreCallAndProof(prepared);
	await createBlocks(devnet.url);
	const now = Math.floor(Date.now() / 1_000);
	const outsideTransaction = await env.admin.getOutsideTransaction(
		{
			caller: env.admin.address,
			execute_after: now - 3_600,
			execute_before: now + 3_600,
		},
		callAndProof.call,
		OutsideExecutionVersion.V2,
	);
	const response = await env.admin.executeFromOutside(outsideTransaction, {
		proofFacts: callAndProof.proof.proofFacts,
		proof: callAndProof.proof.data,
	});
	const receipt = await env.node.waitForTransaction(response.transaction_hash);
	assert.equal(
		receipt.isSuccess(),
		true,
		`prepared privacy-pool call must succeed: ${String(
			receipt.revert_reason ?? receipt.revertReason ?? JSON.stringify(receipt),
		)}`,
	);
	return response.transaction_hash;
}

function makePrivacy(env, account, passphrase) {
	const discovery = new ContractDiscoveryProvider(env.privacy);
	const proving = new ScreeningCallMockProofProvider(
		env.node,
		constants.StarknetChainId.SN_SEPOLIA,
	);
	const viewingKeyProvider = passphraseViewingKeyProvider(
		passphrase,
		account.address,
	);
	const transfers = createPrivateTransfers({
		account,
		viewingKeyProvider,
		provingProvider: proving,
		discoveryProvider: discovery,
		poolContractAddress: env.privacy.address,
	});
	const prover = new CorePrivateTransfersProver({
		signer: account.signer,
		address: account.address,
		passphrase,
		node: env.node,
		discovery,
		prover: proving,
		poolContractAddress: env.privacy.address,
		shadowAccountAnonymizerAddress: "0x1",
		storage: {
			loadRegistry: async () => createEmptyRegistry(),
			saveRegistry: async () => {},
		},
	});
	const coreBuild = prover.transfers.build.bind(prover.transfers);
	prover.transfers.build = (...args) =>
		coreBuild(...args).surplusTo(account.address, false);
	return { prover, transfers };
}

async function prepare(prover, actions) {
	const prepared = await prover.prove(actions);
	assert.equal(
		prepared.proof.data,
		undefined,
		"devnet lock flow must use the upstream simulated proof",
	);
	assert.equal(
		prepared.call.calldata.some(
			(item) => typeof item === "string" && item.includes("${"),
		),
		false,
		"wallet placeholders must be resolved before broadcast",
	);
	return prepared;
}

async function shield(devnet, env, account, prover, token, amount, label) {
	const approval = await account.execute({
		contractAddress: token,
		entrypoint: "approve",
		calldata: [env.privacy.address, amount, 0n],
	});
	await waitForSuccess(env.node, approval.transaction_hash, `${label} approval`);
	await broadcastPrepared(
		devnet,
		env,
		await prepare(prover, [
			{ type: "deposit", token, amount: num.toHex(amount) },
		]),
	);
}

async function declare(env, artifactRoot, name) {
	const contract = json.parse(
		readFileSync(join(artifactRoot, `${name}.contract_class.json`), "utf8"),
	);
	const casm = json.parse(
		readFileSync(
			join(artifactRoot, `${name}.compiled_contract_class.json`),
			"utf8",
		),
	);
	const result = await env.admin.declare({ contract, casm });
	await waitForSuccess(env.node, result.transaction_hash, `${name} declaration`);
	return result.class_hash;
}

function withdraw(token, amount, recipient) {
	return { type: "withdraw", token, amount: num.toHex(amount), recipient };
}

function openNote(token, recipient) {
	return { type: "transfer", token, amount: "OPEN", recipient };
}

function invoke(escrow, calldata) {
	return { type: "invoke", contract: escrow, calldata };
}

async function notesFor(transfers, devnet, tokens) {
	await createBlocks(devnet.url);
	return transfers.discoverNotes({ tokens: tokens.map(BigInt) });
}

test(
	"real privacy pool: LockTicket supply two survives take and both maker settlement pulls",
	{ timeout: TX_TIMEOUT },
	async () => {
		buildArtifacts();
		const devnet = new Devnet();
		try {
			const { env } = await createDevnetTestEnv(devnet);
			const artifactRoot = join(ROOT, "cairo", "target", "dev");
			const claimTicketClassHash = await declare(
				env,
				artifactRoot,
				"app20_mail_ClaimTicket",
			);
			const lockTicketClassHash = await declare(
				env,
				artifactRoot,
				"app20_mail_LockTicket",
			);
			const escrowClassHash = await declare(
				env,
				artifactRoot,
				"app20_mail_App20Escrow",
			);
			const deployment = await env.admin.deployContract({
				classHash: escrowClassHash,
				constructorCalldata: [
					env.privacy.address,
					claimTicketClassHash,
					lockTicketClassHash,
				],
			});
			await waitForSuccess(
				env.node,
				deployment.transaction_hash,
				"App20Escrow deployment",
			);
			const escrow = deployment.contract_address ?? deployment.address;
			assert.ok(escrow, "App20Escrow deployment must return an address");

			const ensureTicket = await env.admin.execute({
				contractAddress: escrow,
				entrypoint: "ensure_lock_ticket",
				calldata: [LOCK_ID],
			});
			await waitForSuccess(
				env.node,
				ensureTicket.transaction_hash,
				"LockTicket deployment",
			);
			const [lockTicket] = await env.node.callContract({
				contractAddress: escrow,
				entrypoint: "get_lock_ticket",
				calldata: [LOCK_ID],
			});
			assert.notEqual(BigInt(lockTicket), 0n, "LockTicket address must exist");

			const maker = makePrivacy(
				env,
				env.alice,
				"app20-lock-ticket-maker",
			);
			const taker = makePrivacy(
				env,
				env.bob,
				"app20-lock-ticket-taker",
			);
			await shield(
				devnet,
				env,
				env.alice,
				maker.prover,
				env.strk,
				COLLATERAL,
				"maker collateral shield",
			);
			await shield(
				devnet,
				env,
				env.bob,
				taker.prover,
				env.eth,
				TAKEN_A,
				"taker principal shield",
			);

			const expiry = Math.floor(Date.now() / 1_000) + 300;
			const commitment = hash.computePoseidonHashOnElements([TAKER_SECRET]);
			await broadcastPrepared(
				devnet,
				env,
				await prepare(maker.prover, [
					withdraw(env.strk, COLLATERAL, escrow),
					openNote(lockTicket, env.alice.address),
					invoke(escrow, [
						"0x4",
						env.strk,
						env.eth,
						RFQ_ID,
						commitment,
						num.toHex(expiry),
						"0x2",
						"0x1",
						"0x2",
						"0x64",
						"0xc8",
						"0x0",
						"0x0",
						"0x0",
						"0x0",
						LOCK_ID,
						POOL_ADDRESS,
						OPEN_NOTE_ID,
					]),
				]),
			);
			const ticketNotesAfterLock = await notesFor(
				maker.transfers,
				devnet,
				[lockTicket],
			);
			assert.ok(
				(ticketNotesAfterLock.notes.get(lockTicket) ?? []).some(
					(note) => note.amount === 2n,
				),
				"Lock must mint one real private LockTicket note with supply two",
			);

			await broadcastPrepared(
				devnet,
				env,
				await prepare(taker.prover, [
					withdraw(env.eth, TAKEN_A, escrow),
					openNote(env.strk, env.bob.address),
					invoke(escrow, [
						"0x5",
						env.eth,
						env.strk,
						TAKER_SECRET,
						"0x1",
						LOCK_ID,
						num.toHex(TAKEN_A),
						DEAL_ID,
						POOL_ADDRESS,
						OPEN_NOTE_ID,
					]),
				]),
			);
			const take = await env.node.callContract({
				contractAddress: escrow,
				entrypoint: "get_take",
				calldata: [DEAL_ID],
			});
			assert.deepEqual(
				take.slice(0, 5).map(BigInt),
				[BigInt(env.eth), TAKEN_A, BigInt(env.strk), TAKEN_B, 1n],
				"Take must record the exact real-pool fill",
			);

			const timeResponse = await fetch(devnet.url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "devnet_setTime",
					params: { time: expiry },
				}),
			});
			assert.equal(timeResponse.ok, true, "devnet_setTime must return HTTP 200");
			assert.equal(
				(await timeResponse.json()).error,
				undefined,
				"devnet_setTime must advance through lock expiry",
			);
			await createBlocks(devnet.url, 1);
			await broadcastPrepared(
				devnet,
				env,
				await prepare(maker.prover, [
					withdraw(lockTicket, 1n, escrow),
					openNote(env.eth, env.alice.address),
					invoke(escrow, ["0x6", LOCK_ID, POOL_ADDRESS, OPEN_NOTE_ID]),
				]),
			);
			const ticketNotesAfterProceeds = await notesFor(
				maker.transfers,
				devnet,
				[lockTicket, env.eth],
			);
			assert.ok(
				(ticketNotesAfterProceeds.notes.get(lockTicket) ?? []).some(
					(note) => note.amount === 1n,
				),
				"the first maker pull must return the second ticket unit privately",
			);
			assert.ok(
				(ticketNotesAfterProceeds.notes.get(env.eth) ?? []).some(
					(note) => note.amount === TAKEN_A,
				),
				"settle proceeds must return the exact taken principal",
			);

			await broadcastPrepared(
				devnet,
				env,
				await prepare(maker.prover, [
					withdraw(lockTicket, 1n, escrow),
					openNote(env.strk, env.alice.address),
					invoke(escrow, ["0x7", LOCK_ID, POOL_ADDRESS, OPEN_NOTE_ID]),
				]),
			);
			const finalLock = await env.node.callContract({
				contractAddress: escrow,
				entrypoint: "get_lock",
				calldata: [LOCK_ID],
			});
			assert.equal(BigInt(finalLock[14]), COLLATERAL - TAKEN_B);
			assert.equal(BigInt(finalLock[15]), TAKEN_A);
			assert.equal(BigInt(finalLock[17]), 1n, "proceeds must be settled");
			assert.equal(BigInt(finalLock[18]), 1n, "collateral must be released");

			const finalNotes = await notesFor(
				maker.transfers,
				devnet,
				[lockTicket, env.strk],
			);
			assert.equal(
				(finalNotes.notes.get(lockTicket) ?? []).reduce(
					(total, note) => total + note.amount,
					0n,
				),
				0n,
				"both LockTicket units must be consumed after both pulls",
			);
			assert.ok(
				(finalNotes.notes.get(env.strk) ?? []).some(
					(note) => note.amount === COLLATERAL - TAKEN_B,
				),
				"release collateral must return the exact unused collateral",
			);
		} finally {
			await devnet.cleanup();
		}
	},
);
