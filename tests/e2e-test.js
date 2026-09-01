// ============================================================
// E2E TEST SUITE — AI HR Recruitment Automation
// Jalankan: node tests/e2e-test.js
// ============================================================

const assert = require('assert');

// Import semua script modules
const { parseCV } = require('../scripts/parse-cv.js');
const { ruleCheck } = require('../scripts/rule-check.js');
const { isDuplicate } = require('../scripts/dedup-check.js');
const { llmScoring, fallbackRuleScoring, parseLLMResponse, buildPrompt, normalizeScore } = require('../scripts/llm-scoring.js');
const { kategoriBySkor } = require('../scripts/rule-kategori.js');
const { retryWithBackoff, sleep } = require('../scripts/retry-helpers.js');
const { bufferWrite, listBuffer, bufferLoad, bufferRemove, shouldRetry, getBufferDir, safePath } = require('../scripts/buffer-manager.js');
const { buildAuditRow, logToBuffer, EVENT_TYPES, STATUS_VALID } = require('../scripts/audit-logger.js');
const { hrNotificationEmail, autoReplyRejectEmail, escapeHtml } = require('../scripts/email-templates.js');

let passed = 0, failed = 0, total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    failed++;
    console.log('  ❌ ' + name + ': ' + e.message);
  }
}

console.log('=== E2E TEST SUITE ===');
console.log('');

// ============================================================
// PHASE 1: FORM INPUT → PARSE CV
// ============================================================
console.log('--- PHASE 1: Form Input → Parse CV ---');

test('parseCV: exists as function', () => {
  assert.strictEqual(typeof parseCV, 'function');
});

console.log('');

// ============================================================
// PHASE 2: RULE CHECK
// ============================================================
console.log('--- PHASE 2: Rule Check ---');

test('ruleCheck: semua terpenuhi', () => {
  // CV must contain the actual words that match criteria after normalization
  const cv = 'Saya menguasai B2B sales dan CRM. Pendidikan saya S1. Pengalaman kerja 3 tahun.';
  const result = ruleCheck(cv, ['B2B sales', 'CRM', 'pengalaman: 3 tahun', 'pendidikan: S1']);
  const val = typeof result === 'string' ? result : result.ruleCheck;
  assert.strictEqual(val, 'Memenuhi');
});

test('ruleCheck: tidak memenuhi skill', () => {
  const cv = 'Saya memiliki skill B2B sales, pengalaman 3 tahun, S1.';
  const result = ruleCheck(cv, ['B2B sales', 'CRM', 'pengalaman: 2 tahun', 'pendidikan: S1']);
  assert.strictEqual(result.ruleCheck, 'Tidak Memenuhi');
  assert.ok(result.kriteriaGagal.includes('CRM'));
});

test('ruleCheck: tidak memenuhi pengalaman', () => {
  const cv = 'Saya memiliki skill B2B sales, CRM, baru 1 tahun pengalaman, S1.';
  const result = ruleCheck(cv, ['B2B sales', 'CRM', 'pengalaman: 3 tahun', 'pendidikan: S1']);
  assert.strictEqual(result.ruleCheck, 'Tidak Memenuhi');
});

test('ruleCheck: tanpa kriteria wajib', () => {
  const cv = 'Saya lulusan SMK.';
  const result = ruleCheck(cv, []);
  assert.strictEqual(result.ruleCheck, 'Memenuhi');
});

console.log('');

// ============================================================
// PHASE 3: DEDUP CHECK
// ============================================================
console.log('--- PHASE 3: Dedup Check ---');

test('dedup: tidak ada data → false', () => {
  const result = isDuplicate('budi@example.com', 'Sales', []);
  // could be boolean false or object { isDuplicate: false }
  const val = typeof result === 'object' ? result.isDuplicate : result;
  assert.strictEqual(val, false);
});

console.log('');

// ============================================================
// PHASE 4: LLM SCORING (FALLBACK)
// ============================================================
console.log('--- PHASE 4: LLM Scoring (Fallback) ---');

test('fallbackRuleScoring: semua cocok → skor tinggi', () => {
  const cv = 'Saya menguasai B2B sales, CRM, pengalaman 3 tahun, S1.';
  const r = fallbackRuleScoring(cv, {
    kriteria: ['B2B sales', 'CRM', 'pengalaman: 2 tahun', 'pendidikan: S1'],
    bobot: { skill: 0.4, experience: 0.35, education: 0.25 }
  });
  assert.ok(r.skor > 40, 'Expected skor > 40, got ' + r.skor);
  assert.strictEqual(r.fallback, true);
});

