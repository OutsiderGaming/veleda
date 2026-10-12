//! Veleda on-chain program.
//!
//! WEEK 1 ONLY: this holds temporary `probe_*` instructions that run the real
//! `veleda_math::engine` on one raw account so we can measure compute units on
//! devnet (scripts/probe-cu.ts). Week 2 replaces them with the real
//! instructions from docs/02-hackathon-spec.md.

use anchor_lang::prelude::*;
use veleda_math::engine::{self, Market, Params, State, BASE};
use veleda_math::fixed::ONE;
use veleda_math::tree::{storage_len, Tree};

declare_id!("7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx");

/// Logs the remaining compute units ("Program consumption: N units remaining").
fn sol_log_compute_units() {
    #[cfg(target_os = "solana")]
    // SAFETY: a syscall with no arguments that only writes to the program log.
    unsafe {
        solana_msg::syscalls::sol_log_compute_units_()
    };
}

/// Probe account layout: a 64-byte header, then tree sums (u128), tree
/// pending multipliers (u128), then owed shares per atom (u64).
const HEADER: usize = 64;

pub fn probe_account_len(atoms: u32) -> usize {
    let n = atoms as usize + 1;
    let (s, l) = storage_len(n);
    HEADER + (s + l) * 16 + n * 8
}

#[program]
pub mod veleda {
    use super::*;

    /// Creates a flat-prior market with `atoms` daily atoms starting tomorrow (b = 1,000 tokens).
    pub fn probe_init(ctx: Context<Probe>, atoms: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut data = ctx.accounts.market.try_borrow_mut_data()?;
        require!(data.len() == probe_account_len(atoms), ProbeError::BadAccount);
        data[0..4].copy_from_slice(&atoms.to_le_bytes());
        data[8..16].copy_from_slice(&(now + 86_400).to_le_bytes());
        let n = atoms as usize + 1;
        let prior = vec![ONE / n as u128; n];
        with_market(&mut data, |m| {
            sol_log_compute_units();
            let subsidy = m.create(&prior)?;
            sol_log_compute_units();
            msg!("created: {} atoms, subsidy {}", atoms, subsidy);
            Ok(())
        })
    }

    pub fn probe_buy(ctx: Context<Probe>, from: u32, to: u32, shares: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut data = ctx.accounts.market.try_borrow_mut_data()?;
        with_market(&mut data, |m| {
            sol_log_compute_units();
            let r = m.buy(from, to, shares, u64::MAX, now)?;
            sol_log_compute_units();
            msg!("buy [{}, {}] {} shares: cost {} stake {}", from, to, shares, r.cost, r.stake);
            Ok(())
        })
    }

    pub fn probe_sell(ctx: Context<Probe>, from: u32, to: u32, shares: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut data = ctx.accounts.market.try_borrow_mut_data()?;
        with_market(&mut data, |m| {
            sol_log_compute_units();
            let r = m.sell(from, to, shares, 0, now)?;
            sol_log_compute_units();
            msg!("sell [{}, {}] {} shares: net {}", from, to, shares, r.net);
            Ok(())
        })
    }

    /// Prunes as if the clock read `now` (probe only: lets us measure pruning without waiting).
    pub fn probe_advance(ctx: Context<Probe>, now: i64) -> Result<()> {
        let mut data = ctx.accounts.market.try_borrow_mut_data()?;
        with_market(&mut data, |m| {
            sol_log_compute_units();
            let pruned = m.advance_time(now)?;
            sol_log_compute_units();
            msg!("pruned {}", pruned);
            Ok(())
        })
    }
}

#[derive(Accounts)]
pub struct Probe<'info> {
    /// CHECK: raw probe market data, owned by this program; layout checked by length.
    #[account(mut, owner = crate::ID)]
    pub market: UncheckedAccount<'info>,
}

#[error_code]
pub enum ProbeError {
    #[msg("Probe account has the wrong size or alignment")]
    BadAccount,
    #[msg("Engine rejected the operation (see logs)")]
    Engine,
}

/// Splits the account into header and slices, runs `f` on the market, saves the state.
fn with_market(data: &mut [u8], f: impl FnOnce(&mut Market) -> core::result::Result<(), engine::Error>) -> Result<()> {
    let atoms = u32::from_le_bytes(data[0..4].try_into().unwrap());
    let start_time = i64::from_le_bytes(data[8..16].try_into().unwrap());
    require!(data.len() == probe_account_len(atoms), ProbeError::BadAccount);
    let n = atoms as usize + 1;
    let (s, l) = storage_len(n);
    let (header, rest) = data.split_at_mut(HEADER);
    let (sums, rest) = rest.split_at_mut(s * 16);
    let (lazy, owed) = rest.split_at_mut(l * 16);
    let sums: &mut [u128] = bytemuck::try_cast_slice_mut(sums).map_err(|_| error!(ProbeError::BadAccount))?;
    let lazy: &mut [u128] = bytemuck::try_cast_slice_mut(lazy).map_err(|_| error!(ProbeError::BadAccount))?;
    let owed: &mut [u64] = bytemuck::try_cast_slice_mut(owed).map_err(|_| error!(ProbeError::BadAccount))?;

    let params = Params { b: 1000 * BASE, atom_seconds: 86_400, start_time, atoms, lock_seconds: 3 * 86_400, lag_seconds: 86_400 };
    let mut state = read_state(header);
    let tree = Tree::new(sums, lazy, n).ok_or(error!(ProbeError::BadAccount))?;
    let mut market = Market::new(&params, &mut state, tree, owed).map_err(|_| error!(ProbeError::BadAccount))?;
    f(&mut market).map_err(|e| {
        msg!("engine error: {:?}", e);
        error!(ProbeError::Engine)
    })?;
    write_state(header, &state);
    Ok(())
}

fn read_state(h: &[u8]) -> State {
    let u64_at = |i: usize| u64::from_le_bytes(h[i..i + 8].try_into().unwrap());
    State {
        live_edge: u32::from_le_bytes(h[16..20].try_into().unwrap()),
        resolved: h[20] != 0,
        winner: u32::from_le_bytes(h[24..28].try_into().unwrap()),
        balance: u64_at(32),
        lp_fees: u64_at(40),
        platform_fees: u64_at(48),
    }
}

fn write_state(h: &mut [u8], s: &State) {
    h[16..20].copy_from_slice(&s.live_edge.to_le_bytes());
    h[20] = s.resolved as u8;
    h[24..28].copy_from_slice(&s.winner.to_le_bytes());
    h[32..40].copy_from_slice(&s.balance.to_le_bytes());
    h[40..48].copy_from_slice(&s.lp_fees.to_le_bytes());
    h[48..56].copy_from_slice(&s.platform_fees.to_le_bytes());
}
