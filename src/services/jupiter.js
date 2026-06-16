import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MINTS } from "../constants.js";

export class JupiterClient {
  constructor(config) {
    this.config = config;
    this.baseUrl = config.jupiter.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.jupiter.timeoutMs;
  }

  headers(extra = {}) {
    const headers = { ...extra };
    if (this.config.jupiter.apiKey) headers["x-api-key"] = this.config.jupiter.apiKey;
    return headers;
  }

  async fetchJson(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: this.headers(options.headers || {})
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(`Jupiter ${response.status}: ${body?.error || body?.message || text}`);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchToken(query) {
    const tokens = await this.fetchJson(`/tokens/v2/search?query=${encodeURIComponent(query)}`);
    if (!Array.isArray(tokens) || tokens.length === 0) return null;
    return tokens.find((token) => token.id === query) || tokens[0];
  }

  async solPriceUsd() {
    const quote = await this.quote({
      inputMint: MINTS.SOL,
      outputMint: MINTS.USDC,
      amount: LAMPORTS_PER_SOL,
      slippageBps: 50
    });
    return Number(quote.outAmount) / 1_000_000;
  }

  async quote({ inputMint, outputMint, amount, slippageBps, onlyDirectRoutes = false }) {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(amount),
      slippageBps: String(slippageBps),
      restrictIntermediateTokens: "true",
      instructionVersion: "V2"
    });
    if (onlyDirectRoutes) params.set("onlyDirectRoutes", "true");
    return this.fetchJson(`/swap/v1/quote?${params.toString()}`);
  }

  async buildSwapTransaction({ quoteResponse, userPublicKey }) {
    return this.fetchJson("/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: String(userPublicKey),
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: this.config.trading.priorityFeeLamports,
            priorityLevel: this.config.trading.priorityLevel
          }
        }
      })
    });
  }
}
