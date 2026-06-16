import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MINTS } from "../constants.js";

function minutesSince(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 60_000);
}

function buySellRatio(buys, sells) {
  if (buys <= 0) return 0;
  if (sells <= 0) return buys;
  return buys / sells;
}

export class Screener {
  constructor({ config, jupiter, dex }) {
    this.config = config;
    this.jupiter = jupiter;
    this.dex = dex;
    this.cachedSolPrice = null;
    this.cachedSolPriceAt = 0;
  }

  async solPriceUsd() {
    if (this.cachedSolPrice && Date.now() - this.cachedSolPriceAt < 60_000) {
      return this.cachedSolPrice;
    }
    this.cachedSolPrice = await this.jupiter.solPriceUsd();
    this.cachedSolPriceAt = Date.now();
    return this.cachedSolPrice;
  }

  buyAmountLamports() {
    return Math.max(1, Math.floor(this.config.trading.buyAmountSol * LAMPORTS_PER_SOL));
  }

  async screen(candidate) {
    const profile = await this.dex.tokenProfile(candidate.mint);
    if (!profile) {
      return this.reject(candidate, "token not found in DexScreener Solana pairs");
    }

    const metrics = this.metricsFor(profile);
    const reasons = this.hardRejectReasons(metrics);
    if (reasons.length > 0) {
      return this.reject(candidate, reasons.join("; "), { token: this.tokenFor(profile), metrics });
    }

    const solPrice = await this.solPriceUsd();
    const amountLamports = this.buyAmountLamports();
    const usdAmount = (amountLamports / LAMPORTS_PER_SOL) * solPrice;
    const quote = await this.jupiter.quote({
      inputMint: MINTS.SOL,
      outputMint: profile.mint,
      amount: amountLamports,
      slippageBps: this.config.trading.slippageBps
    });

    const priceImpactPct = Number(quote.priceImpactPct || 0) * 100;
    metrics.solPriceUsd = solPrice;
    metrics.usdAmount = usdAmount;
    metrics.amountLamports = amountLamports;
    metrics.priceImpactPct = priceImpactPct;
    metrics.route = (quote.routePlan || []).map((leg) => leg.swapInfo?.label).filter(Boolean);

    if (priceImpactPct > this.config.strategy.maxPriceImpactPct) {
      return this.reject(candidate, `price impact ${priceImpactPct.toFixed(2)}% exceeds limit`, {
        token: this.tokenFor(profile),
        metrics,
        quote
      });
    }

    return {
      accepted: true,
      candidate,
      token: this.tokenFor(profile),
      quote,
      metrics,
      summary: `${profile.baseToken.symbol || profile.mint} passed DexScreener screening`,
      risks: this.risksFor(metrics)
    };
  }

  tokenFor(profile) {
    return {
      id: profile.mint,
      symbol: profile.baseToken.symbol,
      name: profile.baseToken.name,
      usdPrice: profile.priceUsd,
      url: profile.url
    };
  }

  metricsFor(profile) {
    return {
      mint: profile.mint,
      pairAddress: profile.pairAddress,
      dexId: profile.dexId,
      symbol: profile.baseToken.symbol,
      name: profile.baseToken.name,
      tokenUrl: profile.url,
      tokenUsd: profile.priceUsd,
      liquidityUsd: profile.liquidityUsd,
      volume5m: profile.volume5m,
      volume1h: profile.volume1h,
      volume6h: profile.volume6h,
      volume24h: profile.volume24h,
      txns5m: profile.txns5m,
      buys5m: profile.buys5m,
      sells5m: profile.sells5m,
      txns1h: profile.txns1h,
      buys1h: profile.buys1h,
      sells1h: profile.sells1h,
      buySellRatio5m: buySellRatio(profile.buys5m, profile.sells5m),
      priceChange5m: profile.priceChange5m,
      priceChange1h: profile.priceChange1h,
      pairAgeMinutes: minutesSince(profile.pairCreatedAt)
    };
  }

  hardRejectReasons(metrics) {
    const s = this.config.strategy;
    const reasons = [];
    if (metrics.liquidityUsd < s.minLiquidityUsd) reasons.push(`liquidity $${metrics.liquidityUsd.toFixed(0)} below minimum`);
    if (metrics.volume5m < s.minVolume5mUsd) reasons.push(`5m volume $${metrics.volume5m.toFixed(0)} below minimum`);
    if (metrics.volume1h < s.minVolume1hUsd) reasons.push(`1h volume $${metrics.volume1h.toFixed(0)} below minimum`);
    if (metrics.volume24h < s.minVolumeUsd) reasons.push(`24h volume $${metrics.volume24h.toFixed(0)} below minimum`);
    if (metrics.txns5m < s.minTxns5m) reasons.push(`5m txns ${metrics.txns5m} below minimum`);
    if (metrics.buys5m < s.minBuys5m) reasons.push(`5m buys ${metrics.buys5m} below minimum`);
    if (metrics.buySellRatio5m < s.minBuySellRatio5m) {
      reasons.push(`5m buy/sell ratio ${metrics.buySellRatio5m.toFixed(2)} below minimum`);
    }
    if (metrics.pairAgeMinutes !== null && metrics.pairAgeMinutes > s.maxPairAgeMinutes) {
      reasons.push(`pair age ${metrics.pairAgeMinutes.toFixed(1)} minutes above limit`);
    }
    return reasons;
  }

  risksFor(metrics) {
    const risks = [];
    if (metrics.pairAgeMinutes !== null && metrics.pairAgeMinutes < 10) risks.push("very new pair");
    if (metrics.volume5m < this.config.strategy.minVolume5mUsd * 2) risks.push("thin 5m volume buffer");
    if (metrics.txns5m < this.config.strategy.minTxns5m * 2) risks.push("thin 5m transaction buffer");
    if (metrics.liquidityUsd < this.config.strategy.minLiquidityUsd * 2) risks.push("thin liquidity buffer");
    if (metrics.priceImpactPct > 10) risks.push("high price impact for tiny order");
    return risks;
  }

  reject(candidate, reason, extra = {}) {
    return {
      accepted: false,
      candidate,
      reason,
      token: extra.token || null,
      metrics: extra.metrics || {},
      quote: extra.quote || null,
      risks: extra.risks || []
    };
  }
}
