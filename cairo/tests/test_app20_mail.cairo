use app20_mail::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use app20_mail::{
    App20Mail, IApp20MailDispatcher, IApp20MailDispatcherTrait, IApp20MailSafeDispatcher,
    IApp20MailSafeDispatcherTrait, MAIL_RECOVERY_AMOUNT, MAX_CT_FELTS, OpenNoteDeposit,
};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait,
    cheat_caller_address, declare, spy_events, start_cheat_transaction_hash,
};
use starknet::ContractAddress;

fn contract_address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn deploy_helper(pool: ContractAddress) -> (ContractAddress, IApp20MailDispatcher) {
    let contract = declare("App20Mail").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![pool.into()]).unwrap();
    (address, IApp20MailDispatcher { contract_address: address })
}

fn deploy_token(
    recipient: ContractAddress, supply: u256,
) -> (ContractAddress, IMockErc20Dispatcher) {
    let contract = declare("MockErc20").unwrap().contract_class();
    let mut calldata = array![recipient.into()];
    supply.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    (address, IMockErc20Dispatcher { contract_address: address })
}

fn transfer_from_pool(
    pool: ContractAddress,
    helper_address: ContractAddress,
    token_address: ContractAddress,
    token: IMockErc20Dispatcher,
    amount: u128,
) {
    cheat_caller_address(token_address, pool, CheatSpan::TargetCalls(1));
    assert(token.transfer(helper_address, amount.into()), 'transfer failed');
}

fn prepare_funding(
    helper_address: ContractAddress,
    helper: IApp20MailDispatcher,
    token: ContractAddress,
    transaction_hash: felt252,
) {
    start_cheat_transaction_hash(helper_address, transaction_hash);
    helper.prepare_funding(token);
}

fn invoke(
    helper_address: ContractAddress,
    helper: IApp20MailDispatcher,
    pool: ContractAddress,
    token: ContractAddress,
    note_id: felt252,
    ct: Array<felt252>,
    action_id: felt252,
) -> Span<OpenNoteDeposit> {
    cheat_caller_address(helper_address, pool, CheatSpan::TargetCalls(1));
    helper
        .privacy_invoke(
            token,
            contract_address(0x999),
            note_id,
            (0x111, 0x222),
            0x7a,
            (0x333, 0x444),
            ct,
            action_id,
        )
}

fn compute_protected(
    helper: IApp20MailDispatcher,
    identity_key: felt252,
    token: ContractAddress,
    note_id: felt252,
    ct: Array<felt252>,
    action_id: felt252,
) -> (felt252, felt252) {
    helper
        .privacy_compute(
            identity_key, token, note_id, (0x111, 0x222), 0x7a, (0x333, 0x444), ct, action_id,
        )
}

fn invoke_protected(
    helper_address: ContractAddress,
    helper: IApp20MailDispatcher,
    pool: ContractAddress,
    computation: (felt252, felt252),
    token: ContractAddress,
    note_id: felt252,
    ct: Array<felt252>,
    action_id: felt252,
) -> Span<OpenNoteDeposit> {
    cheat_caller_address(helper_address, pool, CheatSpan::TargetCalls(1));
    let (replay_slot, payload_commitment) = computation;
    helper
        .privacy_invoke_with_computation(
            replay_slot,
            payload_commitment,
            token,
            contract_address(0x999),
            note_id,
            (0x111, 0x222),
            0x7a,
            (0x333, 0x444),
            ct,
            action_id,
        )
}

#[test]
#[should_panic(expected: ('BAD_POOL',))]
fn non_pool_caller_reverts() {
    let pool = contract_address(0x100);
    let (_helper_address, helper) = deploy_helper(pool);

    helper
        .privacy_invoke(
            contract_address(0x200),
            contract_address(0x300),
            0x400,
            (0x1, 0x2),
            3,
            (0x4, 0x5),
            array![0x6],
            0,
        );
}

#[test]
#[should_panic(expected: ('BAD_POOL',))]
fn protected_non_pool_caller_reverts() {
    let pool = contract_address(0x10f);
    let (_helper_address, helper) = deploy_helper(pool);
    let token = contract_address(0x20f);
    let computation = compute_protected(helper, 0xa11ce, token, 0xf0f, array![0x1], 0xaaaa);
    let (replay_slot, payload_commitment) = computation;

    helper
        .privacy_invoke_with_computation(
            replay_slot,
            payload_commitment,
            token,
            contract_address(0x999),
            0xf0f,
            (0x111, 0x222),
            0x7a,
            (0x333, 0x444),
            array![0x1],
            0xaaaa,
        );
}

