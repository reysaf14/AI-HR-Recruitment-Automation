'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const screening = JSON.parse(fs.readFileSync(
  require.resolve('../n8n-workflows/screening-pipeline.json'),
  'utf8'
));
const autoReply = JSON.parse(fs.readFileSync(
  require.resolve('../n8n-workflows/auto-reply-cron.json'),
  'utf8'
));

const workflows = [screening, autoReply];
const nodes = new Map(workflows.flatMap((workflow) => workflow.nodes)
  .map((node) => [node.name, node]));

function codeFor(name) {
  const node = nodes.get(name);
  assert.ok(node, `Node tidak ditemukan: ${name}`);
  return node.parameters.jsCode || node.parameters.functionCode || '';
}

function runCode(name, inputItems, env = {}, referencedItems = {}) {
  const code = codeFor(name);
  const input = { all: () => inputItems };
  const nodeLookup = (nodeName) => ({ all: () => referencedItems[nodeName] || [] });
  return new Function('$input', '$env', '$', code)(input, env, nodeLookup);
}

async function main() {
  for (const workflow of workflows) {
    assert.ok(workflow.nodes.length > 0, `${workflow.name}: node kosong`);
    const names = new Set(workflow.nodes.map((node) => node.name));
    const ids = workflow.nodes.map((node) => node.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${workflow.name}: ID node duplikat`);

    for (const node of workflow.nodes) {
      assert.strictEqual(typeof node.typeVersion, 'number', `${workflow.name}/${node.name}: typeVersion harus number`);
      if (node.type === 'n8n-nodes-base.code') {
        new vm.Script(`(function(){${node.parameters.jsCode || node.parameters.functionCode || ''}\n})`);
      }
    }

    for (const [source, connection] of Object.entries(workflow.connections || {})) {
      assert.ok(names.has(source), `${workflow.name}: source tidak ditemukan ${source}`);
      for (const branch of Object.values(connection)) {
        for (const targets of branch) {
          for (const target of targets) {
            assert.ok(names.has(target.node), `${workflow.name}: target tidak ditemukan ${target.node}`);
          }
        }
      }
    }
  }

  const candidate = {
    nama: 'Budi Santoso',
    email: 'budi@example.com',
    lowongan: 'Sales Executive',
    file: {
      data: Buffer.from('B2B sales CRM pengalaman 3 tahun pendidikan S1').toString('base64'),
      fileName: 'budi.txt',
    },
    kriteria: ['B2B sales', 'CRM', 'pengalaman: 3 tahun', 'pendidikan: S1'],
    bobotSkill: 0.4,
    bobotPengalaman: 0.35,
    bobotPendidikan: 0.25,
  };

  const parsed = await runCode('Parse CV (Code Node)', [{ json: candidate }]);
  assert.strictEqual(parsed[0].json.textCV.includes('B2B sales'), true);

  const checked = runCode('Rule Check (Code Node)', parsed);
  assert.strictEqual(checked[0].json.ruleCheck, 'Memenuhi');

  const scored = await runCode(
    'LLM Scoring (Code Node + Retry)',
    checked,
    { LLM_API_KEY: '', LLM_API_URL: '', LLM_MODEL: '' }
  );
  assert.strictEqual(scored[0].json.skorLLM, 100);
  assert.strictEqual(scored[0].json.errorFlag, 'llm_config_missing');

  const categorized = runCode('Rule Kategori (Code Node)', scored);
  assert.strictEqual(categorized[0].json.kategori, 'High');

  const lowPrepared = runCode('Siapkan Baris Sheets', [{ json: {
    ...candidate,
    kategori: 'Low',
    kategoriLabel: 'Belum Sesuai',
    skorLLM: 20,
    ruleCheck: 'Tidak Memenuhi',
    alasanRuleCheck: 'Kriteria wajib tidak terpenuhi',
  } }]);
  assert.strictEqual(lowPrepared[0].json.sheetRow[16], 'Pending');

  const letters = 'ABCDEFGHIJKLMNOPQRS'.split('');
  const oldTimestamp = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const oldLowRow = Object.fromEntries(letters.map((letter, index) => [
    letter,
    index === 0 ? oldTimestamp : index === 12 ? 'Low' : index === 16 ? 'Pending' : '',
  ]));
  const filtered = runCode('Filter Low + Pending + 3 Hari', [{ json: oldLowRow }]);
  assert.strictEqual(filtered[0].json._shouldSend, true);

  const duplicate = runCode(
    'Dedup Check Flag',
    [{ json: { email: 'budi@example.com', lowongan: 'Sales Executive' } }],
    {},
    { 'Baca Data Existing (Sheets)': [{ json: {
      Email: 'budi@example.com',
      Lowongan: 'Sales Executive',
      Timestamp: new Date().toISOString(),
    } }] }
  );
  assert.strictEqual(duplicate[0].json.skipWrite, true);

  console.log('Workflow smoke test: PASS');
  console.log('  - import schema, graph, Code Node syntax: PASS');
  console.log('  - screening path TXT → rule → fallback → kategori: PASS');
  console.log('  - Low candidate persistence → cron filter: PASS');
  console.log('  - duplicate lookup: PASS');
}

main().catch((error) => {
  console.error('Workflow smoke test: FAIL');
  console.error(error.stack || error.message);
  process.exit(1);
});
