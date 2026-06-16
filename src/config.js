import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv"; // Pustaka standar untuk membaca .env
import { DEFAULT_WATCH_PROGRAMS, MINTS } from "./constants.js";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Memuat file .env menggunakan dotenv yang lebih tangguh terhadap berbagai edge-cases
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "on"].includes(String(value).toLowerCase());
}

const userConfig = readJsonIfExists(path.join(REPO_ROOT, "user-config.json"));
const risk = userConfig.risk || {};
const trading = userConfig.trading || userConfig.execution || {};
const strategy = userConfig.strategy || userConfig.screening || {};
const execution = userConfig.execution || {};
const portfolio = userConfig.portfolio || userConfig.management || {};
const watch = userConfig.watch || {};
const jupiter = userConfig.jupiter || {};
const dexscreener = userConfig.dexscreener || {};
const telegram = userConfig.telegram || {};

export const config = {
  dryRun: boolValue(firstDefined(process.env.DRY_RUN, userConfig.dryRun), true),
  rpcUrl: firstDefined(process.env.RPC_URL, userConfig.rpcUrl, "https://api.mainnet-beta.solana.com"),
  wsUrl: firstDefined(process.env.WSS_URL, process.env.WS_URL, userConfig.wsUrl, ""),
  commitment: firstDefined(process.env.COMMITMENT, userConfig.commitment, "confirmed"),
  walletPrivateKey: firstDefined(process.env.PRIVATE_KEY, process.env.WALLET_PRIVATE_KEY, userConfig.walletPrivateKey, ""),

  risk: {
    minUsdPerSnipe: numberValue(firstDefined(process.env.MIN_USD_PER_SNIPE, risk.minUsdPerSnipe), 0.1),
    maxUsdPerSnipe: numberValue(firstDefined(process.env.MAX_USD_PER_SNIPE, risk.maxUsdPerSnipe), 0.5),
    defaultUsdPerSnipe: numberValue(firstDefined(process.env.DEFAULT_USD_PER_SNIPE, risk.defaultUsdPerSnipe), 0.5),
    maxOpenPositions: numberValue(risk.maxOpenPositions, 2),
    minSolReserve: numberValue(risk.minSolReserve, 0.025),
    cooldownMinutesByMint: numberValue(risk.cooldownMinutesByMint, 180),
    maxDailyLossUsd: numberValue(risk.maxDailyLossUsd, 1)
  },

  trading: {
    inputMint: firstDefined(trading.inputMint, MINTS.SOL),
    buyAmountSol: numberValue(firstDefined(process.env.BUY_AMOUNT_SOL, trading.buyAmountSol), 0.02),
    slippageBps: numberValue(trading.slippageBps, 1500),
    priorityLevel: firstDefined(trading.priorityLevel, execution.priorityLevel, "veryHigh"),
    priorityFeeLamports: numberValue(
      firstDefined(trading.priorityFeeLamports, execution.maxPriorityFeeLamports),
      100000
    ),
    skipPreflight: boolValue(firstDefined(trading.skipPreflight, execution.skipPreflight), false),
    maxRetries: numberValue(firstDefined(trading.maxRetries, execution.maxRetries), 2)
  },

  strategy: {
    waitTimeMinutes: numberValue(strategy.waitTimeMinutes, 5),
    minVolumeUsd: numberValue(
      firstDefined(strategy.minVolumeUsd, strategy.minVolumeUSD, strategy.minVolume24hUsd),
      10000
    ),
    minVolume5mUsd: numberValue(strategy.minVolume5mUsd, 500),
    minVolume1hUsd: numberValue(strategy.minVolume1hUsd, 3000),
    minTxns5m: numberValue(strategy.minTxns5m, 20),
    minBuys5m: numberValue(strategy.minBuys5m, 12),
    minBuySellRatio5m: numberValue(strategy.minBuySellRatio5m, 1.2),
    minLiquidityUsd: numberValue(firstDefined(strategy.minLiquidityUsd, strategy.minLiquidityUSD), 5000),
    maxPriceImpactPct: numberValue(strategy.maxPriceImpactPct, 20),
    maxPairAgeMinutes: numberValue(strategy.maxPairAgeMinutes, 240)
  },

  portfolio: {
    takeProfitPercent: numberValue(firstDefined(portfolio.takeProfitPercent, portfolio.takeProfitPct), 50),
    stopLossPercent: numberValue(firstDefined(portfolio.stopLossPercent, Math.abs(Number(portfolio.stopLossPct || 20))), 20),
    trailingStopPercent: numberValue(firstDefined(portfolio.trailingStopPercent, portfolio.trailingStopPct), 12),
    maxHoldMinutes: numberValue(portfolio.maxHoldMinutes, 45),
    checkIntervalMs: numberValue(
      firstDefined(portfolio.checkIntervalMs, Number(portfolio.intervalSeconds || 15) * 1000),
      15000
    )
  },

  watch: {
    enabled: boolValue(firstDefined(process.env.WATCH_ENABLED, watch.enabled), false),
    bootstrapRecentSignatures: numberValue(watch.bootstrapRecentSignatures, 0),
    maxParsedTransactionsPerMinute: numberValue(watch.maxParsedTransactionsPerMinute, 12),
    maxConcurrentParses: numberValue(watch.maxConcurrentParses, 1),
    programIds: watch.programIds || DEFAULT_WATCH_PROGRAMS
  },

  jupiter: {
    baseUrl: firstDefined(jupiter.baseUrl, "https://lite-api.jup.ag"),
    apiKey: firstDefined(process.env.JUPITER_API_KEY, jupiter.apiKey, ""),
    timeoutMs: numberValue(jupiter.timeoutMs, 12000)
  },

  dexscreener: {
    baseUrl: firstDefined(dexscreener.baseUrl, "https://api.dexscreener.com"),
    timeoutMs: numberValue(dexscreener.timeoutMs, 12000)
  },

  telegram: {
    enabled: boolValue(firstDefined(process.env.TELEGRAM_ENABLED, telegram.enabled), true),
    botToken: firstDefined(process.env.TELEGRAM_BOT_TOKEN, telegram.botToken, ""),
    chatId: firstDefined(process.env.TELEGRAM_CHAT_ID, telegram.chatId, ""),
    pollIntervalMs: numberValue(telegram.pollIntervalMs, 5000)
  }
};

