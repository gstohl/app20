import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBudgeted} from '../src/budgeted-account.ts';
const bounds={l1_gas:{max_amount:2n,max_price_per_unit:3n},l2_gas:{max_amount:2n,max_price_per_unit:3n},l1_data_gas:{max_amount:0n,max_price_per_unit:0n}};
test('budget wrapper preserves proof bytes and facts while bounding gas and journaling before signing',async()=>{
 let state={spent:'0'};const writes=[];const details={proof:'0x1234',proofFacts:['0x5678'],skipValidate:false};const calls=[{contractAddress:'0x1',entrypoint:'invoke',calldata:[]}];
 const account={estimateInvokeFee:async(c,d)=>{assert.deepEqual(c,calls);assert.equal(d.proof,details.proof);assert.deepEqual(d.proofFacts,details.proofFacts);return{resourceBounds:bounds};},execute:async(c,d)=>{assert.deepEqual(state.pending,{});assert.equal(d.proof,details.proof);assert.deepEqual(d.proofFacts,details.proofFacts);assert.equal(d.skipValidate,false);assert.deepEqual(d.resourceBounds,bounds);return{transaction_hash:'0x9'};}};
 await executeBudgeted(account,calls,details,{maxFeePerTransaction:12n,maxTotalFees:12n,load:async()=>structuredClone(state),save:async s=>{state=structuredClone(s);writes.push(structuredClone(s));}});
 assert.deepEqual(writes,[{spent:'12',pending:{}},{spent:'12',pending:{hash:'0x9'}}]);
 await assert.rejects(executeBudgeted(account,calls,details,{maxFeePerTransaction:12n,maxTotalFees:24n,load:async()=>state,save:async()=>{}}),/Reconcile/);
});
test('fee cap refusal does not sign or consume a budget',async()=>{
 const account={estimateInvokeFee:async()=>({resourceBounds:bounds}),execute:async()=>assert.fail('must not sign')};
 await assert.rejects(executeBudgeted(account,[],{}, {maxFeePerTransaction:11n,maxTotalFees:100n,load:async()=>({spent:'0'}),save:async()=>assert.fail('must not save')}),/budget/);
});
