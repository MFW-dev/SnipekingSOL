# SnipekingSOL v2.0

Bot trading otomatis Solana dengan pendekatan Meridian-style: Watcher, Analyzer, Trader, Portfolio, state lokal, dan decision log terpisah.

Versi ini tidak lagi membeli token di detik pertama. Token baru masuk karantina lebih dulu, dianalisis via DexScreener, lalu baru dibeli lewat Jupiter jika volume, likuiditas, dan price impact masuk akal.

## Fitur Utama

- Watcher mendengar log pool baru dari program Solana melalui WebSocket RPC.
- Analyzer menyimpan token ke watchlist selama `strategy.waitTimeMinutes`.
- DexScreener dipakai untuk filter volume, likuiditas, umur pair, dan harga portfolio.
- Volume transaksi menjadi hard gate: volume 5m/1h, jumlah transaksi 5m, jumlah buy 5m, dan buy/sell ratio harus lolos sebelum buy.
- Jupiter Swap API dipakai untuk quote, swap, slippage, dan priority fee.
- Portfolio otomatis memantau take profit, stop loss, trailing stop, dan max hold.
- Telegram mengirim notifikasi watch, skip, buy, sell, error, dan mendukung perintah `/status`.
- Default tetap `DRY_RUN=true` agar tidak ada transaksi live sebelum konfigurasi diuji.
- Default `watch.enabled=false` agar bot tidak langsung menghabiskan kredit RPC/Helius saat baru dicoba.

## Setup

Install dependency:

```powershell
npm.cmd install
```

Buat file lokal:

```powershell
Copy-Item .env.example .env
Copy-Item user-config.example.json user-config.json
```

Isi minimal `.env`:

```text
DRY_RUN=true
BUY_AMOUNT_SOL=0.02
WATCH_ENABLED=false
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
WSS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
PRIVATE_KEY=your_base58_private_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

`PRIVATE_KEY` hanya wajib saat `DRY_RUN=false`. Pakai burner wallet, bukan wallet utama.

## Konfigurasi Strategi

Semua strategi ada di `user-config.json`.

```json
{
  "trading": {
    "buyAmountSol": 0.02,
    "slippageBps": 1500,
    "priorityFeeLamports": 100000
  },
  "strategy": {
    "waitTimeMinutes": 5,
    "minVolumeUsd": 10000,
    "minVolume5mUsd": 500,
    "minVolume1hUsd": 3000,
    "minTxns5m": 20,
    "minBuys5m": 12,
    "minBuySellRatio5m": 1.2,
    "minLiquidityUsd": 5000
  },
  "portfolio": {
    "takeProfitPercent": 50,
    "stopLossPercent": 20,
    "checkIntervalMs": 15000
  },
  "watch": {
    "enabled": false,
    "bootstrapRecentSignatures": 0,
    "maxParsedTransactionsPerMinute": 12,
    "maxConcurrentParses": 1
  }
}
```

`buyAmountSol` adalah ukuran deploy per posisi. Default sekarang `0.02 SOL`, jadi wallet live perlu saldo di atas `0.02 SOL + risk.minSolReserve + fee`. Dengan default reserve `0.025 SOL`, siapkan minimal sekitar `0.05 SOL` sebelum live mode.

Filter volume/tx adalah hard gate. Organic score atau analisis narasi tidak akan meloloskan token jika volume 5m/1h, transaksi 5m, jumlah buy, atau buy/sell ratio masih di bawah batas.

## Menjalankan

Satu siklus pemeriksaan tanpa menjalankan watcher terus-menerus:

```powershell
npm.cmd run once
```

Mode ini hanya memproses watchlist dan posisi yang sudah ada di `state.json`. Mode ini tidak subscribe ke log on-chain dan tidak menjalankan bootstrap signature.

Menjalankan bot:

```powershell
npm.cmd start
```

Secara default `npm.cmd start` juga belum menyalakan watcher on-chain. Aktifkan hanya saat siap memakai kredit RPC:

```json
{
  "watch": {
    "enabled": true,
    "bootstrapRecentSignatures": 0,
    "maxParsedTransactionsPerMinute": 12,
    "maxConcurrentParses": 1,
    "programIds": {
      "raydiumLaunchLab": "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
    }
  }
}
```

Untuk akun Helius terbatas, mulai dari satu program saja dan biarkan `bootstrapRecentSignatures=0`. Menambah semua program Raydium/Meteora sekaligus bisa membuat konsumsi kredit naik tajam.

Untuk VPS, gunakan PM2:

```bash
npm install -g pm2
pm2 start src/index.js --name snipekingsol
pm2 logs snipekingsol
```

## File Penting

- `user-config.json`: strategi trading dan ambang risiko.
- `state.json`: watchlist, posisi terbuka, dan posisi tertutup.
- `decision-log.json`: alasan watch, skip, deploy, close, dan error.
- `src/services/onchain-watcher.js`: deteksi kandidat token.
- `src/services/screener.js`: analisis DexScreener dan quote Jupiter.
- `src/services/manager.js`: portfolio TP/SL.
- `src/services/telegram.js`: notifikasi dan `/status`.

## Mode Hemat Kredit Helius

Jika kredit Helius naik terlalu cepat:

- set `WATCH_ENABLED=false` atau `"watch.enabled": false` untuk mematikan subscribe on-chain;
- pastikan `"bootstrapRecentSignatures": 0`;
- pakai satu program dulu, misalnya `raydiumLaunchLab`;
- turunkan `"maxParsedTransactionsPerMinute"` ke 3-6 jika masih terlalu berat;
- pakai `npm.cmd run once` untuk cek state/watchlist tanpa watcher live.

## Disclaimer

Trading token baru di Solana sangat berisiko. Rugpull, liquidity trap, API failure, slippage ekstrem, dan bug eksekusi tetap mungkin terjadi. Jalankan live mode hanya dengan modal yang siap hilang.
