use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint, 
    TokenAccount, 
    TokenInterface, 
    TransferChecked, 
    transfer_checked,
    MintTo,
    mint_to,
};
use anchor_spl::associated_token::AssociatedToken;
use constant_product_curve::ConstantProduct;

use crate::state::Config;
use crate::constants::*;
use crate::error::AmmError;

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

impl<'info> Deposit<'info> {
    pub fn deposit(&mut self, amount: u64, max_x: u64, max_y: u64) -> Result<()> {

        // Perform your first failure checks
        // Is the pool currently locked?
        // Is the amount of the deposit greater than zero?
        // If any of these fail then the transaction should fail.

        require!(!self.config.locked, AmmError::PoolLocked);
        require!(amount > 0, AmmError::InvalidAmount);

        // Check to see if this deposit is the first deposit.
        // This is a boolean value that is used later.

        let is_first_deposit = self.lp_mint.supply == 0;

        // If it is the first deposit, then the user can deposit any amount of x and y.
        // If it is not the first deposit, then the user can deposit any amount of x and y
        // that is less than or equal to the amount of x and y that would be deposited if the
        // user had deposited the full amount of lp tokens.

        let (amount_x, amount_y) = if is_first_deposit {
            (max_x, max_y)
        } else {
            let amounts = ConstantProduct::xy_deposit_amounts_from_l(
                self.vault_x.amount,
                self.vault_y.amount,
                self.lp_mint.supply,
                amount,
                6,
            ).map_err(|_| error!(AmmError::CurveError))?;

            require!(amounts.x <= max_x && amounts.y <= max_y, AmmError::SlippageExceeded);

            (amounts.x, amounts.y)
        };

        self.deposit_tokens(true, amount_x)?;
        self.deposit_tokens(false, amount_y)?;

        self.mint_lp_tokens(amount)?;

        Ok(())
    }

    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64 ) -> Result<()> {
        
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

        let cpi_accounts = TransferChecked {
            from,
            to,
            mint,
            authority: self.user.to_account_info(),
        };

        let cpi_program = self.token_program.key();

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        transfer_checked(cpi_ctx, amount, decimals)?;
        
        Ok(())
    }

    pub fn mint_lp_tokens(&self, amount: u64) -> Result<()> {

        // Get the PDA details

        let seed_bytes = self.config.seed.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            CONFIG_SEED,
            seed_bytes.as_ref(),
            &[self.config.config_bump],
        ]];

        // Create the CPI accounts

        let cpi_accounts = MintTo {
            mint: self.lp_mint.to_account_info(),
            to: self.user_lp.to_account_info(),
            authority: self.config.to_account_info(),
        };

        let cpi_program = self.token_program.key();

        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        mint_to(cpi_ctx, amount)?;

        Ok(())
    }
}