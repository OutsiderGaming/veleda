//! LiteSVM harness: the built program (target/deploy/veleda.so, so run
//! `anchor build` first), a 6-decimal VCR-like mint, a funded admin and a
//! separate fee payer.

#![allow(dead_code, clippy::result_large_err, clippy::too_many_arguments)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use solana_address::Address;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_message::{Instruction, Message};
use solana_signer::Signer;
use solana_transaction::Transaction;
use veleda::{CreateMarketArgs, Market, Position, ShapePoint, HEADER_LEN};

pub const BASE: u64 = 1_000_000;
pub const DAY: i64 = 86_400;
pub const HOUR: i64 = 3_600;
/// Mid-afternoon UTC, so atom alignment is visible.
pub const START: i64 = 1_791_000_000 + 13 * HOUR + 17 * 60;

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub fee_payer: Keypair,
    pub token_program: Address,
    pub mint: Address,
    pub admin_token: Address,
}

/// A trader with VCR and no SOL.
pub struct User {
    pub key: Keypair,
    pub token: Address,
}

#[derive(Debug)]
pub struct CreatedMarket {
    pub market: Address,
    pub vault: Address,
    pub meta: TransactionMetadata,
}

impl Env {
    /// Classic SPL Token, like VCR.
    pub fn new() -> Self {
        Self::with_token_program(Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))
    }

    pub fn with_token_program(token_program: Address) -> Self {
        let mut svm = LiteSVM::new();
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/veleda.so");
        svm.add_program_from_file(veleda::ID.to_bytes(), so).expect("run `anchor build` first");
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = START;
        svm.set_sysvar(&clock);

        let admin = Keypair::new();
        let fee_payer = Keypair::new();
        svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&fee_payer.pubkey(), 10_000_000_000).unwrap();
        let mint = CreateMint::new(&mut svm, &admin).decimals(6).token_program_id(&token_program).send().unwrap();
        let admin_token = CreateAssociatedTokenAccount::new(&mut svm, &admin, &mint).token_program_id(&token_program).send().unwrap();
        MintTo::new(&mut svm, &admin, &mint, &admin_token, 1_000_000 * BASE).token_program_id(&token_program).send().unwrap();
        Env { svm, admin, fee_payer, token_program, mint, admin_token }
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let mut ixs = ixs.to_vec();
        ixs.insert(0, compute_limit(1_400_000));
        let msg = Message::new(&ixs, Some(&self.fee_payer.pubkey()));
        let mut all = vec![&self.fee_payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new(&all, msg, self.svm.latest_blockhash());
        let out = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        out
    }

    /// Allocates a market account of `len` bytes owned by the program.
    pub fn alloc_market(&mut self, len: usize) -> Keypair {
        let market = Keypair::new();
        let lamports = self.svm.minimum_balance_for_rent_exemption(len);
        let ix = solana_system_interface::instruction::create_account(&self.admin.pubkey(), &market.pubkey(), lamports, len as u64, &veleda::ID.to_bytes().into());
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &[&admin, &market]).unwrap();
        market
    }

    pub fn create_market_ix(&self, market: &Address, args: CreateMarketArgs) -> Instruction {
        let accounts = veleda::accounts::CreateMarket {
            admin: pk(&self.admin.pubkey()),
            fee_payer: pk(&self.fee_payer.pubkey()),
            market: pk(market),
            mint: pk(&self.mint),
            authority: pk(&authority(market)),
            vault: pk(&vault(market)),
            admin_token: pk(&self.admin_token),
            token_program: pk(&self.token_program),
            system_program: pk(&solana_system_interface::program::ID),
        };
        ix(accounts, veleda::instruction::CreateMarket { args })
    }

    pub fn create_market(&mut self, args: CreateMarketArgs) -> Result<CreatedMarket, FailedTransactionMetadata> {
        let market = self.alloc_market(veleda::market_account_len(args.atoms));
        let ix = self.create_market_ix(&market.pubkey(), args);
        let admin = self.admin.insecure_clone();
        let meta = self.send(&[ix], &[&admin])?;
        Ok(CreatedMarket { market: market.pubkey(), vault: vault(&market.pubkey()), meta })
    }

    /// A new keypair with `vcr` whole tokens in its token account and no SOL.
    pub fn new_user(&mut self, vcr: u64) -> User {
        let key = Keypair::new();
        let admin = self.admin.insecure_clone();
        let token = CreateAssociatedTokenAccount::new(&mut self.svm, &admin, &self.mint)
            .owner(&key.pubkey())
            .token_program_id(&self.token_program)
            .send()
            .unwrap();
        MintTo::new(&mut self.svm, &admin, &self.mint, &token, vcr * BASE).token_program_id(&self.token_program).send().unwrap();
        User { key, token }
    }

    pub fn buy_ix(&self, market: &Address, user: &User, nonce: u64, from: u32, to: u32, shares: u64, max_cost: u64) -> Instruction {
        let accounts = veleda::accounts::BuyRange {
            owner: pk(&user.key.pubkey()),
            fee_payer: pk(&self.fee_payer.pubkey()),
            market: pk(market),
            position: pk(&position(market, &user.key.pubkey(), nonce)),
            mint: pk(&self.mint),
            vault: pk(&vault(market)),
            owner_token: pk(&user.token),
            token_program: pk(&self.token_program),
            system_program: pk(&solana_system_interface::program::ID),
        };
        ix(accounts, veleda::instruction::BuyRange { nonce, from, to, shares, max_cost })
    }

    /// Buys into position `nonce`; the user signs only as token owner.
    pub fn buy(&mut self, market: &Address, user: &User, nonce: u64, from: u32, to: u32, shares: u64, max_cost: u64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let ix = self.buy_ix(market, user, nonce, from, to, shares, max_cost);
        self.send(&[ix], &[&user.key])
    }

    pub fn sell_ix(&self, market: &Address, user: &User, position: &Address, rent_payer: &Address, shares: u64, min_proceeds: u64) -> Instruction {
        let accounts = veleda::accounts::SellRange {
            owner: pk(&user.key.pubkey()),
            market: pk(market),
            position: pk(position),
            rent_payer: pk(rent_payer),
            mint: pk(&self.mint),
            vault: pk(&vault(market)),
            authority: pk(&authority(market)),
            owner_token: pk(&user.token),
            token_program: pk(&self.token_program),
        };
        ix(accounts, veleda::instruction::SellRange { shares, min_proceeds })
    }

    pub fn sell(&mut self, market: &Address, user: &User, nonce: u64, shares: u64, min_proceeds: u64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let position = position(market, &user.key.pubkey(), nonce);
        let ix = self.sell_ix(market, user, &position, &self.fee_payer.pubkey(), shares, min_proceeds);
        self.send(&[ix], &[&user.key])
    }

    pub fn advance_time(&mut self, market: &Address) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let ix = ix(veleda::accounts::AdvanceTime { market: pk(market) }, veleda::instruction::AdvanceTime {});
        self.send(&[ix], &[])
    }

    fn admin_accounts(&self, market: &Address, admin: &Keypair) -> veleda::accounts::AdminOnly {
        veleda::accounts::AdminOnly { admin: pk(&admin.pubkey()), market: pk(market) }
    }

    pub fn set_clock_offset_as(&mut self, admin: &Keypair, market: &Address, offset: i64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let ix = ix(self.admin_accounts(market, admin), veleda::instruction::SetClockOffset { offset });
        self.send(&[ix], &[admin])
    }

    pub fn set_clock_offset(&mut self, market: &Address, offset: i64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let admin = self.admin.insecure_clone();
        self.set_clock_offset_as(&admin, market, offset)
    }

    pub fn resolve_as(&mut self, admin: &Keypair, market: &Address, winner: u32) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let ix = ix(self.admin_accounts(market, admin), veleda::instruction::Resolve { winner });
        self.send(&[ix], &[admin])
    }

    pub fn resolve(&mut self, market: &Address, winner: u32) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let admin = self.admin.insecure_clone();
        self.resolve_as(&admin, market, winner)
    }

    pub fn claim_ix(&self, market: &Address, user: &User, position: &Address) -> Instruction {
        let accounts = veleda::accounts::Claim {
            owner: pk(&user.key.pubkey()),
            market: pk(market),
            position: pk(position),
            rent_payer: pk(&self.fee_payer.pubkey()),
            mint: pk(&self.mint),
            vault: pk(&vault(market)),
            authority: pk(&authority(market)),
            owner_token: pk(&user.token),
            token_program: pk(&self.token_program),
        };
        ix(accounts, veleda::instruction::Claim {})
    }

    pub fn claim(&mut self, market: &Address, user: &User, nonce: u64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let ix = self.claim_ix(market, user, &position(market, &user.key.pubkey(), nonce));
        self.send(&[ix], &[&user.key])
    }

    /// Moves chain time forward.
    pub fn warp(&mut self, seconds: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar(&clock);
    }

    /// The position's state, or None once it's closed.
    pub fn position(&self, market: &Address, owner: &Address, nonce: u64) -> Option<Position> {
        let account = self.svm.get_account(&position(market, owner, nonce)).filter(|a| a.lamports > 0)?;
        Some(Position::try_deserialize(&mut account.data.as_slice()).unwrap())
    }

    pub fn owed(&self, market: &Address) -> Vec<u64> {
        let data = self.svm.get_account(market).unwrap().data;
        let n = self.header(market).atoms as usize + 1;
        let start = HEADER_LEN + 3 * n.next_power_of_two() * 16;
        data[start..start + n * 8].chunks(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())).collect()
    }

    /// The vault holds the market balance plus accrued fees, and the balance
    /// covers the largest payout any single atom could require.
    pub fn check_invariant(&self, market: &Address) {
        let h = self.header(market);
        assert_eq!(self.token_balance(&vault(market)), h.balance + h.lp_fees + h.platform_fees, "vault = balance + fees");
        let owed = self.owed(market);
        let worst = if h.resolved != 0 { owed[h.winner as usize] } else { owed[h.live_edge as usize..].iter().copied().max().unwrap() };
        assert!(h.balance >= worst, "balance {} < largest payout {worst}", h.balance);
    }

    pub fn lamports(&self, address: &Address) -> u64 {
        self.svm.get_account(address).map_or(0, |a| a.lamports)
    }

    pub fn header(&self, market: &Address) -> Market {
        let data = self.svm.get_account(market).unwrap().data;
        bytemuck::pod_read_unaligned(&data[8..HEADER_LEN])
    }

    pub fn token_balance(&self, account: &Address) -> u64 {
        // Token and Token-2022 accounts both keep the amount at bytes 64..72.
        let data = self.svm.get_account(account).unwrap().data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }
}

