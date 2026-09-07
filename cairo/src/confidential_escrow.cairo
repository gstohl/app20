// Confidential RFQ policy account. Development release; independent review and real proofs pending.
// One escrow viewing key is shared by the two controlled test parties; spending uses separate
// signing keys. Ordinary wallet viewing keys are never given to this account or a dapp.
use starknet::ContractAddress;

#[derive(Copy, Drop, Serde)]
pub struct Terms {
    pub token_a: ContractAddress,
    pub token_b: ContractAddress,
    pub amount_a: u128,
    pub amount_b: u128,
    pub party_a: ContractAddress,
    pub party_b: ContractAddress,
    pub salt: felt252,
}

// Matches the pinned pool return ABI. This probe always returns an empty array.
#[derive(Copy, Drop, Serde)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait IApp20ConfidentialEscrow<T> {
    fn configuration(
        self: @T,
    ) -> (ContractAddress, starknet::ClassHash, felt252, felt252, felt252, u64);
    fn supports_interface(self: @T, interface_id: felt252) -> bool;
    fn is_valid_signature(self: @T, hash: felt252, signature: Array<felt252>) -> felt252;
    fn is_custom_signature_valid(
        self: @T,
        calls: Span<starknet::account::Call>,
        additional_data: Span<felt252>,
        signature: Span<felt252>,
    ) -> felt252;
    fn privacy_compute(
        self: @T, identity_key: felt252, private_viewkey: felt252, mode: u8,
    ) -> (felt252, u8);
    fn privacy_invoke_with_computation(
        ref self: T, tag: felt252, mode: u8,
    ) -> Span<OpenNoteDeposit>;
    fn is_settled(self: @T) -> bool;
}

#[starknet::contract]
pub mod App20ConfidentialEscrow {
    use core::ecdsa::check_ecdsa_signature;
    use core::poseidon::poseidon_hash_span;
    use starknet::account::Call;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::get_class_hash_at_syscall;
    use starknet::{
        ClassHash, ContractAddress, SyscallResultTrait, VALIDATED, get_block_timestamp,
        get_caller_address, get_contract_address, get_tx_info,
    };
    use super::{IApp20ConfidentialEscrow, OpenNoteDeposit, Terms};

    const SETUP: u8 = 0;
    const SETTLE: u8 = 1;
    const REFUND_A: u8 = 2;
    const REFUND_B: u8 = 3;
    const COMPUTE_TAG: felt252 = 'APP20_JOINT_COMPUTE_V1';

    #[storage]
    struct Storage {
        pool: ContractAddress,
        pool_class: ClassHash,
        commitment: felt252,
        signer_a: felt252,
        signer_b: felt252,
        deadline: u64,
        settled: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        pool_class: ClassHash,
        commitment: felt252,
        signer_a: felt252,
        signer_b: felt252,
        deadline: u64,
    ) {
        assert(signer_a != 0 && signer_b != 0 && signer_a != signer_b, 'BAD_KEYS');
        assert(commitment != 0 && deadline > get_block_timestamp(), 'BAD_CONFIG');
        assert(get_class_hash_at_syscall(pool).unwrap_syscall() == pool_class, 'POOL_CLASS');
        self.pool.write(pool);
        self.pool_class.write(pool_class);
        self.commitment.write(commitment);
        self.signer_a.write(signer_a);
        self.signer_b.write(signer_b);
        self.deadline.write(deadline);
    }

    fn take(ref data: Span<felt252>) -> felt252 {
        *data.pop_front().expect('TRUNCATED_ACTION')
    }

    fn skip(ref data: Span<felt252>, count: usize) {
        for _ in 0..count {
            take(ref data);
        };
    }

    fn token_allowed(terms: Terms, mode: u8, token: felt252) {
        assert(
            (token == terms.token_a.into() && mode != REFUND_B)
                || (token == terms.token_b.into() && mode != REFUND_A),
            'TOKEN_POLICY',
        );
    }

    fn recipient_allowed(terms: Terms, mode: u8, recipient: felt252) {
        assert(
            (recipient == terms.party_a.into() && mode != REFUND_B)
                || (recipient == terms.party_b.into() && mode != REFUND_A)
                || (mode == SETUP && recipient == get_contract_address().into()),
            'RECIPIENT_POLICY',
        );
    }