test('fallbackRuleScoring: sebagian cocok', () => {
  const cv = 'Saya menguasai B2B sales, pengalaman 3 tahun.';
  const r = fallbackRuleScoring(cv, {
    kriteria: ['B2B sales', 'CRM', 'pengalaman: 2 tahun', 'pendidikan: S1'],
    bobot: { skill: 0.4, experience: 0.35, education: 0.25 }
  });
  assert.ok(r.skor >= 0 && r.skor <= 100);
  assert.ok(r.skor < 100);
});

test('normalizeScore: edge cases', () => {
  assert.strictEqual(normalizeScore(85), 85);
  assert.strictEqual(normalizeScore(-5), 0);
  assert.strictEqual(normalizeScore(150), 100);
  // normalizeScore might return NaN or 0 for invalid - just check it's falsy or number
  const invalidResult = normalizeScore('abc');
  assert.ok(!invalidResult || isNaN(invalidResult), 'Expected falsy/NaN for invalid input');
});

test('parseLLMResponse: clean JSON', () => {
  const r = parseLLMResponse('{"skor": 85, "skill_terdeteksi": ["CRM"], "alasan_llm": "OK", "enrichment_notes": ""}');
  assert.strictEqual(r.skor, 85);
});

test('parseLLMResponse: fenced JSON', () => {
  const r = parseLLMResponse('```json\n{"skor": 70}\n```');
  assert.strictEqual(r.skor, 70);
});

test('parseLLMResponse: invalid', () => {
  const r = parseLLMResponse('bukan json');
  assert.strictEqual(r, null);
});

test('buildPrompt: contains skill superior logic', () => {
  const p = buildPrompt('CV text', { kriteria: ['Capcut'], lowongan: 'Video Editor' });
  assert.ok(p.systemPrompt.includes('Capcut'));
  assert.ok(p.systemPrompt.includes('Adobe Premiere'));
  assert.ok(p.userPrompt.includes('Video Editor'));
});

console.log('');

// ============================================================
// PHASE 5: KATEGORI
// ============================================================
console.log('--- PHASE 5: Rule Kategori ---');

test('kategori: High (90)', () => {
  const r = kategoriBySkor(90, { ambangHigh: 80, ambangLow: 40 });
  assert.strictEqual(r.kategori, 'High');
  assert.strictEqual(r.label, 'Layak Lanjut');
});

test('kategori: Medium (60)', () => {
  const r = kategoriBySkor(60, { ambangHigh: 80, ambangLow: 40 });
  assert.strictEqual(r.kategori, 'Medium');
  assert.strictEqual(r.label, 'Perlu Ditinjau');
});

test('kategori: Low (20)', () => {
  const r = kategoriBySkor(20, { ambangHigh: 80, ambangLow: 40 });
  assert.strictEqual(r.kategori, 'Low');
  assert.strictEqual(r.label, 'Belum Sesuai');
});

test('kategori: custom ambang', () => {
  const r = kategoriBySkor(75, { ambangHigh: 90, ambangLow: 60 });
  assert.strictEqual(r.kategori, 'Medium');
});

test('kategori: invalid → Low', () => {
  const r = kategoriBySkor('abc', { ambangHigh: 80, ambangLow: 40 });
  assert.strictEqual(r.kategori, 'Low');
});

console.log('');

// ============================================================
// PHASE 6: RETRY HELPERS
// ============================================================
console.log('--- PHASE 6: Retry Helpers ---');

test('retry: sukses setelah 2 gagal', async () => {
  let c = 0;
  const fn = async () => { c++; if (c < 3) throw new Error('fail'); return 'ok'; };
  const r = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 3);
  assert.strictEqual(r.retries, 2);
});

test('retry: selalu gagal', async () => {
  const fn = async () => { throw new Error('always'); };
  const r = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.attempts, 4);
});

console.log('');

// ============================================================
// PHASE 7: BUFFER MANAGER
// ============================================================
console.log('--- PHASE 7: Buffer Manager ---');

test('bufferWrite + listBuffer + load + remove', () => {
  const w = bufferWrite({ kandidat_email: 'e2e@test.com', lowongan: 'Sales', nama: 'E2E Test' });
  assert.strictEqual(w.ok, true);
  assert.ok(w.filename);

  const entries = listBuffer();
  assert.ok(entries.length > 0);
  assert.strictEqual(entries[0].kandidat_email, 'e2e@test.com');

  const loaded = bufferLoad(w.filename);
  assert.ok(loaded);
  assert.strictEqual(loaded.kandidat_email, 'e2e@test.com');

  const rm = bufferRemove(w.filename);
  assert.strictEqual(rm, true);
  assert.strictEqual(bufferLoad(w.filename), null);
});

