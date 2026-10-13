//! Veleda on-chain program.
//!
//! Each instruction is a thin wrapper: load accounts, run `veleda_math::engine`
//! over the market account, move tokens. Market layout: `state.rs`.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

mod error;
pub mod prior;
pub mod state;

pub use error::VeledaError;
pub use prior::ShapePoint;
pub use state::{market_account_len, Market, MarketData, HEADER_LEN, MAX_ATOMS};

declare_id!("7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx");

pub const VAULT_SEED: &[u8] = b"vault";
/// PDA that owns the vault and signs payouts.
pub const AUTHORITY_SEED: &[u8] = b"authority";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateMarketArgs {
    /// Timed atoms; the market adds "not by end date" after them.
    pub atoms: u32,
    pub atom_seconds: i64,
    /// Depth, in base units.
    pub b: u64,
    pub lock_seconds: i64,
    pub lag_seconds: i64,
    /// Demo markets let the admin move the clock forward.
    pub demo: bool,
    /// Opening "not by end date" price, parts per million.
    pub end_price_ppm: u32,
    /// Lowest opening price of any timed atom, parts per million.
    pub floor_ppm: u32,
    /// Opening shape of the timed atoms (see `prior.rs`); empty for flat.
    pub shape: Vec<ShapePoint>,
}

#[program]
pub mod veleda {
    use super::*;

    /// Writes the parameters and opening prices, then moves the subsidy
    /// (b · ln(1 / lowest opening price)) from the admin into the vault.
    /// Atom 0 starts at the current atom boundary (UTC midnight for daily markets).
    pub fn create_market(ctx: Context<CreateMarket>, args: CreateMarketArgs) -> Result<()> {
        let a = &args;
        require!(
            (1..=MAX_ATOMS).contains(&a.atoms) && a.atom_seconds > 0 && a.b > 0 && a.lock_seconds >= 0 && a.lag_seconds >= 0,
            VeledaError::BadParams
        );
        let prior = prior::opening_prices(a.atoms, a.end_price_ppm, a.floor_ppm, &a.shape).ok_or(VeledaError::BadPrior)?;
        let now = Clock::get()?.unix_timestamp;

        let market_info = ctx.accounts.market.to_account_info();
        let subsidy = {
            let mut data = market_info.try_borrow_mut_data()?;
            let mut m = MarketData::split(&mut data, a.atoms)?;
            *m.header = Market {
                admin: ctx.accounts.admin.key(),
                mint: ctx.accounts.mint.key(),
                vault: ctx.accounts.vault.key(),
                b: a.b,
                atom_seconds: a.atom_seconds,
                start_time: now - now.rem_euclid(a.atom_seconds),
                lock_seconds: a.lock_seconds,
                lag_seconds: a.lag_seconds,
                clock_offset: 0,
                balance: 0,
                lp_fees: 0,
                platform_fees: 0,
                atoms: a.atoms,
                live_edge: 0,
                winner: 0,
                resolved: 0,
                demo: a.demo as u8,
                authority_bump: ctx.bumps.authority,
                vault_bump: ctx.bumps.vault,
            };
            m.run(|e| e.create(&prior))?
        };

        let accounts = &ctx.accounts;
        let cpi = TransferChecked {
            from: accounts.admin_token.to_account_info(),
            mint: accounts.mint.to_account_info(),
            to: accounts.vault.to_account_info(),
            authority: accounts.admin.to_account_info(),
        };
        token_interface::transfer_checked(CpiContext::new(accounts.token_program.key(), cpi), subsidy, accounts.mint.decimals)?;
        msg!("market created: {} atoms, subsidy {}", a.atoms, subsidy);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    pub admin: Signer<'info>,
    /// Pays rent for the vault; the user-facing fee payer elsewhere.
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    /// Pre-allocated by the client at `market_account_len(atoms)` bytes, owned by this program.
    #[account(zero)]
    pub market: AccountLoader<'info, Market>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: PDA with no data; owns the vault.
    #[account(seeds = [AUTHORITY_SEED, market.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = fee_payer,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = authority,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = admin, token::token_program = token_program)]
    pub admin_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
