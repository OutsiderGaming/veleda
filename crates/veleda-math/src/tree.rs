//! Segment tree of atom weights with lazy range-multiply.
//!
//! Leaves hold each atom's weight w_i = p0_i · e^(q_i/b); internal nodes hold
//! the sum of their subtree and a pending multiplier for it. A trade
//! multiplies a range by e^(±x/b) in O(log n); pruning multiplies a range by
//! 0; prices are range sum ÷ root sum.
//!
//! The tree doesn't own its memory: it works over two caller-provided slices,
//! so the on-chain program can point it straight at account data.
//!
//! Number format: every sum and multiplier is a small float packed into a
//! u128 (see [`Float`]): a 64-bit fractional mantissa and a power-of-two
//! exponent. Fixed point isn't enough here: an atom squeezed to a tiny share
//! of the market by heavy buying elsewhere would keep only a few significant
//! bits, and carry that error into every price once bought back up. With
//! floats each weight keeps 64 bits of relative precision at any size, and
//! nothing can overflow, so no rescaling is needed.
//!
//! Rounding: every operation rounds up. A weight that is slightly too high
//! only makes trades cost slightly more, so it never weakens the vault
//! invariant.

use crate::fixed::{Rounding, ONE};
use crate::float::Float;

/// Largest x/b a single trade may use (factor e^30). Keeps exp inputs well
/// inside their range; the program rejects larger trades, which can be split.
pub const MAX_TRADE_EXPONENT: u128 = 30 * ONE;

/// Node storage needed for `n` leaves: (sums length, lazy length).
pub const fn storage_len(n: usize) -> (usize, usize) {
    let cap = n.next_power_of_two();
    (2 * cap, cap)
}

pub struct Tree<'a> {
    /// Node sums (packed [`Float`]s). Index 1 is the root; children of i are 2i and 2i + 1; leaf j is at cap + j.
    sums: &'a mut [u128],
    /// Pending multiplier for each internal node (packed [`Float`]; `Float::ONE` when none).
    lazy: &'a mut [u128],
    n: usize,
    cap: usize,
}

impl<'a> Tree<'a> {
    /// Wraps existing storage. `None` if the slices are the wrong size for `n` leaves.
    pub fn new(sums: &'a mut [u128], lazy: &'a mut [u128], n: usize) -> Option<Self> {
        let (s, l) = storage_len(n);
        if n == 0 || sums.len() != s || lazy.len() != l {
            return None;
        }
        Some(Tree { sums, lazy, n, cap: n.next_power_of_two() })
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// Writes the opening weights (Q64.64, any positive scale) and builds every node.
    pub fn init(&mut self, leaves: &[u128]) -> Option<()> {
        if leaves.len() != self.n {
            return None;
        }
        self.lazy.fill(Float::ONE.0);
        self.sums.fill(Float::ZERO.0);
        for (i, &w) in leaves.iter().enumerate() {
            self.sums[self.cap + i] = Float::from_q64(w)?.0;
        }
        for i in (1..self.cap).rev() {
            self.sums[i] = Float(self.sums[2 * i]).add(Float(self.sums[2 * i + 1]))?.0;
        }
        Some(())
    }

    /// Price of leaves l..=r: range sum ÷ root sum (Q64.64), capped at 1.
    pub fn range_price(&mut self, l: usize, r: usize, rounding: Rounding) -> Option<u128> {
        let s = self.range_sum(l, r)?;
        Some(s.ratio(Float(self.sums[1]), rounding)?.min(ONE))
    }

    /// Price of leaves l..=r as a [`Float`], rounded up and capped at 1. Keeps full
    /// relative precision for tiny prices; use it for buy quotes.
    pub fn range_price_up(&mut self, l: usize, r: usize) -> Option<Float> {
        let p = self.range_sum(l, r)?.ratio_up(Float(self.sums[1]))?;
        Some(if p.to_q64(Rounding::Down)? > ONE { Float::ONE } else { p })
    }

    /// Multiplies leaves l..=r by `factor` (`Float::ZERO` prunes them).
    /// `None` on a bad range or overflow; the caller must then discard the tree's state.
    pub fn range_mul(&mut self, l: usize, r: usize, factor: Float) -> Option<()> {
        if l > r || r >= self.n {
            return None;
        }
        self.mul_rec(1, 0, self.cap - 1, l, r, factor)
    }

    fn range_sum(&mut self, l: usize, r: usize) -> Option<Float> {
        if l > r || r >= self.n {
            return None;
        }
        self.sum_rec(1, 0, self.cap - 1, l, r)
    }

    fn sum_rec(&mut self, node: usize, lo: usize, hi: usize, l: usize, r: usize) -> Option<Float> {
        if r < lo || hi < l {
            return Some(Float::ZERO);
        }
        if l <= lo && hi <= r {
            return Some(Float(self.sums[node]));
        }
        self.push(node)?;
        let mid = (lo + hi) / 2;
        self.sum_rec(2 * node, lo, mid, l, r)?.add(self.sum_rec(2 * node + 1, mid + 1, hi, l, r)?)
    }

    fn mul_rec(&mut self, node: usize, lo: usize, hi: usize, l: usize, r: usize, factor: Float) -> Option<()> {
        if r < lo || hi < l {
            return Some(());
        }
        if l <= lo && hi <= r {
            return self.apply(node, factor);
        }
        self.push(node)?;
        let mid = (lo + hi) / 2;
        self.mul_rec(2 * node, lo, mid, l, r, factor)?;
        self.mul_rec(2 * node + 1, mid + 1, hi, l, r, factor)?;
        self.sums[node] = Float(self.sums[2 * node]).add(Float(self.sums[2 * node + 1]))?.0;
        Some(())
    }

    /// Multiplies a whole subtree: its sum now, its descendants lazily.
    fn apply(&mut self, node: usize, factor: Float) -> Option<()> {
        self.sums[node] = Float(self.sums[node]).mul(factor)?.0;
        if node < self.cap {
            self.lazy[node] = Float(self.lazy[node]).mul(factor)?.0;
        }
        Some(())
    }

    /// Hands a node's pending multiplier down to its children.
    fn push(&mut self, node: usize) -> Option<()> {
        let f = Float(self.lazy[node]);
        if f != Float::ONE {
            self.apply(2 * node, f)?;
            self.apply(2 * node + 1, f)?;
            self.lazy[node] = Float::ONE.0;
        }
        Some(())
    }
}
