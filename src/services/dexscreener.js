export class DexScreenerClient {
  constructor(config) {
    this.baseUrl = config.dexscreener.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.dexscreener.timeoutMs;
  }

  async fetchJson(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(`DexScreener ${response.status}: ${body?.message || text}`);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async tokenProfile(mint) {
    const data = await this.fetchJson(`/latest/dex/tokens/${encodeURIComponent(mint)}`);
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    const solanaPairs = pairs.filter((pair) => pair.chainId === "solana");
    if (solanaPairs.length === 0) return null;

    const bestPair = solanaPairs.sort((a, b) =>
      Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0)
    )[0];

    return {
      mint,
      pairAddress: bestPair.pairAddress,
      dexId: bestPair.dexId,
      url: bestPair.url,
      baseToken: bestPair.baseToken || {},
      quoteToken: bestPair.quoteToken || {},
      priceUsd: Number(bestPair.priceUsd || 0),
      liquidityUsd: Number(bestPair.liquidity?.usd || 0),
      volume5m: Number(bestPair.volume?.m5 || 0),
      volume1h: Number(bestPair.volume?.h1 || 0),
      volume6h: Number(bestPair.volume?.h6 || 0),
      volume24h: Number(bestPair.volume?.h24 || 0),
      txns5m: Number(bestPair.txns?.m5?.buys || 0) + Number(bestPair.txns?.m5?.sells || 0),
      buys5m: Number(bestPair.txns?.m5?.buys || 0),
      sells5m: Number(bestPair.txns?.m5?.sells || 0),
      txns1h: Number(bestPair.txns?.h1?.buys || 0) + Number(bestPair.txns?.h1?.sells || 0),
      buys1h: Number(bestPair.txns?.h1?.buys || 0),
      sells1h: Number(bestPair.txns?.h1?.sells || 0),
      priceChange5m: Number(bestPair.priceChange?.m5 || 0),
      priceChange1h: Number(bestPair.priceChange?.h1 || 0),
      pairCreatedAt: bestPair.pairCreatedAt ? new Date(bestPair.pairCreatedAt).toISOString() : null
    };
  }
}
