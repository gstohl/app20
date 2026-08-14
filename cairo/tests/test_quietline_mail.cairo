use quietline_mail::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use quietline_mail::{
    IQuietlineMailDispatcher, IQuietlineMailDispatcherTrait, MAX_CT_FELTS, OpenNoteDeposit,
    QuietlineMail,
};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait,
    cheat_caller_address, declare, spy_events,
};
use starknet::ContractAddress;

fn contract_address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn deploy_helper(pool: ContractAddress) -> (ContractAddress, IQuietlineMailDispatcher) {
    let contract = declare("QuietlineMail").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![pool.into()]).unwrap();
    (address, IQuietlineMailDispatcher { contract_address: address })
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

fn invoke(
    helper_address: ContractAddress,
    helper: IQuietlineMailDispatcher,
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

    let deposits = invoke(
        helper_address, helper, pool, token_address, 0x515, array![0x2, 0xabc, 0xdef], 0xa11,
    );

    assert(deposits.is_empty(), 'expected no deposit');
    spy
        .assert_emitted(
            @array![
                (
                    helper_address,
                    QuietlineMail::Event::MessagePosted(
                        QuietlineMail::MessagePosted {
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

    let first = invoke(helper_address, helper, pool, token_address, 0x808, array![0x1], 0xaaaa);
    assert(first.is_empty(), 'expected no deposit');

    invoke(helper_address, helper, pool, token_address, 0x808, array![0x1], 0xaaaa);
}

#[test]
fn different_nonzero_action_ids_both_succeed() {
    let pool = contract_address(0x109);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, _) = deploy_token(pool, 0);

    let first = invoke(helper_address, helper, pool, token_address, 0x909, array![0x1], 0xaaaa);
    let second = invoke(helper_address, helper, pool, token_address, 0x909, array![0x1], 0xbbbb);

    assert(first.is_empty(), 'expected no first deposit');
    assert(second.is_empty(), 'expected no second deposit');
    assert(helper.message_count() == 2, 'wrong message count');
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
fn dust_balance_is_approved_and_echoed() {
    let pool = contract_address(0x103);
    let (helper_address, helper) = deploy_helper(pool);
    let (token_address, token) = deploy_token(pool, 1_000);
    let dust: u256 = 100;

    cheat_caller_address(token_address, pool, CheatSpan::TargetCalls(1));
    assert(token.transfer(helper_address, dust), 'dust transfer failed');

    let deposits = invoke(
        helper_address, helper, pool, token_address, 0x717, array![0x1, 0xcafe], 0,
    );

    assert(deposits.len() == 1, 'expected one deposit');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == 0x717, 'wrong note id');
    assert(deposit.token == token_address, 'wrong token');
    assert(deposit.amount == 100, 'wrong amount');
    assert(token.allowance(helper_address, pool) == dust, 'dust was not approved');
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
