use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub seed: u64, // Used to make each AMM unique

    // Admin who can lock and unlock the pool.
    // Optional pubkey for this role.
    // None is no admin, nobody can freeze it

    pub authority: Option<Pubkey>,

    // Mints that can be used with has_one = mint_x later on

    pub mint_x: Pubkey, // Mint of the first token in the pool
    pub mint_y: Pubkey, // Mint of the second token in the pool
    
    pub fee: u16, // Fee in basis points (1/10000)

    // If something goes wrong, the authority has the ability to 
    // freeze the pool. 

    pub locked: bool,

    // Bumps for the config and lp account so that
    // they can be easily found later on. 
    // There are no vault bumps because the vaults are ATAs. Their addresses
    // are worked out by the Associated Token Program, not this program.

    pub config_bump: u8,
    pub lp_bump: u8,
    

}
