# Devnet Testing with Faucet SOL

## Quick Start

### 1. Get Faucet SOL

**Option A: Solana CLI**
```bash
solana config set --url devnet
solana airdrop 2
solana balance
```

**Option B: Web Faucet**
- Visit https://faucet.solana.com
- Select **Devnet**
- Paste your wallet address (or connect Phantom)
- Request airdrop

**Option C: Script (when RPC not rate-limited)**
```bash
npm run devnet-test
```

### 2. Run the App

```bash
cd app && npm run dev
```

Open http://localhost:3000

### 3. Connect Phantom

- Switch Phantom to **Devnet** (Settings → Developer Settings → Change Network)
- Connect wallet
- Ensure you have devnet SOL for tx fees

### 4. Test Flows

**Stake UST** (requires pool + UST mint on devnet):
- Deploy program to devnet: `anchor deploy --provider.cluster devnet`
- Initialize pool and fund reward pool (see program setup)
- Set `NEXT_PUBLIC_UST_MINT` to your devnet UST mint
- Stake 50+ UST

**Stake with SOL** (requires Raydium SOL/UST pool on devnet):
- Set `NEXT_PUBLIC_RAYDIUM_SOL_UST_POOL_ID` to a valid devnet pool ID
- Enter SOL amount, review quote, submit
- Single transaction: swap SOL→UST + stake

### 5. Verify Transactions

- Check Solana Explorer (Devnet): https://explorer.solana.com/?cluster=devnet
- Paste transaction signature to verify success

## Anchor Integration Tests (Local Validator)

For program logic verification without devnet:

```bash
anchor test
```

Uses a local validator (faucet built-in), runs full test suite.
