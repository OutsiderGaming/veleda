//! Segment tree of atom weights with lazy range-multiply, in Q64.64.
//!
//! Leaves hold each atom's weight w_i = p0_i · e^(q_i/b); internal nodes hold
//! the sum of their subtree and a pending multiplier for it. A trade
//! multiplies a range by e^(±x/b) in O(log n); pruning multiplies a range by
//! 0; prices are range sum ÷ root sum.
//!
//! The tree doesn't own its memory: it works over two caller-provided slices,
//! so the on-chain program can point it straight at account data.
//!
//! Rounding: multiplications round weights up. A weight that is slightly too
//! high only makes trades cost slightly more, so it never weakens the vault
//! invariant. Node sums can differ from the exact sum of their leaves by a few
//! ulps; the margins in `lmsr` are many orders of magnitude larger.
//!
//! Range: after every multiply, if the root sum is outside [1, [`RESCALE_AT`]),
//! the whole tree is scaled by a power of two so the root is back in [1, 2).
//! Scaling down prevents overflow; scaling up (after sells or pruning shrink
//! the tree) keeps every weight's precision. Prices don't change.
//! With trades capped at x ≤ [`MAX_TRADE_EXPONENT`]·b, the largest factor is
//! e^30 ≈ 2^43.3, so no sum can pass 2^16 · 2^43.3 < 2^64.
//!
//! Precision: a weight's relative error is about (operations since) · 2^-64 ÷
//! (the smallest share of the root it has had). Weights that stay at normal
//! sizes are accurate to ~1e-15; one that was squeezed to 1e-12 of the root by
//! heavy buying elsewhere, then bought back up, carries ~1e-8. Prices are
//! weight ÷ root, so they also carry the root's error. None of this affects
//! vault safety, which depends only on the stored weights, and they only ever
//! round up. tests/tree.rs checks this bound for every leaf after every step.
//!
//! Pending multipliers are stored as a small float, not fixed point: a part of
//! the tree nobody trades in keeps collecting rescales (×2^-16 each), and in
//! fixed point that multiplier would lose almost all its precision. Sums stay
//! plain Q64.64.

use crate::fixed::{self, Rounding, ONE};

/// Rescale once the root sum reaches 2^16.
pub const RESCALE_AT: u128 = ONE << 16;
/// Largest x/b a single trade may use (factor e^30). Program rejects larger trades.
pub const MAX_TRADE_EXPONENT: u128 = 30 * ONE;

// Pending multiplier packed into a u128: a Q64.64 mantissa in [1, 2) (or 0)
// in the low 65 bits and a power-of-two exponent (i32) in bits 96..128.
// Value = mantissa · 2^exponent: 64 bits of relative precision at any size.
const MANT_BITS: u128 = (1 << 65) - 1;
const LAZY_ONE: u128 = ONE; // mantissa 1, exponent 0

fn pack(m: u128, e: i32) -> u128 {
    ((e as u32 as u128) << 96) | m
}

fn unpack(x: u128) -> (u128, i32) {
    (x & MANT_BITS, (x >> 96) as u32 as i32)
}

/// Packs m · 2^e with m brought into [1, 2), rounding up when bits are shifted out.
fn normalise(mut m: u128, mut e: i32) -> Option<u128> {
    if m == 0 {
        return Some(0);
    }
    while m >= 2 * ONE {
        let lost = m & 1;
        m = (m >> 1) + lost;
        e = e.checked_add(1)?;
    }
    while m < ONE {
        m <<= 1;
        e = e.checked_sub(1)?;
    }
    Some(pack(m, e))
}

/// Product of two packed multipliers, rounded up.
fn compose(a: u128, b: u128) -> Option<u128> {
    let ((ma, ea), (mb, eb)) = (unpack(a), unpack(b));
    if ma == 0 || mb == 0 {
        return Some(0);
    }
    normalise(fixed::mul(ma, mb, Rounding::Up)?, ea.checked_add(eb)?)
}

/// A Q64.64 value times a packed multiplier, rounded up. `None` on overflow.
fn scale(v: u128, f: u128) -> Option<u128> {
    let (m, e) = unpack(f);
    if m == 0 || v == 0 {
        return Some(0);
    }
    let s = fixed::mul(v, m, Rounding::Up)?;
    if e >= 0 {
        let e = e as u32;
        if e >= s.leading_zeros() {
            return None;
        }
        Some(s << e)
    } else {
        let k = e.unsigned_abs();
        if k >= 128 {
            return Some(1); // rounds up to one ulp
        }
        let lost = s & ((1u128 << k) - 1) != 0;
        Some((s >> k) + lost as u128)
    }
}

