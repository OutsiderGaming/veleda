use anchor_lang::prelude::*;
use veleda_math::engine;

#[error_code]
pub enum VeledaError {
    #[msg("Range is empty, out of bounds, or the share amount is invalid")]
    BadRange,
    #[msg("Range starts inside the locked zone")]
    Locked,
    #[msg("Range includes pruned atoms")]
    Pruned,
    #[msg("Market is resolved")]
    NotOpen,
    #[msg("Trade is larger than 30 × b shares; split it")]
    TooLarge,
    #[msg("Price moved past the slippage limit")]
    Slippage,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Market balance would not cover the largest payout")]
    Insolvent,
    #[msg("Market account has the wrong size or layout")]
    BadAccount,
    #[msg("Invalid market parameters")]
    BadParams,
    #[msg("Invalid opening prices: check end price, floor and shape")]
    BadPrior,
    #[msg("Position holds fewer shares than that")]
    NotEnoughShares,
    #[msg("Only demo markets can move their clock")]
    NotDemo,
    #[msg("The clock can only move forward")]
    ClockBackwards,
}

pub fn engine_error(e: engine::Error) -> Error {
    match e {
        engine::Error::BadRange => error!(VeledaError::BadRange),
        engine::Error::Locked => error!(VeledaError::Locked),
        engine::Error::Pruned => error!(VeledaError::Pruned),
        engine::Error::NotOpen => error!(VeledaError::NotOpen),
        engine::Error::TooLarge => error!(VeledaError::TooLarge),
        engine::Error::Slippage => error!(VeledaError::Slippage),
        engine::Error::Overflow => error!(VeledaError::Overflow),
        engine::Error::Insolvent => error!(VeledaError::Insolvent),
    }
}
