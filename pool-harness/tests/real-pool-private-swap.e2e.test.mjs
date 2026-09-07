import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { json } from 'starknet';
import { Devnet, createDevnetTestEnv } from '@starkware-libs/starknet-privacy-sdk/testing';
import { seal, requestCall, felt, keyCoordinates } from '../../packages/private-intents/src/starknet-maker.ts';
import { buildPrivateSettlementActions } from '../../packages/private-intents/src/private-settlement.ts';
const ROOT = resolve(import.meta.dirname, '../..');
const exec = promisify(execFile);
async function rpc(url, method, params = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json(); assert(!body.error, JSON.stringify(body.error)); return body.result;
}
async function blocks(url) { for (let i = 0; i < 12; i++) await rpc(url, 'devnet_createBlock'); }
async function success(env, tx) { const receipt = await env.node.waitForTransaction(tx.transaction_hash); assert(receipt.isSuccess(), String(receipt.revert_reason)); return receipt; }
async function deploy(env, name, calldata = []) {
  const path = join(ROOT, 'cairo/target/dev', `app20_chat_${name}`);
  const declared = await env.admin.declare({ contract: json.parse(await readFile(`${path}.contract_class.json`, 'utf8')), casm: json.parse(await readFile(`${path}.compiled_contract_class.json`, 'utf8')) });
  await success(env, declared);
  const tx = await env.admin.deployContract({ classHash: declared.class_hash, constructorCalldata: calldata }); await success(env, tx);
  return { address: tx.contract_address ?? tx.address, classHash: declared.class_hash };
}
async function balance(env, token, address) { const n = await env.node.callContract({ contractAddress: token, entrypoint: 'balance_of', calldata: [address] }); return BigInt(n[0]) + (BigInt(n[1]) << 128n); }

test('retired public settlement: new operator actions refused and earlier inventory recoverable', { timeout: 600000 }, async () => {
  execFileSync(join(ROOT, 'vendor/bin/app20-scarb'), ['build'], { cwd: join(ROOT, 'cairo'), stdio: 'inherit' });
  const devnet=new Devnet(),directory=await mkdtemp(join(tmpdir(),'app20-legacy-recovery-'));
  try {
    const {env}=await createDevnetTestEnv(devnet);
    const book=await deploy(env,'App20MakerBook');
    const swap=await deploy(env,'App20PrivateSwap',[env.privacy.address,book.address]);
    const head=await env.node.getBlockWithTxHashes('latest');
    const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const accounts=await rpc(devnet.url,'devnet_getPredeployedAccounts',[]);
    const bob=accounts.find(account=>BigInt(account.address)===BigInt(env.bob.address));assert(bob);
    const config={...book,rpcUrl:devnet.url,chainId:await env.node.getChainId(),fromBlock:head.block_number,account:env.bob.address,stateFile:join(directory,'state.json'),keyValidUntil:head.timestamp+3600,maxResponses:1,maxFeePerTransaction:'1000000000000000000',maxTotalFees:'100000000000000000000',settlement:{...swap,pool:env.privacy.address,poolClassHash:await env.node.getClassHashAt(env.privacy.address)},inventoryWithdrawal:{token:env.eth,amount:'200'},markets:[{sellToken:env.strk,buyToken:env.eth,numerator:'2',denominator:'1',maxSellAmount:'100',maxBuyAmount:'200',spreadBps:500,validUntil:head.timestamp+3600}]};
    const configPath=join(directory,'operator.json');await writeFile(configPath,JSON.stringify(config),{mode:0o600});
    const run=mode=>exec(process.execPath,['scripts/starknet-maker.mjs',configPath,mode],{cwd:ROOT,env:{...process.env,APP20_MAKER_SIGNING_KEY:bob.private_key},timeout:120000});
    for(const mode of ['--register','--fund','--run']) await assert.rejects(()=>run(mode),error=>/Confidential settlement is required/.test(error.stderr));
    assert.throws(()=>buildPrivateSettlementActions({}, {}, {}, '0x1',env.alice.address),/Confidential settlement is required/);
    await assert.rejects(()=>readFile(config.stateFile),/ENOENT/);
    // Seed an earlier public position directly in this disposable contract fixture.
    await success(env,await env.bob.execute({contractAddress:book.address,entrypoint:'register',calldata:[...keyCoordinates(await crypto.subtle.exportKey('jwk',keys.publicKey)),String(config.keyValidUntil)]}));
    await success(env,await env.bob.execute([{contractAddress:env.eth,entrypoint:'approve',calldata:[swap.address,'200','0']},{contractAddress:swap.address,entrypoint:'deposit_inventory',calldata:[env.eth,'200']} ]));
    const scope={chainId:config.chainId,book:book.address,maker:env.bob.address,taker:env.alice.address,id:'0x777',revision:1,expiresAt:head.timestamp+1800};
    const oldRequest=await seal(scope,'request',{sellToken:env.strk,buyToken:env.eth,sellAmount:'40',minBuyAmount:'76',replyKey:await crypto.subtle.exportKey('jwk',keys.publicKey)},keys.publicKey);
    await success(env,await env.alice.execute(requestCall(scope,oldRequest)));
    const expiry=head.timestamp+900;
    await success(env,await env.bob.execute({contractAddress:swap.address,entrypoint:'reserve_quote',calldata:[scope.id,env.strk,env.eth,'40','76','0x888',String(expiry)]}));
    await writeFile(config.stateFile,JSON.stringify({scope:[config.chainId,config.address,config.account].map(felt).join('/'),cursor:config.fromBlock,spent:'0',pending:null,reservations:[scope.id],settlement:swap.address}),{mode:0o600});
    await run('--check');
    await rpc(devnet.url,'devnet_setTime',{time:expiry+1});await blocks(devnet.url);
    await run('--release');
    assert.equal(BigInt((await env.node.callContract({contractAddress:swap.address,entrypoint:'quote',calldata:[scope.id]}))[7]),3n);
    const before=await balance(env,env.eth,env.bob.address);
    await run('--withdraw');
    assert.equal(await balance(env,env.eth,swap.address),0n);
    assert.equal(await balance(env,env.eth,env.bob.address),before+200n);
    await run('--deactivate');await run('--reconcile');
    console.log('New public execution blocked; earlier reservation released, inventory withdrawn, registration deactivated and journal reconciled on local devnet.');
  } finally {await devnet.cleanup();await rm(directory,{recursive:true,force:true});}
});
