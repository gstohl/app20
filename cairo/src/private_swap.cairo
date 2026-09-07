use starknet::ContractAddress;
use crate::OpenNoteDeposit;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct SwapQuote {
    pub maker: ContractAddress,
    pub sell_token: ContractAddress,
    pub buy_token: ContractAddress,
    pub sell_amount: u128,
    pub buy_amount: u128,
    pub commitment: felt252,
    pub expires_at: u64,
    pub status: u8 // 0 absent, 1 reserved, 2 filled, 3 expired/released
}

#[starknet::interface]
pub trait ISwapToken<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IApp20PrivateSwap<T> {
    fn pool(self: @T) -> ContractAddress;
    fn book(self: @T) -> ContractAddress;
    fn available(self: @T, maker: ContractAddress, token: ContractAddress) -> u256;
    fn liability(self: @T, token: ContractAddress) -> u256;
    fn quote(self: @T, id: felt252) -> SwapQuote;
    fn deposit_inventory(ref self: T, token: ContractAddress, amount: u128);
    fn withdraw_inventory(ref self: T, token: ContractAddress, amount: u128);
    fn reserve_quote(
        ref self: T,
        id: felt252,
        sell_token: ContractAddress,
        buy_token: ContractAddress,
        sell_amount: u128,
        buy_amount: u128,
        commitment: felt252,
        expires_at: u64,
    );
    fn release_expired(ref self: T, id: felt252);
    fn privacy_invoke(
        ref self: T, id: felt252, secret: felt252, note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

/// Maker-funded fixed quotes, atomically paid from and returned to STRK20.
/// No admin, upgrade hook, oracle, external signer, or localnet pre-call.
#[starknet::contract]
pub mod App20PrivateSwap {
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address, get_tx_info,
    };
    use crate::OpenNoteDeposit;
    use crate::maker_book::{IApp20MakerBookDispatcher, IApp20MakerBookDispatcherTrait};
    use super::{ISwapTokenDispatcher, ISwapTokenDispatcherTrait, SwapQuote};

    #[storage]
    struct Storage {
        pool: ContractAddress,
        book: ContractAddress,
        available: Map<(ContractAddress, ContractAddress), u256>,
        liability: Map<ContractAddress, u256>,
        quotes: Map<felt252, SwapQuote>,
        entered: bool,
    }
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        InventoryChanged: InventoryChanged,
        QuoteReserved: QuoteReserved,
        QuoteFilled: QuoteFilled,
        QuoteReleased: QuoteReleased,
    }
    #[derive(Drop, starknet::Event)]
    pub struct InventoryChanged {
        #[key]
        pub maker: ContractAddress,
        #[key]
        pub token: ContractAddress,
        pub available: u256,
    }
    #[derive(Drop, starknet::Event)]
    pub struct QuoteReserved {
        #[key]
        pub id: felt252,
        #[key]
        pub maker: ContractAddress,
        pub expires_at: u64,
    }
    #[derive(Drop, starknet::Event)]
    pub struct QuoteFilled {
        #[key]
        pub id: felt252,
        #[key]
        pub maker: ContractAddress,
        pub sell_amount: u128,
        pub buy_amount: u128,
    }
    #[derive(Drop, starknet::Event)]
    pub struct QuoteReleased {
        #[key]
        pub id: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress, book: ContractAddress) {
        assert(pool != 0.try_into().unwrap() && book != 0.try_into().unwrap(), 'ZERO_ADDRESS');
        self.pool.write(pool);
        self.book.write(book);
    }
    fn enter(ref self: ContractState) {
        assert(!self.entered.read(), 'REENTRANCY');
        self.entered.write(true);
    }
    fn token_at(token: ContractAddress) -> ISwapTokenDispatcher {
        assert(token != 0.try_into().unwrap(), 'ZERO_TOKEN');
        ISwapTokenDispatcher { contract_address: token }
    }
    /// Open-note pulls happen after the helper returns. The pool's outstanding
    /// allowance remains reserved until transfer_from consumes it. In particular,
    /// a second invoke in the same pool batch cannot recycle an unpaid output.
    fn backing(self: @ContractState, token: ContractAddress) -> (u256, u256) {
        let erc20 = token_at(token);
        let balance = erc20.balance_of(get_contract_address());
        let reserved = self.liability.read(token)
            + erc20.allowance(get_contract_address(), self.pool.read());
        assert(balance >= reserved, 'INSOLVENT');
        (balance, reserved)
    }
    fn credit(
        ref self: ContractState, maker: ContractAddress, token: ContractAddress, amount: u256,
    ) {
        let next = self.available.read((maker, token)) + amount;
        self.available.write((maker, token), next);
        self.emit(InventoryChanged { maker, token, available: next });
    }

