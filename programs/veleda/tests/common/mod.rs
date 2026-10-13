//! LiteSVM harness: the built program (target/deploy/veleda.so, so run
//! `anchor build` first), a 6-decimal VCR-like mint, a funded admin and a
//! separate fee payer.

#![allow(dead_code)]

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use solana_address::Address;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_message::{Instruction, Message};
use solana_signer::Signer;
use solana_transaction::Transaction;
use veleda::{CreateMarketArgs, Market, ShapePoint, HEADER_LEN};

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
        let (authority, _) = pda(&[veleda::AUTHORITY_SEED, market.as_ref()]);
        let (vault, _) = pda(&[veleda::VAULT_SEED, market.as_ref()]);
        let accounts = veleda::accounts::CreateMarket {
            admin: self.admin.pubkey().to_bytes().into(),
            fee_payer: self.fee_payer.pubkey().to_bytes().into(),
            market: market.to_bytes().into(),
            mint: self.mint.to_bytes().into(),
            authority: authority.to_bytes().into(),
            vault: vault.to_bytes().into(),
            admin_token: self.admin_token.to_bytes().into(),
            token_program: self.token_program.to_bytes().into(),
            system_program: solana_system_interface::program::ID.to_bytes().into(),
        };
        Instruction {
            program_id: veleda::ID.to_bytes().into(),
            accounts: accounts.to_account_metas(None).into_iter().map(|m| solana_message::AccountMeta {
                pubkey: m.pubkey.to_bytes().into(),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            }).collect(),
            data: veleda::instruction::CreateMarket { args }.data(),
        }
    }

    pub fn create_market(&mut self, args: CreateMarketArgs) -> Result<CreatedMarket, FailedTransactionMetadata> {
        let market = self.alloc_market(veleda::market_account_len(args.atoms));
        let ix = self.create_market_ix(&market.pubkey(), args);
        let admin = self.admin.insecure_clone();
        let meta = self.send(&[ix], &[&admin])?;
        let (vault, _) = pda(&[veleda::VAULT_SEED, market.pubkey().as_ref()]);
        Ok(CreatedMarket { market: market.pubkey(), vault, meta })
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
    }
}
