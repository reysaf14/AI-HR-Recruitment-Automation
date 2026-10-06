'use strict';

// Focused local edge/worst-case checks. No Google, Gmail, Drive, or LLM calls.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const AdmZip = require('adm-zip');

const { parseCV } = require('../scripts/parse-cv.js');
const { ruleCheck } = require('../scripts/rule-check.js');
const { isDuplicate } = require('../scripts/dedup-check.js');
const { normalizeScore, fallbackRuleScoring } = require('../scripts/llm-scoring.js');
const { kategoriBySkor } = require('../scripts/rule-kategori.js');
const { safePath } = require('../scripts/buffer-manager.js');
const { hrNotificationEmail } = require('../scripts/email-templates.js');

const screening = JSON.parse(fs.readFileSync(
  require.resolve('../n8n-workflows/screening-pipeline.json'),
  'utf8'
));

function node(name) {
  const found = screening.nodes.find((item) => item.name === name);
  assert.ok(found, `Node tidak ditemukan: ${name}`);
  return found;
}

function runCode(name, inputItems, env = {}, refs = {}, helpers = {}) {
  const code = node(name).parameters.jsCode || '';
  const input = { all: () => inputItems, first: () => inputItems[0] || { json: {} } };
  const lookup = (nodeName) => ({
    all: () => refs[nodeName] || [],
    first: () => (refs[nodeName] || [])[0] || { json: {} },
  });
  return new Function('$input', '$env', '$', 'helpers', code)(input, env, lookup, helpers);
}

function evaluateN8nExpression(value, json) {
  assert.ok(typeof value === 'string' && value.startsWith('='), 'Expression n8n tidak valid');
  const expression = value.slice(1).replace(/^\s*\{\{\s*/, '').replace(/\s*\}\}\s*$/, '');
  return new Function('$json', `return ${expression};`)(json);
}

