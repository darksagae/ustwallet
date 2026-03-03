# UST Wallet - Season 1 Lock Event

90-day tiered staking for UST tokens on Solana with hourly email reward notifications.

## Architecture

- **On-chain**: Anchor (Rust) staking program on Solana
- **Frontend**: Next.js 16 + TypeScript + Tailwind CSS
- **Wallet**: Phantom via Solana wallet adapter
- **Notifications**: Hourly email via SMTP (cron-triggered API route)
- **Database**: PostgreSQL via Prisma

## Tier Schedule

| Staking Amount    | Daily Return | 90-Day Total |
|-------------------|-------------|-------------|
| 50 – 1,000       | 0.5%        | 45%         |
| 1,001 – 5,000    | 0.8%        | 72%         |
| 5,001 – 10,000   | 1.1%        | 99%         |
| 10,001 – 50,000  | 1.4%        | 126%        |
| 50,001+           | 1.8%        | 162%        |

## Setup

### Prerequisites

- Rust + Solana CLI (Agave 2.0+)
- Anchor CLI 0.30.1
- Node.js 22+
- PostgreSQL

### Build the Program

```bash
cargo-build-sbf --manifest-path programs/ust_staking/Cargo.toml
```

### Run Tests

```bash
# Start a local validator
solana-test-validator --gossip-port 18000 --rpc-port 18899 --faucet-port 19900 \
  --bpf-program 9ZcVkMmP4DGsgJZuN6GSUVNhyacvzQwFh1M8kAq15Cie target/deploy/ust_staking.so \
  --reset --quiet &

# Run the test suite
ANCHOR_PROVIDER_URL=http://localhost:18899 \
ANCHOR_WALLET=~/.config/solana/id.json \
NODE_OPTIONS="--no-experimental-strip-types" \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

### Run the Web App

```bash
cd app
cp .env.example .env.local   # edit with real values
npm install
npx prisma generate
npx prisma db push            # create database tables
npm run dev
```

### Hourly Notifications

The `/api/notifications/hourly` endpoint is protected by a `CRON_SECRET` bearer token. Trigger it hourly via any cron service:

```bash
curl -X POST https://your-app.com/api/notifications/hourly \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Project Structure

```
ustwallet/
├── programs/ust_staking/src/lib.rs   # Anchor staking program
├── tests/ust_staking.ts              # On-chain tests
├── target/idl/ust_staking.json       # Program IDL
├── app/
│   ├── src/
│   │   ├── app/page.tsx              # Main staking dashboard
│   │   ├── app/api/subscribe/        # Email subscription endpoint
│   │   ├── app/api/notifications/    # Hourly reward notification
│   │   ├── components/               # React components
│   │   └── lib/                      # Solana client, constants, email
│   └── prisma/schema.prisma          # Database schema
├── Anchor.toml
└── Cargo.toml
```
