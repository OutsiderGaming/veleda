mod common;

use common::{check_bounds, f, q, Rng};
use veleda_math::fixed::{self, Rounding::*, EXP_MAX, LN2, ONE};

const N: usize = 20_000;

#[test]
fn ln2_constant() {
    assert!((f(LN2) - core::f64::consts::LN_2).abs() < 1e-18);
}

#[test]
fn mul_and_div_exact_cases_and_rounding() {
    assert_eq!(fixed::mul(3 * ONE, ONE / 2, Down), Some(3 * ONE / 2));
    assert_eq!(fixed::div(3 * ONE, 2 * ONE, Down), Some(3 * ONE / 2));
    // 1/3 isn't exact: Up is one ulp above Down.
    let d = fixed::div(ONE, 3 * ONE, Down).unwrap();
    assert_eq!(fixed::div(ONE, 3 * ONE, Up), Some(d + 1));
    assert_eq!(fixed::mul(u128::MAX, 2 * ONE, Down), None);
    assert_eq!(fixed::div(ONE, 0, Down), None);
}

#[test]
fn mul_matches_f64_on_large_values() {
    let mut r = Rng::new(1);
    for _ in 0..N {
        let (a, b) = (r.log_range(1e-6, 1e9), r.log_range(1e-6, 1e9));
        let (lo, hi) = (fixed::mul(q(a), q(b), Down).unwrap(), fixed::mul(q(a), q(b), Up).unwrap());
        assert!(hi - lo <= 1);
        let exact = f(q(a)) * f(q(b));
        // Within 1e-12 relative, or within Q64.64 resolution for tiny products.
        assert!((f(lo) - exact).abs() < exact * 1e-12 + 1e-18, "mul({a}, {b}) = {}", f(lo));
    }
}

#[test]
fn div_matches_f64() {
    let mut r = Rng::new(2);
    for _ in 0..N {
        let (a, b) = (r.log_range(1e-6, 1e9), r.log_range(1e-3, 1e9));
        if a / b >= 1.8e19 {
            continue;
        }
        let v = fixed::div(q(a), q(b), Down).unwrap();
        let rel = (f(v) - a / b).abs() / (a / b);
        assert!(rel < 1e-12 || (f(v) - a / b).abs() < 1e-18, "div({a}, {b}) = {}", f(v));
    }
}

#[test]
fn exp_bounds() {
    let mut r = Rng::new(3);
    let mut inputs: Vec<f64> = (0..N).map(|_| r.range(0.0, 43.0)).collect();
    inputs.extend([0.0, 1e-12, 0.5, core::f64::consts::LN_2, 1.0, 10.0, 42.999]);
    for y in inputs {
        let down = fixed::exp(q(y), Down).unwrap();
        let up = fixed::exp(q(y), Up).unwrap();
        // Compare against the exact value of the Q64.64 input, not the f64 we started from.
        check_bounds("exp", y, f(q(y)).exp(), down, up);
    }
    assert_eq!(fixed::exp(EXP_MAX + 1, Up), None);
}

#[test]
fn exp_neg_bounds() {
    let mut r = Rng::new(4);
    let mut inputs: Vec<f64> = (0..N).map(|_| r.range(0.0, 60.0)).collect();
    inputs.extend([0.0, 1e-12, 0.5, 1.0, 44.0, 100.0]);
    for y in inputs {
        let down = fixed::exp_neg(q(y), Down);
        let up = fixed::exp_neg(q(y), Up);
        check_bounds("exp_neg", y, (-f(q(y))).exp(), down, up);
    }
}

#[test]
fn ln_bounds() {
    let mut r = Rng::new(5);
    let mut inputs: Vec<f64> = (0..N).map(|_| r.log_range(1.0, 1e18)).collect();
    inputs.extend([1.0, 1.0 + 1e-12, 1.5, 2.0, core::f64::consts::E, 1e6]);
    for x in inputs {
        let down = fixed::ln(q(x), Down).unwrap();
        let up = fixed::ln(q(x), Up).unwrap();
        check_bounds("ln", x, f(q(x)).ln(), down, up);
    }
    assert_eq!(fixed::ln(ONE - 1, Up), None);
}

#[test]
fn neg_ln_bounds() {
    let mut r = Rng::new(6);
    let mut inputs: Vec<f64> = (0..N).map(|_| r.log_range(1e-15, 1.0)).collect();
    inputs.extend([1.0, 1.0 - 1e-12, 0.5, 0.25, 1e-15]);
    for x in inputs {
        let down = fixed::neg_ln(q(x), Down).unwrap();
        let up = fixed::neg_ln(q(x), Up).unwrap();
        check_bounds("neg_ln", x, -f(q(x)).ln(), down, up);
    }
    assert_eq!(fixed::neg_ln(ONE + 1, Up), None);
    assert_eq!(fixed::neg_ln(0, Up), None);
}
