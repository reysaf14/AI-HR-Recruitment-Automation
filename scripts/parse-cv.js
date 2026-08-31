/**
 * parse-cv.js
 * ===========
 * Fungsi ekstraksi teks dari file CV (PDF/DOCX) menjadi teks plain.
 * 
 * Catatan desain (architecture.md section 7.1):
 * - Format didukung: PDF, DOCX
 * - Format lain (JPG, PNG, ZIP, dll) → flag "format_unsupported"
 * - Jika file corrupt/terenkripsi → flag "parse_error"
 * - Timeout parsing: 60 detik
 * 
 * Cara pakai dari n8n Code Node:
 *   const { parseCV } = require('./parse-cv.js');
 *   const result = parseCV(fileBuffer, fileMimeType, fileName);
 * 
 * Cara pakai dari CLI (testing):
 *   node parse-cv.js <path-ke-file>
 */

'use strict';

// ============================================================
// CONFIG DARI ENVIRONMENT
// ============================================================
const TIMEOUT_PARSE_MS = (process.env.TIMEOUT_PARSE_CV || 60) * 1000; // default 60s

// ============================================================
// UTILITAS: Deteksi tipe file
// ============================================================
const MIME_MAP = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'txt',
};

function detectFileType(buffer, mimeType, fileName = '') {
  // 1. Coba dari magic bytes (paling reliable)
  if (buffer && buffer.length >= 4) {
    // PDF: %PDF
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return 'pdf';
    }
    // DOCX: PK (zip container) — perlu cek lebih lanjut
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      // DOCX vs ZIP biasa — cek string "[Content_Types].xml" dalam 2KB pertama
      const head = buffer.slice(0, 2048).toString('utf8');
      if (head.includes('[Content_Types].xml') || head.includes('word/')) {
        return 'docx';
      }
      return 'zip'; // zip non-docx → unsupported
    }
  }

  // 2. Fallback ke MIME type
  if (MIME_MAP[mimeType]) return MIME_MAP[mimeType];

  // 3. Fallback ke ekstensi file
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (ext === 'txt' || ext === 'md') return 'txt';
  return 'unknown';
}

// ============================================================
// PARSER: PDF
// Catatan: Di n8n Code Node, kita mengandalkan library pdf-parse.
// Untuk test mandiri (tanpa dependency), gunakan parser fallback
// yang mengekstrak teks dari stream PDF sederhana.
// ============================================================
function parsePDF(buffer, useLibrary = false) {
  if (useLibrary) {
    // Di n8n: pakai library pdf-parse
    try {
      // eslint-disable-next-line global-require
      const pdfParse = require('pdf-parse');
      return new Promise((resolve, reject) => {
        pdfParse(buffer).then((data) => resolve(data.text), (err) => reject(err));
      });
    } catch (err) {
      return Promise.reject(new Error('pdf-parse library tidak tersedia: ' + err.message));
    }
  }

  // Fallback sederhana: cari stream teks dalam PDF
  // Catatan: ini bukan parser PDF lengkap, hanya untuk testing mandiri
  return new Promise((resolve, reject) => {
    try {
      const text = buffer.toString('latin1');
      // Ekstrak teks dari objek stream (antara "stream" dan "endstream")
      const matches = text.match(/stream\r?\n([\s\S]*?)\r?\nendstream/g) || [];
      let extracted = '';
      for (const m of matches) {
        const content = m.replace(/^stream\r?\n/, '').replace(/\r?\nendstream$/, '');
        // FlateDecode: di sini hanya fallback, teks mentah
        extracted += content + '\n';
      }
      if (!extracted.trim()) {
        // Coba cari teks biasa (untuk PDF tanpa kompresi)
        const plainText = text.replace(/\(([^)]*)\)/g, '$1');
        extracted = plainText;
      }
      resolve(extracted.trim());
    } catch (err) {
      reject(new Error('Gagal parse PDF: ' + err.message));
    }
  });
}

