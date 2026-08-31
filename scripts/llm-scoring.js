/**
 * llm-scoring.js
 * ==============
 * LLM Enrichment + Scoring (Tahap 2 pipeline scoring).
 * 
 * Catatan desain (architecture.md section 7.2):
 * - Input: teks CV + job deskripsi/kriteria + bobot
 * - Output: JSON dengan field skor, skill_terdeteksi, alasan_llm, enrichment_notes
 * - Instruksi LLM mencakup logika "skill ekuivalen/superior"
 *   (contoh: Adobe Premiere > Capcut)
 * - Bahasa output LLM: Indonesia
 * - LLM gagal setelah retry 3x → fallback ke rule-based scoring (tanpa enrichment)
 * - Timeout LLM: 120 detik
 * 
 * Cara pakai:
 *   const { llmScoring, fallbackRuleScoring } = require('./llm-scoring.js');
 *   const result = await llmScoring(cvText, { kriteria, bobot }, { apiKey, apiUrl, model });
 */

'use strict';

const { retryWithBackoff } = require('./retry-helpers.js');

// ============================================================
// CONSTANTS
// ============================================================
const DEFAULT_TIMEOUT_LLM_MS = (process.env.TIMEOUT_LLM || 120) * 1000; // 120s

// ============================================================
// UTILITAS: HTTP Call (tanpa dependency eksternal — pakai fetch node built-in)
// ============================================================
async function callLLMAPI(payload, config) {
  const { apiKey, apiUrl, model } = config;
  if (!apiUrl || !apiKey) {
    throw new Error('LLM API URL / API key belum diset (llmScoring)');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_LLM_MS);

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model || 'default',
        messages: [
          {
            role: 'system',
            content: payload.systemPrompt,
          },
          {
            role: 'user',
            content: payload.userPrompt,
          },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new Error('LLM API HTTP ' + resp.status + ': ' + bodyText.slice(0, 200));
    }

    const data = await resp.json();
    // Format OpenAI: data.choices[0].message.content
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : (data.content || '');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// UTILITAS: Parse JSON dari response LLM
// LLM mungkin membungkus JSON dengan teks lain/markdown. Standar-kan.
// ============================================================
function parseLLMResponse(rawContent) {
  if (!rawContent) return null;

  let content = String(rawContent).trim();

  // Hapus fenced code block ```json ... ```
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    content = fenceMatch[1].trim();
  }

  // Cari objek JSON pertama dalam teks
  try {
    return JSON.parse(content);
  } catch (_e) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (_e2) {
        return null;
      }
    }
    return null;
  }
}

// ============================================================
// UTILITAS: Normalisasi angka skor dari LLM
// ============================================================
function normalizeScore(rawSkor, min = 0, max = 100) {
  let s = Number(rawSkor);
  if (isNaN(s)) return null;
  if (s < min) s = min;
  if (s > max) s = max;
  return s;
}

