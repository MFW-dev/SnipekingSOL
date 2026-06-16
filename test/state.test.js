import test from "node:test";
import assert from "node:assert/strict";
import { 
  addWatchCandidate, 
  addOpenPosition, 
  closePosition, 
  isMintWatched 
} from "../src/state.js";

test("Bot State Management Tests", async (t) => {

  await t.test("Harus bisa menambahkan dan mendeteksi token di Watchlist", () => {
    // 1. Persiapan State Kosong
    const mockState = { watchlist: [], openPositions: [], closedPositions: [], seenMints: {} };
    const candidate = { mint: "So11111111111111111111111111111111111111112", source: "raydium" };

    // 2. Eksekusi
    addWatchCandidate(mockState, candidate, 5); // Waktu tunggu 5 menit

    // 3. Verifikasi
    assert.equal(mockState.watchlist.length, 1, "Watchlist harus berisi 1 token");
    assert.equal(mockState.watchlist[0].mint, candidate.mint, "Mint address harus sesuai");
    assert.equal(isMintWatched(mockState, candidate.mint), true, "Fungsi isMintWatched harus mengembalikan true");
  });

  await t.test("Harus memindahkan posisi secara akurat dari Open ke Closed", () => {
    // 1. Persiapan State
    const mockState = { watchlist: [], openPositions: [], closedPositions: [], seenMints: {} };
    const dummyPosition = { 
      id: "pos-123", 
      mint: "TokenXYZ", 
      status: "open", 
      entryUsd: 150 
    };

    // 2. Eksekusi: Tambah ke Open
    addOpenPosition(mockState, dummyPosition);
    assert.equal(mockState.openPositions.length, 1, "Harus ada 1 posisi Open");

    // 3. Eksekusi: Tutup Posisi (Take Profit)
    const closedPos = closePosition(mockState, "pos-123", {
      closeReason: "Take Profit Reached",
      pnlUsd: 75.5
    });

    // 4. Verifikasi
    assert.equal(mockState.openPositions.length, 0, "Posisi Open harus kosong setelah dijual");
    assert.equal(mockState.closedPositions.length, 1, "Posisi Closed harus bertambah 1");
    assert.equal(closedPos.status, "closed", "Status token harus berubah menjadi closed");
    assert.equal(closedPos.pnlUsd, 75.5, "PnL USD harus tersimpan dengan benar");
  });

});