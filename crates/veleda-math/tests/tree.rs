mod common;

use common::{f, q, Rng};
use veleda_math::fixed::{Rounding::*, ONE};
use veleda_math::float::Float;
use veleda_math::tree::{storage_len, Tree, MAX_TRADE_EXPONENT};

fn storage(n: usize) -> (Vec<u128>, Vec<u128>) {
    let (s, l) = storage_len(n);
    (vec![0; s], vec![0; l])
}

fn price(t: &mut Tree, l: usize, r: usize) -> f64 {
    f(t.range_price(l, r, Down).unwrap())
}

#[test]
fn float_arithmetic_matches_f64() {
    let mut r = Rng::new(12);
    for _ in 0..20_000 {
        let (a, b) = (r.log_range(1e-12, 1e12), r.log_range(1e-12, 1e12));
        let (fa, fb) = (Float::from_q64(q(a)).unwrap(), Float::from_q64(q(b)).unwrap());
        let (xa, xb) = (f(q(a)), f(q(b)));
        let one = Float::ONE;
        // Read results back through ratio-to-one where they fit in Q64.64 (resolution 5e-20).
        let sum = f(fa.add(fb).unwrap().ratio(one, Down).unwrap_or(u128::MAX));
        if xa + xb < 1e18 {
            assert!((sum - (xa + xb)).abs() <= (xa + xb) * 1e-15 + 1e-19, "{xa} + {xb} = {sum}");
        }
        let prod = fa.mul(fb).unwrap();
        if xa * xb < 1e18 && xa * xb > 1e-12 {
            let p = f(prod.ratio(one, Down).unwrap());
            assert!((p - xa * xb).abs() <= xa * xb * 1e-15 + 1e-19, "{xa} × {xb} = {p}");
        }
        let ratio = fa.ratio(fb, Down);
        if xa / xb < 1e18 && xa / xb > 1e-12 {
            let v = f(ratio.unwrap());
            assert!((v - xa / xb).abs() <= xa / xb * 1e-15 + 1e-19, "{xa} ÷ {xb} = {v}");
        }
    }
    assert!(Float::ZERO.add(Float::ZERO).unwrap().is_zero());
    assert!(Float::ONE.mul(Float::ZERO).unwrap().is_zero());
}

#[test]
fn exp_neg_keeps_relative_precision_when_tiny() {
    let mut r = Rng::new(13);
    for _ in 0..20_000 {
        let y = r.range(0.0, 60.0);
        let got = Float::exp_neg(q(y)).unwrap().as_f64();
        let want = (-f(q(y))).exp();
        assert!(got >= want * (1.0 - 1e-15) && got <= want * (1.0 + 1e-12), "e^-{y}: {got:e} vs {want:e}");
    }
}

#[test]
fn rejects_wrong_storage_and_bad_ranges() {
    let (mut s, mut l) = storage(10);
    assert!(Tree::new(&mut s[..5], &mut l, 10).is_none());
    let mut t = Tree::new(&mut s, &mut l, 10).unwrap();
    assert!(t.init(&[ONE; 9]).is_none());
    t.init(&[ONE; 10]).unwrap();
    assert_eq!(t.range_price(3, 2, Down), None);
    assert_eq!(t.range_price(0, 10, Down), None);
    assert_eq!(t.range_mul(5, 10, Float::ONE), None);
}

#[test]
fn init_builds_sums() {
    let (mut s, mut l) = storage(5);
    let mut t = Tree::new(&mut s, &mut l, 5).unwrap();
    t.init(&[ONE, 2 * ONE, 3 * ONE, 4 * ONE, 5 * ONE]).unwrap();
    assert!((price(&mut t, 1, 3) - 0.6).abs() < 1e-18);
    assert_eq!(t.range_price(0, 4, Down), Some(ONE));
}

#[test]
fn pruning_zeroes_leaves_and_renormalises() {
    let (mut s, mut l) = storage(4);
    let mut t = Tree::new(&mut s, &mut l, 4).unwrap();
    t.init(&[ONE / 4; 4]).unwrap();
    t.range_mul(0, 1, Float::ZERO).unwrap();
    assert_eq!(t.range_price(0, 1, Up), Some(0));
    assert!((price(&mut t, 2, 2) - 0.5).abs() < 1e-18);
}

