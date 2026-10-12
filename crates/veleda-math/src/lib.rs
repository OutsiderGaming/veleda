//! Veleda on-chain maths: Q64.64 fixed point in u128, exp/ln, and the
//! segment tree with lazy range-multiply. No std-only dependencies, so the
//! Anchor program can use it directly. Tested against `packages/reference`.

#![cfg_attr(not(test), no_std)]

/// 1.0 in Q64.64.
pub const ONE: u128 = 1 << 64;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_is_two_to_the_64() {
        assert_eq!(ONE, 18_446_744_073_709_551_616);
    }
}
