/**
 * rule-kategori.js
 * ================
 * Rule Kategori — mapping skor → kategori (Tahap 3 pipeline scoring).
 * 
 * Catatan desain (architecture.md section 2 & 7.6):
 * - High ≥ 80   → "High"   (Layak Lanjut)    → Notifikasi HR
 * - Medium 40-79 → "Medium" (Perlu Ditinjau)  → Notifikasi HR
 * - Low < 40    → "Low"    (Belum Sesuai)    → Auto-reply tolak (3 hari)
 * - Ambang skor bisa diubah HR per lowongan (Sheet "Kriteria Lowongan")
 * - Kandidat yang gugur di rule-check awal (skor 0) → Low
 * 
 * Cara pakai:
 *   const { kategoriBySkor } = require('./rule-kategori.js');
 *   const result = kategoriBySkor(skor, { ambangHigh: 80, ambangLow: 40 });
 */

'use strict';

// ============================================================
// CONSTANTS: Label kategori
// ============================================================
const KATEGORI_LABEL = {
  High: 'Layak Lanjut',
  Medium: 'Perlu Ditinjau',
  Low: 'Belum Sesuai',
};

// ============================================================
// FUNGSI UTAMA
// ============================================================
/**
 * Mapping skor ke kategori berdasarkan ambang.
 * @param {number} skor - Skor kecocokan 0-100
 * @param {object} options
 * @param {number} [options.ambangHigh=80] - Skor minimal kategori High
 * @param {number} [options.ambangLow=40] - Skor minimal kategori Medium (di bawah ini = Low)
 * @returns {object} { kategori, label, alasanKategori, ambangHigh, ambangLow }
 */
function kategoriBySkor(skor, options = {}) {
  // Default dari environment (bisa di-override per lowongan)
  const envHigh = parseInt(process.env.SCORE_AMBANG_HIGH, 10);
  const envLow = parseInt(process.env.SCORE_AMBANG_LOW, 10);

  const ambangHigh = typeof options.ambangHigh === 'number'
    ? options.ambangHigh
    : (!isNaN(envHigh) ? envHigh : 80);

  const ambangLow = typeof options.ambangLow === 'number'
    ? options.ambangLow
    : (!isNaN(envLow) ? envLow : 40);

  // Normalisasi skor: pastikan number 0-100
  let skorNum = Number(skor);
  if (isNaN(skorNum)) skorNum = 0;
  skorNum = Math.max(0, Math.min(100, skorNum));

  let kategori;
  let alasan;

  if (skorNum >= ambangHigh) {
    kategori = 'High';
    alasan = 'Skor ' + skorNum + ' ≥ ambang High (' + ambangHigh + ') → Layak Lanjut';
  } else if (skorNum >= ambangLow) {
    kategori = 'Medium';
    alasan = 'Skor ' + skorNum + ' ≥ ambang Low (' + ambangLow + ') tapi < High (' + ambangHigh + ') → Perlu Ditinjau';
  } else {
    kategori = 'Low';
    alasan = 'Skor ' + skorNum + ' < ambang Low (' + ambangLow + ') → Belum Sesuai';
  }

  return {
    kategori,
    label: KATEGORI_LABEL[kategori],
    alasanKategori: alasan,
    ambangHigh,
    ambangLow,
  };
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const skorRaw = process.argv[2];
  const skor = skorRaw ? Number(skorRaw) : 75;

  const result = kategoriBySkor(skor);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { kategoriBySkor, KATEGORI_LABEL };