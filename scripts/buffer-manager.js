/**
 * buffer-manager.js
 * =================
 * Buffer / Fallback System — simpan data sementara sebagai file JSON lokal
 * jika Google Sheets gagal ditulis.
 * 
 * Catatan desain (architecture.md section 6.2):
 * - Lokasi: {BUFFER_DIR}/buffer-{timestamp}.json
 * - Trigger: Google Sheets gagal setelah 3x retry
 * - Format: { timestamp, kandidat_email, lowongan, data, retry_count, max_retry, next_retry }
 * - Recovery: cron harian mengecek folder buffer, coba tulis ulang ke Sheets,
 *   max 10 retry dengan interval 5 menit
 * - Monitoring: setiap buffer write → Audit Log sebagai event "buffer_written"
 * 
 * Cara pakai:
 *   const buffer = require('./buffer-manager.js');
 *   buffer.bufferWrite(dataKandidat);       // tulis ke buffer
 *   buffer.listBuffer();                    // daftar semua buffer
 *   buffer.bufferLoad(filename);            // baca satu buffer
 *   buffer.bufferRemove(filename);          // hapus buffer (setelah sukses
 *   buffer.shouldRetry(bufferEntry);        // cek apakah perlu retry & sudah waktunya
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// CONFIG
// ============================================================
const BUFFER_DIR = process.env.BUFFER_DIR || path.join(__dirname, '..', 'buffer');
const DEFAULT_MAX_RETRY = 10;
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 menit

// ============================================================
// UTILITAS: Pastikan folder buffer ada
// ============================================================
function ensureDir() {
  if (!fs.existsSync(BUFFER_DIR)) {
    fs.mkdirSync(BUFFER_DIR, { recursive: true });
  }
  return BUFFER_DIR;
}

// ============================================================
// FUNGSI UTAMA
// ============================================================
/**
 * Tulis data kandidat ke file buffer JSON.
 * @param {object} data - Object semua kolom Data Kandidat yang akan ditulis ke Sheets
 * @param {object} options - { maxRetry, retryIntervalMs }
 * @returns {object} - { ok, filename, path }
 */
function bufferWrite(data, options = {}) {
  const maxRetry = options.maxRetry || DEFAULT_MAX_RETRY;
  const retryIntervalMs = options.retryIntervalMs || RETRY_INTERVAL_MS;

  const dir = ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const hash = crypto.createHash('md5')
    .update((data.kandidat_email || data.email || '') + String(Date.now()))
    .digest('hex').slice(0, 8);
  const filename = 'buffer-' + ts + '-' + hash + '.json';
  const filePath = path.join(dir, filename);

  const entry = {
    timestamp: new Date().toISOString(),
    kandidat_email: data.kandidat_email || data.email || data.Email || '',
    lowongan: data.lowongan || data.Lowongan || '',
    data: data,
    retry_count: 0,
    max_retry: maxRetry,
    next_retry: new Date(Date.now() + retryIntervalMs).toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
  return { ok: true, filename, path: filePath };
}

/**
 * Daftar semua file buffer (belum di-proses).
 * @returns {object[]} - Array entry buffer
 */
function listBuffer() {
  if (!fs.existsSync(BUFFER_DIR)) return [];

  const files = fs.readdirSync(BUFFER_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const entries = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(BUFFER_DIR, f), 'utf8');
      entries.push(JSON.parse(raw));
    } catch (_e) {
      // skip file corrupt
    }
  }
  return entries;
}

/**
 * Baca satu file buffer.
 * @param {string} filename - Nama file buffer
 * @returns {object|null} - Entry buffer atau null jika tidak ada
 */
function bufferLoad(filename) {
  const filePath = path.join(BUFFER_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return null;
  }
}

/**
 * Hapus file buffer (setelah berhasil ditulis ke Sheets).
 * @param {string} filename
 * @returns {boolean}
 */
function bufferRemove(filename) {
  const filePath = path.join(BUFFER_DIR, filename);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Cek apakah sebuah buffer entry perlu di-retry & sudah waktunya.
 * @param {object} entry - Entry buffer
 * @returns {object} { shouldRetry, reason }
 */
function shouldRetry(entry) {
  if (!entry) return { shouldRetry: false, reason: 'entry kosong' };
  if (entry.retry_count >= (entry.max_retry || DEFAULT_MAX_RETRY)) {
    return { shouldRetry: false, reason: 'melebihi max retry (' + entry.max_retry + ')' };
  }
  const now = Date.now();
  const nextRetryTs = entry.next_retry ? new Date(entry.next_retry).getTime() : 0;
  if (now < nextRetryTs) {
    return { shouldRetry: false, reason: 'belum waktunya retry' };
  }
  return { shouldRetry: true, reason: 'siap retry' };
}

/**
 * Kembalikan path folder buffer.
 */
function getBufferDir() {
  ensureDir();
  return BUFFER_DIR;
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const action = process.argv[2] || 'write';

  if (action === 'write') {
    const r = bufferWrite({
      kandidat_email: 'test@example.com',
      lowongan: 'Sales Executive',
      nama: 'Budi',
      skor: 30,
      kategori: 'Low',
    });
    console.log(JSON.stringify(r));
  } else if (action === 'list') {
    const entries = listBuffer();
    console.log(JSON.stringify(entries.map((e) => ({
      filename: undefined,
      kandidat_email: e.kandidat_email,
      lowongan: e.lowongan,
      retry_count: e.retry_count,
      next_retry: e.next_retry,
    })), null, 2));
  } else if (action === 'check') {
    const entries = listBuffer();
    for (const e of entries) {
      const s = shouldRetry(e);
      console.log(JSON.stringify({ email: e.kandidat_email, ...s }));
    }
  }
}

module.exports = {
  bufferWrite,
  listBuffer,
  bufferLoad,
  bufferRemove,
  shouldRetry,
  getBufferDir,
  ensureDir,
};