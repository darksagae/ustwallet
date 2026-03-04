import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface RewardEmailParams {
  to: string;
  wallet: string;
  principal: string;
  accruedReward: string;
  tierLabel: string;
  dailyPct: string;
  unlockDate: string;
  daysRemaining: number;
  unlockProgressPct: number;
  marketPriceUsd: number;
  estimatedUsdValue: string;
  unsubscribeUrl: string;
  restakeCta?: boolean;
}

export async function sendRewardNotification(params: RewardEmailParams) {
  const {
    to,
    wallet,
    principal,
    accruedReward,
    tierLabel,
    dailyPct,
    unlockDate,
    daysRemaining,
    unlockProgressPct,
    marketPriceUsd,
    estimatedUsdValue,
    unsubscribeUrl,
    restakeCta = false,
  } = params;

  const shortWallet = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

  const restakeCtaHtml = restakeCta
    ? `<p style="color: #a78bfa; font-size: 14px; margin-top: 16px;">Consider restaking when you unlock to earn more rewards.</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f23; color: #e2e8f0; padding: 32px; border-radius: 12px;">
      <h1 style="color: #a78bfa; margin-bottom: 8px;">UST Wallet</h1>
      <h2 style="color: #c4b5fd; font-size: 18px; margin-top: 0;">Reward Update</h2>
      <hr style="border-color: #1e1b4b; margin: 24px 0;" />
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Wallet</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${shortWallet}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Staked Amount</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${principal} UST</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Rate</td>
          <td style="padding: 8px 0; text-align: right;">${dailyPct}% daily</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Progress to Unlock</td>
          <td style="padding: 8px 0; text-align: right;">${unlockProgressPct.toFixed(0)}%</td>
        </tr>
        <tr style="background: #1e1b4b; border-radius: 8px;">
          <td style="padding: 12px 8px; color: #a78bfa; font-weight: bold;">Accrued Reward</td>
          <td style="padding: 12px 8px; text-align: right; color: #34d399; font-size: 20px; font-weight: bold;">${accruedReward} UST</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Est. USD Value</td>
          <td style="padding: 8px 0; text-align: right;">${estimatedUsdValue} (UST ~$${marketPriceUsd.toFixed(4)})</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Unlock Date</td>
          <td style="padding: 8px 0; text-align: right;">${unlockDate}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Days Remaining</td>
          <td style="padding: 8px 0; text-align: right;">${daysRemaining}</td>
        </tr>
      </table>
      ${restakeCtaHtml}
      <hr style="border-color: #1e1b4b; margin: 24px 0;" />
      <p style="color: #64748b; font-size: 12px; text-align: center;">
        UST Wallet Season 1 Lock Event. <a href="${unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a>
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || "UST Wallet <noreply@ustwallet.io>",
    to,
    subject: `UST Wallet: You've earned ${accruedReward} UST so far`,
    html,
  });

  return info.messageId;
}

export async function sendCreatorLowFundAlert(params: {
  to: string;
  usagePct: number;
  rewardPoolMax: string;
  rewardPoolReserved: string;
}) {
  const { to, usagePct, rewardPoolMax, rewardPoolReserved } = params;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f23; color: #e2e8f0; padding: 32px; border-radius: 12px;">
      <h1 style="color: #f59e0b; margin-bottom: 8px;">UST Wallet</h1>
      <h2 style="color: #fbbf24; font-size: 18px; margin-top: 0;">Reward Pool Alert</h2>
      <hr style="border-color: #1e1b4b; margin: 24px 0;" />
      <p style="color: #e2e8f0;">Reward pool usage has reached <strong>${usagePct.toFixed(0)}%</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Pool Max</td>
          <td style="padding: 8px 0; text-align: right;">${rewardPoolMax} UST</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Reserved</td>
          <td style="padding: 8px 0; text-align: right;">${rewardPoolReserved} UST</td>
        </tr>
      </table>
      <p style="color: #94a3b8; font-size: 14px; margin-top: 16px;">Consider adding more funds to support additional staking.</p>
      <hr style="border-color: #1e1b4b; margin: 24px 0;" />
      <p style="color: #64748b; font-size: 12px; text-align: center;">UST Wallet Season 1</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || "UST Wallet <noreply@ustwallet.io>",
    to,
    subject: `UST Wallet: Reward pool at ${usagePct.toFixed(0)}% — add funds`,
    html,
  });

  return info.messageId;
}

export async function sendWithdrawalRequestedEmail(params: {
  to: string;
  wallet: string;
  destination: string;
  amountTokens: string;
  stakeId: string;
}) {
  const { to, wallet, destination, amountTokens, stakeId } = params;
  const shortWallet = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  const shortDest = `${destination.slice(0, 4)}...${destination.slice(-4)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f23; color: #e2e8f0; padding: 32px; border-radius: 12px;">
      <h1 style="color: #a78bfa; margin-bottom: 8px;">UST Wallet</h1>
      <h2 style="color: #c4b5fd; font-size: 18px; margin-top: 0;">Withdrawal requested</h2>
      <hr style="border-color: #1e1b4b; margin: 24px 0;" />
      <p style="color: #e2e8f0;">A user has requested a stake withdrawal (90-day lock complete).</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Stake ID</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${stakeId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Wallet</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${shortWallet}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Destination</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${shortDest}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Amount (principal + rewards)</td>
          <td style="padding: 8px 0; text-align: right;">${amountTokens} UST</td>
        </tr>
      </table>
      <p style="color: #94a3b8; font-size: 14px; margin-top: 16px;">
        Please send UST from the pool wallet to the destination above, then mark this request as approved.
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || "UST Wallet <noreply@ustwallet.io>",
    to,
    subject: `UST Wallet: Withdrawal requested (${amountTokens} UST)`,
    html,
  });

  return info.messageId;
}

export async function sendReferralPayoutRequestedEmail(params: {
  to: string;
  wallet: string;
  amountTokens: string;
  amountUsd: string;
}) {
  const { to, wallet, amountTokens, amountUsd } = params;
  const shortWallet = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f23; color: #e2e8f0; padding: 32px; border-radius: 12px;">
      <h1 style="color: #a78bfa; margin-bottom: 8px;">UST Wallet</h1>
      <h2 style="color: #c4b5fd; font-size: 18px; margin-top: 0;">Referral claim requested</h2>
      <hr style="border-color: #1e1b4b; margin: 24px 0;" />
      <p style="color: #e2e8f0;">A user has requested a referral payout.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Wallet</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${shortWallet}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Amount</td>
          <td style="padding: 8px 0; text-align: right;">${amountTokens} UST (~$${amountUsd})</td>
        </tr>
      </table>
      <p style="color: #94a3b8; font-size: 14px; margin-top: 16px;">
        Please send the payout from the pool wallet and then mark this request as approved in your admin flow.
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || "UST Wallet <noreply@ustwallet.io>",
    to,
    subject: `UST Wallet: Referral claim requested (${amountTokens} UST)`,
    html,
  });

  return info.messageId;
}
