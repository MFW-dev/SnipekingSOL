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
  meteoraDlmm: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
};

// PERBAIKAN: Memasukkan program utama Raydium ke dalam daftar pantauan default
export const DEFAULT_WATCH_PROGRAMS = {
  raydiumLaunchLab: AVAILABLE_WATCH_PROGRAMS.raydiumLaunchLab,
  raydiumAmmV4: AVAILABLE_WATCH_PROGRAMS.raydiumAmmV4,
  raydiumCpmm: AVAILABLE_WATCH_PROGRAMS.raydiumCpmm
};

export const POOL_LOG_PATTERNS = [
  /initialize2/i,
  /init_pc_amount/i,
  /initialize.*pool/i,
  /create.*pool/i,
  /new.*pool/i,
  /InitializeLbPair/i
];

export const DECISION_TYPES = {
  WATCH: "watch",
  DEPLOY: "deploy",
  SKIP: "skip",
  CLOSE: "close",
  HOLD: "hold",
  ERROR: "error"
};