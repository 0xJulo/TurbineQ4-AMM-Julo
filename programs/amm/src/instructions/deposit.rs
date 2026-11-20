use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::associated_token::AssociatedToken;

use crate::state::Config;
use crate::constants::*;

// The accounts that will change in this instruction
// are the users token accounts, the mint accounts for each token
// the config itself, and the vault accounts for each token. 

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // The config account needs to have the seeds and bump that comes 
    // in from the created pool. These are already saved from config.
    // You also need to check that there are mints for x and y.

    #[account(
        seeds = [CONFIG_SEED, config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
        has_one = mint_x,
        has_one = mint_y,
    )]
    pub config: Account<'info, Config>,

    // The pool's two tokens. They already exist, so they are only read.
    // The has_one checks on config make sure they are this pool's mints.

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_x: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_y: InterfaceAccount<'info, Mint>,

    // The pool's vaults, where the deposited tokens go.
    // Mutable because their balances go up. The checks make sure these
    // really are config's ATAs, not someone else's token accounts.

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub vault_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub vault_y: Box<InterfaceAccount<'info, TokenAccount>>,

    // The user's own token accounts, where the deposited tokens come from.
    // Mutable because their balances go down. The user is the authority,
    // so only the user can sign to move tokens out of them.

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_y: Box<InterfaceAccount<'info, TokenAccount>>,

    // The pool's LP mint, created in initialize. Mutable because minting
    // LP tokens increases its supply. Checked with the saved lp_bump.

    #[account(
        mut,
        seeds = [LP_SEED, config.key().as_ref()],
        bump = config.lp_bump,
    )]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    // The user's token account for LP tokens, where the minted LP tokens go.
    // It may not exist on a first deposit, so init_if_needed creates it
    // (paid for by the user) and reuses it on later deposits.

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = lp_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_lp: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> Deposit<'info> {}