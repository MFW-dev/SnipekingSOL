import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export function createConnection(config) {
  return new Connection(config.rpcUrl, {
    commitment: config.commitment,
    wsEndpoint: config.wsUrl || undefined
  });
}

export function loadWallet(config) {
  if (!config.walletPrivateKey) return null;
  const raw = config.walletPrivateKey.trim();
  const secret = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : bs58.decode(raw);
  return Keypair.fromSecretKey(secret);
}

export async function getSolBalance(connection, publicKey) {
  const lamports = await connection.getBalance(new PublicKey(publicKey));
  return lamports / LAMPORTS_PER_SOL;
}

export async function getTokenBalance(connection, owner, mint) {
  const ownerKey = new PublicKey(owner);
  const mintKey = new PublicKey(mint);
  const response = await connection.getParsedTokenAccountsByOwner(ownerKey, { mint: mintKey });
  let rawAmount = 0n;
  let decimals = 0;

  for (const account of response.value) {
    const amount = account.account.data.parsed.info.tokenAmount;
    rawAmount += BigInt(amount.amount);
    decimals = amount.decimals;
  }

  return {
    rawAmount: rawAmount.toString(),
    uiAmount: Number(rawAmount) / 10 ** decimals,
    decimals
  };
}

export function lamportsFromSol(sol) {
  return Math.floor(Number(sol) * LAMPORTS_PER_SOL);
}

export function shortKey(key) {
  const value = String(key);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
