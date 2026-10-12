#![allow(dead_code)]

use veleda_math::ONE;

pub const TWO64: f64 = 18_446_744_073_709_551_616.0;

pub fn q(v: f64) -> u128 {
    (v * TWO64) as u128
}

pub fn f(v: u128) -> f64 {
    v as f64 / TWO64
}

/// xorshift64*: deterministic randomness without dependencies.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in [0, 1).
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
    /// Log-uniform in [lo, hi].
    pub fn log_range(&mut self, lo: f64, hi: f64) -> f64 {
        (lo.ln() + (hi.ln() - lo.ln()) * self.unit()).exp()
    }
}

/// f64 references are within ~1e-16 relative of the truth. Allow for that,
/// plus Q64.64 resolution, when checking the rounding direction.
const REF_REL: f64 = 1e-15;
const REF_ABS: f64 = 1e-18;
/// Accuracy target: both directions within this of the truth.
const ACC_REL: f64 = 1e-12;
const ACC_ABS: f64 = 1e-15;

/// `up` is at least the true value and close to it; `down` is at most the true value and close to it.
pub fn check_bounds(name: &str, input: f64, reference: f64, down: u128, up: u128) {
    let (d, u) = (f(down), f(up));
    assert!(down <= up, "{name}({input}): down > up");
    assert!(
        u >= reference - reference.abs() * REF_REL - REF_ABS,
        "{name}({input}): up {u} below reference {reference}"
    );
    assert!(
        d <= reference + reference.abs() * REF_REL + REF_ABS,
        "{name}({input}): down {d} above reference {reference}"
    );
    let tol = reference.abs() * ACC_REL + ACC_ABS;
    assert!(u - reference <= tol, "{name}({input}): up {u} too far above {reference}");
    assert!(reference - d <= tol, "{name}({input}): down {d} too far below {reference}");
    let _ = ONE;
}
