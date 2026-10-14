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
pub use state::{market_account_len, Market, MarketData, Position, HEADER_LEN, MAX_ATOMS};

declare_id!("7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx");

pub const VAULT_SEED: &[u8] = b"vault";
/// PDA that owns the vault and signs payouts.
pub const AUTHORITY_SEED: &[u8] = b"authority";
/// Position PDA: `[POSITION_SEED, market, owner, nonce (u64 LE)]`.
pub const POSITION_SEED: &[u8] = b"position";

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
    /// Demo markets only (0 otherwise): the clock starts this far ahead of chain time, and so
    /// does atom 0, e.g. to set a clearly fictional scenario in the future. Never negative.
    pub clock_offset: i64,
}

#[program]
pub mod veleda {
    use super::*;

    /// Writes the parameters and opening prices, then moves the subsidy
    /// (b · ln(1 / lowest opening price)) from the admin into the vault.
    /// Atom 0 starts at the current atom boundary of the market clock (UTC midnight for daily
    /// markets); a demo market created with a clock offset starts that far ahead.
    pub fn create_market(ctx: Context<CreateMarket>, args: CreateMarketArgs) -> Result<()> {
        let a = &args;
        require!(
            (1..=MAX_ATOMS).contains(&a.atoms) && a.atom_seconds > 0 && a.b > 0 && a.lock_seconds >= 0 && a.lag_seconds >= 0,
            VeledaError::BadParams
        );
        let prior = prior::opening_prices(a.atoms, a.end_price_ppm, a.floor_ppm, &a.shape).ok_or(VeledaError::BadPrior)?;
        require!(a.clock_offset >= 0, VeledaError::ClockBackwards);
        require!(a.demo || a.clock_offset == 0, VeledaError::NotDemo);
        let now = Clock::get()?.unix_timestamp + a.clock_offset;

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
                clock_offset: a.clock_offset,
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

    /// Buys `shares` in every atom of [from, to] into a new position. The
    /// owner pays the stake (LMSR cost + 3.5% fee, at most `max_cost`); the
    /// fee payer pays the position's rent. `nonce` is any number not yet used
    /// by this owner in this market.
    pub fn buy_range(ctx: Context<BuyRange>, nonce: u64, from: u32, to: u32, shares: u64, max_cost: u64) -> Result<()> {
        let info = ctx.accounts.market.to_account_info();
        let receipt = {
            let mut data = info.try_borrow_mut_data()?;
            let mut m = MarketData::load(&mut data)?;
            let now = m.header.now()?;
            m.run(|e| e.buy(from, to, shares, max_cost, now))?
        };

        let accounts = &ctx.accounts;
        let cpi = TransferChecked {
            from: accounts.owner_token.to_account_info(),
            mint: accounts.mint.to_account_info(),
            to: accounts.vault.to_account_info(),
            authority: accounts.owner.to_account_info(),
        };
        token_interface::transfer_checked(CpiContext::new(accounts.token_program.key(), cpi), receipt.stake, accounts.mint.decimals)?;

        let position = &mut ctx.accounts.position;
        position.set_inner(Position {
            market: info.key(),
            owner: ctx.accounts.owner.key(),
            rent_payer: ctx.accounts.fee_payer.key(),
            nonce,
            from,
            to,
            shares,
            bump: ctx.bumps.position,
        });
        emit!(Trade {
            market: info.key(),
            owner: position.owner,
            position: position.key(),
            from,
            to,
            shares,
            is_buy: true,
            amount: receipt.stake,
            fee: receipt.fee,
        });
        Ok(())
    }

    /// Sells `shares` from the position's whole range at the live price. The
    /// owner receives the LMSR proceeds less 3.5% (at least `min_proceeds`).
    /// Selling the last share closes the position and returns its rent to
    /// whoever paid it.
    pub fn sell_range(ctx: Context<SellRange>, shares: u64, min_proceeds: u64) -> Result<()> {
        let (from, to) = (ctx.accounts.position.from, ctx.accounts.position.to);
        require!(shares <= ctx.accounts.position.shares, VeledaError::NotEnoughShares);
        let info = ctx.accounts.market.to_account_info();
        let (receipt, authority_bump) = {
            let mut data = info.try_borrow_mut_data()?;
            let mut m = MarketData::load(&mut data)?;
            let now = m.header.now()?;
            (m.run(|e| e.sell(from, to, shares, min_proceeds, now))?, m.header.authority_bump)
        };

        let accounts = &ctx.accounts;
        let market_key = info.key();
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, market_key.as_ref(), &[authority_bump]];
        let cpi = TransferChecked {
            from: accounts.vault.to_account_info(),
            mint: accounts.mint.to_account_info(),
            to: accounts.owner_token.to_account_info(),
            authority: accounts.authority.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(accounts.token_program.key(), cpi, &[seeds]),
            receipt.net,
            accounts.mint.decimals,
        )?;

        let position = &mut ctx.accounts.position;
        position.shares -= shares;
        emit!(Trade {
            market: market_key,
            owner: position.owner,
            position: position.key(),
            from,
            to,
            shares,
            is_buy: false,
            amount: receipt.net,
            fee: receipt.fee,
        });
        if position.shares == 0 {
            position.close(ctx.accounts.rent_payer.to_account_info())?;
        }
        Ok(())
    }

