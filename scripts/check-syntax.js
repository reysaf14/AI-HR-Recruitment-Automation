'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptsDir = __dirname;
const files = fs.readdirSync(scriptsDir)
  .filter((name) => name.endsWith('.js') && name !== path.basename(__filename))
  .sort();

let failed = 0;
for (const name of files) {
  const file = path.join(scriptsDir, name);
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed++;
}

console.log(`Syntax check: ${files.length - failed}/${files.length} passed`);
process.exit(failed === 0 ? 0 : 1);
