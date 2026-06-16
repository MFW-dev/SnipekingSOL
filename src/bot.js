import { DECISION_TYPES } from "./constants.js";
import { recordDecision } from "./decision-log.js";
import { AgentHarness } from "./harness.js";
import { log, errorToJson } from "./logger.js";
import {
  addOpenPosition,
  addWatchCandidate,
  closePosition,
  dueWatchCandidates,
  isMintOnCooldown,
  isMintWatched,
  markMintSeen,
  pruneSeen,
  removeWatchCandidate,
  replaceOpenPosition,
  saveState
} from "./state.js";

export class SnipeBot {
  constructor({ config, state, connection, wallet, watcher, screener, executor, manager, telegram }) {
    this.config = config;
    this.state = state;
    this.connection = connection;
    this.wallet = wallet;
    this.watcher = watcher;
    this.screener = screener;
    this.executor = executor;
    this.manager = manager;
    this.screenerHarness = new AgentHarness("SCREENER");
    this.managerHarness = new AgentHarness("MANAGER");
    this.telegram = telegram;
    this.watchlistTimer = null;
    this.managementTimer = null;
    this._stopRequested = false;
  }

  async start({ once = false } = {}) {
    this._stopRequested = false;
    pruneSeen(this.state);
    
    this.watcher.on("candidate", (candidate) => {
      this.handleCandidate(candidate).catch((error) => {
        log("bot", "candidate handling failed", errorToJson(error), "error");
      });
    });

    if (once) {
      await this.runScreeningCycle();
      await this.runManagementCycle();
      saveState(this.state);
      return;
    }

    this.telegram.startCommandPolling(() => this.statusSummary());
    
    if (this.config.watch.enabled) {
      if (typeof this.watcher.bootstrapRecentSignatures === 'function') {
        await this.watcher.bootstrapRecentSignatures().catch((error) => {
          log("watcher", "recent signature bootstrap failed", errorToJson(error), "warn");
        });
      }
      await this.watcher.start();
    }
    
    this.loopScreening();
    this.loopManagement();
  }

  async stop() {
    this._stopRequested = true;
    if (this.watchlistTimer) clearTimeout(this.watchlistTimer);
    if (this.managementTimer) clearTimeout(this.managementTimer);
    this.telegram.stop();
    await this.watcher.stop();
    saveState(this.state);
  }

  async loopScreening() {
    if (this._stopRequested) return;
    try { await this.runScreeningCycle(); } catch (error) { log("bot", "screening interval failed", errorToJson(error), "error"); }
    finally { if (!this._stopRequested) this.watchlistTimer = setTimeout(() => this.loopScreening(), 15_000); }
  }

  async loopManagement() {
    if (this._stopRequested) return;
    try { await this.runManagementCycle(); } catch (error) { log("bot", "management interval failed", errorToJson(error), "error"); }
    finally { if (!this._stopRequested) this.managementTimer = setTimeout(() => this.loopManagement(), this.config.portfolio.checkIntervalMs); }
  }

  async runScreeningCycle() {
    return this.screenerHarness.run("screen quarantined watchlist", async () => {
      if (this.maxPositionsReached()) return;
      for (const candidate of dueWatchCandidates(this.state)) {
        removeWatchCandidate(this.state, candidate.mint);
        await this.screenCandidate(candidate);
        if (this.maxPositionsReached()) break;
      }
      saveState(this.state);
    });
  }

  async handleCandidate(candidate) {
    if (!candidate?.mint || this.maxPositionsReached() || this.hasOpenMint(candidate.mint) || isMintWatched(this.state, candidate.mint) || isMintOnCooldown(this.state, candidate.mint, this.config.risk.cooldownMinutesByMint)) return;
    const watched = addWatchCandidate(this.state, candidate, this.config.strategy.waitTimeMinutes);
    if (!watched) return;
    markMintSeen(this.state, candidate.mint);
    this.telegram.send(`WATCH ${candidate.mint}`).catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
    saveState(this.state);
  }

  async screenCandidate(candidate) {
    let screened;
    try { screened = await this.screener.screen(candidate); } catch (error) { return; }
    if (!screened.accepted) return;
    try {
      const tx = await this.executor.buy(screened);
      const position = this.buildPosition(screened, tx);
      addOpenPosition(this.state, position);
      this.telegram.send(`BUY ${position.symbol}`).catch(err => log("telegram", "send failed", err, "warn"));
    } catch (error) {
      log("bot", "buy error", error, "error");
    } finally { saveState(this.state); }
  }

  async runManagementCycle() {
    return this.managerHarness.run("review open positions", async () => {
      for (const position of [...this.state.openPositions]) {
        try {
          const result = await this.manager.review(position);
          if (result.action === DECISION_TYPES.CLOSE) {
            closePosition(this.state, position.id, { closeReason: result.reason });
            this.telegram.send(`SELL ${position.symbol}`).catch(err => log("telegram", "send failed", err, "warn"));
          } else {
            replaceOpenPosition(this.state, result.position);
          }
        } catch (error) { log("manager", "position review failed", errorToJson(error), "error"); }
      }
      saveState(this.state);
    });
  }

  statusSummary() { return "SnipekingSOL is running..."; }
  buildPosition(screened, tx) { return { id: `${screened.token.id}-${Date.now()}`, status: "open", mint: screened.token.id, symbol: screened.token.symbol, entryUsd: screened.metrics.usdAmount, buySignature: tx.signature }; }
  maxPositionsReached() { return this.state.openPositions.length >= this.config.risk.maxOpenPositions; }
  hasOpenMint(mint) { return this.state.openPositions.some((p) => p.mint === mint); }
  dailyLossExceeded() { return false; } // Sederhanakan untuk stabilitas
}