/// Node storage needed for `n` leaves: (sums length, lazy length).
pub const fn storage_len(n: usize) -> (usize, usize) {
    let cap = n.next_power_of_two();
    (2 * cap, cap)
}

pub struct Tree<'a> {
    /// Node sums. Index 1 is the root; children of i are 2i and 2i + 1; leaf j is at cap + j.
    sums: &'a mut [u128],
    /// Pending multiplier for each internal node, packed (see `pack`); LAZY_ONE when none.
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

    /// Writes the opening weights and builds every node. `None` if lengths differ or sums overflow.
    pub fn init(&mut self, leaves: &[u128]) -> Option<()> {
        if leaves.len() != self.n {
            return None;
        }
        self.lazy.fill(LAZY_ONE);
        self.sums.fill(0);
        self.sums[self.cap..self.cap + self.n].copy_from_slice(leaves);
        for i in (1..self.cap).rev() {
            self.sums[i] = self.sums[2 * i].checked_add(self.sums[2 * i + 1])?;
        }
        Some(())
    }

    pub fn root(&self) -> u128 {
        self.sums[1]
    }

    /// Sum of leaves l..=r.
    pub fn range_sum(&mut self, l: usize, r: usize) -> Option<u128> {
        if l > r || r >= self.n {
            return None;
        }
        self.sum_rec(1, 0, self.cap - 1, l, r)
    }

    pub fn leaf(&mut self, i: usize) -> Option<u128> {
        self.range_sum(i, i)
    }

    /// Price of leaves l..=r: range sum ÷ root sum, capped at 1.
    pub fn range_price(&mut self, l: usize, r: usize, rounding: Rounding) -> Option<u128> {
        let s = self.range_sum(l, r)?;
        Some(fixed::div(s, self.root(), rounding)?.min(ONE))
    }

    /// Multiplies leaves l..=r by `factor`, then rescales if the root got large.
    /// `None` (tree unchanged at the root) on a bad range or overflow.
    pub fn range_mul(&mut self, l: usize, r: usize, factor: u128) -> Option<()> {
        if l > r || r >= self.n {
            return None;
        }
        self.mul_rec(1, 0, self.cap - 1, l, r, normalise(factor, 0)?)?;
        let root = self.root();
        if root >= RESCALE_AT || (root < ONE && root != 0) {
            self.rescale()?;
        }
        Some(())
    }

    /// Scales every weight by a power of two so the root lands in [1, 2). Prices don't change.
    pub fn rescale(&mut self) -> Option<()> {
        let root = self.root();
        if root == 0 || (ONE..2 * ONE).contains(&root) {
            return Some(());
        }
        let log2 = 127 - root.leading_zeros() as i32 - 64; // floor(log2(root value)), may be negative
        self.apply(1, pack(ONE, -log2))
    }

    fn sum_rec(&mut self, node: usize, lo: usize, hi: usize, l: usize, r: usize) -> Option<u128> {
        if r < lo || hi < l {
            return Some(0);
        }
        if l <= lo && hi <= r {
            return Some(self.sums[node]);
        }
        self.push(node)?;
        let mid = (lo + hi) / 2;
        self.sum_rec(2 * node, lo, mid, l, r)?.checked_add(self.sum_rec(2 * node + 1, mid + 1, hi, l, r)?)
    }

    fn mul_rec(&mut self, node: usize, lo: usize, hi: usize, l: usize, r: usize, factor: u128) -> Option<()> {
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
        self.sums[node] = self.sums[2 * node].checked_add(self.sums[2 * node + 1])?;
        Some(())
    }

    /// Multiplies a whole subtree by a packed factor: its sum now, its descendants lazily.
    fn apply(&mut self, node: usize, factor: u128) -> Option<()> {
        self.sums[node] = scale(self.sums[node], factor)?;
        if node < self.cap {
            self.lazy[node] = compose(self.lazy[node], factor)?;
        }
        Some(())
    }

    /// Hands a node's pending multiplier down to its children.
    fn push(&mut self, node: usize) -> Option<()> {
        let f = self.lazy[node];
        if f != LAZY_ONE {
            self.apply(2 * node, f)?;
            self.apply(2 * node + 1, f)?;
            self.lazy[node] = LAZY_ONE;
        }
        Some(())
    }
}
