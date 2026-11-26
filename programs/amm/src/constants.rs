use anchor_lang::prelude::*;

// Every PDA within the program derives need a seed
#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const LP_SEED: &[u8] = b"lp";

// The maximum fee for the pools

#[constant]
pub const MAX_FEE_BPS: u16 = 10_000; // 100%

#[constant]
pub const TREASURY_SEED: &[u8] = b"treasury";