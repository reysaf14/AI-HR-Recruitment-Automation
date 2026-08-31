/**
 * dedup-check.js
 * =============
 * Deduplication — cek apakah email + lowongan sudah pernah submit.
 * 
 * Catatan desain (architecture.md section 6.3):
 * - Kunci dedup: Email + Lowongan
 * - Cek pada Sheet "Data Kandidat" (array data yang sudah ada)
 * - Jika ditemukan dalam 24 jam terakhir → skip tulis + audit log "duplicate_skipped"
 * - Alasan: Google Form bisa dikirim 2x oleh kandidat yang sama (double-click)
 * 
 * Cara pakai dari n8n Code Node:
 *   const { isDuplicate } = require('./dedup-check.js');
 *   const result = isDuplicate(email, lowongan, existingRows, windowHours);
 */

'use strict';

// ============================================================
// UTILITAS
// ============================================================
function normalizeEmail(email) {
  if (!email) return '';
  return String(email).trim().toLowerCase();
}

function parseTimestamp(value) {
  // Terima berbagai format: ISO string, "DD/MM/YYYY HH:mm:ss", Date object
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const str = String(value || '').trim();
  if (!str) return 0;

  // Format Google Sheets: "MM/DD/YYYY HH:mm:ss" atau "DD/MM/YYYY"
  // Coba parse langsung dulu
  let d = new Date(str);
  if (!isNaN(d.getTime())) return d.getTime();

  // Coba format DD/MM/YYYY HH:mm:ss
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, day, month, year, hh, mm, ss] = m;
    d = new Date(Number(year), Number(month) - 1, Number(day), Number(hh), Number(mm), Number(ss || 0));
    return d.getTime();
  }

  // Coba format DD/MM/YYYY
  const m2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const [, day, month, year] = m2;
    d = new Date(Number(year), Number(month) - 1, Number(day));
    return d.getTime();
  }

  return 0;
}

// ============================================================
// FUNGSI UTAMA
// ============================================================
/**
 * Cek duplikat email + lowongan dalam window waktu.
 * @param {string} email - Email kandidat
 * @param {string} lowongan - Nama lowongan
 * @param {array} existingRows - Array baris dari Sheet "Data Kandidat"
 * @param {number} windowHours - Jendela dedup (default 24 jam)
 * @returns {object} { isDuplicate, duplicateRow, alasan }
 */
function isDuplicate(email, lowongan, existingRows = [], windowHours = 24) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedLowongan = String(lowongan || '').trim().toLowerCase();

  if (!normalizedEmail || !normalizedLowongan) {
    return { isDuplicate: false, duplicateRow: null, alasan: 'Email atau lowongan kosong — skip dedup check' };
  }

  const cutoff = Date.now() - (windowHours * 3600 * 1000);

  for (const row of existingRows) {
    // Dukung dua bentuk: object (dari Google Sheets node) atau array (row spreadsheet)
    let rowEmail = '';
    let rowLowongan = '';
    let rowTimestamp = 0;

    if (Array.isArray(row)) {
      // Bentuk array: asumsikan kolom [timestamp, nama, email, ...]
      // Kolom 0 = timestamp, kolom 2 = email, kolom 4 = lowongan
      rowTimestamp = parseTimestamp(row[0]);
      rowEmail = row[2] || '';
      rowLowongan = row[4] || '';
    } else if (row && typeof row === 'object') {
      rowEmail = row.Email || row.email || row['Email'] || '';
      rowLowongan = row.Lowongan || row.lowongan || row['Lowongan'] || '';
      rowTimestamp = parseTimestamp(row.Timestamp || row.timestamp || row['Timestamp'] || '');
    }

    const matches = normalizeEmail(rowEmail) === normalizedEmail
      && String(rowLowongan || '').trim().toLowerCase() === normalizedLowongan;

    if (matches) {
      // Masih dalam window?
      const withinWindow = rowTimestamp >= cutoff;
      return {
        isDuplicate: true,
        duplicateRow: row,
        alasan: withinWindow
          ? 'Duplikat ditemukan dalam ' + windowHours + ' jam terakhir'
          : 'Pernah submit sebelumnya (di luar window ' + windowHours + ' jam) — tetap dianggap duplikat',
      };
    }
  }

  return { isDuplicate: false, duplicateRow: null, alasan: 'Tidak ada duplikat' };
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const email = process.argv[2] || 'test@example.com';
  const lowongan = process.argv[3] || 'Sales Executive';

  // Data contoh
  const existing = [
    ['2026-08-30T10:00:00', 'Orang Satu', 'test@example.com', '0812', 'Sales Executive', 'url-cv-1'],
    ['2026-08-29T10:00:00', 'Orang Dua', 'lain@example.com', '0813', 'Admin', 'url-cv-2'],
  ];

  const result = isDuplicate(email, lowongan, existing, 24);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { isDuplicate, normalizeEmail, parseTimestamp };