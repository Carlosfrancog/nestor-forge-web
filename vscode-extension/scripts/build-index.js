#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { scanProject } = require('../src/projectMap');
const { readClassification } = require('../src/graphyClassification');
const { buildContextIndex, writeContextIndex } = require('../src/contextIndex');
const { writeHandoff } = require('../src/projectDocs');
const { recentGitChanges } = require('../src/gitChanges');

function usage() {
  return 'Uso: node scripts/build-index.js --root <projeto> [--handoff] [--cache-dir <pasta>] [--python <exe>] [--go <exe>] [--json]';
}
/** Cache fora do projeto, com a mesma chave por raiz que a extensão usa. */
function defaultCacheDir(root, env = process.env, platform = process.platform) {
  const base = platform === 'win32'
    ? env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const key = crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
  return path.join(base, 'agentorchestra', 'project-map', key);
}
function parseArgs(args) {
  const options = { handoff: false, json: false };
  const value = (index, name) => {
    if (index >= args.length || args[index].startsWith('--')) throw new Error(`Falta o valor de ${name}.\n${usage()}`);
    return args[index];
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--root') options.root = value(++index, arg);
    else if (arg === '--cache-dir') options.cacheDir = value(++index, arg);
    else if (arg === '--python') options.python = value(++index, arg);
    else if (arg === '--go') options.go = value(++index, arg);
    else if (arg === '--handoff') options.handoff = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Argumento desconhecido: ${arg}\n${usage()}`);
  }
  return options;
}
async function main(args = process.argv.slice(2), output = process.stdout) {
  const options = parseArgs(args);
  if (options.help) { output.write(usage() + '\n'); return 0; }
  if (!options.root) throw new Error(usage());
  const root = path.resolve(options.root);
  const cacheDir = path.resolve(options.cacheDir || defaultCacheDir(root));
  const report = await scanProject(root, { cacheDir, python: options.python, go: options.go });
  const classification = await readClassification(root);
  const index = await buildContextIndex(root, report, { classification });
  const written = await writeContextIndex(root, index);
  const result = { indexPath: written.indexPath, metaPath: written.metaPath, revision: index.meta.revision,
    counts: index.meta.counts, classification: index.meta.classification, warnings: index.meta.warnings.length };
  if (options.handoff) {
    report.git = { changes: await recentGitChanges(root) };
    const handoff = await writeHandoff(root, report);
    result.handoffPath = handoff.handoffPath;
    result.legacyDocs = handoff.warnings;
  }
  if (options.json) output.write(JSON.stringify(result, null, 2) + '\n');
  else {
    const counts = Object.entries(result.counts).map(([kind, count]) => `${kind} ${count}`).join(' · ');
    const state = !result.classification?.present ? 'ausente (agrupamento por diretório)'
      : result.classification.stale ? 'defasada; rode `bash graphy-refat/run.sh all`' : 'em dia';
    output.write(`Índice: ${path.relative(root, result.indexPath)}\n${counts}\nClassificação: ${state}\n` +
      (result.warnings ? `Avisos de leitura: ${result.warnings} (veja index-meta.json)\n` : '') +
      (result.handoffPath ? `Handoff: ${path.relative(root, result.handoffPath)}\n` : ''));
  }
  return 0;
}
if (require.main === module) {
  main().then(code => { process.exitCode = code; })
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
module.exports = { main, parseArgs, defaultCacheDir };