    /// Prunes every timed atom that ended before now − lag. Permissionless.
    pub fn advance_time(ctx: Context<AdvanceTime>) -> Result<()> {
        let info = ctx.accounts.market.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let mut m = MarketData::load(&mut data)?;
        let now = m.header.now()?;
        let pruned = m.run(|e| e.advance_time(now))?;
        msg!("pruned {} atoms; live edge {}", pruned, m.header.live_edge);
        Ok(())
    }

    /// Demo markets only: moves the market's clock to chain time + `offset`. Never back.
    pub fn set_clock_offset(ctx: Context<AdminOnly>, offset: i64) -> Result<()> {
        let mut market = ctx.accounts.market.load_mut()?;
        require!(market.demo != 0, VeledaError::NotDemo);
        require!(offset >= market.clock_offset, VeledaError::ClockBackwards);
        market.clock_offset = offset;
        Ok(())
    }

    /// Records the winning atom (`atoms` for "not by end date") and stops trading.
    pub fn resolve(ctx: Context<AdminOnly>, winner: u32) -> Result<()> {
        let info = ctx.accounts.market.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        MarketData::load(&mut data)?.run(|e| e.resolve(winner))?;
        msg!("resolved: atom {}", winner);
        Ok(())
    }

    /// After resolution: pays one VCR per share if the position's range
    /// contains the winner (nothing otherwise) and closes the position,
    /// returning its rent to whoever paid it.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let p = &ctx.accounts.position;
        let (from, to, shares) = (p.from, p.to, p.shares);
        let info = ctx.accounts.market.to_account_info();
        let (payout, authority_bump) = {
            let mut data = info.try_borrow_mut_data()?;
            let mut m = MarketData::load(&mut data)?;
            (m.run(|e| e.claim(from, to, shares))?, m.header.authority_bump)
        };

        let accounts = &ctx.accounts;
        let market_key = info.key();
        if payout > 0 {
            let seeds: &[&[u8]] = &[AUTHORITY_SEED, market_key.as_ref(), &[authority_bump]];
            let cpi = TransferChecked {
                from: accounts.vault.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to: accounts.owner_token.to_account_info(),
                authority: accounts.authority.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(accounts.token_program.key(), cpi, &[seeds]),
                payout,
                accounts.mint.decimals,
            )?;
        }
        emit!(Claimed { market: market_key, owner: p.owner, position: p.key(), payout });
        Ok(())
    }
}

/// A position paid out, or closed with nothing to pay.
#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub position: Pubkey,
    pub payout: u64,
}

/// Every buy and sell, for the app's activity feed and price history.
#[event]
pub struct Trade {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub position: Pubkey,
    pub from: u32,
    pub to: u32,
    pub shares: u64,
    pub is_buy: bool,
    /// Stake paid (buy, fee included) or proceeds received (sell, after the fee).
    pub amount: u64,
    pub fee: u64,
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

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct BuyRange<'info> {
    pub owner: Signer<'info>,
    /// Pays the position's rent and gets it back when the position closes.
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub market: AccountLoader<'info, Market>,
    #[account(
        init,
        payer = fee_payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub position: Account<'info, Position>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellRange<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut, has_one = market, has_one = owner, has_one = rent_payer)]
    pub position: Account<'info, Position>,
    /// CHECK: receives the position's rent if it closes; must match the position.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: PDA with no data; signs for the vault.
    #[account(seeds = [AUTHORITY_SEED, market.key().as_ref()], bump = market.load()?.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct AdvanceTime<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin)]
    pub market: AccountLoader<'info, Market>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut, has_one = market, has_one = owner, has_one = rent_payer, close = rent_payer)]
    pub position: Account<'info, Position>,
    /// CHECK: receives the position's rent; must match the position.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: PDA with no data; signs for the vault.
    #[account(seeds = [AUTHORITY_SEED, market.key().as_ref()], bump = market.load()?.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