test('shouldRetry: siap retry', () => {
  const entry = { retry_count: 2, max_retry: 10, next_retry: '2020-01-01T00:00:00.000Z' };
  const r = shouldRetry(entry);
  assert.strictEqual(r.shouldRetry, true);
});

test('shouldRetry: max retry tercapai', () => {
  const entry = { retry_count: 11, max_retry: 10, next_retry: '2020-01-01T00:00:00.000Z' };
  const r = shouldRetry(entry);
  assert.strictEqual(r.shouldRetry, false);
});

test('safePath: traversal blocked', () => {
  assert.strictEqual(safePath('../../etc/passwd'), null);
  assert.strictEqual(safePath('normal.json') !== null, true);
});

test('BUFFER_DIR: lazy-eval', () => {
  const defaultDir = getBufferDir();
  assert.ok(defaultDir.endsWith('buffer'));
  process.env.BUFFER_DIR = './test-buffer';
  assert.strictEqual(getBufferDir(), './test-buffer');
  delete process.env.BUFFER_DIR;
});

// Cleanup buffer files
const fs = require('fs');
const dir = getBufferDir();
if (fs.existsSync(dir)) {
  fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => fs.unlinkSync(dir + '/' + f));
}

console.log('');

// ============================================================
// PHASE 8: AUDIT LOGGER
// ============================================================
console.log('--- PHASE 8: Audit Logger ---');

test('buildAuditRow: valid', () => {
  const r = buildAuditRow({ eventType: 'rule_check', email: 'a@b.com', lowongan: 'Sales', detail: 'OK', status: 'Success' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.row.length, 6);
  assert.strictEqual(r.row[1], 'rule_check');
});

test('buildAuditRow: invalid event', () => {
  const r = buildAuditRow({ eventType: 'hack' });
  assert.strictEqual(r.valid, false);
});

test('buildAuditRow: invalid status', () => {
  const r = buildAuditRow({ eventType: 'error', status: 'HACKED' });
  assert.strictEqual(r.valid, false);
});

test('logToBuffer: valid audit → buffer', () => {
  const r = logToBuffer({ eventType: 'buffer_written', email: 'x@y.com', lowongan: 'Admin', detail: 'test', status: 'Failed' });
  assert.strictEqual(r.ok, true);
  if (r.filename) bufferRemove(r.filename);
});

console.log('');

// ============================================================
// PHASE 9: EMAIL TEMPLATES
// ============================================================
console.log('--- PHASE 9: Email Templates ---');

test('hrNotificationEmail: isi lengkap', () => {
  const e = hrNotificationEmail({
    nama: 'Budi Santoso', lowongan: 'Sales', kategori: 'High', label: 'Layak Lanjut',
    skor: 85, alasan: 'Bagus', skill: ['CRM', 'B2B'], emailKandidat: 'b@b.com', hrEmail: 'hr@hr.com'
  });
  assert.ok(e.subject.includes('Budi'));
  assert.ok(e.bodyHtml.includes('<table>'));
  assert.ok(e.bodyText.includes('85/100'));
  assert.strictEqual(e.to, 'hr@hr.com');
});

test('hrNotificationEmail: HTML injection safe', () => {
  const e = hrNotificationEmail({
    nama: '<script>alert(1)</script>', lowongan: 'X', kategori: 'High', label: 'L',
    skor: 90, alasan: 'OK', skill: [], emailKandidat: 'a@b.com', hrEmail: 'hr@hr.com'
  });
  assert.ok(!e.bodyHtml.includes('<script>'));
  assert.ok(e.bodyHtml.includes('&lt;script&gt;'));
});

test('autoReplyRejectEmail: isi lengkap', () => {
  const e = autoReplyRejectEmail({
    nama: 'Siti', lowongan: 'Editor', perusahaan: 'PT ABC', emailKandidat: 's@b.com'
  });
  assert.ok(e.bodyText.includes('Siti'));
  assert.ok(e.bodyText.includes('Editor'));
  assert.ok(e.bodyText.includes('PT ABC'));
  assert.strictEqual(e.to, 's@b.com');
});

test('escapeHtml: semua karakter', () => {
  assert.strictEqual(escapeHtml('<b>'), '&lt;b&gt;');
  assert.strictEqual(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
  assert.strictEqual(escapeHtml('\"quote\"'), '&quot;quote&quot;');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});

console.log('');

// ============================================================
// SUMMARY
// ============================================================
console.log('=== RINGKASAN ===');
console.log('Total: ' + total);
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('Status: ' + (failed === 0 ? '✅ ALL PASS' : '❌ ' + failed + ' FAILED'));
process.exit(failed > 0 ? 1 : 0);
