import { DECISION_TYPES } from "../constants.js";

function pnlPct(entry, current) {
  if (!entry || !current) return null;
  return ((current - entry) / entry) * 100;
}

function ageMinutes(position) {
  return (Date.now() - new Date(position.openedAt).getTime()) / 60_000;
}

export class Manager {
  constructor({ config, dex, executor }) {
    this.config = config;
    this.dex = dex;
    this.executor = executor;
  }

  async review(position) {
    const profile = await this.dex.tokenProfile(position.mint);
    if (!profile) {
      return {
        action: DECISION_TYPES.HOLD,
        reason: "DexScreener token info unavailable",
        position
      };
    }

    const currentPrice = Number(profile.priceUsd || 0);
    const currentPnlPct = pnlPct(position.entryTokenUsd, currentPrice);
    const peakPrice = Math.max(Number(position.highestTokenUsd || 0), currentPrice);
    const drawdownFromPeakPct = pnlPct(peakPrice, currentPrice);
    const heldMinutes = ageMinutes(position);

    const nextPosition = {
      ...position,
      highestTokenUsd: peakPrice || position.highestTokenUsd,
      lastReviewAt: new Date().toISOString(),
      lastTokenUsd: currentPrice || position.lastTokenUsd,
      lastPnlPct: currentPnlPct
    };

    const exitReason = this.exitReason({
      currentPnlPct,
      drawdownFromPeakPct,
      heldMinutes
    });

    if (!exitReason) {
      return {
        action: DECISION_TYPES.HOLD,
        reason: "no exit rule triggered",
        position: nextPosition,
        metrics: {
          currentPnlPct,
          drawdownFromPeakPct,
          heldMinutes,
          liquidityUsd: profile.liquidityUsd,
          volume5m: profile.volume5m
        }
      };
    }

    const tx = await this.executor.sell(nextPosition, exitReason);
    return {
      action: DECISION_TYPES.CLOSE,
      reason: exitReason,
      position: nextPosition,
      metrics: {
        currentPnlPct,
        drawdownFromPeakPct,
        heldMinutes,
        liquidityUsd: profile.liquidityUsd,
        volume5m: profile.volume5m
      },
      tx
    };
  }

  exitReason({ currentPnlPct, drawdownFromPeakPct, heldMinutes }) {
    const m = this.config.portfolio;
    if (currentPnlPct !== null && currentPnlPct <= -Math.abs(m.stopLossPercent)) {
      return `stop loss ${currentPnlPct.toFixed(2)}%`;
    }
    if (currentPnlPct !== null && currentPnlPct >= m.takeProfitPercent) {
      return `take profit ${currentPnlPct.toFixed(2)}%`;
    }
    if (drawdownFromPeakPct !== null && drawdownFromPeakPct <= -Math.abs(m.trailingStopPercent)) {
      return `trailing stop ${drawdownFromPeakPct.toFixed(2)}% from peak`;
    }
    if (heldMinutes >= m.maxHoldMinutes) return `max hold ${heldMinutes.toFixed(1)} minutes`;
    return null;
  }
}
