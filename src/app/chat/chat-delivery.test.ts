import { describe, expect, it } from 'vitest';
import { chatDeliveryLabel } from './ChatTimeline';
import type { ChatItem } from './chat-model';

const item = (extra: Record<string, unknown>) => ({ direction: 'outgoing', provenance: 'device-sent', ...extra }) as ChatItem;
describe('message delivery presentation', () => {
  it('does not treat a saved transaction hash as confirmation', () => {
    expect(chatDeliveryLabel(item({ message: { transactionHash: '0x123' } }))).toBe('Saved on this device');
  });
  it('keeps partial delivery distinct from confirmed delivery', () => {
    expect(chatDeliveryLabel(item({ message: { deliveryState: 'partially_confirmed' } }))).toBe('Partially confirmed');
    expect(chatDeliveryLabel(item({ message: { deliveryState: 'confirmed' } }))).toBe('Confirmed on-chain');
  });
  it('never presents imported links or saved deal state as message confirmation', () => {
    expect(chatDeliveryLabel(item({ provenance: 'payment-link', message: { deliveryState: 'confirmed' } }))).toBe('Imported request');
    expect(chatDeliveryLabel(item({ provenance: 'mailbox-record' }))).toBe('Saved record');
  });
});
