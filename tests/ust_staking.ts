import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

const POOL_SEED = Buffer.from("global_pool");
const VAULT_SEED = Buffer.from("vault");
const USER_STAKE_SEED = Buffer.from("user_stake");

const idlPath = path.join(__dirname, "..", "target", "idl", "ust_staking.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

describe("ust_staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as any, provider);
  const authority = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let authorityAta: PublicKey;
  let poolPda: PublicKey;
  let poolBump: number;
  let vaultPda: PublicKey;

  const user1 = Keypair.generate();
  let user1Ata: PublicKey;

  const user2 = Keypair.generate();
  let user2Ata: PublicKey;

  const DECIMALS = 0;
  const CAP = 5_000_000;
  const REWARD_FUND = 2_000_000;

  before(async () => {
    for (const kp of [user1, user2]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    mint = await createMint(
      provider.connection,
      (authority as any).payer,
      authority.publicKey,
      null,
      DECIMALS
    );

    [poolPda, poolBump] = PublicKey.findProgramAddressSync(
      [POOL_SEED, mint.toBuffer()],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, poolPda.toBuffer()],
      program.programId
    );

    authorityAta = await createAccount(
      provider.connection,
      (authority as any).payer,
      mint,
      authority.publicKey
    );
    await mintTo(
      provider.connection,
      (authority as any).payer,
      mint,
      authorityAta,
      authority.publicKey,
      REWARD_FUND + 100_000
    );

    user1Ata = await createAccount(
      provider.connection,
      (authority as any).payer,
      mint,
      user1.publicKey
    );
    await mintTo(
      provider.connection,
      (authority as any).payer,
      mint,
      user1Ata,
      authority.publicKey,
      100_000
    );

    user2Ata = await createAccount(
      provider.connection,
      (authority as any).payer,
      mint,
      user2.publicKey
    );
    await mintTo(
      provider.connection,
      (authority as any).payer,
      mint,
      user2Ata,
      authority.publicKey,
      60_000
    );
  });

  it("initializes the pool", async () => {
    await program.methods
      .initializePool(new BN(CAP))
      .accounts({
        globalPool: poolPda,
        vault: vaultPda,
        mint,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const pool = await (program.account as any).globalPool.fetch(poolPda);
    expect(pool.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(pool.totalStaked.toNumber()).to.equal(0);
    expect(pool.capTotalStaked.toNumber()).to.equal(CAP);
    expect(pool.paused).to.equal(false);
  });

  it("funds the reward pool", async () => {
    await program.methods
      .fundRewardPool(new BN(REWARD_FUND))
      .accounts({
        globalPool: poolPda,
        vault: vaultPda,
        funderAta: authorityAta,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const pool = await (program.account as any).globalPool.fetch(poolPda);
    expect(pool.rewardPoolMax.toNumber()).to.equal(REWARD_FUND);
  });

  it("stakes 500 UST in Bronze tier (0.5% daily)", async () => {
    const amount = 500;
    const [userStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, poolPda.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .stake(new BN(amount))
      .accounts({
        globalPool: poolPda,
        vault: vaultPda,
        userStake: userStakePda,
        userAta: user1Ata,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();

    const stake = await (program.account as any).userStakeAccount.fetch(userStakePda);
    expect(stake.amountStaked.toNumber()).to.equal(amount);
    expect(stake.tierBps).to.equal(50);
    expect(stake.claimed).to.equal(false);
    expect(stake.pendingReward.toNumber()).to.equal(225);

    const pool = await (program.account as any).globalPool.fetch(poolPda);
    expect(pool.totalStaked.toNumber()).to.equal(amount);
    expect(pool.rewardPoolReserved.toNumber()).to.equal(225);
  });

  it("stakes 55000 UST in Diamond tier (1.8% daily)", async () => {
    const amount = 55_000;
    const [userStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, poolPda.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .stake(new BN(amount))
      .accounts({
        globalPool: poolPda,
        vault: vaultPda,
        userStake: userStakePda,
        userAta: user2Ata,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    const stake = await (program.account as any).userStakeAccount.fetch(userStakePda);
    expect(stake.tierBps).to.equal(180);
    expect(stake.pendingReward.toNumber()).to.equal(89100);

    const pool = await (program.account as any).globalPool.fetch(poolPda);
    expect(pool.totalStaked.toNumber()).to.equal(500 + 55_000);
    expect(pool.rewardPoolReserved.toNumber()).to.equal(225 + 89100);
  });

  it("rejects stake below minimum (49 UST)", async () => {
    const badUser = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      badUser.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const badAta = await createAccount(
      provider.connection,
      (authority as any).payer,
      mint,
      badUser.publicKey
    );
    await mintTo(
      provider.connection,
      (authority as any).payer,
      mint,
      badAta,
      authority.publicKey,
      49
    );

    const [userStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, poolPda.toBuffer(), badUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .stake(new BN(49))
        .accounts({
          globalPool: poolPda,
          vault: vaultPda,
          userStake: userStakePda,
          userAta: badAta,
          user: badUser.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([badUser])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidAmount");
    }
  });

  it("rejects early unstake", async () => {
    const [userStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, poolPda.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .unstakeAndClaim()
        .accounts({
          globalPool: poolPda,
          vault: vaultPda,
          userStake: userStakePda,
          userAta: user1Ata,
          user: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("PrematureUnstake");
    }
  });

  it("admin can pause and unpause", async () => {
    await program.methods
      .setPause(true)
      .accounts({
        globalPool: poolPda,
        authority: authority.publicKey,
      })
      .rpc();

    let pool = await (program.account as any).globalPool.fetch(poolPda);
    expect(pool.paused).to.equal(true);

    await program.methods
      .setPause(false)
      .accounts({
        globalPool: poolPda,
        authority: authority.publicKey,
      })
      .rpc();

    pool = await (program.account as any).globalPool.fetch(poolPda);
    expect(pool.paused).to.equal(false);
  });

  it("rejects stake when pool is paused", async () => {
    await program.methods
      .setPause(true)
      .accounts({
        globalPool: poolPda,
        authority: authority.publicKey,
      })
      .rpc();

    const pauseUser = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      pauseUser.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
    const pauseAta = await createAccount(
      provider.connection,
      (authority as any).payer,
      mint,
      pauseUser.publicKey
    );
    await mintTo(
      provider.connection,
      (authority as any).payer,
      mint,
      pauseAta,
      authority.publicKey,
      100
    );

    const [userStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, poolPda.toBuffer(), pauseUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .stake(new BN(100))
        .accounts({
          globalPool: poolPda,
          vault: vaultPda,
          userStake: userStakePda,
          userAta: pauseAta,
          user: pauseUser.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([pauseUser])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("Paused");
    }

    await program.methods
      .setPause(false)
      .accounts({
        globalPool: poolPda,
        authority: authority.publicKey,
      })
      .rpc();
  });

  it("rejects unauthorized admin actions", async () => {
    try {
      await program.methods
        .setPause(true)
        .accounts({
          globalPool: poolPda,
          authority: user1.publicKey,
        })
        .signers([user1])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("Unauthorized");
    }
  });
});
