//! Opening prices from a preset.
//!
//! A preset is small enough to fit in one instruction, whatever the number of
//! atoms: an explicit "not by end date" price, a per-atom floor, and a shape
//! for the timed atoms given as a few control points joined by straight
//! lines. Every timed atom gets the floor plus its share of what's left:
//!
//!   price_i = floor + (1 − end − atoms · floor) · shape_i / Σ shape
//!
//! so "not by end date" opens at exactly `end` and no atom opens below the
//! floor. No points means flat.

use anchor_lang::prelude::*;
use veleda_math::fixed::ONE;

/// Prices in the preset are parts per million.
pub const PPM: u128 = 1_000_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ShapePoint {
    pub atom: u32,
    pub weight: u32,
}

/// Opening prices (Q64.64) for `atoms` timed atoms plus "not by end date".
/// `None` if the preset is invalid or any price would be zero.
pub fn opening_prices(atoms: u32, end_ppm: u32, floor_ppm: u32, shape: &[ShapePoint]) -> Option<Vec<u128>> {
    let n = atoms as usize;
    let end = end_ppm as u128 * ONE / PPM;
    let floor = floor_ppm as u128 * ONE / PPM;
    let rest = ONE.checked_sub(end)?.checked_sub(floor.checked_mul(n as u128)?)?;
    if end == 0 || n == 0 || !shape.windows(2).all(|w| w[0].atom < w[1].atom) || shape.last().is_some_and(|p| p.atom >= atoms) {
        return None;
    }

    let mut prices = Vec::with_capacity(n + 1);
    let mut total: u64 = 0;
    for i in 0..atoms {
        let s = shape_at(shape, i);
        total += s as u64;
        prices.push(s as u128);
    }
    if rest > 0 && total == 0 {
        return None;
    }
    // One division, then a multiply per atom: u128 division is slow on-chain.
    // Rounding the unit down leaves "not by end date" a hair above `end`.
    let unit = if rest > 0 { rest / total as u128 } else { 0 };
    for p in &mut prices {
        // unit < 2^64 and each shape value < 2^32, so this can't overflow;
        // wrapping_mul skips the overflow-checked u128 multiply, which is slow on-chain.
        *p = floor + unit.wrapping_mul(*p);
    }
    prices.push(end);
    prices.iter().all(|&p| p > 0).then_some(prices)
}

/// Shape value at atom `i`: linear between control points, held flat beyond the first and last.
fn shape_at(points: &[ShapePoint], i: u32) -> u32 {
    let Some(first) = points.first() else { return 1 };
    if i <= first.atom {
        return first.weight;
    }
    for w in points.windows(2) {
        let (a, b) = (w[0], w[1]);
        if i <= b.atom {
            // Unsigned arithmetic only: signed division is slow on-chain.
            let t = (i - a.atom) as u64;
            let span = (b.atom - a.atom) as u64;
            return if b.weight >= a.weight {
                a.weight + ((b.weight - a.weight) as u64 * t / span) as u32
            } else {
                a.weight - ((a.weight - b.weight) as u64 * t / span) as u32
            };
        }
    }
    points[points.len() - 1].weight
}

#[cfg(test)]
mod tests {
    use super::*;

    fn as_f64(v: u128) -> f64 {
        v as f64 / ONE as f64
    }

    #[test]
    fn flat() {
        let p = opening_prices(168, 10_000, 0, &[]).unwrap();
        assert_eq!(p.len(), 169);
        assert!((as_f64(p[168]) - 0.01).abs() < 1e-12);
        assert!((as_f64(p[0]) - 0.99 / 168.0).abs() < 1e-12);
        assert!(p[..168].iter().all(|&x| x == p[0]));
    }

    #[test]
    fn shaped_with_floor() {
        let shape = [ShapePoint { atom: 180, weight: 0 }, ShapePoint { atom: 730, weight: 100 }, ShapePoint { atom: 1095, weight: 80 }];
        let p = opening_prices(1096, 650_000, 100, &shape).unwrap();
        let sum: f64 = p.iter().map(|&x| as_f64(x)).sum();
        assert!((sum - 1.0).abs() < 1e-9);
        assert!((as_f64(p[1096]) - 0.65).abs() < 1e-12);
        assert!((as_f64(p[0]) - 0.0001).abs() < 1e-12);
        assert_eq!(p[0], p[180]);
        assert!(p[730] > p[1095] && p[1095] > p[400] && p[400] > p[180]);
    }

    #[test]
    fn rejects_bad_presets() {
        assert!(opening_prices(10, 0, 0, &[]).is_none()); // "not by end date" must be positive
        assert!(opening_prices(10, 500_000, 60_000, &[]).is_none()); // floors exceed the remaining mass
        assert!(opening_prices(10, 500_000, 0, &[ShapePoint { atom: 10, weight: 1 }]).is_none()); // point past the end
        assert!(opening_prices(10, 500_000, 0, &[ShapePoint { atom: 3, weight: 1 }, ShapePoint { atom: 3, weight: 2 }]).is_none());
        assert!(opening_prices(10, 500_000, 0, &[ShapePoint { atom: 0, weight: 0 }]).is_none()); // all-zero shape, no floor
        assert!(opening_prices(10, 500_000, 0, &[ShapePoint { atom: 0, weight: 0 }, ShapePoint { atom: 9, weight: 5 }]).is_none()); // atom 0 at zero
    }
}
