use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {
    #[msg("Pool fee is too high")]
    InvalidFee,
    #[msg("The pool is currently locked")]
    PoolLocked,
    #[msg("The amount must be greater than zero")]
    InvalidAmount,
    #[msg("The Curve calculation failed")]
    CurveError,
    #[msg("The slippage exceeded the allowed amount")]
    SlippageExceeded,
    #[msg("The authority is not the pool authority")]
    InvalidAuthority,
}
