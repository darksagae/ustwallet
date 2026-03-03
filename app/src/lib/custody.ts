import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import { UST_MINT, RPC_URL } from "./constants";
import { prisma } from "./prisma";

const ENCRYPTION_KEY = process.env.CUSTODY_ENCRYPTION_KEY || "";
const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error(
      "CUSTODY_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)"
    );
  }
  return Buffer.from(ENCRYPTION_KEY, "hex");
}

function encrypt(data: Uint8Array): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decrypt(encrypted: string, iv: string, authTag: string): Uint8Array {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);
  return new Uint8Array(decrypted);
}

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function loadMainWallet(): Keypair {
  const secret = process.env.CUSTODY_WALLET_SECRET;
  if (!secret) {
    throw new Error("CUSTODY_WALLET_SECRET env var is required");
  }
  return Keypair.fromSecretKey(bs58.decode(secret));
}

export async function createChildWallet(
  stakeId: string
): Promise<{ publicKey: PublicKey }> {
  const childKeypair = Keypair.generate();
  const { encrypted, iv, authTag } = encrypt(childKeypair.secretKey);

  await prisma.childWallet.create({
    data: {
      stakeId,
      publicKey: childKeypair.publicKey.toBase58(),
      encryptedSecretKey: encrypted,
      iv,
      authTag,
    },
  });

  const connection = getConnection();
  const mainWallet = loadMainWallet();
  const childAta = getAssociatedTokenAddressSync(
    UST_MINT,
    childKeypair.publicKey
  );
  const ataInfo = await connection.getAccountInfo(childAta);
  if (!ataInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        mainWallet.publicKey,
        childAta,
        childKeypair.publicKey,
        UST_MINT
      )
    );
    await sendAndConfirmTransaction(connection, tx, [mainWallet]);
  }

  return { publicKey: childKeypair.publicKey };
}

function loadChildKeypair(
  encrypted: string,
  iv: string,
  authTag: string
): Keypair {
  const secretKey = decrypt(encrypted, iv, authTag);
  return Keypair.fromSecretKey(secretKey);
}

export async function transferToChild(
  childPubkey: PublicKey,
  amount: bigint
): Promise<string> {
  const connection = getConnection();
  const mainWallet = loadMainWallet();
  const mainAta = getAssociatedTokenAddressSync(UST_MINT, mainWallet.publicKey);
  const childAta = getAssociatedTokenAddressSync(UST_MINT, childPubkey);

  const tx = new Transaction().add(
    createTransferInstruction(
      mainAta,
      childAta,
      mainWallet.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  return sendAndConfirmTransaction(connection, tx, [mainWallet]);
}

export async function transferFromChildToUser(
  childEncrypted: string,
  childIv: string,
  childAuthTag: string,
  userWallet: PublicKey,
  amount: bigint
): Promise<string> {
  const connection = getConnection();
  const mainWallet = loadMainWallet();
  const childKeypair = loadChildKeypair(childEncrypted, childIv, childAuthTag);
  const childAta = getAssociatedTokenAddressSync(
    UST_MINT,
    childKeypair.publicKey
  );
  const userAta = getAssociatedTokenAddressSync(UST_MINT, userWallet);

  const tx = new Transaction();

  const userAtaInfo = await connection.getAccountInfo(userAta);
  if (!userAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        mainWallet.publicKey,
        userAta,
        userWallet,
        UST_MINT
      )
    );
  }

  tx.add(
    createTransferInstruction(
      childAta,
      userAta,
      childKeypair.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return sendAndConfirmTransaction(connection, tx, [mainWallet, childKeypair]);
}

/** Transfer UST from a child wallet to an arbitrary destination (e.g. user withdraw address or new child). Creates destination ATA if needed. */
export async function transferFromChildToAddress(
  childEncrypted: string,
  childIv: string,
  childAuthTag: string,
  destinationPubkey: PublicKey,
  amount: bigint
): Promise<string> {
  const connection = getConnection();
  const mainWallet = loadMainWallet();
  const childKeypair = loadChildKeypair(childEncrypted, childIv, childAuthTag);
  const childAta = getAssociatedTokenAddressSync(
    UST_MINT,
    childKeypair.publicKey
  );
  const destinationAta = getAssociatedTokenAddressSync(
    UST_MINT,
    destinationPubkey
  );

  const tx = new Transaction();

  const destAtaInfo = await connection.getAccountInfo(destinationAta);
  if (!destAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        mainWallet.publicKey,
        destinationAta,
        destinationPubkey,
        UST_MINT
      )
    );
  }

  tx.add(
    createTransferInstruction(
      childAta,
      destinationAta,
      childKeypair.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return sendAndConfirmTransaction(connection, tx, [mainWallet, childKeypair]);
}

export async function transferFromMainToUser(
  userWallet: PublicKey,
  amount: bigint
): Promise<string> {
  const connection = getConnection();
  const mainWallet = loadMainWallet();
  const mainAta = getAssociatedTokenAddressSync(UST_MINT, mainWallet.publicKey);
  const userAta = getAssociatedTokenAddressSync(UST_MINT, userWallet);

  const tx = new Transaction();

  const userAtaInfo = await connection.getAccountInfo(userAta);
  if (!userAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        mainWallet.publicKey,
        userAta,
        userWallet,
        UST_MINT
      )
    );
  }

  tx.add(
    createTransferInstruction(
      mainAta,
      userAta,
      mainWallet.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return sendAndConfirmTransaction(connection, tx, [mainWallet]);
}

export async function getChildTokenBalance(
  childPubkey: PublicKey
): Promise<bigint> {
  const connection = getConnection();
  const childAta = getAssociatedTokenAddressSync(UST_MINT, childPubkey);
  try {
    const account = await getAccount(connection, childAta);
    return account.amount;
  } catch {
    return BigInt(0);
  }
}

export function getMainWalletPublicKey(): PublicKey {
  const pk = process.env.NEXT_PUBLIC_MAIN_WALLET;
  if (pk) return new PublicKey(pk);
  return loadMainWallet().publicKey;
}
