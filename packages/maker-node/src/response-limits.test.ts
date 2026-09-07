import { it, expect } from 'vitest';
import { canRespond, validateResponseLimits } from './response-limits';
it('allows comparison then reservation, limits repeat requests and active inventory locks', () => {
  expect(canRespond({}, {}, '0x1', 1000, false, 0)).toBe(true);
  const preliminary = { '0x1': { at: 1000, firm: false } };
  expect(canRespond({}, preliminary, '0x01', 1001, false, 0)).toBe(false);
  expect(canRespond({}, preliminary, '0x1', 1001, true, 0)).toBe(true);
  expect(canRespond({}, preliminary, '0x1', 1001, true, 20)).toBe(false);
  const reserved = { '0x1': { at: 1001, firm: true } };
  expect(canRespond({}, reserved, '0x1', 1002, true, 1)).toBe(false);
  expect(canRespond({}, reserved, '0x1', 1002, false, 1)).toBe(false);
  expect(canRespond({}, reserved, '0x1', 2201, true, 0)).toBe(true);
});
it('rejects disabling admission caps through malformed settings', () => {
  for (const value of [0, -1, NaN, 1.5, 1001]) expect(() => validateResponseLimits({ maxActiveReservations: value })).toThrow();
});
