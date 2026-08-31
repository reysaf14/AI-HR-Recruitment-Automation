/**
 * rule-check.js
 * =============
 * Rule Check — Syarat Wajib (Tahap 1 pipeline scoring).
 * 
 * Catatan desain (architecture.md section 2):
 * - Membaca kriteria wajib dari Sheet "Kriteria Lowongan"
 * - Mengecek apakah semua syarat wajib ditemukan dalam teks CV
 * - Output: rule_check = "Memenuhi" | "Tidak Memenuhi" + alasan
 * - Jika tidak memenuhi → skor 0, kategori Low, TANPA LLM (hemat token)
 * 
 * Cara pakai dari n8n Code Node:
 *   const { ruleCheck } = require('./rule-check.js');
 *   const result = ruleCheck(cvText, kriteriaWajib, lowonganNama);
 */

'use strict';

// ============================================================
// UTILITAS: Normalisasi teks
// ============================================================
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s+]/gi, ' ') // ganti karakter non-alphanumeric dengan spasi (pertahankan +)
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// UTILITAS: Cek kemiripan skill
// Handle variasi penulisan: "node.js" vs "nodejs", "c#" vs "c sharp"
// ============================================================
function skillVariants(skill) {
  const normalized = normalizeText(skill);
  const variants = new Set([normalized]);

  // Hilangkan spasi: "node js" → "nodejs"
  variants.add(normalized.replace(/\s+/g, ''));

  // Ganti . dengan spasi: "node.js" → "node js"
  variants.add(normalized.replace(/\./g, ' '));

  // Ganti # dengan "sharp": "c#" → "c sharp"
  if (normalized.includes('#')) {
    variants.add(normalized.replace(/#/g, ' sharp'));
  }

  // Hilangkan simbol +: "c++" → "c"
  variants.add(normalized.replace(/\+/g, ''));

  // Gabungan semua
  variants.add(normalized.replace(/[.#]/g, ' ').replace(/\s+/g, ' '));

  return [...variants].filter((v) => v.length > 0);
}

// ============================================================
// UTILITAS: Parsing kriteria wajib
// Kriteria bisa dipisah dengan koma, newline, atau titik-koma
// Format per item: "skill: nama skill" atau "nama skill"
// ============================================================
function parseKriteriaWajib(kriteriaRaw) {
  if (!kriteriaRaw) return [];

  const parts = String(kriteriaRaw)
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Deteksi prefiks tipe
  const parsed = parts.map((part) => {
    const lower = part.toLowerCase();
    let tipe = 'skill';
    let nilai = part;

    if (lower.startsWith('skill:')) { tipe = 'skill'; nilai = part.slice(6).trim(); }
    else if (lower.startsWith('pengalaman:')) { tipe = 'experience'; nilai = part.slice(11).trim(); }
    else if (lower.startsWith('pendidikan:')) { tipe = 'education'; nilai = part.slice(11).trim(); }

    return { tipe, nilai };
  });

  return parsed;
}

// ============================================================
// FUNGSI UTAMA
// ============================================================
/**
 * Rule check: cek apakah CV memenuhi semua syarat wajib.
 * @param {string} cvText - Teks CV hasil parsing
 * @param {string|array} kriteriaWajib - Kriteria wajib (string dipisah koma/newline, atau array)
 * @param {string} lowonganNama - Nama lowongan (untuk logging)
 * @returns {object} { ruleCheck, alasan, kriteriaTerpenuhi, kriteriaGagal, lowongan }
 */
function ruleCheck(cvText, kriteriaWajib, lowonganNama = '') {
  const cvNormalized = normalizeText(cvText);

  if (!cvNormalized) {
    return {
      ruleCheck: 'Tidak Memenuhi',
      alasan: 'Teks CV kosong — tidak bisa diverifikasi syarat wajib.',
      kriteriaTerpenuhi: [],
      kriteriaGagal: parseKriteriaWajib(kriteriaWajib).map((k) => k.nilai),
      lowongan: lowonganNama,
    };
  }

  const kriteriaList = Array.isArray(kriteriaWajib)
    ? kriteriaWajib.map((k) => ({ tipe: 'skill', nilai: String(k) }))
    : parseKriteriaWajib(kriteriaWajib);

  if (kriteriaList.length === 0) {
    return {
      ruleCheck: 'Memenuhi',
      alasan: 'Tidak ada kriteria wajib yang ditentukan — semua kandidat lolos tahap 1.',
      kriteriaTerpenuhi: [],
      kriteriaGagal: [],
      lowongan: lowonganNama,
    };
  }

  const kriteriaTerpenuhi = [];
  const kriteriaGagal = [];

  for (const kriteria of kriteriaList) {
    const variants = skillVariants(kriteria.nilai);
    const found = variants.some((v) => cvNormalized.includes(v));

    if (found) {
      kriteriaTerpenuhi.push(kriteria.nilai);
    } else {
      kriteriaGagal.push(kriteria.nilai);
    }
  }

  const passes = kriteriaGagal.length === 0;
  const alasan = passes
    ? 'Semua syarat wajib terpenuhi di CV.'
    : 'Tidak memenuhi syarat wajib: ' + kriteriaGagal.join(', ');

  return {
    ruleCheck: passes ? 'Memenuhi' : 'Tidak Memenuhi',
    alasan,
    kriteriaTerpenuhi,
    kriteriaGagal,
    lowongan: lowonganNama,
  };
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const cvText = process.argv[2] || '';
  const kriteria = process.argv[3] || '';

  const result = ruleCheck(cvText, kriteria, 'TEST LOWONGAN');
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { ruleCheck, parseKriteriaWajib, normalizeText, skillVariants };