    // Parse only the exact pinned ClientAction wire ABI; fail closed on all other operations.
    fn check_actions(mut data: Span<felt252>, mode: u8, terms: Terms) {
        assert(take(ref data) == get_contract_address().into(), 'WRONG_USER');
        let viewing_key = take(ref data);
        let count: usize = take(ref data).try_into().unwrap();
        assert(count > 0 && count <= 64, 'ACTION_COUNT');
        let mut callback = false;
        let mut traded_a: u128 = 0;
        let mut traded_b: u128 = 0;
        let mut refunded: u128 = 0;
        let mut used = false;
        for i in 0..count {
            let kind = take(ref data);
            match kind {
                0 => {
                    assert(mode == SETUP, 'REGISTER_POLICY');
                    skip(ref data, 1);
                },
                1 => {
                    recipient_allowed(terms, mode, take(ref data));
                    skip(ref data, 3);
                },
                2 => {
                    recipient_allowed(terms, mode, take(ref data));
                    skip(ref data, 3);
                    token_allowed(terms, mode, take(ref data));
                    skip(ref data, 1);
                },
                3 => {
                    assert(mode != SETUP, 'SETUP_VALUE');
                    let recipient = take(ref data);
                    skip(ref data, 1);
                    let token = take(ref data);
                    token_allowed(terms, mode, token);
                    let amount: u128 = take(ref data).try_into().unwrap();
                    skip(ref data, 2);
                    if mode == SETTLE {
                        if token == terms.token_a.into() && recipient == terms.party_b.into() {
                            traded_a += amount;
                        } else if token == terms.token_b.into()
                            && recipient == terms.party_a.into() {
                            traded_b += amount;
                        } else {
                            // Return surplus only to that asset's original owner.
                            assert(
                                (token == terms.token_a.into() && recipient == terms.party_a.into())
                                    || (token == terms.token_b.into()
                                        && recipient == terms.party_b.into()),
                                'CHANGE_POLICY',
                            );
                        }
                    } else {
                        recipient_allowed(terms, mode, recipient);
                        refunded += amount;
                    }
                },
                6 => {
                    assert(mode != SETUP, 'SETUP_INPUT');
                    skip(ref data, 1);
                    token_allowed(terms, mode, take(ref data));
                    skip(ref data, 1);
                    used = true;
                },
                9 => {
                    assert(i + 1 == count && !callback, 'CALLBACK_LAST');
                    assert(take(ref data) == get_contract_address().into(), 'CALLBACK_TARGET');
                    assert(take(ref data) == 2, 'COMPUTE_DATA');
                    assert(take(ref data) == viewing_key, 'COMPUTE_KEY');
                    assert(take(ref data) == mode.into(), 'COMPUTE_MODE');
                    assert(take(ref data) == 0, 'INVOKE_DATA');
                    callback = true;
                },
                _ => { assert(false, 'ACTION_FORBIDDEN'); },
            };
        }
        assert(data.is_empty() && callback, 'MISSING_CALLBACK_OR_TRAILING');
        if mode == SETTLE {
            assert(
                used && traded_a == terms.amount_a && traded_b == terms.amount_b, 'TRADE_AMOUNTS',
            );
        } else if mode == REFUND_A || mode == REFUND_B {
            assert(used && refunded > 0, 'EMPTY_REFUND');
        }
    }

    #[abi(embed_v0)]
    impl Probe of IApp20ConfidentialEscrow<ContractState> {
        fn configuration(
            self: @ContractState,
        ) -> (ContractAddress, ClassHash, felt252, felt252, felt252, u64) {
            (
                self.pool.read(),
                self.pool_class.read(),
                self.commitment.read(),
                self.signer_a.read(),
                self.signer_b.read(),
                self.deadline.read(),
            )
        }
        fn supports_interface(self: @ContractState, interface_id: felt252) -> bool {
            interface_id == selector!("is_custom_signature_valid")
        }

        // The pool also tries two standard signature fallbacks. Both MUST be disabled.
        fn is_valid_signature(
            self: @ContractState, hash: felt252, signature: Array<felt252>,
        ) -> felt252 {
            0
        }

