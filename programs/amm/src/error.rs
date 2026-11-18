use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {
    #[msg("Pool fee is too high")]
    InvalidFee,
}