/// Plain f64 array doing the same operations, kept normalised to sum 1.
struct Model(Vec<f64>);

impl Model {
    fn mul(&mut self, l: usize, r: usize, factor: f64) {
        for w in &mut self.0[l..=r] {
            *w *= factor;
        }
        let total: f64 = self.0.iter().sum();
        for w in &mut self.0 {
            *w /= total;
        }
    }
    fn price(&self, l: usize, r: usize) -> f64 {
        self.0[l..=r].iter().sum::<f64>() / self.0.iter().sum::<f64>()
    }
}

#[test]
fn random_operations_match_f64_model() {
    // With float weights, every price should match the model to ~1e-11
    // relative however small it gets (the f64 model's own drift dominates).
    // Sells here are unconstrained, so weights get squeezed far harder than
    // on a real market.
    let mut r = Rng::new(9);
    let mut worst = 0f64;
    for &n in &[1usize, 2, 3, 7, 169, 732, 1000] {
        let raw: Vec<f64> = (0..n).map(|_| r.log_range(1e-4, 1.0)).collect();
        let total: f64 = raw.iter().sum();
        let prior: Vec<u128> = raw.iter().map(|w| q(w / total)).collect();
        let (mut s, mut l) = storage(n);
        let mut t = Tree::new(&mut s, &mut l, n).unwrap();
        t.init(&prior).unwrap();
        let mut m = Model(prior.iter().map(|&p| f(p)).collect());
        let mut edge = 0usize;

        for step in 0..1500 {
            let a = edge + (r.unit() * (n - edge) as f64) as usize;
            let b = a + (r.unit() * (n - a) as f64) as usize;
            if r.unit() < 0.95 {
                let y = q(r.range(0.0, 3.0));
                let factor = if r.unit() < 0.6 { Float::exp(y).unwrap() } else { Float::exp_neg(y).unwrap() };
                t.range_mul(a, b, factor).unwrap();
                m.mul(a, b, factor.as_f64());
            } else if edge + 1 < n {
                let to = (edge + 1 + (r.unit() * 5.0) as usize).min(n - 1);
                t.range_mul(edge, to - 1, Float::ZERO).unwrap();
                m.mul(edge, to - 1, 0.0);
                edge = to;
            }
            for i in 0..n {
                let (got, want) = (price(&mut t, i, i), m.0[i]);
                if i < edge {
                    assert_eq!(got, 0.0, "n {n} step {step}: pruned leaf {i} not zero");
                    continue;
                }
                // Prices below Q64.64 resolution (5e-20) can only be checked absolutely.
                let err = (got - want).abs();
                if want > 1e-9 {
                    worst = worst.max(err / want);
                }
                assert!(err <= want * 1e-11 + 1e-19, "n {n} step {step} leaf {i}: {got:e} vs model {want:e}");
            }
            let lo = edge + (r.unit() * (n - edge) as f64) as usize;
            let (got, want) = (price(&mut t, lo, n - 1), m.price(lo, n - 1));
            assert!((got - want).abs() <= want * 1e-11 + 1e-19, "n {n} step {step}: price [{lo}, {}]", n - 1);
        }
    }
    println!("worst relative error on prices above 1e-9: {worst:.2e}");
}

#[test]
fn largest_trades_never_overflow() {
    let n = 732;
    let (mut s, mut l) = storage(n);
    let mut t = Tree::new(&mut s, &mut l, n).unwrap();
    t.init(&vec![ONE / n as u128; n]).unwrap();
    let up = Float::exp(MAX_TRADE_EXPONENT).unwrap();
    // Hammer one atom, the whole range and the end atom with the biggest allowed factor, many times over.
    for i in 0..300 {
        let (a, b) = match i % 3 { 0 => (5, 5), 1 => (0, n - 1), _ => (n - 1, n - 1) };
        t.range_mul(a, b, up).unwrap();
    }
    let both = price(&mut t, 5, 5) + price(&mut t, n - 1, n - 1);
    assert!(both > 0.999 && both <= 1.0 + 1e-15, "two hammered atoms hold ~all the mass: {both}");
    // Far below Q64.64 resolution, so read it rounded up: still nonzero.
    assert!(t.range_price(100, 100, Up).unwrap() > 0, "untouched atoms keep a tiny but nonzero price");
}