#[test]
#[should_panic(expected: ('CT_TOO_LARGE',))]
fn oversized_ciphertext_reverts() {
    let pool = contract_address(0x107);
    let (helper_address, helper) = deploy_helper(pool);
    let mut ct = array![];
    let mut index = 0;
    while index <= MAX_CT_FELTS {
        ct.append(0);
        index += 1;
    }

    invoke(helper_address, helper, pool, contract_address(0x207), 0x307, ct, 0);
}

#[test]
fn post_emits_event_with_exact_payload() {
    let pool = contract_address(0x101);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);
    let mut spy = spy_events();
    let expected_ct = array![0x2, 0xabc, 0xdef];

    let computation = compute_protected(
        helper, 0x12345, token_address, 0x515, array![0x2, 0xabc, 0xdef], 0xa11,
    );
    let deposits = invoke_protected(
        helper_address,
        helper,
        pool,
        computation,
        token_address,
        0x515,
        array![0x2, 0xabc, 0xdef],
        0xa11,
    );

    assert(deposits.is_empty(), 'expected no deposit');
    spy
        .assert_emitted(
            @array![
                (
                    helper_address,
                    App20Mail::Event::MessagePosted(
                        App20Mail::MessagePosted {
                            index: 0,
                            eph_pk: (0x111, 0x222),
                            view_tag: 0x7a,
                            nonce: (0x333, 0x444),
                            ct: expected_ct.span(),
                            action_id: 0xa11,
                        },
                    ),
                ),
            ],
        );
    assert(helper.message_count() == 1, 'wrong message count');
}

#[test]
#[should_panic(expected: ('ACTION_ID_USED',))]
fn duplicate_nonzero_action_id_reverts() {
    let pool = contract_address(0x108);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);

    let computation = compute_protected(helper, 0x12345, token_address, 0x808, array![0x1], 0xaaaa);
    let first = invoke_protected(
        helper_address, helper, pool, computation, token_address, 0x808, array![0x1], 0xaaaa,
    );
    assert(first.is_empty(), 'expected no deposit');

    invoke_protected(
        helper_address, helper, pool, computation, token_address, 0x808, array![0x1], 0xaaaa,
    );
}

#[test]
fn different_nonzero_action_ids_both_succeed() {
    let pool = contract_address(0x109);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);

    let first_computation = compute_protected(
        helper, 0x12345, token_address, 0x909, array![0x1], 0xaaaa,
    );
    let first = invoke_protected(
        helper_address, helper, pool, first_computation, token_address, 0x909, array![0x1], 0xaaaa,
    );
    let second_computation = compute_protected(
        helper, 0x12345, token_address, 0x909, array![0x1], 0xbbbb,
    );
    let second = invoke_protected(
        helper_address, helper, pool, second_computation, token_address, 0x909, array![0x1], 0xbbbb,
    );

    assert(first.is_empty(), 'expected no first deposit');
    assert(second.is_empty(), 'expected no second deposit');
    assert(helper.message_count() == 2, 'wrong message count');
}

#[test]
#[should_panic(expected: ('PROTECTED_ACTION_REQUIRED',))]
fn plain_invoke_rejects_nonzero_action_id() {
    let pool = contract_address(0x10b);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);

    invoke(helper_address, helper, pool, token_address, 0xb0b, array![0x1], 0xaaaa);
}

#[test]
fn another_identity_cannot_reserve_the_intended_senders_action_id() {
    let pool = contract_address(0x10c);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);
    let action_id = 0xaaaa;

    let attacker_computation = compute_protected(
        helper, 0xbad, token_address, 0xbad, array![0xdead], action_id,
    );
    let intended_computation = compute_protected(
        helper, 0xa11ce, token_address, 0xcafe, array![0xbeef], action_id,
    );
    let (attacker_slot, _) = attacker_computation;
    let (intended_slot, _) = intended_computation;
    assert(attacker_slot != intended_slot, 'identity did not bind slot');

    let attacker = invoke_protected(
        helper_address,
        helper,
        pool,
        attacker_computation,
        token_address,
        0xbad,
        array![0xdead],
        action_id,
    );
    let intended = invoke_protected(
        helper_address,
        helper,
        pool,
        intended_computation,
        token_address,
        0xcafe,
        array![0xbeef],
        action_id,
    );

    assert(attacker.is_empty(), 'expected no attacker deposit');
    assert(intended.is_empty(), 'expected no intended deposit');
    assert(helper.message_count() == 2, 'intended message was suppressed');
}

