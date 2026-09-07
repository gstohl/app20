import type { Call } from 'starknet';
import { rejectPublicSettlement } from '@app20/domain';
import { publicKey, keyCoordinates, felt } from '@app20/private-intents/starknet-maker';
import { MAINNET_DEPLOYMENT as deployment } from './mainnet-deployment';

export function makerUnits(value: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const result = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (result <= 0n || result >= 1n << 128n) throw new Error('Amount must be positive and fit in 128 bits.');
  return result.toString();
}
export async function makerRegistration(raw: string, days: number, now: number): Promise<Call> {
  rejectPublicSettlement();
  let key: JsonWebKey;
  try { key = JSON.parse(raw); } catch { throw new Error('Paste the public P-256 key JSON printed by the bot.'); }
  if (key.d) throw new Error('This is a private key. Remove it; only paste the public key.');
  await publicKey(key);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Registration must last 1–30 days.');
  return { contractAddress: deployment.address, entrypoint: 'register', calldata: [...keyCoordinates(key), String(now + days * 86400)] };
}
export function makerInventoryCalls(action: 'fund' | 'withdraw', token: string, value: string): Call[] {
  if (action === 'fund') rejectPublicSettlement();
  const metadata = [deployment.sellToken, deployment.buyToken].find(t => felt(t.address) === felt(token));
  if (!metadata) throw new Error('Unsupported inventory token.');
  const amount = makerUnits(value, metadata.decimals);
  const movement = { contractAddress: deployment.settlement.address, entrypoint: action === 'fund' ? 'deposit_inventory' : 'withdraw_inventory', calldata: [felt(token), amount] };
  return action === 'fund' ? [{ contractAddress: felt(token), entrypoint: 'approve', calldata: [deployment.settlement.address, amount, '0'] }, movement] : [movement];
}
export function makerOperatorConfig(input: { account: string; reverse: boolean; price: string; spread: number; maxSell: string; maxBuy: string; priceHours: number; maxFee: string; totalFees: string; keyValidUntil: number }, now: number) {
  const sell = input.reverse ? deployment.buyToken : deployment.sellToken;
  const buy = input.reverse ? deployment.sellToken : deployment.buyToken;
  if (BigInt(felt(input.account)) === 0n) throw new Error('Connect your maker account.');
  if (!Number.isInteger(input.spread) || input.spread < 0 || input.spread >= 10000) throw new Error('Spread must be 0–9999 basis points.');
  if (!Number.isFinite(input.priceHours) || input.priceHours <= 0 || input.priceHours > 24) throw new Error('Price validity must be between 0 and 24 hours.');
  if (input.keyValidUntil <= now) throw new Error('Register a public key before exporting bot settings.');
  const numerator = makerUnits(input.price, buy.decimals);
  const maxFee = makerUnits(input.maxFee, 18), totalFees = makerUnits(input.totalFees, 18);
  if (BigInt(maxFee) > BigInt(totalFees)) throw new Error('Per-transaction gas limit exceeds the total budget.');
  return { rpcUrl: 'https://api.cartridge.gg/x/starknet/mainnet', chainId: deployment.chainId, address: deployment.address, classHash: deployment.classHash, fromBlock: deployment.fromBlock,
    account: felt(input.account), stateFile: './maker-state.json', keyValidUntil: input.keyValidUntil, maxResponses: 10, maxFeePerTransaction: maxFee, maxTotalFees: totalFees,
    markets: [{ sellToken: sell.address, buyToken: buy.address, numerator, denominator: (10n ** BigInt(sell.decimals)).toString(), maxSellAmount: makerUnits(input.maxSell, sell.decimals), maxBuyAmount: makerUnits(input.maxBuy, buy.decimals), spreadBps: input.spread, validUntil: Math.floor(now + input.priceHours * 3600) }], settlement: deployment.settlement, quoteTtlSeconds: 1200, indicativeTtlSeconds: 300, maxActiveReservations: 20, responseCooldownSeconds: 60, reservationCooldownSeconds: 1200 };
}
