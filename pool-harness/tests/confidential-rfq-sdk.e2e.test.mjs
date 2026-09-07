import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfidentialLab } from '../src/confidential-lab.mjs';

test('shared confidential SDK: independent approvals, exact encrypted swap, restart and unilateral refunds', { timeout: 600000 }, async () => {
  const lab = await createConfidentialLab({ mainnetClass: process.env.APP20_CONFIDENTIAL_MAINNET_CLASS === '1' });
  try {
    const trade = await lab.create();
    assert.equal((await trade.view()).status, 'setup');
    await assert.rejects(() => trade.fund('a'), /registered/i);
    await trade.operation('setup');
    await trade.fund('a');
    await assert.rejects(() => trade.client.prepare('settle'), /both agreed assets/i);
    await trade.fund('b');
    const prepared = await trade.client.prepare('settle');
    const onlyA = await trade.approve(prepared, 'a');
    await assert.rejects(() => trade.client.execute(prepared, [onlyA]), /every required party/i);
    const tampered = structuredClone(prepared); tampered.agreement.terms.amountA = '1';
    await assert.rejects(() => trade.approve(tampered, 'b'), /commitment/i);
    const onlyB = await trade.approve(prepared, 'b');
    await trade.client.execute(prepared, [onlyA, onlyB]);
    await trade.reopen();
    assert.equal((await trade.view()).settled, true);
    await assert.rejects(() => trade.client.execute(prepared, [onlyA, onlyB]), /settled or expired/i);
    console.log('SDK swap: exact jointly signed operation settled; replay and changed terms rejected.');
    const recovery = await lab.create({ amountA: '77', amountB: '99' });
    await recovery.operation('setup'); await recovery.fund('a');
    await assert.rejects(() => recovery.client.prepare('refundA'), /after the agreed deadline/i);
    await recovery.expire(); await recovery.reopen();
    assert.equal((await recovery.view()).status, 'refundable');
    // No funding or signing by party B after setup: A alone can rebuild and recover.
    await recovery.operation('refundA');
    assert.equal((await recovery.view()).status, 'closed');
    assert.deepEqual(await lab.balances(), [['99999999999999998766', '2345'], ['1234', '99999999999999997655']]);
    console.log('SDK recovery: restarted client rebuilt unilateral refund; exact final balances verified.');
  } finally { await lab.close(); }
});