#[test]
fn retry_with_fresh_ciphertext_keeps_slot_but_changes_payload_commitment() {
    let pool = contract_address(0x10d);
    let (_helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);

    let first = compute_protected(helper, 0xa11ce, token_address, 0xd0d, array![0x111], 0xaaaa);
    let retry = compute_protected(helper, 0xa11ce, token_address, 0xd0d, array![0x222], 0xaaaa);
    let (first_slot, first_payload) = first;
    let (retry_slot, retry_payload) = retry;

    assert(first_slot == retry_slot, 'retry changed replay slot');
    assert(first_payload != retry_payload, 'payload was not committed');
}

#[test]
#[should_panic(expected: ('PAYLOAD_MISMATCH',))]
fn protected_invoke_rejects_payload_different_from_compute_phase() {
    let pool = contract_address(0x10e);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);
    let computation = compute_protected(
        helper, 0xa11ce, token_address, 0xe0e, array![0x111], 0xaaaa,
    );

    invoke_protected(
        helper_address, helper, pool, computation, token_address, 0xe0e, array![0x222], 0xaaaa,
    );
}

#[test]
fn zero_action_id_can_repeat_freely() {
    let pool = contract_address(0x10a);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);

    let first = invoke(helper_address, helper, pool, token_address, 0xa0a, array![0x1], 0);
    let second = invoke(helper_address, helper, pool, token_address, 0xa0a, array![0x1], 0);

    assert(first.is_empty(), 'expected no first deposit');
    assert(second.is_empty(), 'expected no second deposit');
    assert(helper.message_count() == 2, 'wrong message count');
}

#[test]
fn zero_balance_returns_empty_span() {
    let pool = contract_address(0x102);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 1_000);

    let deposits = invoke(
        helper_address, helper, pool, token_address, 0x616, array![0x1, 0xbeef], 0,
    );

    assert(deposits.is_empty(), 'expected empty deposit span');
    assert(helper.message_count() == 1, 'message was not posted');
}

#[test]
fn only_fixed_recovery_amount_is_approved_and_echoed() {
    let pool = contract_address(0x103);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    let dust: u256 = 100;

    transfer_from_pool(pool, helper_address, token_address, token, dust.try_into().unwrap());
    prepare_funding(helper_address, helper, token_address, 0x717);
    transfer_from_pool(pool, helper_address, token_address, token, MAIL_RECOVERY_AMOUNT);

    let deposits = invoke(
        helper_address, helper, pool, token_address, 0x717, array![0x1, 0xcafe], 0,
    );

    assert(deposits.len() == 1, 'expected one deposit');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == 0x717, 'wrong note id');
    assert(deposit.token == token_address, 'wrong token');
    assert(deposit.amount == MAIL_RECOVERY_AMOUNT, 'wrong amount');
    assert(
        token.allowance(helper_address, pool) == MAIL_RECOVERY_AMOUNT.into(),
        'wrong recovery approval',
    );
    assert(
        token.balance_of(helper_address) == dust + MAIL_RECOVERY_AMOUNT.into(),
        'balance moved early',
    );
}

