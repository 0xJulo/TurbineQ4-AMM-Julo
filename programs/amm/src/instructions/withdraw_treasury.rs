use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::state::Config;
use crate::constants::*;
use crate::error::AmmError;

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    // The pool's admin, who signs. Only they may take fees out of the treasury.
    // Mutable because they pay the rent if one of their token accounts
    // has to be created (see authority_x and authority_y below).
    #[account(mut)]
    pub authority: Signer<'info>,
    // The pool's settings. Not mutable: this instruction only reads it.
    // The seeds and saved bump prove it is a real Config.
    // The has_one checks make sure the mints passed in are this pool's mints.
    #[account(
        seeds = [CONFIG_SEED, config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
        has_one = mint_x,
        has_one = mint_y,
    )]
    pub config: Account<'info, Config>,
    // The pool's two tokens. They already exist, so they are only read.
    #[account(
        mint::token_program = token_program,
    )]
    pub mint_x: InterfaceAccount<'info, Mint>,
    #[account(
        mint::token_program = token_program,
    )]
    pub mint_y: InterfaceAccount<'info, Mint>,
    // The treasury PDA. It owns the treasury's token accounts, so the
    // program has to sign as it to move the fees out.
    #[account(
        seeds = [TREASURY_SEED, config.key().as_ref()],
        bump = config.treasury_bump,
    )]
    pub treasury: SystemAccount<'info>,
    // Where the fees are now: the treasury's token accounts.
    // Mutable because their balances go down.
    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_y: Box<InterfaceAccount<'info, TokenAccount>>,
    // Where the fees are going: the authority's own token accounts.
    // init_if_needed because the authority may not hold these tokens yet.
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint_x,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint_y,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_y: Box<InterfaceAccount<'info, TokenAccount>>,
    // Needed because only the ATA program can create the authority's token accounts.
    pub associated_token_program: Program<'info, AssociatedToken>,
    // Needed for the transfers, and to set up any new token account.
    pub token_program: Interface<'info, TokenInterface>,
    // Needed because only the System Program can create new accounts.
    pub system_program: Program<'info, System>,
}

impl<'info> WithdrawTreasury<'info> {
    pub fn withdraw_treasury(&mut self) -> Result<()> {
        // Only the pool's admin may take fees out of the treasury.
        // This is the same check as in lock and unlock: the admin saved in
        // config must be some key, and that key must be the signer's.
        // A pool with no admin (None) fails this too.
        require!(self.config.authority == Some(self.authority.key()), AmmError::InvalidAuthority);

        // Pay out everything the treasury has collected, in both tokens.
        // true = token X, false = token Y.
        self.pay_out(true)?;
        self.pay_out(false)?;

        Ok(())
    }

    // Moves ALL of one token from the treasury's token account to the
    // authority's token account.
    // It is the same idea as withdraw_tokens in swap.rs. There, config owned
    // the vault, so the program signed with config's seeds. Here, the
    // treasury PDA owns the token account, so the program signs with the
    // treasury's seeds: the constant, config's address, and the saved bump.
    pub fn pay_out(&mut self, is_x: bool) -> Result<()> {
        // Pick the X accounts or the Y accounts.
        // amount is the treasury account's whole balance.
        let (from, to, mint, decimals, amount) = match is_x {
            true => (
                self.treasury_x.to_account_info(),
                self.authority_x.to_account_info(),
                self.mint_x.to_account_info(),
                self.mint_x.decimals,
                self.treasury_x.amount,
            ),
            false => (
                self.treasury_y.to_account_info(),
                self.authority_y.to_account_info(),
                self.mint_y.to_account_info(),
                self.mint_y.decimals,
                self.treasury_y.amount,
            ),
        };

        // The treasury's seeds, matching the seeds in the Accounts struct.
        // config_key is stored in a variable first so it lives long enough
        // for the seeds list to borrow it.
        let config_key = self.config.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            TREASURY_SEED,
            config_key.as_ref(),
            &[self.config.treasury_bump],
        ]];

        let cpi_accounts = TransferChecked {
            from,
            to,
            mint,
            authority: self.treasury.to_account_info(),
        };
        let cpi_program = self.token_program.key();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        transfer_checked(cpi_ctx, amount, decimals)?;

        Ok(())
    }
}
