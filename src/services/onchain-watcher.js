import { EventEmitter } from "node:events";
import { PublicKey } from "@solana/web3.js";
import { MINTS, POOL_LOG_PATTERNS } from "../constants.js";
import { log, errorToJson } from "../logger.js";

const IGNORED_MINTS = new Set(Object.values(MINTS));

function hasPoolLikeLog(logMessages = []) {
  return logMessages.some((line) => POOL_LOG_PATTERNS.some((pattern) => pattern.test(line)));
}

function tokenMintsFromTransaction(tx) {
  const balances = [
    ...(tx?.meta?.preTokenBalances || []),
    ...(tx?.meta?.postTokenBalances || [])
  ];
  const mints = new Set();
  for (const balance of balances) {
    if (balance?.mint && !IGNORED_MINTS.has(balance.mint)) mints.add(balance.mint);
  }
  return [...mints];
}

export class OnchainWatcher extends EventEmitter {
  constructor({ connection, config, state }) {
    super();
    this.connection = connection;
    this.config = config;
    this.state = state;
    this.subscriptions = [];
    this.activeParses = 0;
    this.parseTimestamps = [];
    this.lastBudgetLogAt = 0;
  }

  async start() {
    if (!this.config.watch.enabled) return;

    for (const [label, programId] of Object.entries(this.config.watch.programIds)) {
      const publicKey = new PublicKey(programId);
      
      const subId = this.connection.onLogs(publicKey, (event) => {
        if (event.err || !hasPoolLikeLog(event.logs)) return;
        
        this.processSignatureWithinBudget(event.signature, label).catch((error) => {
          log("watcher", "failed to process log event", errorToJson(error), "warn");
        });
      }, this.config.commitment);
      
      this.subscriptions.push(subId);
      log("watcher", `watching ${label}`, { programId });
    }
  }

  async bootstrapRecentSignatures() {
    const limit = this.config.watch.bootstrapRecentSignatures;
    if (!limit) return;

    for (const [label, programId] of Object.entries(this.config.watch.programIds)) {
      const signatures = await this.connection.getSignaturesForAddress(new PublicKey(programId), { limit });
      for (const item of signatures) {
        await this.processSignatureWithinBudget(item.signature, label);
      }
    }
  }

  async processSignatureWithinBudget(signature, source) {
    if (!this.reserveParseSlot(signature)) return;

    try {
      await this.processSignature(signature, source);
    } finally {
      this.activeParses -= 1;
    }
  }

  reserveParseSlot(signature) {
    if (this.state.seenSignatures[signature]) return false;

    const now = Date.now();
    this.parseTimestamps = this.parseTimestamps.filter((ts) => now - ts < 60_000);

    if (this.activeParses >= this.config.watch.maxConcurrentParses) {
      this.logBudgetSkip("parse concurrency limit reached");
      return false;
    }

    if (this.parseTimestamps.length >= this.config.watch.maxParsedTransactionsPerMinute) {
      this.logBudgetSkip("parse budget reached; skipping extra log signatures");
      return false;
    }

    this.activeParses += 1;
    this.parseTimestamps.push(now);
    return true;
  }

  logBudgetSkip(message) {
    const now = Date.now();
    if (now - this.lastBudgetLogAt < 60_000) return;
    this.lastBudgetLogAt = now;
    log("watcher", message, {
      maxParsedTransactionsPerMinute: this.config.watch.maxParsedTransactionsPerMinute,
      maxConcurrentParses: this.config.watch.maxConcurrentParses
    }, "warn");
  }

  async processSignature(signature, source) {
    if (this.state.seenSignatures[signature]) return;
    this.state.seenSignatures[signature] = new Date().toISOString();

    const tx = await this.connection.getParsedTransaction(signature, {
      commitment: this.config.commitment,
      maxSupportedTransactionVersion: 0
    });
    
    if (!tx || !hasPoolLikeLog(tx.meta?.logMessages || [])) return;

    for (const mint of tokenMintsFromTransaction(tx)) {
      this.emit("candidate", {
        source: `onchain:${source}`,
        signature,
        mint,
        slot: tx.slot,
        seenAt: new Date().toISOString()
      });
    }
  }

  async stop() {
    await Promise.all(this.subscriptions.map((id) => this.connection.removeOnLogsListener(id)));
    this.subscriptions = [];
  }
}