#[test]
fn ambient_donation_without_current_preparation_is_not_recovered() {
    let pool = contract_address(0x110);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    let donation: u128 = 100;
    transfer_from_pool(pool, helper_address, token_address, token, donation);

    let deposits = invoke(helper_address, helper, pool, token_address, 0x810, array![0x1, 0x2], 0);

    assert(deposits.is_empty(), 'ambient donation was recovered');
    assert(token.balance_of(helper_address) == donation.into(), 'donation moved');
    assert(token.allowance(helper_address, pool) == 0, 'donation was approved');
    assert(helper.message_count() == 1, 'message was not posted');
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn prepared_zero_new_input_cannot_recover_ambient_donation() {
    let pool = contract_address(0x111);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    transfer_from_pool(pool, helper_address, token_address, token, 100);
    prepare_funding(helper_address, helper, token_address, 0x811);

    invoke(helper_address, helper, pool, token_address, 0x811, array![0x1], 0);
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn prepared_short_recovery_input_reverts() {
    let pool = contract_address(0x112);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    prepare_funding(helper_address, helper, token_address, 0x812);
    transfer_from_pool(pool, helper_address, token_address, token, MAIL_RECOVERY_AMOUNT - 1);

    invoke(helper_address, helper, pool, token_address, 0x812, array![0x1], 0);
}

#[test]
#[should_panic(expected: ('EXCESS_FILL',))]
fn prepared_excess_recovery_input_reverts() {
    let pool = contract_address(0x113);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    prepare_funding(helper_address, helper, token_address, 0x813);
    transfer_from_pool(pool, helper_address, token_address, token, MAIL_RECOVERY_AMOUNT + 1);

    invoke(helper_address, helper, pool, token_address, 0x813, array![0x1], 0);
}

#[test]
fn stale_preparation_preserves_message_only_semantics() {
    let pool = contract_address(0x114);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    prepare_funding(helper_address, helper, token_address, 0x814);
    transfer_from_pool(pool, helper_address, token_address, token, MAIL_RECOVERY_AMOUNT);
    start_cheat_transaction_hash(helper_address, 0x815);

    let deposits = invoke(helper_address, helper, pool, token_address, 0x814, array![0x1], 0);

    assert(deposits.is_empty(), 'stale recovered');
    assert(token.allowance(helper_address, pool) == 0, 'stale funds were approved');
    assert(helper.message_count() == 1, 'message was not posted');
}

#[test]
#[feature("safe_dispatcher")]
fn failed_short_fill_rolls_back_snapshot_consumption() {
    let pool = contract_address(0x115);
    let (helper_address, helper) = deploy_helper(pool);
    let safe_helper = IApp20MailSafeDispatcher { contract_address: helper_address };
    let (token_address, token) = deploy_token(pool, 1_000);
    prepare_funding(helper_address, helper, token_address, 0x815);
    transfer_from_pool(pool, helper_address, token_address, token, MAIL_RECOVERY_AMOUNT - 1);
    cheat_caller_address(helper_address, pool, CheatSpan::TargetCalls(1));

    let failed = safe_helper
        .privacy_invoke(
            token_address,
            contract_address(0x999),
            0x815,
            (0x111, 0x222),
            0x7a,
            (0x333, 0x444),
            array![0x1],
            0,
        );
    assert(failed.is_err(), 'short succeeded');
    assert(helper.message_count() == 0, 'failed message was retained');

    transfer_from_pool(pool, helper_address, token_address, token, 1);
    let deposits = invoke(helper_address, helper, pool, token_address, 0x815, array![0x1], 0);
    assert(deposits.len() == 1, 'snapshot consumed');
}

#[test]
fn consumed_preparation_cannot_recover_twice() {
    let pool = contract_address(0x116);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    prepare_funding(helper_address, helper, token_address, 0x816);
    transfer_from_pool(pool, helper_address, token_address, token, MAIL_RECOVERY_AMOUNT);

    let first = invoke(helper_address, helper, pool, token_address, 0x816, array![0x1], 0);
    let second = invoke(helper_address, helper, pool, token_address, 0x817, array![0x2], 0);

    assert(first.len() == 1, 'first recovery missing');
    assert(second.is_empty(), 'snapshot was reused');
    assert(helper.message_count() == 2, 'message-only retry failed');
}

#[test]
fn register_pubkeys_are_isolated_by_caller() {
    let pool = contract_address(0x104);
    let registrant_a = contract_address(0x105);
    let registrant_b = contract_address(0x106);
    let (helper_address, helper) = deploy_helper(pool);

    cheat_caller_address(helper_address, registrant_a, CheatSpan::TargetCalls(1));
    helper.register_pubkey((0x123456, 0xabcdef));
    cheat_caller_address(helper_address, registrant_b, CheatSpan::TargetCalls(1));
    helper.register_pubkey((0x777777, 0x888888));

    assert(helper.get_pubkey(registrant_a) == (0x123456, 0xabcdef), 'caller B altered caller A');
    assert(helper.get_pubkey(registrant_b) == (0x777777, 0x888888), 'caller B key mismatch');
}
