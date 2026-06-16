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
      // Defensive check untuk bootstrapRecentSignatures
      if (typeof this.watcher.bootstrapRecentSignatures === 'function') {
        await this.watcher.bootstrapRecentSignatures().catch((error) => {
          log("watcher", "recent signature bootstrap failed", errorToJson(error), "warn");
        });
      } else {
        log("watcher", "bootstrapRecentSignatures method missing in OnchainWatcher class", null, "error");
      }
      await this.watcher.start();
    } else {
      log("watcher", "disabled; set watch.enabled=true only when ready to spend RPC credits", null, "warn");
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
    try {
      await this.runScreeningCycle();
    } catch (error) {
      log("bot", "screening interval failed", errorToJson(error), "error");
    } finally {
      if (!this._stopRequested) {
        this.watchlistTimer = setTimeout(() => this.loopScreening(), 15_000);
      }
    }
  }

  async loopManagement() {
    if (this._stopRequested) return;
    try {
      await this.runManagementCycle();
    } catch (error) {
      log("bot", "management interval failed", errorToJson(error), "error");
    } finally {
      if (!this._stopRequested) {
        this.managementTimer = setTimeout(() => this.loopManagement(), this.config.portfolio.checkIntervalMs);
      }
    }
  }

  async runScreeningCycle() {
    return this.screenerHarness.run("screen quarantined watchlist", async () => {
      if (this.maxPositionsReached()) return;
      if (this.dailyLossExceeded()) {
        recordDecision({ actor: "SCREENER", type: DECISION_TYPES.SKIP, summary: "screening skipped", reason: "daily loss limit reached" });
        return;
      }

      for (const candidate of dueWatchCandidates(this.state)) {
        removeWatchCandidate(this.state, candidate.mint);
        await this.screenCandidate(candidate);
        if (this.maxPositionsReached()) break;
      }
      saveState(this.state);
    });
  }

  async handleCandidate(candidate) {
    if (!candidate?.mint || this.maxPositionsReached() || this.hasOpenMint(candidate.mint) || isMintWatched(this.state, candidate.mint) || isMintOnCooldown(this.state, candidate.mint, this.config.risk.cooldownMinutesByMint) || this.dailyLossExceeded()) return;

    const watched = addWatchCandidate(this.state, candidate, this.config.strategy.waitTimeMinutes);
    if (!watched) return;
    markMintSeen(this.state, candidate.mint);
    
    recordDecision({ actor: "WATCHER", type: DECISION_TYPES.WATCH, summary: `quarantine ${candidate.mint}`, reason: `waiting ${this.config.strategy.waitTimeMinutes} minutes`, candidate: watched });

    this.telegram.send(`WATCH ${candidate.mint}\nSource: ${candidate.source}\nAnalyze after: ${watched.eligibleAt}`)
      .catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
      
    saveState(this.state);
  }

  async screenCandidate(candidate) {
    let screened;
    try {
      screened = await this.screener.screen(candidate);
    } catch (error) {
      this.telegram.send(`SCREEN ERROR ${candidate.mint}\n${error.message}`).catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
      return;
    }

    if (!screened.accepted) {
      this.telegram.send(`SKIP ${screened.token?.symbol || candidate.mint}\n${screened.reason}`).catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
      return;
    }

    try {
      const tx = await this.executor.buy(screened);
      const position = this.buildPosition(screened, tx);
      addOpenPosition(this.state, position);
      
      this.telegram.send(`BUY ${position.symbol || position.mint}\nDry run: ${tx.dryRun}\nMint: ${position.mint}`).catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
    } catch (error) {
      this.telegram.send(`BUY ERROR ${screened.token?.symbol || candidate.mint}\n${error.message}`).catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
    } finally {
      saveState(this.state);
    }
  }

  async runManagementCycle() {
    return this.managerHarness.run("review open positions", async () => {
      for (const position of [...this.state.openPositions]) {
        try {
          const result = await this.manager.review(position);
          if (result.action === DECISION_TYPES.CLOSE) {
            closePosition(this.state, position.id, { closeReason: result.reason, sellSignature: result.tx?.signature || null });
            this.telegram.send(`SELL ${position.symbol || position.mint}\nReason: ${result.reason}`).catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
          } else {
            replaceOpenPosition(this.state, result.position);
          }
        } catch (error) {
          log("manager", "position review failed", errorToJson(error), "error");
        }
      }
      saveState(this.state);
    });
  }

  statusSummary() {
    return [
      "SnipekingSOL status",
      `Mode: ${this.config.dryRun ? "DRY_RUN" : "LIVE"}`,
      `Watchlist: ${this.state.watchlist?.length || 0}`,
      `Open: ${this.state.openPositions.length}`
    ].join("\n");
  }

  buildPosition(screened, tx) {
    return {
      id: `${screened.token.id}-${Date.now()}`,
      status: "open",
      openedAt: new Date().toISOString(),
      mint: screened.token.id,
      symbol: screened.token.symbol,
      entryUsd: screened.metrics.usdAmount,
      buySignature: tx.signature,
      dryRun: tx.dryRun
    };
  }

  maxPositionsReached() { return this.state.openPositions.length >= this.config.risk.maxOpenPositions; }
  hasOpenMint(mint) { return this.state.openPositions.some((p) => p.mint === mint); }
  dailyLossExceeded() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const loss = this.state.closedPositions.filter(p => new Date(p.closedAt || 0).getTime() >= cutoff).reduce((s, p) => (Number(p.pnlUsd || 0) < 0 ? s + Math.abs(p.pnlUsd) : s), 0);
    return loss >= this.config.risk.maxDailyLossUsd;
  }
}