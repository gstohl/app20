use quietline_mail::OpenNoteDeposit;
use quietline_mail::escrow::{
    ClaimParams, DealStatus, EscrowOperation, FillParams, FundParams, IQuietlineEscrowDispatcher,
    IQuietlineEscrowDispatcherTrait, PayoutOperation, QuietlineEscrow, TimeoutParams,
};
use quietline_mail::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use snforge_std::signature::stark_curve::{
    StarkCurveKeyPair, StarkCurveKeyPairImpl, StarkCurveSignerImpl,
};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait,
    cheat_block_timestamp, cheat_caller_address, declare, spy_events,
};
use starknet::ContractAddress;

const DEAL_1: felt252 = 0xD001;
const DEAL_2: felt252 = 0xD002;
const SECRET_1: felt252 = 0x515151;
const SECRET_2: felt252 = 0x525252;
const FUND_TIME: u64 = 10;
const DEADLINE: u64 = 100;
const LEG_A_AMOUNT: u128 = 500;
const LEG_B_AMOUNT: u128 = 700;

fn key_from_secret(secret: felt252) -> StarkCurveKeyPair {
    StarkCurveKeyPairImpl::from_secret_key(secret)
}

fn contract_address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn deploy_escrow(pool: ContractAddress) -> (ContractAddress, IQuietlineEscrowDispatcher) {
    let contract = declare("QuietlineEscrow").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![pool.into()]).unwrap();
    (address, IQuietlineEscrowDispatcher { contract_address: address })
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

fn deploy_fixture() -> (
    ContractAddress,
    ContractAddress,
    IQuietlineEscrowDispatcher,
    ContractAddress,
    IMockErc20Dispatcher,
    ContractAddress,
    IMockErc20Dispatcher,
) {
    let pool = contract_address(0x1000);
    let (escrow_address, escrow) = deploy_escrow(pool);
    let (token_a_address, token_a) = deploy_token(pool, 10_000);
    let (token_b_address, token_b) = deploy_token(pool, 10_000);
    (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b)
}

fn transfer_from(
    token_address: ContractAddress,
    token: IMockErc20Dispatcher,
    sender: ContractAddress,
    recipient: ContractAddress,
    amount: u128,
) {
    cheat_caller_address(token_address, sender, CheatSpan::TargetCalls(1));
    assert(token.transfer(recipient, amount.into()), 'token transfer failed');
}

fn invoke_as_pool(
    escrow_address: ContractAddress,
    escrow: IQuietlineEscrowDispatcher,
    pool: ContractAddress,
    at: u64,
    operation: EscrowOperation,
    deal_id: felt252,
    note_id: felt252,
) -> Span<OpenNoteDeposit> {
    cheat_caller_address(escrow_address, pool, CheatSpan::TargetCalls(1));
    cheat_block_timestamp(escrow_address, at, CheatSpan::TargetCalls(1));
    escrow.privacy_invoke(operation, deal_id, contract_address(0xBAD), note_id)
}

fn fund(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IQuietlineEscrowDispatcher,
    token_a_address: ContractAddress,
    token_a: IMockErc20Dispatcher,
    token_b_address: ContractAddress,
    deal_id: felt252,
    amount: u128,
    counter_amount: u128,
    deadline: u64,
    claim_secret: felt252,
) {
    let claim_key = key_from_secret(claim_secret);
    transfer_from(token_a_address, token_a, pool, escrow_address, amount);
    let deposits = invoke_as_pool(
        escrow_address,
        escrow,
        pool,
        FUND_TIME,
        EscrowOperation::Fund(
            FundParams {
                token: token_a_address,
                counter_token: token_b_address,
                counter_amount,
                deadline,
                claim_pubkey: claim_key.public_key,
            },
        ),
        deal_id,
        0,
    );
    assert(deposits.is_empty(), 'fund released value');
}

fn fill(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IQuietlineEscrowDispatcher,
    token_b_address: ContractAddress,
    token_b: IMockErc20Dispatcher,
    deal_id: felt252,
    amount: u128,
    at: u64,
    note_id: felt252,
) -> Span<OpenNoteDeposit> {
    transfer_from(token_b_address, token_b, pool, escrow_address, amount);
    invoke_as_pool(
        escrow_address,
        escrow,
        pool,
        at,
        EscrowOperation::Fill(FillParams { token: token_b_address }),
        deal_id,
        note_id,
    )
}

fn signature_for(
    escrow: IQuietlineEscrowDispatcher,
    deal_id: felt252,
    operation: PayoutOperation,
    note_id: felt252,
    claim_key: StarkCurveKeyPair,
) -> (felt252, felt252) {
    claim_key.sign(escrow.compute_claim_message(deal_id, operation, note_id)).unwrap()
}

