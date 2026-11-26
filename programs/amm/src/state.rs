use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    // Used to make each AMM unique
    pub seed: u64, 
    // Admin who can lock and unlock the pool.
    // Optional pubkey for this role.
    // None is no admin, nobody can freeze it
    pub authority: Option<Pubkey>,
    // Mints that can be used with has_one = mint_x later on
    pub mint_x: Pubkey, // Mint of the first token in the pool
    pub mint_y: Pubkey, // Mint of the second token in the pool
    // This is the transaction fee in basis points (1/10000)
    pub fee: u16, 
    // Fee for the protocol itself
    // A share of the swap fee going to a treasury
    pub protocol_fee: u16,
    // If something goes wrong, the authority has the ability to 
    // freeze the pool. 
    pub locked: bool,
    // Bumps for the config and lp account so that
    // they can be easily found later on. 
    // There are no vault bumps because the vaults are ATAs. Their addresses
    // are worked out by the Associated Token Program, not this program.
    pub config_bump: u8,
    pub lp_bump: u8,
    pub treasury_bump: u8,
}
