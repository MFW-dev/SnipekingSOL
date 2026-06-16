export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
};

export const AVAILABLE_WATCH_PROGRAMS = {
  raydiumLaunchLab: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  raydiumCpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  raydiumAmmV4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  raydiumClmm: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  meteoraDlmm: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  pumpFun: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
};

export const DEFAULT_WATCH_PROGRAMS = {
  raydiumAmmV4: AVAILABLE_WATCH_PROGRAMS.raydiumAmmV4,
  raydiumCpmm: AVAILABLE_WATCH_PROGRAMS.raydiumCpmm
};

// Filter ini hanya akan memicu bot jika terjadi pembuatan pool baru
export const POOL_LOG_PATTERNS = [
  /initialize/i,
  /create.*pool/i,
  /new.*pool/i
];

export const DECISION_TYPES = {
  WATCH: "watch",
  DEPLOY: "deploy",
  SKIP: "skip",
  CLOSE: "close",
  HOLD: "hold",
  ERROR: "error"
};