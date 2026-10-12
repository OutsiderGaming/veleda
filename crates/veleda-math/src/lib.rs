//! Veleda on-chain maths: Q64.64 fixed point in u128, exp/ln with guaranteed
//! rounding direction, LMSR range pricing and the segment tree of atom weights. No std, so the Anchor program
//! can use it directly. Tested against f64 here and against
//! `packages/reference` via shared vectors.

#![cfg_attr(not(test), no_std)]

pub mod fixed;
pub mod float;
pub mod engine;
pub mod lmsr;
pub mod tree;

pub use fixed::{Rounding, ONE};
