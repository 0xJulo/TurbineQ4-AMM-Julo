use anchor_lang::prelude::*;

use crate::state::Config;
use crate::constants::*;
use crate::error::AmmError;

#[derive(Accounts)]
pub struct Lock<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,
}

impl<'info> Lock<'info> {
    pub fn lock_pool(&mut self) -> Result<()> {
        require!(self.config.authority == Some(self.authority.key()), AmmError::InvalidAuthority);
        self.config.locked = true;

        Ok(())
    }
}