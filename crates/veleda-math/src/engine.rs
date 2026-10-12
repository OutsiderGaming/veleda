//! Market engine: the program's instructions as plain Rust over borrowed state.
//!
//! Token amounts and shares are u64 base units (6 decimals: 1_000_000 = one
//! token, and one share pays one token). Pricing runs in Q64.64 via `lmsr` and
//! `tree`. Every amount is rounded in the vault's favour: costs and fees up,
//! proceeds down. Every state change ends with a solvency check: the market's
//! balance (vault minus accrued fees) must cover the largest payout any single
//! atom could require.
//!
//! The engine doesn't know about positions or owners: the program checks that
//! a seller holds the shares and passes the range and amount in. On an error
//! the engine may have changed state partway; on-chain the whole transaction
//! reverts, so that never persists.
//!
//! Mirrors `Market` in packages/reference; tests/cross_check.rs replays the
//! reference's trade logs against it.

use crate::fixed::{self, Rounding, ONE};
use crate::float::Float;
use crate::lmsr;
use crate::tree::{Tree, MAX_TRADE_EXPONENT};

/// Base units per token (6 decimals).
pub const BASE: u64 = 1_000_000;
/// Fee on buys and sells, in basis points: 3.5%, of which 2.5% to LPs and 1% to the platform.
pub const FEE_BPS: u64 = 350;
pub const LP_FEE_BPS: u64 = 250;
const BPS: u64 = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// Range is empty, out of bounds, or the share amount is invalid.
    BadRange,
    /// Range starts inside the locked zone (start < now + lock).
    Locked,
    /// Range includes pruned atoms.
    Pruned,
    /// Market already resolved.
    NotOpen,
    /// Trade exceeds 30 × b shares.
    TooLarge,
    /// Price moved past max_cost / min_proceeds.
    Slippage,
    Overflow,
    /// Balance would not cover the largest single-atom payout.
    Insolvent,
}

pub type Result<T> = core::result::Result<T, Error>;

