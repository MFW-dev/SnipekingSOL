export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
};

export const AVAILABLE_WATCH_PROGRAMS = {
  raydiumAmmV4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  raydiumCpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
};

export const DEFAULT_WATCH_PROGRAMS = {
  raydiumAmmV4: AVAILABLE_WATCH_PROGRAMS.raydiumAmmV4,
  raydiumCpmm: AVAILABLE_WATCH_PROGRAMS.raydiumCpmm
};

// PERBAIKAN UTAMA:
// Kita hanya menyisakan pola 'initialize'. 
// Bot HANYA akan memproses transaksi yang membuat pool baru.
export const POOL_LOG_PATTERNS = [
  /initialize2/i,
  /initialize/i,
  /create.*pool/i
];

export const DECISION_TYPES = {
  WATCH: "watch",
  DEPLOY: "deploy",
  SKIP: "skip",
  CLOSE: "close",
  HOLD: "hold",
  ERROR: "error"
};