// ============================================================
// BUILDER: Prompt untuk LLM
// ============================================================
function buildPrompt(cvText, options = {}) {
  const {
    kriteria = [],
    bobot = {},
    lowongan = '',
    jobDesc = '',
  } = options;

  const bobotSkill = typeof bobot.skill === 'number' ? bobot.skill : 0.40;
  const bobotPengalaman = typeof bobot.experience === 'number' ? bobot.experience : 0.35;
  const bobotPendidikan = typeof bobot.education === 'number' ? bobot.education : 0.25;

  const systemPrompt = [
    'Anda adalah asisten perekrut (HR) yang menilai kesesuaian CV kandidat.',
    'Anda harus menilai secara adil, objektif, dan konsisten.',
    'Tugas Anda:',
    '1. Ekstrak dari CV: skill yang terdeteksi, pengalaman kerja, dan latar belakang pendidikan.',
    '2. Deteksi apakah ada skill yang LEBIH UNGGUL (superior/ekuivalen) dari yang diwajibkan.',
    '   Contoh: untuk syarat "Capcut", kandidat yang menguasai "Adobe Premiere Pro" dianggap',
    '   memenuhi karena Premiere lebih advance dari Capcut. Jelaskan ini di enrichment_notes.',
    '3. Hitung skor 0-100 berdasarkan bobot berikut:',
    '   - Skill: ' + (bobotSkill * 100) + '%',
    '   - Pengalaman: ' + (bobotPengalaman * 100) + '%',
    '   - Pendidikan: ' + (bobotPendidikan * 100) + '%',
    '4. Berikan alasan singkat (2-3 kalimat) dalam Bahasa Indonesia yang mudah dipahami.',
    '',
    'Level skill ekuivalen yang umum (untuk referensi superioritas):',
    '- Video editing: Capcut < Premiere Pro, DaVinci Resolve, After Effects',
    '- Spreadsheet: Excel ≥ Google Sheets',
    '- Coding: Python/Java/C++ setara atau lebih advance dari basic script',
    '- Design: Canva < Photoshop, Figma, Illustrator',
    '- CRM: HubSpot, Salesforce ≥ tool CRM sederhana',
    '',
    'Output HARUS berupa JSON (tanpa teks lain) dengan format:',
    '{',
    '  "skor": <angka 0-100>,',
    '  "skill_terdeteksi": ["...", "..."],',
    '  "alasan_llm": "<2-3 kalimat bahasa Indonesia>",',
    '  "enrichment_notes": "<catatan skill ekuivalen/unggul jika ada, bahasa Indonesia>"',
    '}',
  ].join('\n');

  const userPrompt = [
    '=== LOWONGAN ===',
    lowongan || '(tidak disebutkan)',
    '',
    '=== JOB DESKRIPSI ===',
    jobDesc || '(tidak ada)',
    '',
    '=== KRITERIA WAJIB ===',
    (Array.isArray(kriteria) && kriteria.length > 0)
      ? kriteria.join(', ')
      : '(tidak ada kriteria wajib spesifik)',
    '',
    '=== ISI CV KANDIDAT ===',
    cvText || '(CV kosong)',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

// ============================================================
// FALLBACK: Rule-Based Scoring (saat LLM gagal)
// Hitung skor sederhana dari pencocokan kata kunci.
// ============================================================
function fallbackRuleScoring(cvText, options = {}) {
  const {
    kriteria = [],
    bobot = {},
  } = options;

  const normalizedCV = String(cvText || '').toLowerCase();
  const bobotSkill = typeof bobot.skill === 'number' ? bobot.skill : 0.40;
  const bobotPengalaman = typeof bobot.experience === 'number' ? bobot.experience : 0.35;
  const bobotPendidikan = typeof bobot.education === 'number' ? bobot.education : 0.25;

  // Pisahkan kriteria berdasarkan tipe (jika ada prefiks)
  const skillKriteria = [];
  const experienceKriteria = [];
  const educationKriteria = [];

  for (const k of kriteria) {
    const lower = String(k).toLowerCase();
    if (lower.startsWith('pengalaman:')) experienceKriteria.push(String(k).slice(11).trim());
    else if (lower.startsWith('pendidikan:')) educationKriteria.push(String(k).slice(11).trim());
    else skillKriteria.push(String(k));
  }

  // Hitung score per komponen (0-100)
  const scoreComponent = (items) => {
    if (items.length === 0) return 100; // tidak ada kriteria → dianggap penuh (netral)
    let hit = 0;
    for (const item of items) {
      // Normalisasi variasi kata kunci (hilangkan spasi, .) untuk matching longgar
      const itemKey = String(item).toLowerCase().replace(/[.\s]/g, '');
      if (itemKey && normalizedCV.includes(itemKey)) hit++;
    }
    return (hit / items.length) * 100;
  };

  const skillScore = scoreComponent(skillKriteria);
  const expScore = scoreComponent(experienceKriteria);
  const eduScore = scoreComponent(educationKriteria);

  const total = Math.round(
    skillScore * bobotSkill + expScore * bobotPengalaman + eduScore * bobotPendidikan
  );

  return {
    skor: total,
    skill_terdeteksi: [],
    alasan_llm: 'Skor dihitung dengan metode rule-based (fallback karena LLM tidak tersedia).',
    enrichment_notes: 'Fallback scoring — enrichment LLM dilewati.',
    fallback: true,
  };
}

// ============================================================
// FUNGSI UTAMA: LLM Scoring dengan retry
// ============================================================
/**
 * Lakukan enrichment + scoring via LLM, dengan retry & fallback.
 * @param {string} cvText - Teks CV hasil parsing
 * @param {object} options - { kriteria, bobot, lowongan, jobDesc }
 * @param {object} config - { apiKey, apiUrl, model }
 * @returns {Promise<object>} Hasil scoring (dari LLM atau fallback)
 */
async function llmScoring(cvText, options = {}, config = {}) {
  const apiKey = config.apiKey || process.env.LLM_API_KEY;
  const apiUrl = config.apiUrl || process.env.LLM_API_URL;
  const model = config.model || process.env.LLM_MODEL;

  // Jika config LLM tidak lengkap → langsung fallback rule-based
  if (!apiKey || !apiUrl) {
    const fb = fallbackRuleScoring(cvText, options);
    return { ...fb, errorFlag: 'llm_config_missing' };
  }

  const payload = buildPrompt(cvText, options);

  const retryResult = await retryWithBackoff(
    () => callLLMAPI(payload, { apiKey, apiUrl, model }),
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      multiplier: 3,
      timeoutMs: DEFAULT_TIMEOUT_LLM_MS,
    }
  );

  if (!retryResult.ok) {
    // Fallback rule-based setelah LLM gagal
    const fb = fallbackRuleScoring(cvText, options);
    return {
      ...fb,
      errorFlag: 'llm_error',
      errorMessage: retryResult.error ? retryResult.error.message : 'LLM gagal',
    };
  }

  // Parse response LLM
  const parsed = parseLLMResponse(retryResult.data);
  if (!parsed) {
    const fb = fallbackRuleScoring(cvText, options);
    return {
      ...fb,
      errorFlag: 'llm_parse_error',
      errorMessage: 'Response LLM tidak bisa diparse sebagai JSON',
    };
  }

  // Normalisasi skor
  const skor = normalizeScore(parsed.skor);
  if (skor === null) {
    const fb = fallbackRuleScoring(cvText, options);
    return {
      ...fb,
      errorFlag: 'llm_invalid_score',
      errorMessage: 'Skor dari LLM tidak valid: ' + parsed.skor,
    };
  }

  return {
    skor,
    skill_terdeteksi: Array.isArray(parsed.skill_terdeteksi) ? parsed.skill_terdeteksi : [],
    alasan_llm: String(parsed.alasan_llm || ''),
    enrichment_notes: String(parsed.enrichment_notes || ''),
    attempts: retryResult.attempts,
    retries: retryResult.retries,
    errorFlag: '',
    errorMessage: '',
    fallback: false,
  };
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const cvText = process.argv[2] || '';
  const kriteriaCsv = process.argv[3] || 'CRM, B2B sales';

  const kriteria = kriteriaCsv.split(',').map((s) => s.trim());

  // Test mode: tanpa API key → fallback rule-based
  const result = fallbackRuleScoring(cvText, {
    kriteria,
    bobot: { skill: 0.4, experience: 0.35, education: 0.25 },
  });
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { llmScoring, fallbackRuleScoring, parseLLMResponse, buildPrompt, normalizeScore };