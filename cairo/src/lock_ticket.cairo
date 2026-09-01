use starknet::ContractAddress;

#[starknet::interface]
pub trait ILockTicket<TState> {
    fn name(self: @TState) -> ByteArray;
    fn symbol(self: @TState) -> ByteArray;
    fn decimals(self: @TState) -> u8;
    fn total_supply(self: @TState) -> u256;
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn mint(ref self: TState);
    fn burn(ref self: TState);
    fn escrow(self: @TState) -> ContractAddress;
    fn pool(self: @TState) -> ContractAddress;
    fn lock_id(self: @TState) -> felt252;
}

/// Lock-unique, supply-two authorization token. Each unit authorizes settlement of one side of a
/// lock after expiry: maker proceeds or unused collateral.
#[starknet::contract]
pub mod LockTicket {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    mod errors {
        pub const NOT_AUTHORIZED: felt252 = 'NOT_AUTHORIZED';
        pub const ALREADY_MINTED: felt252 = 'ALREADY_MINTED';
        pub const BAD_AMOUNT: felt252 = 'BAD_AMOUNT';
        pub const BAD_RECIPIENT: felt252 = 'BAD_RECIPIENT';
        pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
        pub const ZERO_LOCK_ID: felt252 = 'ZERO_LOCK_ID';
    }

    #[storage]
    struct Storage {
        escrow: ContractAddress,
        pool: ContractAddress,
        lock_id: felt252,
        minted: bool,
        supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer {
        #[key]
        pub from: ContractAddress,
        #[key]
        pub to: ContractAddress,
        pub value: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Approval {
        #[key]
        pub owner: ContractAddress,
        #[key]
        pub spender: ContractAddress,
        pub value: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, escrow: ContractAddress, pool: ContractAddress, lock_id: felt252,
    ) {
        assert(escrow.is_non_zero(), errors::ZERO_ADDRESS);
        assert(pool.is_non_zero(), errors::ZERO_ADDRESS);
        assert(lock_id.is_non_zero(), errors::ZERO_LOCK_ID);
        self.escrow.write(escrow);
        self.pool.write(pool);
        self.lock_id.write(lock_id);
    }

    #[abi(embed_v0)]
    impl LockTicketImpl of super::ILockTicket<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            "APP20 Lock Ticket"
        }

        fn symbol(self: @ContractState) -> ByteArray {
            "A20LT"
        }

        fn decimals(self: @ContractState) -> u8 {
            0
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            assert_authorized(@self);
            transfer_balance(ref self, get_caller_address(), recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            assert_authorized(@self);
            let spender = get_caller_address();
            let allowance = self.allowances.entry((sender, spender)).read();
            self.allowances.entry((sender, spender)).write(allowance - amount);
            transfer_balance(ref self, sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            assert_authorized(@self);
            let owner = get_caller_address();
            self.allowances.entry((owner, spender)).write(amount);
            self.emit(Approval { owner, spender, value: amount });
            true
        }

        fn mint(ref self: ContractState) {
            let escrow = self.escrow.read();
            assert(get_caller_address() == escrow, errors::NOT_AUTHORIZED);
            assert(!self.minted.read(), errors::ALREADY_MINTED);
            self.minted.write(true);
            self.supply.write(2);
            self.balances.entry(escrow).write(2);
            self.emit(Transfer { from: 0.try_into().unwrap(), to: escrow, value: 2 });
        }

        fn burn(ref self: ContractState) {
            let escrow = self.escrow.read();
            assert(get_caller_address() == escrow, errors::NOT_AUTHORIZED);
            let balance = self.balances.entry(escrow).read();
            assert(balance >= 1, errors::BAD_AMOUNT);
            self.balances.entry(escrow).write(balance - 1);
            self.supply.write(self.supply.read() - 1);
            self.emit(Transfer { from: escrow, to: 0.try_into().unwrap(), value: 1 });
        }

        fn escrow(self: @ContractState) -> ContractAddress {
            self.escrow.read()
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn lock_id(self: @ContractState) -> felt252 {
            self.lock_id.read()
        }
    }

    fn assert_authorized(self: @ContractState) {
        let caller = get_caller_address();
        assert(caller == self.escrow.read() || caller == self.pool.read(), errors::NOT_AUTHORIZED);
    }

    fn transfer_balance(
        ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) {
        assert(amount == 1, errors::BAD_AMOUNT);
        assert(
            recipient == self.escrow.read() || recipient == self.pool.read(), errors::BAD_RECIPIENT,
        );
        self.balances.entry(sender).write(self.balances.entry(sender).read() - amount);
        self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
        self.emit(Transfer { from: sender, to: recipient, value: amount });
    }
}
