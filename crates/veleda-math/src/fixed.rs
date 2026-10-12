//! Q64.64 fixed point in u128: the raw value v represents v / 2^64.
//!
//! Every function takes a [`Rounding`] direction and guarantees it: `Up`
//! never returns less than the true value, `Down` never more. Internally each
//! function computes a close approximation (error well under 2^-56 relative,
//! plus a few ulps), then widens it by a fixed margin in the requested
//! direction. The margin (2^-44 relative + 256 ulps) is far larger than the
//! internal error and far smaller than one token base unit at any realistic
//! size, so the vault is always favoured and nobody notices.

/// 1.0
pub const ONE: u128 = 1 << 64;
/// ln 2, rounded to nearest.
pub const LN2: u128 = 0xB172_17F7_D1CF_79AC;
/// Largest exponent [`exp`] accepts: e^43 ≈ 4.7e18 still fits below 2^64.
pub const EXP_MAX: u128 = 43 * ONE;

const LO: u128 = u64::MAX as u128;
const MARGIN_SHIFT: u32 = 44;
const MARGIN_ULPS: u128 = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rounding {
    Down,
    Up,
}

/// Full 256-bit product of two u128s, as (high, low).
fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    let (a1, a0) = (a >> 64, a & LO);
    let (b1, b0) = (b >> 64, b & LO);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & LO) + (p10 & LO);
    let lo = (p00 & LO) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

/// a × b. `None` on overflow.
pub fn mul(a: u128, b: u128, rounding: Rounding) -> Option<u128> {
    let (hi, lo) = mul_wide(a, b);
    if hi >> 64 != 0 {
        return None;
    }
    let result = (hi << 64) | (lo >> 64);
    match rounding {
        Rounding::Up if lo & LO != 0 => result.checked_add(1),
        _ => Some(result),
    }
}

/// a ÷ b. `None` if b is 0, b ≥ 2^127, or the result overflows.
pub fn div(a: u128, b: u128, rounding: Rounding) -> Option<u128> {
    if b == 0 || b >> 127 != 0 {
        return None;
    }
    let int = a / b;
    if int >> 64 != 0 {
        return None;
    }
    // Long division for the 64 fractional bits. rem < b < 2^127, so rem << 1 can't overflow.
    let mut rem = a % b;
    let mut frac: u128 = 0;
    for _ in 0..64 {
        rem <<= 1;
        frac <<= 1;
        if rem >= b {
            rem -= b;
            frac |= 1;
        }
    }
    let result = (int << 64) | frac;
    match rounding {
        Rounding::Up if rem != 0 => result.checked_add(1),
        _ => Some(result),
    }
}

/// e^y for y ≥ 0. `None` if y > [`EXP_MAX`].
pub fn exp(y: u128, rounding: Rounding) -> Option<u128> {
    if y > EXP_MAX {
        return None;
    }
    // y = k·ln2 + r with r in [0, ln2), so e^y = 2^k · e^r.
    let k = y / LN2;
    let r = y - k * LN2;
    let v = exp_taylor(r, false) << k;
    Some(widen(v, rounding))
}

/// e^(−y) for y ≥ 0. Underflows towards 0 for large y.
pub fn exp_neg(y: u128, rounding: Rounding) -> u128 {
    let k = y / LN2;
    if k >= 128 {
        return widen(0, rounding);
    }
    let r = y - k * LN2;
    let v = exp_taylor(r, true) >> k;
    widen(v, rounding)
}

/// e^(−y) for y ≥ 0 split as (m, k) with e^(−y) = m · 2^(−k) and m in
/// (1/2, 1], m rounded the given way. Unlike [`exp_neg`] this keeps full
/// relative precision however small the result.
pub fn exp_neg_split(y: u128, rounding: Rounding) -> (u128, u128) {
    let k = y / LN2;
    let r = y - k * LN2;
    (widen(exp_taylor(r, true), rounding), k)
}

/// ln x for x ≥ 1. `None` if x < 1.
pub fn ln(x: u128, rounding: Rounding) -> Option<u128> {
    if x < ONE {
        return None;
    }
    // x = 2^k · m with m in [1, 2): ln x = k·ln2 + ln m.
    let k = (127 - x.leading_zeros()) - 64;
    let m = x >> k;
    let v = k as u128 * LN2 + ln_mantissa(m);
    Some(widen(v, rounding))
}

/// −ln x for 0 < x ≤ 1 (a non-negative result). `None` outside that range.
pub fn neg_ln(x: u128, rounding: Rounding) -> Option<u128> {
    if x == 0 || x > ONE {
        return None;
    }
    // x = 2^(−k) · m with m in [1, 2): −ln x = k·ln2 − ln m.
    let k = 64 - (127 - x.leading_zeros());
    let m = x << k;
    let v = (k as u128 * LN2).saturating_sub(ln_mantissa(m));
    Some(widen(v, rounding))
}

/// e^r (or e^(−r) if `negate`) for r in [0, ln2), by Taylor series.
fn exp_taylor(r: u128, negate: bool) -> u128 {
    let mut pos = ONE;
    let mut neg = 0;
    let mut term = ONE;
    for n in 1..=40u128 {
        term = mul(term, r, Rounding::Down).unwrap() / n;
        if term == 0 {
            break;
        }
        if negate && n % 2 == 1 {
            neg += term;
        } else {
            pos += term;
        }
    }
    pos - neg
}

/// ln m for m in [1, 2), via ln m = 2·atanh(s) with s = (m − 1)/(m + 1) in [0, 1/3).
fn ln_mantissa(m: u128) -> u128 {
    let s = div(m - ONE, m + ONE, Rounding::Down).unwrap();
    let s2 = mul(s, s, Rounding::Down).unwrap();
    let mut sum = s;
    let mut term = s;
    for n in 1..=40u128 {
        term = mul(term, s2, Rounding::Down).unwrap();
        if term == 0 {
            break;
        }
        sum += term / (2 * n + 1);
    }
    2 * sum
}

fn widen(v: u128, rounding: Rounding) -> u128 {
    let margin = (v >> MARGIN_SHIFT) + MARGIN_ULPS;
    match rounding {
        Rounding::Up => v.saturating_add(margin),
        Rounding::Down => v.saturating_sub(margin),
    }
}
