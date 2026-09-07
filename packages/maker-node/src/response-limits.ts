import { felt } from '@app20/private-intents/starknet-maker';

type Limits = { maxActiveReservations?: number; responseCooldownSeconds?: number; reservationCooldownSeconds?: number };
type Recent = Record<string, { at: number; firm: boolean }>;
export function validateResponseLimits(limits: Limits): void {
  for (const [value, max] of [[limits.maxActiveReservations ?? 20, 1000], [limits.responseCooldownSeconds ?? 60, 3600], [limits.reservationCooldownSeconds ?? 1200, 86400]]) {
    if (!Number.isSafeInteger(value) || value! < 1 || value! > max!) throw new Error('Invalid maker response limits.');
  }
}
/** Account cooldowns reduce repeat requests, but cannot prevent permissionless Sybils. */
export function canRespond(limits: Limits, recent: Recent, taker: string, now: number, firm: boolean, activeReservations: number): boolean {
  validateResponseLimits(limits);
  if (firm && activeReservations >= (limits.maxActiveReservations ?? 20)) return false;
  const previous = recent[felt(taker)];
  if (!previous) return true;
  // A preliminary answer may be followed immediately by one firm request.
  if (firm && !previous.firm) return true;
  return now - previous.at >= (previous.firm ? (limits.reservationCooldownSeconds ?? 1200) : (limits.responseCooldownSeconds ?? 60));
}
