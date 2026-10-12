//! LMSR range pricing in Q64.64, rounded in the vault's favour.
//!
//! cost(x)     = b · ln(1 − p + p·e^(x/b))      rounded up
//! proceeds(x) = −b · ln(1 − p + p·e^(−x/b))    rounded down
//!
//! where p is the range's current price (range sum ÷ root sum, in [0, 1]) and
//! x the number of shares. Every intermediate step is rounded in whichever
//! direction pushes the final figure the vault's way.
//!
//! The caller must round p the same way: up before `range_cost`, down before
//! `range_proceeds`. Near p = 1, proceeds are very sensitive to p, so this
//! matters. Mirrors
//! `costForShares` / `proceedsForShares` in packages/reference.

use crate::fixed::{self, Rounding, ONE};
use crate::float::Float;

/// Cost of adding x shares to a range at price p (Q64.64), with depth b. All Q64.64.
/// `None` if p > 1, b is 0, or x/b exceeds [`fixed::EXP_MAX`] (trade too large).
pub fn range_cost(b: u128, p: u128, x: u128) -> Option<u128> {
    if p > ONE {
        return None;
    }
    range_cost_float(b, Float::from_q64(p)?, x)
}

/// As [`range_cost`], with p as a [`Float`]. Big trades multiply p by up to
/// e^30, so a tiny p must keep its full relative precision rather than be
/// truncated to Q64.64 first.
pub fn range_cost_float(b: u128, p: Float, x: u128) -> Option<u128> {
    use Rounding::Up;
    // Cost rises with x/b and with p, so round both up.
    let y = fixed::div(x, b, Up)?;
    let e = fixed::exp(y, Up)?;
    let t = p.mul(Float::from_q64(e - ONE)?)?.to_q64(Up)?;
    let l = fixed::ln(ONE.checked_add(t)?, Up)?;
    fixed::mul(b, l, Up)
}

/// Proceeds (before fees) of removing x shares from a range at price p, with depth b. All Q64.64.
/// `None` if p > 1 or b is 0.
pub fn range_proceeds(b: u128, p: u128, x: u128) -> Option<u128> {
    use Rounding::{Down, Up};
    if p > ONE {
        return None;
    }
    // z = 1 − p·(1 − e^(−x/b)); proceeds = −b·ln z fall as z rises, so round z up:
    // the subtracted term down, which means e^(−x/b) up and x/b down.
    let y = fixed::div(x, b, Down)?;
    let e = fixed::exp_neg(y, Up).min(ONE);
    let t = fixed::mul(p, ONE - e, Down)?;
    let z = ONE - t;
    let l = fixed::neg_ln(z, Down)?;
    fixed::mul(b, l, Down)
}
