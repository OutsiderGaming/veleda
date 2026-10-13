//! Market account layout.
//!
//! One zero-copy account per market, created by the client with
//! `createAccount` (it's over the 10 KB CPI limit) and initialised by
//! `create_market`:
//!
//! | Bytes | Holds |
//! | --- | --- |
//! | 8 | Anchor discriminator |
//! | 184 | [`Market`] header: parameters, admin, mint, vault, engine state |
//! | 16 × 2·cap | tree sums (packed floats) |
//! | 16 × cap | tree pending multipliers |
//! | 8 × (atoms + 1) | owed shares per atom |
//!
//! where cap = (atoms + 1) rounded up to a power of two. Scripts compute the
//! same size: see [`market_account_len`].

use anchor_lang::prelude::*;
use core::mem::size_of;
use veleda_math::engine::{self, Params, State};
use veleda_math::tree::{storage_len, Tree};

use crate::error::{engine_error, VeledaError};

/// Most timed atoms a market may have: create_market builds the opening
/// prices on the 32 KB heap (16 bytes per atom).
pub const MAX_ATOMS: u32 = 1_500;

#[account(zero_copy)]
pub struct Market {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    /// Depth, in base units.
    pub b: u64,
    pub atom_seconds: i64,
    /// Unix time at which atom 0 starts.
    pub start_time: i64,
    pub lock_seconds: i64,
    pub lag_seconds: i64,
    /// Added to chain time everywhere; only demo markets can move it, and only forward.
    pub clock_offset: i64,
    /// Market's tokens excluding accrued fees, in base units.
    pub balance: u64,
    pub lp_fees: u64,
    pub platform_fees: u64,
    /// Timed atoms; index `atoms` is "not by end date".
    pub atoms: u32,
    /// Atoms below this index are pruned.
    pub live_edge: u32,
    pub winner: u32,
    pub resolved: u8,
    pub demo: u8,
    pub authority_bump: u8,
    pub vault_bump: u8,
}

pub const HEADER_LEN: usize = 8 + size_of::<Market>();
// The tree's u128 slices start right after the header.
const _: () = assert!(HEADER_LEN.is_multiple_of(16));

/// Total account size for a market with `atoms` timed atoms.
pub const fn market_account_len(atoms: u32) -> usize {
    let n = atoms as usize + 1;
    let (s, l) = storage_len(n);
    HEADER_LEN + (s + l) * 16 + n * 8
}

impl Market {
    pub fn params(&self) -> Params {
        Params {
            b: self.b,
            atom_seconds: self.atom_seconds,
            start_time: self.start_time,
            atoms: self.atoms,
            lock_seconds: self.lock_seconds,
            lag_seconds: self.lag_seconds,
        }
    }

    pub fn state(&self) -> State {
        State {
            live_edge: self.live_edge,
            resolved: self.resolved != 0,
            winner: self.winner,
            balance: self.balance,
            lp_fees: self.lp_fees,
            platform_fees: self.platform_fees,
        }
    }

    pub fn set_state(&mut self, s: &State) {
        self.live_edge = s.live_edge;
        self.resolved = s.resolved as u8;
        self.winner = s.winner;
        self.balance = s.balance;
        self.lp_fees = s.lp_fees;
        self.platform_fees = s.platform_fees;
    }

    /// The market's "now": chain time plus the clock offset.
    pub fn now(&self) -> Result<i64> {
        Ok(Clock::get()?.unix_timestamp + self.clock_offset)
    }
}

/// A market account's data split into the header and the engine's slices.
pub struct MarketData<'a> {
    pub header: &'a mut Market,
    sums: &'a mut [u128],
    lazy: &'a mut [u128],
    owed: &'a mut [u64],
}

impl<'a> MarketData<'a> {
    /// Splits an initialised market's data (discriminator already checked by Anchor).
    pub fn load(data: &'a mut [u8]) -> Result<Self> {
        let atoms = bytemuck::try_from_bytes::<Market>(&data[8..HEADER_LEN]).map_err(|_| error!(VeledaError::BadAccount))?.atoms;
        Self::split(data, atoms)
    }

    /// Splits `data` for a market with `atoms` timed atoms, checking its length.
    pub fn split(data: &'a mut [u8], atoms: u32) -> Result<Self> {
        require!(data.len() == market_account_len(atoms), VeledaError::BadAccount);
        let (s, l) = storage_len(atoms as usize + 1);
        let (header, rest) = data[8..].split_at_mut(HEADER_LEN - 8);
        let (sums, rest) = rest.split_at_mut(s * 16);
        let (lazy, owed) = rest.split_at_mut(l * 16);
        let bad = |_| error!(VeledaError::BadAccount);
        Ok(MarketData {
            header: bytemuck::try_from_bytes_mut(header).map_err(bad)?,
            sums: bytemuck::try_cast_slice_mut(sums).map_err(bad)?,
            lazy: bytemuck::try_cast_slice_mut(lazy).map_err(bad)?,
            owed: bytemuck::try_cast_slice_mut(owed).map_err(bad)?,
        })
    }

    /// Runs `f` on the engine over this market, then saves the engine state to the header.
    pub fn run<R>(&mut self, f: impl FnOnce(&mut engine::Market) -> engine::Result<R>) -> Result<R> {
        let params = self.header.params();
        let mut state = self.header.state();
        let n = params.atoms as usize + 1;
        let tree = Tree::new(self.sums, self.lazy, n).ok_or(error!(VeledaError::BadAccount))?;
        let mut market = engine::Market::new(&params, &mut state, tree, self.owed).map_err(engine_error)?;
        let out = f(&mut market).map_err(engine_error)?;
        self.header.set_state(&state);
        Ok(out)
    }
}