fn claim_with_signature(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IQuietlineEscrowDispatcher,
    deal_id: felt252,
    signature: (felt252, felt252),
    note_id: felt252,
) -> Span<OpenNoteDeposit> {
    let (sig_r, sig_s) = signature;
    invoke_as_pool(
        escrow_address,
        escrow,
        pool,
        DEADLINE + 50,
        EscrowOperation::Claim(ClaimParams { sig_r, sig_s }),
        deal_id,
        note_id,
    )
}

fn claim(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IQuietlineEscrowDispatcher,
    deal_id: felt252,
    claim_secret: felt252,
    note_id: felt252,
) -> Span<OpenNoteDeposit> {
    let signature = signature_for(
        escrow, deal_id, PayoutOperation::Claim, note_id, key_from_secret(claim_secret),
    );
    claim_with_signature(pool, escrow_address, escrow, deal_id, signature, note_id)
}

fn timeout_with_signature(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IQuietlineEscrowDispatcher,
    deal_id: felt252,
    signature: (felt252, felt252),
    at: u64,
    note_id: felt252,
) -> Span<OpenNoteDeposit> {
    let (sig_r, sig_s) = signature;
    invoke_as_pool(
        escrow_address,
        escrow,
        pool,
        at,
        EscrowOperation::Timeout(TimeoutParams { sig_r, sig_s }),
        deal_id,
        note_id,
    )
}

fn timeout(
    pool: ContractAddress,
    escrow_address: ContractAddress,
    escrow: IQuietlineEscrowDispatcher,
    deal_id: felt252,
    claim_secret: felt252,
    at: u64,
    note_id: felt252,
) -> Span<OpenNoteDeposit> {
    let signature = signature_for(
        escrow, deal_id, PayoutOperation::Timeout, note_id, key_from_secret(claim_secret),
    );
    timeout_with_signature(pool, escrow_address, escrow, deal_id, signature, at, note_id)
}

fn assert_deposit(
    deposits: Span<OpenNoteDeposit>, note_id: felt252, token: ContractAddress, amount: u128,
) -> OpenNoteDeposit {
    assert(deposits.len() == 1, 'expected one deposit');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == note_id, 'wrong note id');
    assert(deposit.token == token, 'wrong deposit token');
    assert(deposit.amount == amount, 'wrong deposit amount');
    deposit
}

fn pull_deposit(pool: ContractAddress, escrow_address: ContractAddress, deposit: OpenNoteDeposit) {
    let token = IMockErc20Dispatcher { contract_address: deposit.token };
    transfer_from(deposit.token, token, escrow_address, pool, deposit.amount);
}

#[test]
#[should_panic(expected: ('BAD_POOL',))]
fn non_pool_caller_reverts() {
    let pool = contract_address(0x1100);
    let (_escrow_address, escrow) = deploy_escrow(pool);

    escrow
        .privacy_invoke(
            EscrowOperation::Fill(FillParams { token: contract_address(0x2200) }),
            DEAL_1,
            contract_address(0x3300),
            0x4400,
        );
}

