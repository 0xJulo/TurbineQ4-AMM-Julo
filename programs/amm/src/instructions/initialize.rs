use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::Config;
use crate::constants::*;
use crate::error::AmmError;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {

    // This is the account that creates the pool
    // and pays for the initialization.

    #[account(mut)]
    pub initializer: Signer<'info>,

    // This is setting up the config for the pool with its rules.
    // It creates a PDA so each pool is unique, and below the lp_mint
    // is a mint in which the Config is the authority that can mint new tokens.

    #[account(
        init,
        payer = initializer,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        seeds = [CONFIG_SEED, seed.to_le_bytes().as_ref()],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_x: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_y: InterfaceAccount<'info, Mint>,

    // Creating the vaults for the pools resereves
    // ATAs are PDAs themselves, there is no need for seeds and a bump
    // Config is the authority so only the program can move tokens out.

    #[account(
        init,
        payer = initializer,
        associated_token::mint = mint_x,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub vault_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = initializer,
        associated_token::mint = mint_y,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub vault_y: InterfaceAccount<'info, TokenAccount>,

    // This is creating the mint for the LP token. It does not create tokens
    // but sets up the rules that the LP tokens will follow when they are created.
    // This will be created when a new pool is created, and it is a PDA with the
    // config as the authority so only the program can mint new tokens.
    // The mint:: lines below are the rules for the LP token that match
    // how a new mint is created.

    #[account(
        init,
        payer = initializer,
        seeds = [LP_SEED, config.key().as_ref()],
        bump,
        mint::authority = config.key(),
        mint::decimals = 6,
        mint::token_program = token_program,
    )]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    // Needed because only the ATA program can the create the vault ATAs

    pub associated_token_program: Program<'info, AssociatedToken>,

    // Needed because only the token program can set up mint and token accounts

    pub token_program: Interface<'info, TokenInterface>,

    // Needed because only the system program can create new accounts

    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn create_pool(
        &mut self, 
        seed: u64, 
        fee: u16, 
        authority: Option<Pubkey>, 
        bumps: &InitializeBumps
    ) -> Result<()> {
        require!(fee <= MAX_FEE_BPS, AmmError::InvalidFee);

        self.config.set_inner(Config{
            seed,
            authority,
            mint_x: self.mint_x.key(),
            mint_y: self.mint_y.key(),
            fee,
            locked: false,
            config_bump: bumps.config,
            lp_bump: bumps.lp_mint,
        });

        Ok(())
    }
}
