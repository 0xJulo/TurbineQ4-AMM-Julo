pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2cCvsHgXPFvRLgbbrPbRyVQBoqGhR9D8iEjJj4D9jmRg");

#[program]
pub mod amm {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>, 
        seed: u64, 
        fee: u16, 
        authority: Option<Pubkey>, 
    ) -> Result<()> {
        ctx.accounts.create_pool(seed, fee, authority, &ctx.bumps)
    }
}