#[test]
fn happy_path_two_leg_settlement_is_conserved_and_marks_settled() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    let maker_note = 0xA11CE;
    let taker_note = 0xB0B;
    let claim_pubkey = key_from_secret(SECRET_1).public_key;
    let mut spy = spy_events();

    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    assert(token_a.balance_of(escrow_address) == LEG_A_AMOUNT.into(), 'leg A not held');
    assert(token_b.balance_of(escrow_address) == 0, 'unexpected leg B');

    let taker_deposits = fill(
        pool,
        escrow_address,
        escrow,
        token_b_address,
        token_b,
        DEAL_1,
        LEG_B_AMOUNT,
        DEADLINE - 1,
        taker_note,
    );
    let taker_deposit = assert_deposit(taker_deposits, taker_note, token_a_address, LEG_A_AMOUNT);
    pull_deposit(pool, escrow_address, taker_deposit);
    assert(token_a.balance_of(escrow_address) == 0, 'leg A stranded');
    assert(token_b.balance_of(escrow_address) == LEG_B_AMOUNT.into(), 'leg B not held');
    assert(escrow.get_deal(DEAL_1).status == DealStatus::Filled, 'deal not filled');

    let maker_deposits = claim(pool, escrow_address, escrow, DEAL_1, SECRET_1, maker_note);
    let maker_deposit = assert_deposit(maker_deposits, maker_note, token_b_address, LEG_B_AMOUNT);
    pull_deposit(pool, escrow_address, maker_deposit);

    let deal = escrow.get_deal(DEAL_1);
    assert(deal.status == DealStatus::Settled, 'deal not settled');
    assert(deal.leg_a_amount == LEG_A_AMOUNT, 'wrong measured leg A');
    assert(deal.leg_b_amount == LEG_B_AMOUNT, 'wrong measured leg B');
    assert(token_a.balance_of(escrow_address) == 0, 'leg A remains');
    assert(token_b.balance_of(escrow_address) == 0, 'leg B remains');
    assert(token_a.balance_of(pool) == 10_000, 'token A not conserved');
    assert(token_b.balance_of(pool) == 10_000, 'token B not conserved');

    spy
        .assert_emitted(
            @array![
                (
                    escrow_address,
                    QuietlineEscrow::Event::DealFunded(
                        QuietlineEscrow::DealFunded {
                            deal_id: DEAL_1,
                            leg_a_token: token_a_address,
                            leg_a_amount: LEG_A_AMOUNT,
                            leg_b_token: token_b_address,
                            leg_b_terms: LEG_B_AMOUNT,
                            deadline: DEADLINE,
                            claim_pubkey,
                        },
                    ),
                ),
                (
                    escrow_address,
                    QuietlineEscrow::Event::DealFilled(
                        QuietlineEscrow::DealFilled {
                            deal_id: DEAL_1,
                            leg_a_token: token_a_address,
                            leg_a_amount: LEG_A_AMOUNT,
                            leg_b_token: token_b_address,
                            leg_b_amount: LEG_B_AMOUNT,
                        },
                    ),
                ),
                (
                    escrow_address,
                    QuietlineEscrow::Event::DealClaimed(
                        QuietlineEscrow::DealClaimed {
                            deal_id: DEAL_1, token: token_b_address, amount: LEG_B_AMOUNT,
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn double_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let first = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, 20, 0x1,
    );
    pull_deposit(pool, escrow_address, *first.at(0));

    fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, 21, 0x2);
}

#[test]
fn timeout_refunds_maker_and_conserves_dust() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    transfer_from(token_a_address, token_a, pool, escrow_address, 5);

    let deposits = timeout(pool, escrow_address, escrow, DEAL_1, SECRET_1, DEADLINE, 0xCA11);
    let deposit = assert_deposit(deposits, 0xCA11, token_a_address, LEG_A_AMOUNT + 5);
    pull_deposit(pool, escrow_address, deposit);

    assert(escrow.get_deal(DEAL_1).status == DealStatus::TimedOut, 'not timed out');
    assert(token_a.balance_of(escrow_address) == 0, 'refund stranded');
    assert(token_a.balance_of(pool) == 10_000, 'refund not conserved');
}

#[test]
#[should_panic(expected: ('DEAL_NOT_EXPIRED',))]
fn timeout_cannot_be_called_before_deadline() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );

    timeout(pool, escrow_address, escrow, DEAL_1, SECRET_1, DEADLINE - 1, 0x1);
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn timeout_after_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let deposits = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, 20, 0x2,
    );
    pull_deposit(pool, escrow_address, *deposits.at(0));

    timeout(pool, escrow_address, escrow, DEAL_1, SECRET_1, DEADLINE, 0x3);
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn post_settle_timeout_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let taker_deposits = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, 20, 0x2,
    );
    pull_deposit(pool, escrow_address, *taker_deposits.at(0));
    let maker_deposits = claim(pool, escrow_address, escrow, DEAL_1, SECRET_1, 0x3);
    pull_deposit(pool, escrow_address, *maker_deposits.at(0));

    timeout(pool, escrow_address, escrow, DEAL_1, SECRET_1, DEADLINE + 1, 0x4);
}

#[test]
#[should_panic(expected: ('WRONG_TOKEN',))]
fn wrong_token_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );

    invoke_as_pool(
        escrow_address,
        escrow,
        pool,
        20,
        EscrowOperation::Fill(FillParams { token: token_a_address }),
        DEAL_1,
        0x2,
    );
}

#[test]
#[should_panic(expected: ('SHORT_FILL',))]
fn short_funded_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );

    fill(pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT - 1, 20, 0x2);
}

#[test]
#[should_panic(expected: ('DEAL_EXPIRED',))]
fn fill_at_or_after_deadline_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );

    fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, DEADLINE, 0x2,
    );
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn claim_before_fill_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );

    claim(pool, escrow_address, escrow, DEAL_1, SECRET_1, 0x3);
}

#[test]
#[should_panic(expected: ('BAD_SIGNATURE',))]
fn signature_from_different_key_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let deposits = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, 20, 0x2,
    );
    pull_deposit(pool, escrow_address, *deposits.at(0));

    claim(pool, escrow_address, escrow, DEAL_1, SECRET_2, 0x3);
}

#[test]
#[should_panic(expected: ('BAD_STATE',))]
fn double_claim_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let taker_deposits = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, 20, 0x2,
    );
    pull_deposit(pool, escrow_address, *taker_deposits.at(0));
    let maker_deposits = claim(pool, escrow_address, escrow, DEAL_1, SECRET_1, 0x3);
    pull_deposit(pool, escrow_address, *maker_deposits.at(0));

    claim(pool, escrow_address, escrow, DEAL_1, SECRET_1, 0x4);
}