        fn is_custom_signature_valid(
            self: @ContractState,
            calls: Span<Call>,
            additional_data: Span<felt252>,
            mut signature: Span<felt252>,
        ) -> felt252 {
            assert(calls.len() == 1 && additional_data.is_empty(), 'CALL_SHAPE');
            assert(signature.len() == 12, 'SIGNATURE_SHAPE');
            let mode: u8 = take(ref signature).try_into().unwrap();
            assert(mode <= REFUND_B, 'BAD_MODE');
            let terms: Terms = Serde::deserialize(ref signature).expect('TERMS_SHAPE');
            assert(
                terms.token_a != terms.token_b
                    && terms.party_a != terms.party_b
                    && terms.amount_a > 0
                    && terms.amount_b > 0
                    && terms.salt != 0,
                'TERMS_POLICY',
            );
            let pool = self.pool.read();
            let pool_class = self.pool_class.read();
            assert(get_class_hash_at_syscall(pool).unwrap_syscall() == pool_class, 'POOL_CLASS');
            let chain = get_tx_info().unbox().chain_id;
            let mut committed = array![
                'APP20_JOINT_TERMS_V1', chain, pool.into(), pool_class.into(), self.signer_a.read(),
                self.signer_b.read(), self.deadline.read().into(),
            ];
            terms.serialize(ref committed);
            assert(
                poseidon_hash_span(committed.span()) == self.commitment.read(), 'TERMS_COMMITMENT',
            );
            let call = *calls.at(0);
            assert(
                call.to == pool && call.selector == selector!("compile_actions"), 'COMPILE_ONLY',
            );
            check_actions(call.calldata, mode, terms);
            let digest = poseidon_hash_span(
                array![
                    'APP20_JOINT_AUTH_V1', chain, get_contract_address().into(), pool.into(),
                    pool_class.into(), self.commitment.read(), mode.into(),
                    poseidon_hash_span(call.calldata),
                ]
                    .span(),
            );
            let r_a = take(ref signature);
            let s_a = take(ref signature);
            let r_b = take(ref signature);
            let s_b = take(ref signature);
            if mode != REFUND_B {
                assert(check_ecdsa_signature(digest, self.signer_a.read(), r_a, s_a), 'SIGNER_A');
            }
            if mode != REFUND_A {
                assert(check_ecdsa_signature(digest, self.signer_b.read(), r_b, s_b), 'SIGNER_B');
            }
            VALIDATED
        }

        fn privacy_compute(
            self: @ContractState, identity_key: felt252, private_viewkey: felt252, mode: u8,
        ) -> (felt252, u8) {
            // A plain InvokeExternal callback would let another pool user grief this escrow.
            // ComputeAndInvoke supplies an identity derived by the pinned compiler itself.
            let address: felt252 = get_contract_address().into();
            assert(
                identity_key == poseidon_hash_span(
                    array!['IDENTITY_KEY_TAG:V1', address, private_viewkey, address].span(),
                ),
                'ESCROW_IDENTITY',
            );
            assert(mode <= REFUND_B, 'BAD_MODE');
            (COMPUTE_TAG, mode)
        }

        fn privacy_invoke_with_computation(
            ref self: ContractState, tag: felt252, mode: u8,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(get_caller_address() == pool, 'ONLY_POOL');
            assert(
                get_class_hash_at_syscall(pool).unwrap_syscall() == self.pool_class.read(),
                'POOL_CLASS',
            );
            assert(tag == COMPUTE_TAG && mode <= REFUND_B, 'COMPUTE_TAG');
            // Enforce against actual execution time, not only the proof's historical state.
            if mode == SETUP || mode == SETTLE {
                assert(get_block_timestamp() < self.deadline.read(), 'ESCROW_EXPIRED');
                assert(!self.settled.read(), 'ALREADY_SETTLED');
                if mode == SETTLE {
                    self.settled.write(true);
                }
            } else {
                assert(get_block_timestamp() >= self.deadline.read(), 'REFUND_TOO_EARLY');
                // Repeatable: a partial refund or late funding must not strand remaining notes.
            }
            array![].span()
        }

        fn is_settled(self: @ContractState) -> bool {
            self.settled.read()
        }
    }
}