pub fn pda(seeds: &[&[u8]]) -> (Address, u8) {
    Address::find_program_address(seeds, &veleda::ID.to_bytes().into())
}

pub fn vault(market: &Address) -> Address {
    pda(&[veleda::VAULT_SEED, market.as_ref()]).0
}

pub fn authority(market: &Address) -> Address {
    pda(&[veleda::AUTHORITY_SEED, market.as_ref()]).0
}

pub fn position(market: &Address, owner: &Address, nonce: u64) -> Address {
    pda(&[veleda::POSITION_SEED, market.as_ref(), owner.as_ref(), &nonce.to_le_bytes()]).0
}

/// Anchor's Pubkey and LiteSVM's Address are different types with the same bytes.
pub fn pk(a: &Address) -> Pubkey {
    a.to_bytes().into()
}

/// Builds a program instruction from Anchor's generated accounts and args.
pub fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: veleda::ID.to_bytes().into(),
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|m| solana_message::AccountMeta { pubkey: m.pubkey.to_bytes().into(), is_signer: m.is_signer, is_writable: m.is_writable })
            .collect(),
        data: data.data(),
    }
}

fn compute_limit(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction { program_id: Address::from_str_const("ComputeBudget111111111111111111111111111111"), accounts: vec![], data }
}