    #[abi(embed_v0)]
    impl Impl of super::IApp20PrivateSwap<ContractState> {
        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }
        fn book(self: @ContractState) -> ContractAddress {
            self.book.read()
        }
        fn available(self: @ContractState, maker: ContractAddress, token: ContractAddress) -> u256 {
            self.available.read((maker, token))
        }
        fn liability(self: @ContractState, token: ContractAddress) -> u256 {
            self.liability.read(token)
        }
        fn quote(self: @ContractState, id: felt252) -> SwapQuote {
            self.quotes.read(id)
        }
        fn deposit_inventory(ref self: ContractState, token: ContractAddress, amount: u128) {
            enter(ref self);
            assert(amount > 0, 'ZERO_AMOUNT');
            let caller = get_caller_address();
            let erc20 = token_at(token);
            let (before, _) = backing(@self, token);
            assert(
                erc20.transfer_from(caller, get_contract_address(), amount.into()), 'TRANSFER_FROM',
            );
            let after = erc20.balance_of(get_contract_address());
            assert(after >= before && after - before == amount.into(), 'BAD_DELTA');
            self.liability.write(token, self.liability.read(token) + amount.into());
            credit(ref self, caller, token, amount.into());
            backing(@self, token);
            self.entered.write(false);
        }
        fn withdraw_inventory(ref self: ContractState, token: ContractAddress, amount: u128) {
            enter(ref self);
            assert(amount > 0, 'ZERO_AMOUNT');
            let caller = get_caller_address();
            let available = self.available.read((caller, token));
            assert(available >= amount.into(), 'UNAVAILABLE');
            backing(@self, token);
            self.available.write((caller, token), available - amount.into());
            self.liability.write(token, self.liability.read(token) - amount.into());
            assert(token_at(token).transfer(caller, amount.into()), 'TRANSFER');
            backing(@self, token);
            self
                .emit(
                    InventoryChanged { maker: caller, token, available: available - amount.into() },
                );
            self.entered.write(false);
        }
        fn reserve_quote(
            ref self: ContractState,
            id: felt252,
            sell_token: ContractAddress,
            buy_token: ContractAddress,
            sell_amount: u128,
            buy_amount: u128,
            commitment: felt252,
            expires_at: u64,
        ) {
            enter(ref self);
            assert(id != 0 && self.quotes.read(id).status == 0, 'QUOTE_EXISTS');
            assert(
                sell_token != 0.try_into().unwrap()
                    && buy_token != 0.try_into().unwrap()
                    && sell_token != buy_token,
                'BAD_PAIR',
            );
            assert(sell_amount > 0 && buy_amount > 0 && commitment != 0, 'BAD_TERMS');
            let caller = get_caller_address();
            let book = IApp20MakerBookDispatcher { contract_address: self.book.read() };
            let request = book.get_request(id);
            assert(request.maker == caller && request.status == 1, 'WRONG_REQUEST');
            let key = book.maker(caller);
            assert(
                key.revision == request.revision && key.valid_until > get_block_timestamp(),
                'INACTIVE_KEY',
            );
            assert(
                expires_at > get_block_timestamp() && expires_at <= request.expires_at,
                'BAD_EXPIRY',
            );
            let available = self.available.read((caller, buy_token));
            assert(available >= buy_amount.into(), 'UNAVAILABLE');
            backing(@self, buy_token);
            self.available.write((caller, buy_token), available - buy_amount.into());
            self
                .quotes
                .write(
                    id,
                    SwapQuote {
                        maker: caller,
                        sell_token,
                        buy_token,
                        sell_amount,
                        buy_amount,
                        commitment,
                        expires_at,
                        status: 1,
                    },
                );
            self.emit(QuoteReserved { id, maker: caller, expires_at });
            self.entered.write(false);
        }
        fn release_expired(ref self: ContractState, id: felt252) {
            enter(ref self);
            let quote = self.quotes.read(id);
            assert(quote.status == 1, 'NOT_RESERVED');
            assert(get_block_timestamp() >= quote.expires_at, 'NOT_EXPIRED');
            self.quotes.write(id, SwapQuote { status: 3, ..quote });
            credit(ref self, quote.maker, quote.buy_token, quote.buy_amount.into());
            self.emit(QuoteReleased { id });
            self.entered.write(false);
        }
        fn privacy_invoke(
            ref self: ContractState, id: felt252, secret: felt252, note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            enter(ref self);
            assert(get_caller_address() == self.pool.read(), 'ONLY_POOL');
            let quote = self.quotes.read(id);
            assert(quote.status == 1, 'NOT_RESERVED');
            assert(get_block_timestamp() < quote.expires_at, 'EXPIRED');
            assert(secret != 0 && note_id != 0, 'ZERO_SECRET_OR_NOTE');
            let commitment = poseidon_hash_span(
                array![
                    'APP20_SWAP_SECRET_V1', get_tx_info().unbox().chain_id,
                    get_contract_address().into(), secret,
                ]
                    .span(),
            );
            assert(commitment == quote.commitment, 'BAD_SECRET');
            let (balance, reserved) = backing(@self, quote.sell_token);
            assert(balance - reserved >= quote.sell_amount.into(), 'MISSING_PAYMENT');
            backing(@self, quote.buy_token);
            // A single state transition consumes the reservation before external approval.
            self.quotes.write(id, SwapQuote { status: 2, ..quote });
            self
                .liability
                .write(
                    quote.sell_token,
                    self.liability.read(quote.sell_token) + quote.sell_amount.into(),
                );
            credit(ref self, quote.maker, quote.sell_token, quote.sell_amount.into());
            self
                .liability
                .write(
                    quote.buy_token, self.liability.read(quote.buy_token) - quote.buy_amount.into(),
                );
            let token = token_at(quote.buy_token);
            let next = token.allowance(get_contract_address(), self.pool.read())
                + quote.buy_amount.into();
            assert(token.approve(self.pool.read(), next), 'APPROVE');
            assert(
                token.allowance(get_contract_address(), self.pool.read()) == next, 'BAD_ALLOWANCE',
            );
            backing(@self, quote.sell_token);
            backing(@self, quote.buy_token);
            self
                .emit(
                    QuoteFilled {
                        id,
                        maker: quote.maker,
                        sell_amount: quote.sell_amount,
                        buy_amount: quote.buy_amount,
                    },
                );
            self.entered.write(false);
            array![OpenNoteDeposit { note_id, token: quote.buy_token, amount: quote.buy_amount }]
                .span()
        }
    }
}
