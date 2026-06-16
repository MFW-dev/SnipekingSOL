import { config, validateConfig } from "./config.js";
import { JupiterClient } from "./services/jupiter.js";
import { DexScreenerClient } from "./services/dexscreener.js";
import { OnchainWatcher } from "./services/onchain-watcher.js";
import { Screener } from "./services/screener.js";
import { Executor } from "./services/executor.js";
import { Manager } from "./services/manager.js";
import { TelegramNotifier } from "./services/telegram.js";
import { SnipeBot } from "./bot.js";
import { createConnection, loadWallet, shortKey } from "./solana.js";
import { loadState } from "./state.js";
import { log } from "./logger.js";

const once = process.argv.includes("--once");
const errors = validateConfig();
if (errors.length > 0) {
  for (const error of errors) log("config", error, null, "error");
  process.exit(1);
}

const state = loadState();
const connection = createConnection(config);
const wallet = loadWallet(config);
const jupiter = new JupiterClient(config);
const dex = new DexScreenerClient(config);
const watcher = new OnchainWatcher({ connection, config, state });
const screener = new Screener({ config, jupiter, dex });
const executor = new Executor({ config, connection, wallet, jupiter });
const manager = new Manager({ config, dex, executor });
const telegram = new TelegramNotifier(config);
const bot = new SnipeBot({ config, state, connection, wallet, watcher, screener, executor, manager, telegram });

log("boot", "starting solana micro snipe bot", {
  dryRun: config.dryRun,
  wallet: wallet ? shortKey(wallet.publicKey) : null,
  buyAmountSol: config.trading.buyAmountSol,
  waitTimeMinutes: config.strategy.waitTimeMinutes,
  maxOpenPositions: config.risk.maxOpenPositions,
  watchEnabled: config.watch.enabled,
  watchPrograms: Object.keys(config.watch.programIds).length,
  watchParseCapPerMinute: config.watch.maxParsedTransactionsPerMinute,
  telegram: telegram.enabled,
  once
});

process.on("SIGINT", async () => {
  log("boot", "stopping");
  await bot.stop();
  process.exit(0);
});

await bot.start({ once });
