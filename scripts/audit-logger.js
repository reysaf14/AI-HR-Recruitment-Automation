/**
 * audit-logger.js
 * ===============
 * Audit Logger — tulis event ke Sheet "Audit Log" (append-only).
 * 
 * Catatan desain (architecture.md section 5 & 6):
 * - Sheet 3: "Audit Log" (append-only, tidak pernah diedit)
 * - Kolom: Timestamp, Event Type, Email Kandidat, Lowongan, Detail, Status
 * - Event types: rule_check, llm_scoring, kategori, write_sheets, notif_hr,
 *   auto_reply, error, retry
 * - Jika Google Sheets gagal → tulis ke buffer (melalui buffer-manager)
 * 
 * Catatan penting:
 * - Script ini menyediakan fungsi format/validasi event.
 * - Akses Google Sheets via n8n node Google Sheets (dari workflow), bukan dari
 *   script ini langsung. Fungsi buildAuditRow() menghasilkan baris yang siap
 *   ditambahkan oleh n8n. Fungsi logToBuffer() dipakai n8n saat Sheets gagal.
 * 
 * Cara pakai:
 *   const audit = require('./audit-logger.js');
 *   const row = audit.buildAuditRow({ eventType, email, lowongan, detail, status });
 */

'use strict';

const buffer = require('./buffer-manager.js');

// ============================================================
// CONSTANTS: Event types yang valid
// ============================================================
const EVENT_TYPES = [
  'rule_check',
  'llm_scoring',
  'kategori',
  'write_sheets',
  'notif_hr',
  'auto_reply',
  'error',
  'retry',
  'duplicate_skipped',
  'buffer_written',
];

const STATUS_VALID = ['Success', 'Failed', 'Retry', 'Info'];

// ============================================================
// UTILITAS: Generate timestamp sekarang
// ============================================================
function nowISO() {
  return new Date().toISOString();
}

// ============================================================
// FUNGSI UTAMA
// ============================================================
/**
 * Validasi dan bangun 1 baris audit log (siap di-append ke Google Sheets).
 * @param {object} fields - { eventType, email, lowongan, detail, status }
 * @returns {object} - { row, valid, errors }
 */
function buildAuditRow(fields = {}) {
  const errors = [];
  const eventType = fields.eventType || '';

  if (!EVENT_TYPES.includes(eventType)) {
    errors.push('eventType tidak valid: ' + eventType + '. Valid: ' + EVENT_TYPES.join(', '));
  }

  const status = fields.status || 'Info';
  if (!STATUS_VALID.includes(status)) {
    errors.push('status tidak valid: ' + status + '. Valid: ' + STATUS_VALID.join(', '));
  }

  const row = [
    fields.timestamp || nowISO(),     // Timestamp
    eventType,                         // Event Type
    fields.email || '',                // Email Kandidat
    fields.lowongan || '',             // Lowongan
    fields.detail || '',               // Detail
    status,                            // Status
  ];

  return { row, valid: errors.length === 0, errors };
}

/**
 * Simpan event audit ke buffer (fallback saat Google Sheets gagal).
 * @param {object} fields - Sama seperti buildAuditRow
 * @returns {object} - Hasil bufferWrite
 */
function logToBuffer(fields = {}) {
  const { row, valid, errors } = buildAuditRow(fields);
  if (!valid) {
    return { ok: false, error: errors.join('; ') };
  }
  // Simpan sebagai buffer khusus audit (prefix key "audit")
  return buffer.bufferWrite({
    kandidat_email: fields.email || '',
    lowongan: fields.lowongan || '',
    data: { audit_row: row, eventType: fields.eventType },
    _type: 'audit',
  });
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const r = buildAuditRow({
    eventType: 'rule_check',
    email: 'test@example.com',
    lowongan: 'Sales Executive',
    detail: 'Kandidat memenuhi semua syarat',
    status: 'Success',
  });
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { buildAuditRow, logToBuffer, EVENT_TYPES, STATUS_VALID, nowISO };