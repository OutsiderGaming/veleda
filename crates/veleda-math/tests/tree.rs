mod common;

use common::{f, q, Rng};
use veleda_math::fixed::{self, Rounding::*, ONE};
use veleda_math::tree::{storage_len, Tree, MAX_TRADE_EXPONENT, RESCALE_AT};

fn storage(n: usize) -> (Vec<u128>, Vec<u128>) {
    let (s, l) = storage_len(n);
    (vec![0; s], vec![0; l])
}

/// Plain f64 array doing the same operations, kept normalised to sum 1.
/// `.1` tracks each leaf's net exponent (q/b) so sells can only undo buys, as on a real market.
struct Model(Vec<f64>, Vec<f64>);

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

fn random_prior(r: &mut Rng, n: usize) -> Vec<f64> {
    let raw: Vec<f64> = (0..n).map(|_| r.log_range(1e-4, 1.0)).collect();
    let total: f64 = raw.iter().sum();
    raw.iter().map(|w| w / total).collect()
}

#[test]
fn rejects_wrong_storage_and_bad_ranges() {
    let (mut s, mut l) = storage(10);
    assert!(Tree::new(&mut s[..5], &mut l, 10).is_none());
    let mut t = Tree::new(&mut s, &mut l, 10).unwrap();
    assert!(t.init(&[ONE; 9]).is_none());
    t.init(&[ONE; 10]).unwrap();
    assert_eq!(t.range_sum(3, 2), None);
    assert_eq!(t.range_sum(0, 10), None);
    assert_eq!(t.range_mul(5, 10, ONE), None);
}

#[test]
fn init_builds_sums() {
    let (mut s, mut l) = storage(5);
    let mut t = Tree::new(&mut s, &mut l, 5).unwrap();
    t.init(&[ONE, 2 * ONE, 3 * ONE, 4 * ONE, 5 * ONE]).unwrap();
    assert_eq!(t.root(), 15 * ONE);
    assert_eq!(t.range_sum(1, 3), Some(9 * ONE));
    assert_eq!(t.leaf(4), Some(5 * ONE));
}

#[test]
fn pruning_zeroes_leaves_and_renormalises() {
    let (mut s, mut l) = storage(4);
    let mut t = Tree::new(&mut s, &mut l, 4).unwrap();
    t.init(&[ONE / 4; 4]).unwrap();
    t.range_mul(0, 1, 0).unwrap();
    assert_eq!(t.leaf(0), Some(0));
    assert_eq!(t.range_sum(0, 1), Some(0));
    let p = f(t.range_price(2, 2, Down).unwrap());
    assert!((p - 0.5).abs() < 1e-15, "survivor price {p}");
}