#[test]
#[should_panic(expected: ('BAD_SIGNATURE',))]
fn copied_claim_signature_cannot_front_run_to_a_different_note() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let deposits = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT, 20, 0x2,
    );
    pull_deposit(pool, escrow_address, *deposits.at(0));
    let signature = signature_for(
        escrow, DEAL_1, PayoutOperation::Claim, 0xA11CE, key_from_secret(SECRET_1),
    );

    claim_with_signature(pool, escrow_address, escrow, DEAL_1, signature, 0xBAD);
}

#[test]
#[should_panic(expected: ('BAD_SIGNATURE',))]
fn signature_for_another_deal_id_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_2,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let signature = signature_for(
        escrow, DEAL_1, PayoutOperation::Timeout, 0x4, key_from_secret(SECRET_1),
    );

    timeout_with_signature(pool, escrow_address, escrow, DEAL_2, signature, DEADLINE, 0x4);
}

#[test]
#[should_panic(expected: ('BAD_SIGNATURE',))]
fn claim_signature_cannot_replay_as_timeout() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let signature = signature_for(
        escrow, DEAL_1, PayoutOperation::Claim, 0x4, key_from_secret(SECRET_1),
    );

    timeout_with_signature(pool, escrow_address, escrow, DEAL_1, signature, DEADLINE, 0x4);
}

#[test]
#[should_panic]
fn zero_signature_reverts() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );

    timeout_with_signature(pool, escrow_address, escrow, DEAL_1, (0, 0), DEADLINE, 0x4);
}

#[test]
#[should_panic(expected: ('BAD_SIGNATURE',))]
fn signature_for_another_deployment_reverts() {
    let (pool, _escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    let (other_address, other_escrow) = deploy_escrow(pool);
    fund(
        pool,
        other_address,
        other_escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    let signature = signature_for(
        escrow, DEAL_1, PayoutOperation::Timeout, 0x4, key_from_secret(SECRET_1),
    );

    timeout_with_signature(pool, other_address, other_escrow, DEAL_1, signature, DEADLINE, 0x4);
}

#[test]
fn measured_overfunding_and_dust_are_fully_returned() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    transfer_from(token_a_address, token_a, pool, escrow_address, 5);

    let taker_deposits = fill(
        pool, escrow_address, escrow, token_b_address, token_b, DEAL_1, LEG_B_AMOUNT + 11, 20, 0x2,
    );
    let taker_deposit = assert_deposit(taker_deposits, 0x2, token_a_address, LEG_A_AMOUNT + 5);
    pull_deposit(pool, escrow_address, taker_deposit);
    transfer_from(token_b_address, token_b, pool, escrow_address, 7);

    let maker_deposits = claim(pool, escrow_address, escrow, DEAL_1, SECRET_1, 0x3);
    let maker_deposit = assert_deposit(maker_deposits, 0x3, token_b_address, LEG_B_AMOUNT + 11 + 7);
    pull_deposit(pool, escrow_address, maker_deposit);

    assert(escrow.get_deal(DEAL_1).leg_b_amount == LEG_B_AMOUNT + 11, 'delta not measured');
    assert(token_a.balance_of(escrow_address) == 0, 'token A stranded');
    assert(token_b.balance_of(escrow_address) == 0, 'token B stranded');
    assert(token_a.balance_of(pool) == 10_000, 'token A lost');
    assert(token_b.balance_of(pool) == 10_000, 'token B lost');
}

#[test]
fn concurrent_deal_liabilities_remain_isolated() {
    let (pool, escrow_address, escrow, token_a_address, token_a, token_b_address, _token_b) =
        deploy_fixture();
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_1,
        LEG_A_AMOUNT,
        LEG_B_AMOUNT,
        DEADLINE,
        SECRET_1,
    );
    fund(
        pool,
        escrow_address,
        escrow,
        token_a_address,
        token_a,
        token_b_address,
        DEAL_2,
        300,
        400,
        DEADLINE,
        SECRET_2,
    );
    assert(token_a.balance_of(escrow_address) == 800, 'aggregate liability mismatch');

    let refund = timeout(pool, escrow_address, escrow, DEAL_1, SECRET_1, DEADLINE, 0x4);
    let deposit = assert_deposit(refund, 0x4, token_a_address, LEG_A_AMOUNT);
    pull_deposit(pool, escrow_address, deposit);

    assert(token_a.balance_of(escrow_address) == 300, 'other deal was cross-spent');
    assert(escrow.get_deal(DEAL_1).status == DealStatus::TimedOut, 'deal 1 not timed out');
    assert(escrow.get_deal(DEAL_2).status == DealStatus::Funded, 'deal 2 was mutated');
}