#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// Depth, in base units.
    pub b: u64,
    pub atom_seconds: i64,
    /// Unix time at which atom 0 starts.
    pub start_time: i64,
    /// Timed atoms; index `atoms` is "not by end date".
    pub atoms: u32,
    pub lock_seconds: i64,
    pub lag_seconds: i64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct State {
    /// Atoms below this index are pruned.
    pub live_edge: u32,
    pub resolved: bool,
    pub winner: u32,
    /// Market's tokens excluding accrued fees, in base units.
    pub balance: u64,
    pub lp_fees: u64,
    pub platform_fees: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuyReceipt {
    /// LMSR cost: the part of the stake that goes to the market.
    pub cost: u64,
    pub fee: u64,
    /// Total the buyer pays.
    pub stake: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellReceipt {
    /// LMSR proceeds before the fee.
    pub gross: u64,
    pub fee: u64,
    /// What the seller receives.
    pub net: u64,
}

pub struct Market<'a> {
    pub params: &'a Params,
    pub state: &'a mut State,
    tree: Tree<'a>,
    /// Outstanding shares per atom: what the market owes if that atom wins.
    owed: &'a mut [u64],
}

impl<'a> Market<'a> {
    pub fn new(params: &'a Params, state: &'a mut State, tree: Tree<'a>, owed: &'a mut [u64]) -> Result<Self> {
        let n = params.atoms as usize + 1;
        if tree.len() != n || owed.len() != n || params.b == 0 || params.atom_seconds <= 0 {
            return Err(Error::BadRange);
        }
        Ok(Market { params, state, tree, owed })
    }

    /// create_market: writes the opening prices (Q64.64, any positive scale) and
    /// returns the subsidy b · ln(1 / lowest opening price), rounded up, which
    /// the caller must deposit. It becomes the opening balance.
    pub fn create(&mut self, prior: &[u128]) -> Result<u64> {
        self.tree.init(prior).ok_or(Error::Overflow)?;
        self.owed.fill(0);
        let (lowest, _) = prior.iter().enumerate().min_by_key(|(_, &w)| w).ok_or(Error::BadRange)?;
        let p_min = self.price(lowest as u32, lowest as u32, Rounding::Down)?;
        let ln = fixed::neg_ln(p_min, Rounding::Up).ok_or(Error::BadRange)?;
        let subsidy = to_base_up(fixed::mul(from_base(self.params.b, Rounding::Up)?, ln, Rounding::Up).ok_or(Error::Overflow)?)?;
        *self.state = State { balance: subsidy, ..State::default() };
        Ok(subsidy)
    }

    // ---- Quotes ----

    /// Range price (Q64.64), rounded the given way.
    pub fn price(&mut self, from: u32, to: u32, rounding: Rounding) -> Result<u128> {
        self.check_range(from, to)?;
        self.tree.range_price(from as usize, to as usize, rounding).ok_or(Error::Overflow)
    }

    pub fn quote_buy(&mut self, from: u32, to: u32, shares: u64) -> Result<BuyReceipt> {
        self.check_range(from, to)?;
        // Cost rises with x and p and falls with b: round x and p up, b down.
        let x = from_base(shares, Rounding::Up)?;
        let b = from_base(self.params.b, Rounding::Down)?;
        if shares == 0 || fixed::div(x, b, Rounding::Up).ok_or(Error::Overflow)? > MAX_TRADE_EXPONENT {
            return Err(if shares == 0 { Error::BadRange } else { Error::TooLarge });
        }
        let p = self.tree.range_price_up(from as usize, to as usize).ok_or(Error::Overflow)?;
        let cost = to_base_up(lmsr::range_cost_float(b, p, x).ok_or(Error::Overflow)?)?;
        // The fee is 3.5% of the stake, so stake = cost / (1 − 3.5%), rounded up.
        let stake = div_ceil(cost as u128 * BPS as u128, (BPS - FEE_BPS) as u128)?;
        Ok(BuyReceipt { cost, fee: stake - cost, stake })
    }

    pub fn quote_sell(&mut self, from: u32, to: u32, shares: u64) -> Result<SellReceipt> {
        self.check_range(from, to)?;
        // Proceeds rise with x, p and b: round all three down.
        let x = from_base(shares, Rounding::Down)?;
        let b = from_base(self.params.b, Rounding::Down)?;
        if shares == 0 || fixed::div(x, b, Rounding::Down).ok_or(Error::Overflow)? > MAX_TRADE_EXPONENT {
            return Err(if shares == 0 { Error::BadRange } else { Error::TooLarge });
        }
        let p = self.price(from, to, Rounding::Down)?;
        let gross = to_base_down(lmsr::range_proceeds(b, p, x).ok_or(Error::Overflow)?)?;
        let fee = div_ceil(gross as u128 * FEE_BPS as u128, BPS as u128)?;
        Ok(SellReceipt { gross, fee, net: gross - fee })
    }

    // ---- Instructions ----

    /// buy_range: adds `shares` to every atom in [from, to]. `max_cost` caps the stake (fee included).
    pub fn buy(&mut self, from: u32, to: u32, shares: u64, max_cost: u64, now: i64) -> Result<BuyReceipt> {
        self.check_tradable(from, to, now)?;
        let receipt = self.quote_buy(from, to, shares)?;
        if receipt.stake > max_cost {
            return Err(Error::Slippage);
        }
        // Weights round up: the factor uses x/b rounded up.
        let y = fixed::div(from_base(shares, Rounding::Up)?, from_base(self.params.b, Rounding::Down)?, Rounding::Up).ok_or(Error::Overflow)?;
        let factor = Float::exp(y).ok_or(Error::Overflow)?;
        self.tree.range_mul(from as usize, to as usize, factor).ok_or(Error::Overflow)?;
        for owed in &mut self.owed[from as usize..=to as usize] {
            *owed = owed.checked_add(shares).ok_or(Error::Overflow)?;
        }
        self.state.balance = self.state.balance.checked_add(receipt.cost).ok_or(Error::Overflow)?;
        self.add_fee(receipt.fee)?;
        self.check_solvent()?;
        Ok(receipt)
    }

    /// sell_range: removes `shares` from every atom in [from, to]. The caller
    /// checks the seller holds them. `min_proceeds` is the least net accepted.
    pub fn sell(&mut self, from: u32, to: u32, shares: u64, min_proceeds: u64, now: i64) -> Result<SellReceipt> {
        self.check_tradable(from, to, now)?;
        let receipt = self.quote_sell(from, to, shares)?;
        if receipt.net < min_proceeds {
            return Err(Error::Slippage);
        }
        // Weights round up: the factor e^(−x/b) uses x/b rounded down, then rounds up.
        let y = fixed::div(from_base(shares, Rounding::Down)?, from_base(self.params.b, Rounding::Down)?, Rounding::Down).ok_or(Error::Overflow)?;
        let factor = Float::exp_neg(y).ok_or(Error::Overflow)?;
        self.tree.range_mul(from as usize, to as usize, factor).ok_or(Error::Overflow)?;
        for owed in &mut self.owed[from as usize..=to as usize] {
            *owed = owed.checked_sub(shares).ok_or(Error::BadRange)?;
        }
        self.state.balance = self.state.balance.checked_sub(receipt.gross).ok_or(Error::Insolvent)?;
        self.add_fee(receipt.fee)?;
        self.check_solvent()?;
        Ok(receipt)
    }

    /// advance_time: prunes every timed atom that ended before now − lag. Returns how many.
    pub fn advance_time(&mut self, now: i64) -> Result<u32> {
        if self.state.resolved {
            return Err(Error::NotOpen);
        }
        let p = self.params;
        let elapsed = now - p.lag_seconds - p.start_time;
        let edge = elapsed.div_euclid(p.atom_seconds).clamp(0, p.atoms as i64) as u32;
        if edge <= self.state.live_edge {
            return Ok(0);
        }
        let from = self.state.live_edge;
        self.tree.range_mul(from as usize, edge as usize - 1, Float::ZERO).ok_or(Error::Overflow)?;
        self.owed[from as usize..edge as usize].fill(0);
        self.state.live_edge = edge;
        self.check_solvent()?;
        Ok(edge - from)
    }

    pub fn resolve(&mut self, winner: u32) -> Result<()> {
        if self.state.resolved {
            return Err(Error::NotOpen);
        }
        if winner < self.state.live_edge || winner > self.params.atoms {
            return Err(Error::BadRange);
        }
        self.state.resolved = true;
        self.state.winner = winner;
        Ok(())
    }

    /// claim: pays one token per share if [from, to] contains the winner, else 0.
    pub fn claim(&mut self, from: u32, to: u32, shares: u64) -> Result<u64> {
        if !self.state.resolved {
            return Err(Error::NotOpen);
        }
        self.check_range(from, to)?;
        let won = from <= self.state.winner && self.state.winner <= to;
        let payout = if won { shares } else { 0 };
        // Pruned atoms already owe nothing; a range that is entirely pruned has nothing to release.
        let first = from.max(self.state.live_edge);
        if first <= to {
            for owed in &mut self.owed[first as usize..=to as usize] {
                *owed = owed.checked_sub(shares).ok_or(Error::BadRange)?;
            }
        }
        self.state.balance = self.state.balance.checked_sub(payout).ok_or(Error::Insolvent)?;
        Ok(payout)
    }

    // ---- Solvency ----

    /// Largest payout any single atom could require.
    pub fn max_liability(&self) -> u64 {
        if self.state.resolved {
            return self.owed[self.state.winner as usize];
        }
        self.owed[self.state.live_edge as usize..].iter().copied().max().unwrap_or(0)
    }

    fn check_solvent(&self) -> Result<()> {
        if self.state.balance >= self.max_liability() {
            Ok(())
        } else {
            Err(Error::Insolvent)
        }
    }

    // ---- Internals ----

    fn atom_start(&self, i: u32) -> i64 {
        self.params.start_time + i as i64 * self.params.atom_seconds
    }

    fn check_range(&self, from: u32, to: u32) -> Result<()> {
        if from > to || to > self.params.atoms {
            return Err(Error::BadRange);
        }
        Ok(())
    }

    fn check_tradable(&self, from: u32, to: u32, now: i64) -> Result<()> {
        if self.state.resolved {
            return Err(Error::NotOpen);
        }
        self.check_range(from, to)?;
        // range start ≥ now + lock. Also blocks atoms that have elapsed but aren't pruned yet.
        if self.atom_start(from) < now + self.params.lock_seconds {
            return Err(Error::Locked);
        }
        if from < self.state.live_edge {
            return Err(Error::Pruned);
        }
        Ok(())
    }

    fn add_fee(&mut self, fee: u64) -> Result<()> {
        let lp = fee * LP_FEE_BPS / FEE_BPS;
        self.state.lp_fees = self.state.lp_fees.checked_add(lp).ok_or(Error::Overflow)?;
        self.state.platform_fees = self.state.platform_fees.checked_add(fee - lp).ok_or(Error::Overflow)?;
        Ok(())
    }
}

/// Base units → Q64.64 tokens.
pub fn from_base(amount: u64, rounding: Rounding) -> Result<u128> {
    fixed::div((amount as u128) << 64, (BASE as u128) << 64, rounding).ok_or(Error::Overflow)
}

/// Q64.64 tokens → base units, rounded up.
pub fn to_base_up(v: u128) -> Result<u64> {
    let scaled = fixed::mul(v, (BASE as u128) << 64, Rounding::Up).ok_or(Error::Overflow)?;
    let whole = (scaled >> 64) + (scaled & (ONE - 1) != 0) as u128;
    u64::try_from(whole).map_err(|_| Error::Overflow)
}

/// Q64.64 tokens → base units, rounded down.
pub fn to_base_down(v: u128) -> Result<u64> {
    let scaled = fixed::mul(v, (BASE as u128) << 64, Rounding::Down).ok_or(Error::Overflow)?;
    u64::try_from(scaled >> 64).map_err(|_| Error::Overflow)
}

fn div_ceil(a: u128, b: u128) -> Result<u64> {
    u64::try_from(a.div_ceil(b)).map_err(|_| Error::Overflow)
}