#[test]
fn random_operations_match_f64_model() {
    // Weights are fixed point with a step of 2^-64 (root kept in [1, 2^16)), and
    // every operation rounds up by a few ulps. A leaf's error, as a fraction of
    // its weight, is then bounded by roughly
    //     steps · ULPS_PER_STEP · 2^-64 / (smallest share of the root it has had)
    // because error added while the leaf was small grows with it afterwards
    // (plus 1e-11 for the f64 model's own drift). A share is weight ÷ root, so
    // it also carries the root's error: the share-weighted average of every
    // leaf's bound. Check that for every leaf after every step.
    const ULPS_PER_STEP: f64 = 8.0;
    let ulp = 1.0 / 18_446_744_073_709_551_616.0;
    let mut r = Rng::new(9);
    let mut worst = 0f64; // worst error as a fraction of its bound
    for &n in &[1usize, 2, 3, 7, 169, 732, 1000] {
        let prior = random_prior(&mut r, n);
        let (mut s, mut l) = storage(n);
        let mut t = Tree::new(&mut s, &mut l, n).unwrap();
        t.init(&prior.iter().map(|&p| q(p)).collect::<Vec<_>>()).unwrap();
        let mut m = Model(prior.iter().map(|&p| f(q(p))).collect(), vec![0.0; n]);
        let mut min_share = m.0.clone();
        let mut edge = 0usize;

        for step in 1..=1500usize {
            let a = edge + (r.unit() * (n - edge) as f64) as usize;
            let b = a + (r.unit() * (n - a) as f64) as usize;
            let roll = r.unit();
            if roll < 0.95 {
                // A trade: buy (×e^y) or, if every leaf holds enough, sell (×e^(−y)); y up to 3.
                let yf = r.range(0.0, 3.0);
                let y = q(yf);
                let can_sell = m.1[a..=b].iter().all(|&e| e >= yf);
                let factor = if can_sell && r.unit() < 0.4 { fixed::exp_neg(y, Up) } else { fixed::exp(y, Up).unwrap() };
                let sign = if factor < ONE { -1.0 } else { 1.0 };
                for e in &mut m.1[a..=b] {
                    *e += sign * yf;
                }
                t.range_mul(a, b, factor).unwrap();
                m.mul(a, b, f(factor));
            } else if edge + 1 < n {
                // Prune the next few atoms (never the last one, like the end atom).
                let to = (edge + 1 + (r.unit() * 5.0) as usize).min(n - 1);
                t.range_mul(edge, to - 1, 0).unwrap();
                m.mul(edge, to - 1, 0.0);
                edge = to;
            }
            let root = t.root();
            assert!((ONE..RESCALE_AT).contains(&root), "n {n} step {step}: root {} out of range", f(root));

            let rel_bound: Vec<f64> = (0..n)
                .map(|i| {
                    min_share[i] = min_share[i].min(m.0[i]);
                    if i < edge { 0.0 } else { 1e-11 + step as f64 * ULPS_PER_STEP * ulp / min_share[i] }
                })
                .collect();
            let root_bound: f64 = (0..n).map(|i| m.0[i] * rel_bound[i]).sum();
            for i in 0..n {
                let want = m.0[i];
                let got = f(t.leaf(i).unwrap()) / f(root);
                if i < edge {
                    assert_eq!(got, 0.0, "n {n} step {step}: pruned leaf {i} not zero");
                    continue;
                }
                let bound = want * (rel_bound[i] + root_bound);
                let err = (got - want).abs();
                worst = worst.max(err / bound);
                assert!(err <= bound, "n {n} step {step} leaf {i}: {got:e} vs model {want:e}, bound {bound:e}");
            }
            // Range prices go through the internal nodes rather than single leaves.
            let lo = edge + (r.unit() * (n - edge) as f64) as usize;
            let got = f(t.range_price(lo, n - 1, Down).unwrap());
            let want = m.price(lo, n - 1);
            let bound: f64 = (lo..n).map(|i| m.0[i] * (rel_bound[i] + root_bound)).sum::<f64>() + 1e-18;
            assert!((got - want).abs() <= bound, "n {n} step {step}: price [{lo}, {}] = {got:e}, model {want:e}", n - 1);
        }
    }
    println!("worst error as a fraction of its bound: {worst:.3}");
}

#[test]
fn largest_trades_rescale_without_overflow() {
    let n = 732;
    let (mut s, mut l) = storage(n);
    let mut t = Tree::new(&mut s, &mut l, n).unwrap();
    t.init(&vec![ONE / n as u128; n]).unwrap();
    let factor = fixed::exp(MAX_TRADE_EXPONENT, Up).unwrap();
    // Hammer one atom, then the whole range, then the end atom, with the biggest allowed factor.
    for i in 0..50 {
        let (a, b) = match i % 3 { 0 => (5, 5), 1 => (0, n - 1), _ => (n - 1, n - 1) };
        t.range_mul(a, b, factor).unwrap();
        assert!(t.root() < RESCALE_AT);
    }
    let p = f(t.range_price(5, 5, Down).unwrap()) + f(t.range_price(n - 1, n - 1, Down).unwrap());
    assert!(p > 0.999 && p <= 1.0 + 1e-12, "two hammered atoms hold ~all the mass: {p}");
}

#[test]
fn rounding_up_keeps_root_at_least_the_leaf_sum() {
    let mut r = Rng::new(10);
    let n = 169;
    let prior = random_prior(&mut r, n);
    let (mut s, mut l) = storage(n);
    let mut t = Tree::new(&mut s, &mut l, n).unwrap();
    t.init(&prior.iter().map(|&p| q(p)).collect::<Vec<_>>()).unwrap();
    for _ in 0..2000 {
        let a = (r.unit() * n as f64) as usize;
        let b = a + (r.unit() * (n - a) as f64) as usize;
        t.range_mul(a, b, fixed::exp(q(r.range(0.0, 2.0)), Up).unwrap()).unwrap();
    }
    let leaves: u128 = (0..n).map(|i| t.leaf(i).unwrap()).sum();
    let root = t.root();
    // Node sums and leaf sums agree to within a few ulps per level.
    assert!(root.abs_diff(leaves) <= 64 * n as u128, "root {root} vs leaves {leaves}");
}
