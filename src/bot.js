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
    this._stopRequested = false; // Bendera keamanan untuk mematikan loop
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
      await this.watcher.bootstrapRecentSignatures().catch((error) => {
        log("watcher", "recent signature bootstrap failed", errorToJson(error), "warn");
      });
      await this.watcher.start();
    } else {
      log("watcher", "disabled; set watch.enabled=true only when ready to spend RPC credits", null, "warn");
    }

    // Memulai loop secara asinkron (menggantikan setInterval)
    this.loopScreening();
    this.loopManagement();
  }

  async stop() {
    this._stopRequested = true; // Menghentikan siklus setTimeout
    if (this.watchlistTimer) clearTimeout(this.watchlistTimer);
    if (this.managementTimer) clearTimeout(this.managementTimer);
    
    this.telegram.stop();
    await this.watcher.stop();
    saveState(this.state);
  }

  // Rekursif Timeout untuk Screening
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

  // Rekursif Timeout untuk Management (Portfolio check)
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
      if (this.maxPositionsReached()) {
        log("screener", "max open positions reached");
        return;
      }
      if (this.dailyLossExceeded()) {
        recordDecision({
          actor: "SCREENER",
          type: DECISION_TYPES.SKIP,
          summary: "screening skipped",
          reason: "daily loss limit reached"
        });
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
    if (!candidate?.mint) return;
    if (this.maxPositionsReached()) return;
    if (this.hasOpenMint(candidate.mint)) return;
    if (isMintWatched(this.state, candidate.mint)) return;
    if (isMintOnCooldown(this.state, candidate.mint, this.config.risk.cooldownMinutesByMint)) return;
    if (this.dailyLossExceeded()) return;

    const watched = addWatchCandidate(this.state, candidate, this.config.strategy.waitTimeMinutes);
    if (!watched) return;
    markMintSeen(this.state, candidate.mint);
    
    recordDecision({
      actor: "WATCHER",
      type: DECISION_TYPES.WATCH,
      summary: `quarantine ${candidate.mint}`,
      reason: `waiting ${this.config.strategy.waitTimeMinutes} minutes before DexScreener analysis`,
      candidate: watched
    });

    // Menghapus await, menggunakan catch agar tidak I/O blocking
    this.telegram.send(`WATCH ${candidate.mint}\nSource: ${candidate.source}\nAnalyze after: ${watched.eligibleAt}`)
      .catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
      
    saveState(this.state);
  }

  async screenCandidate(candidate) {
    let screened;
    try {
      screened = await this.screener.screen(candidate);
    } catch (error) {
      recordDecision({
        actor: "SCREENER",
        type: DECISION_TYPES.ERROR,
        summary: "screening failed",
        reason: error.message,
        candidate
      });
      this.telegram.send(`SCREEN ERROR ${candidate.mint}\n${error.message}`)
        .catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
      saveState(this.state);
      return;
    }

    if (!screened.accepted) {
      recordDecision({
        actor: "SCREENER",
        type: DECISION_TYPES.SKIP,
        summary: `skip ${screened.token?.symbol || candidate.mint}`,
        reason: screened.reason,
        risks: screened.risks,
        metrics: screened.metrics,
        candidate
      });
      this.telegram.send(`SKIP ${screened.token?.symbol || candidate.mint}\n${screened.reason}`)
        .catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
      saveState(this.state);
      return;
    }

    try {
      const tx = await this.executor.buy(screened);
      const position = this.buildPosition(screened, tx);
      addOpenPosition(this.state, position);
      
      recordDecision({
        actor: "SCREENER",
        type: DECISION_TYPES.DEPLOY,
        summary: screened.summary,
        reason: "all configured screening gates passed",
        risks: screened.risks,
        metrics: screened.metrics,
        candidate,
        tx
      });
      
      log("screener", screened.summary, { dryRun: tx.dryRun, mint: position.mint });
      
      this.telegram.send(`BUY ${position.symbol || position.mint}\nDry run: ${tx.dryRun}\nMint: ${position.mint}\nTx: ${tx.signature || "not sent"}`)
        .catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
        
    } catch (error) {
      recordDecision({
        actor: "SCREENER",
        type: DECISION_TYPES.ERROR,
        summary: `buy failed ${screened.token?.symbol || candidate.mint}`,
        reason: error.message,
        risks: screened.risks,
        metrics: screened.metrics,
        candidate
      });
      
      log("executor", "buy failed", errorToJson(error), "error");
      this.telegram.send(`BUY ERROR ${screened.token?.symbol || candidate.mint}\n${error.message}`)
        .catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
        
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
            const pnlUsd = result.metrics.currentPnlPct === null
              ? null
              : position.entryUsd * (result.metrics.currentPnlPct / 100);
              
            const closed = closePosition(this.state, position.id, {
              closeReason: result.reason,
              sellSignature: result.tx?.signature || null,
              pnlUsd,
              lastMetrics: result.metrics
            });
            
            recordDecision({
              actor: "MANAGER",
              type: DECISION_TYPES.CLOSE,
              summary: `close ${position.symbol || position.mint}`,
              reason: result.reason,
              metrics: result.metrics,
              candidate: { mint: position.mint },
              tx: result.tx
            });
            
            log("manager", `closed ${closed.symbol || closed.mint}`, { reason: result.reason });
            
            this.telegram.send(`SELL ${closed.symbol || closed.mint}\nReason: ${result.reason}\nPnL: ${result.metrics.currentPnlPct?.toFixed?.(2) ?? "n/a"}%`)
              .catch(err => log("telegram", "send failed", errorToJson(err), "warn"));
              
          } else {
            replaceOpenPosition(this.state, result.position);
            log("manager", `hold ${position.symbol || position.mint}`, result.metrics || {});
          }
        } catch (error) {
          recordDecision({
            actor: "MANAGER",
            type: DECISION_TYPES.ERROR,
            summary: `management failed ${position.symbol || position.mint}`,
            reason: error.message,
            candidate: { mint: position.mint }
          });
          log("manager", "position review failed", errorToJson(error), "error");
        }
      }
      saveState(this.state);
    });
  }

  statusSummary() {
    const open = this.state.openPositions.length;
    const watching = (this.state.watchlist || []).length;
    const closed = this.state.closedPositions.length;
    return [
      "SnipekingSOL status",
      `Mode: ${this.config.dryRun ? "DRY_RUN" : "LIVE"}`,
      `Watchlist: ${watching}`,
      `Open positions: ${open}`,
      `Closed positions: ${closed}`,
      `Buy amount: ${this.config.trading.buyAmountSol} SOL`
    ].join("\n");
  }

  buildPosition(screened, tx) {
    return {
      id: `${screened.token.id}-${Date.now()}`,
      status: "open",
      openedAt: new Date().toISOString(),
      mint: screened.token.id,
      symbol: screened.token.symbol,
      name: screened.token.name,
      source: screened.candidate.source,
      sourceSignature: screened.candidate.signature || null,
      entryUsd: screened.metrics.usdAmount,
      entryTokenUsd: Number(screened.token.usdPrice || 0),
      highestTokenUsd: Number(screened.token.usdPrice || 0),
      amountLamports: screened.metrics.amountLamports,
      quotedOutAmount: screened.quote.outAmount,
      route: screened.metrics.route,
      buySignature: tx.signature,
      dryRun: tx.dryRun
    };
  }

  maxPositionsReached() {
    return this.state.openPositions.length >= this.config.risk.maxOpenPositions;
  }

  hasOpenMint(mint) {
    return this.state.openPositions.some((position) => position.mint === mint);
  }

  dailyLossExceeded() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const loss = this.state.closedPositions
      .filter((position) => new Date(position.closedAt || 0).getTime() >= cutoff)
      .reduce((sum, position) => {
        const pnl = Number(position.pnlUsd || 0);
        return pnl < 0 ? sum + Math.abs(pnl) : sum;
      }, 0);
    return loss >= this.config.risk.maxDailyLossUsd;
  }
}