config.execution = {
  inputMint: config.trading.inputMint,
  slippageBps: config.trading.slippageBps,
  priorityLevel: config.trading.priorityLevel,
  maxPriorityFeeLamports: config.trading.priorityFeeLamports,
  skipPreflight: config.trading.skipPreflight,
  maxRetries: config.trading.maxRetries
};

config.management = {
  intervalSeconds: Math.max(1, Math.floor(config.portfolio.checkIntervalMs / 1000)),
  takeProfitPct: config.portfolio.takeProfitPercent,
  stopLossPct: -Math.abs(config.portfolio.stopLossPercent),
  trailingStopPct: config.portfolio.trailingStopPercent,
  maxHoldMinutes: config.portfolio.maxHoldMinutes
};

config.screening = {
  minLiquidityUsd: config.strategy.minLiquidityUsd,
  minVolumeUsd: config.strategy.minVolumeUsd,
  minVolume5mUsd: config.strategy.minVolume5mUsd,
  minVolume1hUsd: config.strategy.minVolume1hUsd,
  minTxns5m: config.strategy.minTxns5m,
  minBuys5m: config.strategy.minBuys5m,
  minBuySellRatio5m: config.strategy.minBuySellRatio5m,
  maxPriceImpactPct: config.strategy.maxPriceImpactPct,
  maxFirstPoolAgeMinutes: config.strategy.maxPairAgeMinutes
};

export function validateConfig() {
  const errors = [];
  if (config.risk.minUsdPerSnipe <= 0) errors.push("risk.minUsdPerSnipe must be greater than 0");
  if (config.risk.maxUsdPerSnipe < config.risk.minUsdPerSnipe) {
    errors.push("risk.maxUsdPerSnipe must be >= risk.minUsdPerSnipe");
  }
  if (config.trading.buyAmountSol <= 0) errors.push("trading.buyAmountSol must be greater than 0");
  if (config.strategy.waitTimeMinutes < 0) errors.push("strategy.waitTimeMinutes must be >= 0");
  if (config.strategy.minVolume5mUsd < 0) errors.push("strategy.minVolume5mUsd must be >= 0");
  if (config.strategy.minVolume1hUsd < 0) errors.push("strategy.minVolume1hUsd must be >= 0");
  if (config.strategy.minTxns5m < 0) errors.push("strategy.minTxns5m must be >= 0");
  if (config.strategy.minBuys5m < 0) errors.push("strategy.minBuys5m must be >= 0");
  if (config.strategy.minBuySellRatio5m < 0) errors.push("strategy.minBuySellRatio5m must be >= 0");
  if (!config.dryRun && !config.walletPrivateKey) {
    errors.push("PRIVATE_KEY or WALLET_PRIVATE_KEY is required when DRY_RUN=false");
  }
  if (!config.rpcUrl) errors.push("RPC_URL is required");
  if (config.watch.enabled && !config.wsUrl) errors.push("WSS_URL is required when watch.enabled=true");
  if (config.watch.maxParsedTransactionsPerMinute < 1) {
    errors.push("watch.maxParsedTransactionsPerMinute must be greater than 0");
  }
  if (config.watch.maxConcurrentParses < 1) errors.push("watch.maxConcurrentParses must be greater than 0");
  return errors;
}