async function main() {
  const results = [];
  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
      console.log(`  FAIL ${name}: ${error.message}`);
    }
  }

  console.log('=== EDGE/WORST-CASE TEST SUITE ===');

  await check('empty CV is rejected without throwing', async () => {
    const result = await parseCV(Buffer.alloc(0), 'text/plain', 'empty.txt');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorFlag, 'parse_error');
  });

  await check('whitespace-only CV is rejected', async () => {
    const result = await parseCV(Buffer.from(' \n\t '), 'text/plain', 'blank.txt');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorFlag, 'parse_error');
  });

  await check('unsupported image/zip is rejected explicitly', async () => {
    const result = await parseCV(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png', 'cv.png');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorFlag, 'format_unsupported');
  });

  await check('real compressed DOCX text is extracted', async () => {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
    zip.addFile('word/document.xml', Buffer.from(
      '<w:document><w:body><w:p><w:r><w:t>CRM B2B sales pengalaman 3 tahun</w:t></w:r></w:p></w:body></w:document>'
    ));
    const result = await parseCV(
      zip.toBuffer(),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'candidate.docx',
      { useLibrary: true }
    );
    assert.strictEqual(result.ok, true);
    assert.ok(result.text.includes('CRM B2B sales'));
  });

  await check('empty CV does not pass required rules', async () => {
    const result = ruleCheck('', ['CRM', 'pengalaman: 3 tahun']);
    assert.strictEqual(result.ruleCheck, 'Tidak Memenuhi');
    assert.deepStrictEqual(result.kriteriaGagal, ['CRM', '3 tahun']);
  });

  await check('special skill spelling variants match', async () => {
    const result = ruleCheck('Menguasai Node.js, C# dan C++.', ['Node.js', 'C#', 'C++']);
    assert.strictEqual(result.ruleCheck, 'Memenuhi');
  });

  await check('rule matching rejects substring false positives', async () => {
    const experience = ruleCheck('Pengalaman 13 tahun sebagai engineer.', ['pengalaman: 3 tahun']);
    const language = ruleCheck('Google Analytics dan Google Tag Manager.', ['Go']);
    assert.strictEqual(experience.ruleCheck, 'Tidak Memenuhi');
    assert.strictEqual(language.ruleCheck, 'Tidak Memenuhi');
  });

  await check('fallback scoring rejects substring false positives', async () => {
    const result = fallbackRuleScoring('Pengalaman 13 tahun dan Google Analytics.', {
      kriteria: ['Go', 'pengalaman: 3 tahun'],
      bobot: { skill: 0.4, experience: 0.35, education: 0.25 },
    });
    assert.strictEqual(result.skor, 25);
  });

  await check('old and future duplicate timestamps are handled deterministically', async () => {
    const rows = [
      { Email: 'candidate@example.com', Lowongan: 'Sales', Timestamp: new Date(Date.now() - 25 * 3600 * 1000).toISOString() },
      { Email: 'future@example.com', Lowongan: 'Sales', Timestamp: new Date(Date.now() + 2 * 3600 * 1000).toISOString() },
    ];
    const oldResult = isDuplicate('candidate@example.com', 'Sales', rows, 24);
    const futureResult = isDuplicate('future@example.com', 'Sales', rows, 24);
    assert.strictEqual(oldResult.isDuplicate, true);
    assert.strictEqual(futureResult.isDuplicate, true);
  });

  await check('score normalization rejects non-finite values', async () => {
    assert.strictEqual(normalizeScore(Infinity), null);
    assert.strictEqual(normalizeScore('Infinity'), null);
    assert.strictEqual(normalizeScore('NaN'), null);
  });

  await check('n8n LLM node falls back on non-finite model score', async () => {
    const result = await runCode(
      'LLM Scoring (Code Node + Retry)',
      [{ json: {
        textCV: 'CRM pengalaman 3 tahun S1',
        kriteria: ['CRM', 'pengalaman: 3 tahun', 'pendidikan: S1'],
        bobotSkill: 0.4,
        bobotPengalaman: 0.35,
        bobotPendidikan: 0.25,
      } }],
      { LLM_API_KEY: 'synthetic-key', LLM_API_URL: 'https://invalid.local', LLM_MODEL: 'synthetic-model' },
      {},
      { httpRequest: async () => ({ choices: [{ message: { content: '{"skor":"Infinity"}' } }] }) }
    );
    assert.strictEqual(result[0].json.errorFlag, 'llm_fallback');
    assert.ok(result[0].json.skorLLM >= 0 && result[0].json.skorLLM <= 100);
  });

  await check('n8n parser marks corrupt DOCX as parse error', async () => {
    const encoded = Buffer.from('PK\x03\x04not-a-real-docx', 'binary').toString('base64');
    const result = await runCode('Parse CV (Code Node)', [{ json: {
      file: { data: encoded, fileName: 'corrupt.docx' },
    } }]);
    assert.strictEqual(result[0].json.cvFileType, 'docx');
    assert.strictEqual(result[0].json.parseErrorFlag, 'parse_error');
    assert.strictEqual(result[0].json.textCV, '');
  });

  await check('n8n parser marks corrupt PDF as parse error', async () => {
    const encoded = Buffer.from('%PDF-1.4 definitely-corrupt', 'utf8').toString('base64');
    const result = await runCode('Parse CV (Code Node)', [{ json: {
      file: { data: encoded, fileName: 'corrupt.pdf' },
    } }]);
    assert.strictEqual(result[0].json.cvFileType, 'pdf');
    assert.strictEqual(result[0].json.parseErrorFlag, 'parse_error');
    assert.strictEqual(result[0].json.textCV, '');
  });

  await check('category boundaries remain deterministic', async () => {
    assert.strictEqual(kategoriBySkor(79, { ambangHigh: 80, ambangLow: 40 }).kategori, 'Medium');
    assert.strictEqual(kategoriBySkor(80, { ambangHigh: 80, ambangLow: 40 }).kategori, 'High');
    assert.strictEqual(kategoriBySkor(-Infinity, { ambangHigh: 80, ambangLow: 40 }).kategori, 'Low');
  });

  await check('buffer path traversal cannot escape into a sibling prefix', async () => {
    assert.strictEqual(safePath('..\\buffer-evil\\outside.json'), null);
    assert.strictEqual(safePath('nested\\inside.json') !== null, true);
  });

  await check('HR email expression tolerates missing optional fields', async () => {
    const gmail = node('Notifikasi HR');
    const body = evaluateN8nExpression(gmail.parameters.message, {
      kategori: 'Medium',
      kategoriLabel: undefined,
      nama: undefined,
      email: undefined,
      lowongan: undefined,
      skorLLM: 40,
      skillTerdeteksi: undefined,
      alasanSkor: undefined,
    });
    assert.ok(typeof body === 'string');
  });

  await check('HR template escapes worst-case HTML payload', async () => {
    const result = hrNotificationEmail({
      nama: '<img src=x onerror="alert(1)">',
      lowongan: '<script>bad</script>',
      kategori: 'High',
      label: 'Layak',
      skor: 100,
      alasan: '<b>bad</b>',
      skill: ['<svg onload=alert(1)>'],
      emailKandidat: 'candidate@example.com',
      hrEmail: 'hr@example.com',
    });
    assert.ok(!result.bodyHtml.includes('<img'));
    assert.ok(!result.bodyHtml.includes('<script>'));
    assert.ok(result.bodyHtml.includes('&lt;img'));
  });

  const failed = results.filter((item) => !item.ok);
  console.log(`=== SUMMARY: ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
