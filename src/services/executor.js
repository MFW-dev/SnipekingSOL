import { VersionedTransaction } from "@solana/web3.js";
import { MINTS } from "../constants.js";
import { getSolBalance, getTokenBalance } from "../solana.js";

export class Executor {
  constructor({ config, connection, wallet, jupiter }) {
    this.config = config;
    this.connection = connection;
    this.wallet = wallet;
    this.jupiter = jupiter;
  }

  async buy(screened) {
    if (this.config.dryRun) {
      return {
        dryRun: true,
        signature: null,
        message: "dry run buy skipped before signing"
      };
    }
    this.requireWallet();
    await this.ensureSolReserve(screened.metrics.amountLamports);
    
    const swapResponse = await this.jupiter.buildSwapTransaction({
      quoteResponse: screened.quote,
      userPublicKey: this.wallet.publicKey
    });
    
    const signature = await this.signAndSend(swapResponse.swapTransaction);
    return { dryRun: false, signature, message: "buy sent and confirmed" };
  }

  async sell(position, reason) {
    if (this.config.dryRun) {
      return {
        dryRun: true,
        signature: null,
        message: `dry run sell skipped: ${reason}`
      };
    }
    this.requireWallet();
    
    const balance = await getTokenBalance(this.connection, this.wallet.publicKey, position.mint);
    
    // PERBAIKAN: Jika saldo sudah 0 (mungkin terjual manual), catat sebagai tertutup otomatis
    if (BigInt(balance.rawAmount) <= 0n) {
      return { 
        dryRun: false, 
        signature: "FORCE_CLOSED_ZERO_BALANCE", 
        quote: null, 
        message: `forced close due to zero balance (already sold?): ${reason}` 
      };
    }
    
    const quote = await this.jupiter.quote({
      inputMint: position.mint,
      outputMint: MINTS.SOL,
      amount: balance.rawAmount,
      slippageBps: this.config.trading.slippageBps
    });
    
    const swapResponse = await this.jupiter.buildSwapTransaction({
      quoteResponse: quote,
      userPublicKey: this.wallet.publicKey
    });
    
    const signature = await this.signAndSend(swapResponse.swapTransaction);
    return { dryRun: false, signature, quote, message: `sell sent and confirmed: ${reason}` };
  }

  async signAndSend(serializedTransaction) {
    const transaction = VersionedTransaction.deserialize(Buffer.from(serializedTransaction, "base64"));
    transaction.sign([this.wallet]);

    // 1. Kirim transaksi ke jaringan
    const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: this.config.trading.skipPreflight,
      maxRetries: this.config.trading.maxRetries
    });

    // 2. Ambil blockhash terbaru
    const latestBlockHash = await this.connection.getLatestBlockhash();

    // 3. Konfirmasi transaksi
    const confirmation = await this.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: signature
    }, "confirmed");

    // 4. Lemparkan error jika gagal di on-chain agar status tidak tercatat Open
    if (confirmation.value.err) {
      throw new Error(`Transaction failed to confirm: ${confirmation.value.err.toString()}`);
    }

    return signature;
  }

  async ensureSolReserve(spendLamports) {
    const balanceSol = await getSolBalance(this.connection, this.wallet.publicKey);
    const spendSol = spendLamports / 1_000_000_000;
    if (balanceSol - spendSol < this.config.risk.minSolReserve) {
      throw new Error(
        `insufficient SOL reserve: balance=${balanceSol.toFixed(6)}, spend=${spendSol.toFixed(6)}, reserve=${this.config.risk.minSolReserve}`
      );
    }
  }

  requireWallet() {
    if (!this.wallet) throw new Error("wallet is required for live execution");
  }
}