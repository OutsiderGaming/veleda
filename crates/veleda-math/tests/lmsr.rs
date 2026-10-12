mod common;

use common::{f, q, Rng};
use veleda_math::lmsr::{range_cost, range_proceeds};
use veleda_math::ONE;

fn ref_cost(b: f64, p: f64, x: f64) -> f64 {
    b * (p * (x / b).exp_m1()).ln_1p()
}

fn ref_proceeds(b: f64, p: f64, x: f64) -> f64 {
    -b * (p * (-x / b).exp_m1()).ln_1p()
}

/// One token base unit (6 decimals). Rounding margins must stay far below it.
const UNIT: f64 = 1e-6;

#[test]
fn spec_example_cost_and_cash_out() {
    // Design spec: 320 shares of a 6.1% window at b = 1,000 cost ~22.75; at 15% they sell for ~41.95.
    let cost = f(range_cost(q(1000.0), q(0.061), q(320.0)).unwrap());
    assert!((cost - 22.745).abs() < 0.001, "cost {cost}");
    let proceeds = f(range_proceeds(q(1000.0), q(0.15), q(320.0)).unwrap());
    assert!((proceeds - 41.945).abs() < 0.001, "proceeds {proceeds}");
}

#[test]
fn cost_rounds_up_and_proceeds_round_down() {
    let mut r = Rng::new(7);
    for _ in 0..20_000 {
        let b = r.log_range(10.0, 1e5);
        let p = r.log_range(1e-6, 0.999);
        let x = r.log_range(1e-3, 40.0 * b);
        let (bq, pq, xq) = (q(b), q(p), q(x));
        let (bf, pf, xf) = (f(bq), f(pq), f(xq));

        let cost = f(range_cost(bq, pq, xq).unwrap());
        let rc = ref_cost(bf, pf, xf);
        assert!(cost >= rc * (1.0 - 1e-14), "cost({b}, {p}, {x}) = {cost} < {rc}");
        assert!(cost - rc < UNIT / 100.0 + rc * 1e-12, "cost({b}, {p}, {x}) = {cost} far above {rc}");

        let proceeds = f(range_proceeds(bq, pq, xq).unwrap());
        let rp = ref_proceeds(bf, pf, xf);
        assert!(proceeds <= rp * (1.0 + 1e-14), "proceeds({b}, {p}, {x}) = {proceeds} > {rp}");
        assert!(rp - proceeds < UNIT / 100.0 + rp * 1e-12, "proceeds({b}, {p}, {x}) = {proceeds} far below {rp}");
    }
}

#[test]
fn buy_then_sell_never_profits() {
    // Buy x at p, then immediately sell x at the new price: rounding must leave the vault ahead.
    let mut r = Rng::new(8);
    for _ in 0..20_000 {
        let b = r.log_range(10.0, 1e5);
        let p = r.log_range(1e-6, 0.99);
        let x = r.log_range(1e-3, 40.0 * b);
        let k = (x / b).exp();
        // New price, rounded down as the program must before quoting a sale.
        // f64 can't hold it exactly, so use the formula that's accurate at this
        // size (direct when small, 1 − rest when near 1) and step down by more
        // than f64's error.
        let direct = p * k / (1.0 - p + p * k);
        let p_after = if direct < 0.5 {
            q(direct * (1.0 - 1e-14))
        } else {
            let rest = (1.0 - p) / (1.0 - p + p * k);
            ONE - q(rest * (1.0 + 1e-14)) - 1
        };
        let cost = range_cost(q(b), q(p), q(x)).unwrap();
        let proceeds = range_proceeds(q(b), p_after, q(x)).unwrap();
        assert!(proceeds <= cost, "b {b} p {p} x {x}: sold for {} > paid {}", f(proceeds), f(cost));
    }
}

#[test]
fn rejects_out_of_range_inputs() {
    assert_eq!(range_cost(q(100.0), q(1.0) + 1, q(1.0)), None);
    assert_eq!(range_cost(q(100.0), q(0.5), q(4400.0)), None); // x/b = 44 > EXP_MAX
    assert_eq!(range_cost(0, q(0.5), q(1.0)), None);
}
