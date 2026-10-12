//! A small non-negative float packed into a u128, used by the segment tree and
//! for buy prices. Every operation rounds up unless it takes a `Rounding`.

use crate::fixed::{self, Rounding, ONE};

/// A non-negative float packed into a u128: mantissa m (Q64.64, in [1, 2), or
/// 0 for zero) in the low 65 bits and exponent e (i32) in bits 96..128.
/// Value = m · 2^e. Operations round up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Float(pub u128);

const MANT_BITS: u128 = (1 << 65) - 1;

impl Float {
    pub const ZERO: Float = Float(0);
    pub const ONE: Float = Float(ONE); // mantissa 1, exponent 0

    fn parts(self) -> (u128, i32) {
        (self.0 & MANT_BITS, (self.0 >> 96) as u32 as i32)
    }

    fn pack(m: u128, e: i32) -> Float {
        Float(((e as u32 as u128) << 96) | m)
    }

    /// m · 2^e with any m, normalised so the mantissa is in [1, 2), rounding up.
    fn normalised(m: u128, e: i32) -> Option<Float> {
        if m == 0 {
            return Some(Float::ZERO);
        }
        let msb = 127 - m.leading_zeros() as i32; // the mantissa's top bit belongs at 64
        if msb > 64 {
            let k = (msb - 64) as u32;
            let lost = m & ((1u128 << k) - 1) != 0;
            let mut m = (m >> k) + lost as u128;
            let mut e = e.checked_add(k as i32)?;
            if m == 2 * ONE {
                m = ONE;
                e = e.checked_add(1)?;
            }
            Some(Float::pack(m, e))
        } else {
            let k = (64 - msb) as u32;
            Some(Float::pack(m << k, e.checked_sub(k as i32)?))
        }
    }

    /// From a Q64.64 value.
    pub fn from_q64(v: u128) -> Option<Float> {
        Float::normalised(v, 0)
    }

    /// e^y for 0 ≤ y ≤ [`fixed::EXP_MAX`], rounded up.
    pub fn exp(y: u128) -> Option<Float> {
        Float::from_q64(fixed::exp(y, Rounding::Up)?)
    }

    /// e^(−y) for y ≥ 0, rounded up, with full relative precision however small.
    pub fn exp_neg(y: u128) -> Option<Float> {
        let (m, k) = fixed::exp_neg_split(y, Rounding::Up);
        Float::normalised(m, -(i32::try_from(k).ok()?))
    }

    /// Approximate value as f64, for display and tests. 0 or infinity outside f64's range.
    pub fn as_f64(self) -> f64 {
        let (m, e) = self.parts();
        if m == 0 {
            return 0.0;
        }
        let mant = m as f64 / 18_446_744_073_709_551_616.0; // in [1, 2)
        match e {
            -1022..=1023 => mant * f64::from_bits(((e + 1023) as u64) << 52),
            _ if e < 0 => 0.0,
            _ => f64::INFINITY,
        }
    }

    pub fn is_zero(self) -> bool {
        self.parts().0 == 0
    }

    pub fn mul(self, other: Float) -> Option<Float> {
        let ((ma, ea), (mb, eb)) = (self.parts(), other.parts());
        if ma == 0 || mb == 0 {
            return Some(Float::ZERO);
        }
        Float::normalised(fixed::mul(ma, mb, Rounding::Up)?, ea.checked_add(eb)?)
    }

    pub fn add(self, other: Float) -> Option<Float> {
        let (mut a, mut b) = (self.parts(), other.parts());
        if a.0 == 0 {
            return Some(other);
        }
        if b.0 == 0 {
            return Some(self);
        }
        if a.1 < b.1 {
            core::mem::swap(&mut a, &mut b);
        }
        // Align the smaller to the larger's exponent, rounding up any bits shifted out.
        let d = (a.1 as i64 - b.1 as i64) as u64;
        let mb = if d >= 66 {
            1
        } else {
            let lost = b.0 & ((1u128 << d) - 1) != 0;
            (b.0 >> d) + lost as u128
        };
        Float::normalised(a.0 + mb, a.1)
    }

    /// self ÷ other as a Float, rounded up. `None` if other is 0.
    pub fn ratio_up(self, other: Float) -> Option<Float> {
        let ((ma, ea), (mb, eb)) = (self.parts(), other.parts());
        if mb == 0 {
            return None;
        }
        if ma == 0 {
            return Some(Float::ZERO);
        }
        Float::normalised(fixed::div(ma, mb, Rounding::Up)?, ea.checked_sub(eb)?)
    }

    /// As Q64.64, rounded the given way. `None` if it doesn't fit.
    pub fn to_q64(self, rounding: Rounding) -> Option<u128> {
        self.ratio(Float::ONE, rounding)
    }

    /// self ÷ other as Q64.64, rounded the given way. `None` if other is 0 or the result overflows.
    pub fn ratio(self, other: Float, rounding: Rounding) -> Option<u128> {
        let ((ma, ea), (mb, eb)) = (self.parts(), other.parts());
        if mb == 0 {
            return None;
        }
        if ma == 0 {
            return Some(0);
        }
        let q = fixed::div(ma, mb, rounding)?; // in (1/2, 2)
        let shift = ea as i64 - eb as i64;
        if shift >= 0 {
            if shift >= q.leading_zeros() as i64 {
                return None;
            }
            Some(q << shift)
        } else {
            let k = shift.unsigned_abs();
            if k >= 128 {
                return Some((rounding == Rounding::Up) as u128);
            }
            let lost = q & ((1u128 << k) - 1) != 0;
            Some((q >> k) + (lost && rounding == Rounding::Up) as u128)
        }
    }
}