/// Fails unless the transaction failed with the named program error.
pub fn expect_error(result: Result<impl std::fmt::Debug, FailedTransactionMetadata>, name: &str) {
    let err = result.expect_err(&format!("expected {name}"));
    let logs = err.meta.logs.join("\n");
    assert!(logs.contains(&format!("Error Code: {name}")), "expected {name}, got {:?}\n{logs}", err.err);
}

/// Flagship preset: 3 years of days, "not by end date" 65%, 0.01% floor;
/// nothing above the floor for ~6 months, curving up to a peak at the end of
/// year 2, easing slightly through year 3.
pub fn flagship_args() -> CreateMarketArgs {
    let shape = [(182, 0), (300, 15), (420, 40), (550, 70), (650, 90), (730, 100), (1095, 85)];
    CreateMarketArgs {
        atoms: 1096,
        atom_seconds: DAY,
        b: 1_000 * BASE,
        lock_seconds: 72 * HOUR,
        lag_seconds: 24 * HOUR,
        demo: false,
        end_price_ppm: 650_000,
        floor_ppm: 100,
        shape: shape.iter().map(|&(atom, weight)| ShapePoint { atom, weight }).collect(),
        clock_offset: 0,
    }
}

/// Fast demo preset: a week of hours, flat, "not by end date" at the same price as each hour.
pub fn fast_args() -> CreateMarketArgs {
    CreateMarketArgs {
        atoms: 168,
        atom_seconds: HOUR,
        b: 100 * BASE,
        lock_seconds: HOUR,
        lag_seconds: 10 * 60,
        demo: true,
        end_price_ppm: (1_000_000 / 169) as u32,
        floor_ppm: 0,
        shape: vec![],
        clock_offset: 0,
    }
}
