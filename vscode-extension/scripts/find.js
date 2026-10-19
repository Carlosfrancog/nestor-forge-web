#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { route } = require('../src/contextRouter');

function usage() {
  return 'Uso: node scripts/find.js --root <projeto> [--json] "<missão>"';
}
function readJson(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}
function main(args = process.argv.slice(2)) {
  let root;
  let json = false;
  const words = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--root') root = args[++index];
    else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') { process.stdout.write(usage() + '\n'); return 0; }
    else if (arg.startsWith('--')) throw new Error(`Opção desconhecida: ${arg}`);
    else words.push(arg);
  }
  if (!root || !words.length) throw new Error(usage());
  root = path.resolve(root);
  const directory = path.join(root, '.agentorchestra', 'context');
  const meta = readJson(path.join(directory, 'index-meta.json'));
  if (!meta || meta.schemaVersion !== 1) throw new Error('Índice de contexto ausente ou com versão desconhecida. Construa o índice pelo Agent Orchestra.');
  const indexFile = path.join(directory, 'index.jsonl');
  const stat = fs.lstatSync(indexFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Índice de contexto inválido.');
  const records = fs.readFileSync(indexFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const rawClassification = readJson(path.join(root, 'graphify-out', 'classification.json'));
  const classification = rawClassification?.schemaVersion === 1 &&
    rawClassification.format === 'graphy-refat.classification.v1' ? rawClassification : null;
  const mission = words.join(' ');
  const needsLogic = /\b[a-z][\w-]*(?:\.[a-z][\w-]*)+\b|\/[a-z][\w/{}.-]*/i.test(mission);
  const needsSchema = /\b(?:tabela|table|coluna|column)\b|\b[a-z][\w]*_[a-z][\w]*\b/i.test(mission);
  const rawLogic = needsLogic ? readJson(path.join(root, 'graphify-out', 'logic.json')) : null;
  const rawSchema = needsSchema ? readJson(path.join(root, 'graphify-out', 'schema.json')) : null;
  const logic = rawLogic?.schemaVersion && rawLogic.schemaVersion !== 1 ? null : rawLogic;
  const schema = rawSchema?.schemaVersion && rawSchema.schemaVersion !== 1 ? null : rawSchema;
  const result = route({ records, meta }, mission, { root, classification, logic, schema });
  process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : result.card);
  return 0;
}
if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { main };
