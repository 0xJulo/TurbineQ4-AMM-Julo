use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, transfer_checked, TransferChecked};
use constant_product_curve::{ConstantProduct, LiquidityPair};

use crate::state::Config;
use crate::constants::*;
use crate::error::*;

#[derive(Accounts)]
pub struct Swap<'info> {
    // The user making the swap. They sign the transaction.
    #[account(mut)]
    pub user: Signer<'info>,
    // The pool being traded against. Not mutable: a swap only reads it.
    // The seeds and saved bump prove it is a real Config from this program.
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
    // The pool's vaults. Mutable because one balance goes up and the other
    // goes down. Config does not store the vault addresses, so there is no
    // has_one for them: these checks prove each one is config's ATA for the mint.
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
    // The user's own token accounts: one is paid from, the other is paid into.
    // Which is which depends on is_x, and that is only known when the
    // instruction runs. The accounts are checked before that, so BOTH use
    // init_if_needed: the user may not yet hold the token they are receiving.
    // The user pays the rent if one has to be created.
    // No separate mut: init_if_needed already makes the account mutable.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_x,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_y,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_y: Box<InterfaceAccount<'info, TokenAccount>>,
    // The pool's LP mint. Its supply counts how many LP tokens exist, which
    // the curve library needs as an input. Not mutable: a swap does not add
    // or remove liquidity, so no LP tokens are minted or burned.
    #[account(
        seeds = [LP_SEED, config.key().as_ref()],
        bump = config.lp_bump,
    )]
    pub lp_mint: InterfaceAccount<'info, Mint>,
    // Needed because only the ATA program can create the user's token accounts.
    pub associated_token_program: Program<'info, AssociatedToken>,
    // Needed for the transfers, and to set up any new token account.
    pub token_program: Interface<'info, TokenInterface>,
    // Needed because only the System Program can create new accounts.
    pub system_program: Program<'info, System>,
}

impl<'info> Swap<'info> {
    pub fn swap(&mut self, is_x: bool, amount: u64, min: u64) -> Result<()> {
        // Check that the pools locked setting is not enabled
        require!(!self.config.locked, AmmError::PoolLocked);
        // Check that the amount coming into the function is greater than zero
        require!(amount > 0, AmmError::InvalidAmount);

        // This function takes a snapshot of the curve, so that the swap
        // maths can be worked out on the next step. 
        // Add in the map error here because it returns a box and this box
        // needs to be opened.
        let mut curve = ConstantProduct::init(
            self.vault_x.amount,
            self.vault_y.amount,
            self.lp_mint.supply,
            self.config.fee,
            None,
        ).map_err(|_| AmmError::CurveError)?;
        // Pick the direction to see which token is being swapped in.
        let direction = match is_x {
            true => LiquidityPair::X,
            false => LiquidityPair::Y,
        };
        // Work out the swap, how much the user pays in and how much they get back.
        // No tokens move yet, this is only the maths.
        let result = curve.swap(
            direction,
            amount,
            min,
        ).map_err(|_| AmmError::CurveError)?;
        // Call the function below to deposit the tokens
        self.deposit_tokens(is_x, result.deposit)?;
        // Call the function below to withdraw the tokens
        // You are adding ! so that it is the opposite of the token going in.
        self.withdraw_tokens(!is_x, result.withdraw)?;


        Ok(())
    }

    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to, mint, decimals) = match is_x {
            true => (
                self.user_x.to_account_info(),
                self.vault_x.to_account_info(),
                self.mint_x.to_account_info(),
                self.mint_x.decimals,
            ),
            false => (
                self.user_y.to_account_info(),
                self.vault_y.to_account_info(),
                self.mint_y.to_account_info(),
                self.mint_y.decimals,
            ),
        };
        let cpi_account = TransferChecked {
            from, 
            to, 
            mint,
            authority: self.user.to_account_info(),
        };
        let cpi_program = self.token_program.key();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_account);
        transfer_checked(cpi_ctx, amount, decimals)?;

        Ok(())
    }

    pub fn withdraw_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to, mint, decimals) = match is_x {
            true => (
                self.vault_x.to_account_info(),
                self.user_x.to_account_info(),
                self.mint_x.to_account_info(),
                self.mint_x.decimals,
            ),
            false => (
                self.vault_y.to_account_info(),
                self.user_y.to_account_info(),
                self.mint_y.to_account_info(),
                self.mint_y.decimals,
            ),
        };
        let cpi_account = TransferChecked {
            from, 
            to, 
            mint,
            authority: self.config.to_account_info(),
        };
        let cpi_program = self.token_program.key();
        // The tokens are coming out of the vault, it is a PDA
        // so we need to use the seeds in order to sign the transaction.
        let seed_bytes = self.config.seed.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            CONFIG_SEED,
            seed_bytes.as_ref(),
            &[self.config.config_bump],
        ]];
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_account, signer_seeds);
        transfer_checked(cpi_ctx, amount, decimals)?;

        Ok(())
    }
}
