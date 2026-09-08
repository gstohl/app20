import { describe, expect, it } from 'vitest';
import { ec, hash } from 'starknet';
import { createConfidentialAgreement, confidentialConstructor } from '../../packages/agent-sdk/src/confidential-protocol';
import { confirmedTradingState, reviewConfidentialQuote } from './confidential-trading';
import { MAINNET_DEPLOYMENT as mainnet } from './mainnet-deployment';
import { CONFIDENTIAL_RFQ_CONTRACT } from './confidential-rfq-deployment';
import type { ConfidentialMaker, QuoteRequest } from './confidential-room';

const now=1_800_000_000;
function fixture() {
  const request:QuoteRequest={kind:'request',taker:'0x123',signerA:ec.starkCurve.getStarkKey('0xabc'),replyKey:{},sellToken:mainnet.sellToken.address,buyToken:mainnet.buyToken.address,sellAmount:'100',minimumAmount:'190'};
  const maker:ConfidentialMaker={account:'0x456',name:'Example maker',publicKey:{},expiresAt:now+240};
  const input={chainId:mainnet.chainId,pool:mainnet.settlement.pool,poolClassHash:mainnet.settlement.poolClassHash,escrowClassHash:CONFIDENTIAL_RFQ_CONTRACT.classHash,signerA:request.signerA,signerB:ec.starkCurve.getStarkKey('0xdef'),deadline:now+1800,terms:{partyA:request.taker,partyB:maker.account,tokenA:request.sellToken,tokenB:request.buyToken,amountA:request.sellAmount,amountB:'200',salt:'0x789'}};
  const candidate=createConfidentialAgreement(input),salt='0x345';
  const address=hash.calculateContractAddressFromHash(salt,candidate.escrowClassHash,confidentialConstructor(candidate),0);
  return {request,maker,quote:{kind:'quote' as const,agreement:createConfidentialAgreement({...input,address}),viewingKey:'0x12345',salt,expiresAt:now+240}};
}
describe('private quote review before wallet spending',()=>{
  it('accepts a pinned deployment and a maker return above the user minimum',()=>{
    const {request,maker,quote}=fixture();
    expect(reviewConfidentialQuote(request,maker,quote,now).agreement.terms.amountB).toBe('200');
  });
  it('rejects changed identities, assets, principal, minimum and deployment salt',()=>{
    const {request,maker,quote}=fixture();
    for(const change of [{taker:'0x999'},{signerA:ec.starkCurve.getStarkKey('0x111')},{sellToken:request.buyToken},{sellAmount:'101'},{minimumAmount:'201'}])
      expect(()=>reviewConfidentialQuote({...request,...change},maker,quote,now)).toThrow();
    expect(()=>reviewConfidentialQuote(request,{...maker,account:'0x999'},quote,now)).toThrow();
    expect(()=>reviewConfidentialQuote(request,maker,{...quote,salt:'0x346'},now)).toThrow(/deployment/);
  });
  it('rejects expired offers and noncanonical recovery scalars before deployment',()=>{
    const {request,maker,quote}=fixture();
    expect(()=>reviewConfidentialQuote(request,maker,{...quote,expiresAt:now},now)).toThrow(/expired/);
    expect(()=>reviewConfidentialQuote(request,maker,{...quote,expiresAt:now+301},now)).toThrow(/expired/);
    expect(()=>reviewConfidentialQuote(request,maker,{...quote,viewingKey:`0x${(ec.starkCurve.CURVE.n/2n+1n).toString(16)}`},now)).toThrow(/recovery/);
    // A committed swap remains recoverable after its initial quote has expired.
    expect(reviewConfidentialQuote(request,maker,quote,now+1900,true).agreement.address).toBe(quote.agreement.address);
  });
});
describe('receipt journal recovery',()=>{
  it('restores completed setup/funding/settlement after the browser lost the result',()=>{
    expect(confirmedTradingState({schema:'app20/confidential-journal/v1',scope:'0x1/0x2/0x3',confirmed:[{id:'0x1',mode:'setup',hash:'0x01'},{id:'0x2',mode:'fundA',hash:'0x02'},{id:'0x3',mode:'fundB',hash:'0x03'},{id:'0x4',mode:'settle',hash:'0x04'}]})).toEqual({setupHash:'0x1',fundingHash:'0x2',settlementHash:'0x4'});
  });
  it('never presents an unresolved hash as confirmed and rejects corrupt success records',()=>{
    expect(confirmedTradingState({schema:'app20/confidential-journal/v1',scope:'0x1/0x2/0x3',pending:{id:'0x1',mode:'fundA',hash:'0x2'},confirmed:[]})).toEqual({});
    expect(()=>confirmedTradingState({schema:'app20/confidential-journal/v1',scope:'0x1/0x2/0x3',confirmed:[{id:'0x1',mode:'fundA'}]})).toThrow(/receipt/);
  });
});