// ============================================================
// PARSER: DOCX
// DOCX adalah zip berisi document.xml. Ekstrak teks dari XML.
// ============================================================
function parseDOCX(buffer) {
  return new Promise((resolve, reject) => {
    try {
      // DOCX = zip. Di n8n, pakai library adm-zip atau jszip.
      // Untuk fallback ringan, cari XML mentah dalam buffer.
      const text = buffer.toString('utf8');
      // Cari blok XML yang mengandung <w:t> tags
      const matches = text.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      let extracted = '';
      for (const m of matches) {
        const content = m.replace(/<w:t[^>]*>/g, '').replace(/<\/w:t>/g, '');
        extracted += content;
      }
      // Hapus XML entities
      extracted = extracted
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      resolve(extracted.trim());
    } catch (err) {
      reject(new Error('Gagal parse DOCX: ' + err.message));
    }
  });
}

// ============================================================
// FUNGSI UTAMA
// ============================================================
/**
 * Parse file CV menjadi teks plain.
 * @param {Buffer} buffer - Buffer file CV
 * @param {string} mimeType - MIME type file (dari n8n)
 * @param {string} fileName - Nama file asli
 * @param {object} options - { useLibrary: boolean }
 * @returns {Promise<object>} { ok, text, fileType, errorFlag, errorMessage }
 */
async function parseCV(buffer, mimeType, fileName = '', options = {}) {
  const startTime = Date.now();

  // Validasi input
  if (!buffer || buffer.length === 0) {
    return {
      ok: false,
      text: '',
      fileType: 'unknown',
      errorFlag: 'parse_error',
      errorMessage: 'Buffer kosong atau tidak ada file',
    };
  }

  const fileType = detectFileType(buffer, mimeType, fileName);
  const useLibrary = options.useLibrary === true;

  try {
    let text = '';
    let errorFlag = '';
    let errorMessage = '';

    switch (fileType) {
      case 'pdf':
        text = await parsePDF(buffer, useLibrary);
        break;
      case 'docx':
        text = await parseDOCX(buffer);
        break;
      case 'txt':
        text = buffer.toString('utf8');
        break;
      case 'doc':
        errorFlag = 'format_unsupported';
        errorMessage = 'Format DOC lama tidak didukung, minta kandidat upload DOCX atau PDF';
        break;
      case 'zip':
        errorFlag = 'format_unsupported';
        errorMessage = 'File ZIP tidak didukung. Upload PDF atau DOCX.';
        break;
      default:
        errorFlag = 'format_unsupported';
        errorMessage = 'Format file tidak dikenal. Didukung: PDF, DOCX.';
        break;
    }

    // Cek timeout
    if (Date.now() - startTime > TIMEOUT_PARSE_MS) {
      return {
        ok: false,
        text: '',
        fileType,
        errorFlag: 'parse_error',
        errorMessage: 'Timeout parsing CV (' + TIMEOUT_PARSE_MS + 'ms)',
      };
    }

    // Cek hasil kosong
    if (errorFlag) {
      return { ok: false, text: '', fileType, errorFlag, errorMessage };
    }

    if (!text || !text.trim()) {
      return {
        ok: false,
        text: '',
        fileType,
        errorFlag: 'parse_error',
        errorMessage: 'Tidak ada teks yang bisa diekstrak dari CV (mungkin terenkripsi atau gambar-only)',
      };
    }

    return { ok: true, text: text.trim(), fileType, errorFlag: '', errorMessage: '' };
  } catch (err) {
    return {
      ok: false,
      text: '',
      fileType,
      errorFlag: 'parse_error',
      errorMessage: err.message || 'Error parsing CV',
    };
  }
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node parse-cv.js <path-to-file>');
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const mimeType = filePath.endsWith('.pdf') ? 'application/pdf'
    : filePath.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : '';

  parseCV(buffer, mimeType, path.basename(filePath)).then((result) => {
    console.log(JSON.stringify({
      ok: result.ok,
      fileType: result.fileType,
      errorFlag: result.errorFlag,
      errorMessage: result.errorMessage,
      textLength: result.text.length,
      textPreview: result.text.slice(0, 200),
    }, null, 2));
  }).catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { parseCV, detectFileType };