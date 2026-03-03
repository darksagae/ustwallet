use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("9ZcVkMmP4DGsgJZuN6GSUVNhyacvzQwFh1M8kAq15Cie");

pub const LOCK_DURATION: i64 = 90 * 24 * 60 * 60; // 90 days in seconds
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const POOL_SEED: &[u8] = b"global_pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const USER_STAKE_SEED: &[u8] = b"user_stake";

#[program]
pub mod ust_staking {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        cap_total_staked: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.global_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.mint = ctx.accounts.mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.start_time = Clock::get()?.unix_timestamp;
        pool.end_time = pool.start_time + (4 * 30 * 24 * 60 * 60); // ~4 months
        pool.total_staked = 0;
        pool.reward_pool_max = 0;
        pool.reward_pool_reserved = 0;
        pool.cap_total_staked = cap_total_staked;
        pool.paused = false;
        pool.bump = ctx.bumps.global_pool;
        pool.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn fund_reward_pool(ctx: Context<FundRewardPool>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::InvalidAmount);

        let pool = &mut ctx.accounts.global_pool;
        require!(
            ctx.accounts.authority.key() == pool.authority,
            StakingError::Unauthorized
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.funder_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        pool.reward_pool_max = pool
            .reward_pool_max
            .checked_add(amount)
            .ok_or(StakingError::Overflow)?;

        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.global_pool;
        require!(!pool.paused, StakingError::Paused);

        let now = Clock::get()?.unix_timestamp;
        require!(now < pool.end_time, StakingError::CampaignClosed);
        require!(amount >= 50, StakingError::InvalidAmount);

        let new_total = pool
            .total_staked
            .checked_add(amount)
            .ok_or(StakingError::Overflow)?;
        require!(
            new_total <= pool.cap_total_staked,
            StakingError::CapExceeded
        );

        let tier_daily_bps = get_tier_bps(amount)?;
        let reward = compute_reward(amount, tier_daily_bps)?;

        let new_reserved = pool
            .reward_pool_reserved
            .checked_add(reward)
            .ok_or(StakingError::Overflow)?;
        require!(
            new_reserved <= pool.reward_pool_max,
            StakingError::InsufficientRewardPool
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        pool.total_staked = new_total;
        pool.reward_pool_reserved = new_reserved;

        let user_stake = &mut ctx.accounts.user_stake;
        user_stake.owner = ctx.accounts.user.key();
        user_stake.amount_staked = amount;
        user_stake.start_time = now;
        user_stake.unlock_time = now + LOCK_DURATION;
        user_stake.claimed = false;
        user_stake.tier_bps = tier_daily_bps;
        user_stake.pending_reward = reward;
        user_stake.bump = ctx.bumps.user_stake;

        Ok(())
    }

    pub fn unstake_and_claim(ctx: Context<UnstakeAndClaim>) -> Result<()> {
        let user_stake = &ctx.accounts.user_stake;
        require!(!user_stake.claimed, StakingError::AlreadyClaimed);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= user_stake.unlock_time, StakingError::PrematureUnstake);

        let payout = user_stake
            .amount_staked
            .checked_add(user_stake.pending_reward)
            .ok_or(StakingError::Overflow)?;

        let pool = &ctx.accounts.global_pool;
        let pool_key = pool.key();
        let seeds: &[&[u8]] = &[VAULT_SEED, pool_key.as_ref(), &[pool.vault_bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
        )?;

        let user_stake = &mut ctx.accounts.user_stake;
        user_stake.claimed = true;

        let pool = &mut ctx.accounts.global_pool;
        pool.total_staked = pool
            .total_staked
            .checked_sub(user_stake.amount_staked)
            .ok_or(StakingError::Overflow)?;
        pool.reward_pool_reserved = pool
            .reward_pool_reserved
            .checked_sub(user_stake.pending_reward)
            .ok_or(StakingError::Overflow)?;

        Ok(())
    }

    pub fn set_pause(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        let pool = &mut ctx.accounts.global_pool;
        require!(
            ctx.accounts.authority.key() == pool.authority,
            StakingError::Unauthorized
        );
        pool.paused = paused;
        Ok(())
    }
}

pub fn get_tier_bps(amount: u64) -> Result<u16> {
    if amount >= 50_001 {
        Ok(180) // 1.8%
    } else if amount >= 10_001 {
        Ok(140) // 1.4%
    } else if amount >= 5_001 {
        Ok(110) // 1.1%
    } else if amount >= 1_001 {
        Ok(80) // 0.8%
    } else if amount >= 50 {
        Ok(50) // 0.5%
    } else {
        err!(StakingError::InvalidAmount)
    }
}

pub fn compute_reward(amount: u64, daily_bps: u16) -> Result<u64> {
    // reward = amount * daily_bps / 10000 * 90
    let reward = (amount as u128)
        .checked_mul(daily_bps as u128)
        .ok_or(StakingError::Overflow)?
        .checked_mul(90)
        .ok_or(StakingError::Overflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(StakingError::Overflow)?;
    u64::try_from(reward).map_err(|_| StakingError::Overflow.into())
}

// ── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalPool::INIT_SPACE,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump,
    )]
    pub global_pool: Account<'info, GlobalPool>,

    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = vault,
        seeds = [VAULT_SEED, global_pool.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct FundRewardPool<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, global_pool.mint.as_ref()],
        bump = global_pool.bump,
    )]
    pub global_pool: Account<'info, GlobalPool>,

    #[account(
        mut,
        address = global_pool.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = funder_ata.mint == global_pool.mint,
    )]
    pub funder_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, global_pool.mint.as_ref()],
        bump = global_pool.bump,
    )]
    pub global_pool: Account<'info, GlobalPool>,

    #[account(
        mut,
        address = global_pool.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + UserStakeAccount::INIT_SPACE,
        seeds = [USER_STAKE_SEED, global_pool.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, UserStakeAccount>,

    #[account(
        mut,
        constraint = user_ata.mint == global_pool.mint,
        constraint = user_ata.owner == user.key(),
    )]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnstakeAndClaim<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, global_pool.mint.as_ref()],
        bump = global_pool.bump,
    )]
    pub global_pool: Account<'info, GlobalPool>,

    #[account(
        mut,
        address = global_pool.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [USER_STAKE_SEED, global_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key(),
    )]
    pub user_stake: Account<'info, UserStakeAccount>,

    #[account(
        mut,
        constraint = user_ata.mint == global_pool.mint,
        constraint = user_ata.owner == user.key(),
    )]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, global_pool.mint.as_ref()],
        bump = global_pool.bump,
    )]
    pub global_pool: Account<'info, GlobalPool>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// ── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct GlobalPool {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub total_staked: u64,
    pub reward_pool_max: u64,
    pub reward_pool_reserved: u64,
    pub cap_total_staked: u64,
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserStakeAccount {
    pub owner: Pubkey,
    pub amount_staked: u64,
    pub start_time: i64,
    pub unlock_time: i64,
    pub claimed: bool,
    pub tier_bps: u16,
    pub pending_reward: u64,
    pub bump: u8,
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum StakingError {
    #[msg("Invalid staking amount")]
    InvalidAmount,
    #[msg("Campaign is closed")]
    CampaignClosed,
    #[msg("Insufficient reward pool to cover liability")]
    InsufficientRewardPool,
    #[msg("Cannot unstake before unlock time")]
    PrematureUnstake,
    #[msg("Rewards already claimed")]
    AlreadyClaimed,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Pool is paused")]
    Paused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Total staking cap exceeded")]
    CapExceeded,
}
