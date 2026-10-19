'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseMarkdown } = require('./structural');

const CONTEXT_DIR = path.join('.agentorchestra', 'context');
const MAP_NOTE = 'graphify-out/vault-modules/CONTEXTO/_Mapa contextual.md';

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function tokens(value) { return Math.ceil(Buffer.byteLength(value) / 4); }
function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      value.includes(':') || path.posix.isAbsolute(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return value;
}
function classificationData(classification) {
  if (classification?.valid === false) return null;
  const value = classification?.data || classification;
  return value?.schemaVersion === 1 && value?.format === 'graphy-refat.classification.v1' ? value : null;
}
function short(value, limit) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function unitLabel(key) {
  return String(key || '').replace(/^(?:(?:setup|script|style):)*(?:class|method|function|module|rule|heading|instruction|statement|element|key|array):/, '')
    .replace(/\\/g, '.');
}
function linesOf(source) { return source.split(/\r?\n/); }
function boundedLines(symbol, lineCount) {
  const start = Math.min(Math.max(Number(symbol.line) || 1, 1), lineCount);
  const end = Math.min(Math.max(Number(symbol.endLine) || start, start), lineCount);
  return [start, end];
}
function docSummary(lines, start) {
  let cursor = start - 2;
  while (cursor >= 0 && !lines[cursor].trim()) cursor--;
  if (cursor < 0 || !/\*\//.test(lines[cursor])) return '';
  const end = cursor;
  while (cursor >= 0 && !/\/\*\*/.test(lines[cursor]) && end - cursor < 24) cursor--;
  if (cursor < 0 || !/\/\*\*/.test(lines[cursor])) return '';
  for (let i = cursor; i <= end; i++) {
    const clean = lines[i].replace(/^\s*\/\*\*?\s?/, '').replace(/^\s*\*\s?/, '').replace(/\*\/\s*$/, '').trim();
    if (clean && !clean.startsWith('@')) return short(clean, 160);
  }
  return '';
}
function unitSummary(lines, start) {
  return docSummary(lines, start) || short(lines[start - 1], 160);
}
function parentClassKey(key) {
  const match = String(key).match(/^(.*?)(method):(.+)\.([^.]*)$/);
  return match ? `${match[1]}class:${match[3]}` : null;
}
function plainMarkdown(value) {
  return value.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s*>\s*\[![^\]]+\]\s*/gim, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim();
}
function sectionWarnings(value) {
  const result = [];
  const lines = linesOf(value);
  for (let i = 0; i < lines.length && result.length < 5; i++) {
    const match = lines[i].match(/^\s*>\s*\[!warning\]\s*(.*)$/i);
    if (!match) continue;
    const parts = [match[1]];
    while (i + 1 < lines.length && /^\s*>\s*\S/.test(lines[i + 1]) && !/^\s*>\s*\[!/.test(lines[i + 1])) {
      parts.push(lines[++i].replace(/^\s*>\s*/, ''));
    }
    result.push(short(plainMarkdown(parts.join(' ')), 240));
  }
  return result.filter(Boolean);
}
async function readSafe(root, relative, readFile) {
  if (!safePath(relative)) return null;
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) return null;
  }
  try { return await readFile(current, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Build a deterministic hierarchy from an existing project map. */
async function buildContextIndex(root, report, { classification, readFile = fs.readFile } = {}) {
  const projectRoot = path.resolve(root);
  const data = classificationData(classification);
  const records = new Map();
  const add = record => { if (!records.has(record.id)) records.set(record.id, record); };
  add({ id: 'project', kind: 'project', parent: null, label: path.basename(projectRoot) });

  const modules = new Map((report.modules || []).map(module => [module.id, module]));
  for (const module of data?.modules || []) {
    if (typeof module.id !== 'string' || !module.id) continue;
    modules.set(module.id, { ...module, label: module.name || module.id, kind: 'graphy' });
  }
  for (const module of modules.values()) {
    add({ id: `module:${module.id}`, kind: 'module', parent: 'project', label: module.label || module.id });
    for (const layer of module.layers || []) {
      if (!layer?.name) continue;
      add({ id: `layer:${module.id}:${layer.name}`, kind: 'layer', parent: `module:${module.id}`, label: layer.name });
    }
  }

  for (const file of report.files || []) {
    if (file.status !== 'parsed' || !safePath(file.path)) continue;
    const moduleId = file.module || 'unclassified';
    const layer = file.layer || 'unknown';
    if (!records.has(`module:${moduleId}`)) add({ id: `module:${moduleId}`, kind: 'module', parent: 'project', label: moduleId });
    add({ id: `layer:${moduleId}:${layer}`, kind: 'layer', parent: `module:${moduleId}`, label: layer });
    const fileId = `file:${file.path}`;
    add({ id: fileId, kind: 'file', parent: `layer:${moduleId}:${layer}`, label: path.posix.basename(file.path),
      path: file.path, fingerprint: file.hash || null, imports: (file.imports || []).slice(0, 40),
      module: moduleId, layer, language: file.language || 'unknown', tokens: Math.ceil((file.bytes || 0) / 4) });
    if (!file.symbols?.length) continue;
    const source = await readSafe(projectRoot, file.path, readFile);
    const lines = source === null ? [] : linesOf(String(source));
    const keys = new Set(file.symbols.map(symbol => symbol.key));
    for (const symbol of file.symbols) {
      if (!symbol?.key || !lines.length) continue;
      const range = boundedLines(symbol, lines.length);
      const classKey = parentClassKey(symbol.key);
      const parent = classKey && keys.has(classKey) ? `unit:${file.path}#${classKey}` : fileId;
      add({ id: `unit:${file.path}#${symbol.key}`, kind: 'unit', parent,
        label: unitLabel(symbol.key), path: file.path, lines: range, unitKind: symbol.kind,
        fingerprint: symbol.fingerprint || null, calls: (symbol.calls || []).slice(0, 40),
        module: moduleId, layer, tokens: tokens(lines.slice(range[0] - 1, range[1]).join('\n')),
        summary: unitSummary(lines, range[0]) });
    }
  }

  async function addNote(relative, parent, moduleId, layer) {
    if (!safePath(relative) || !records.has(parent)) return;
    const source = await readSafe(projectRoot, relative, readFile);
    if (source === null) return;
    const noteId = `note:${relative}`;
    add({ id: noteId, kind: 'note', parent, label: path.posix.basename(relative, '.md'), path: relative });
    const text = String(source);
    const lines = linesOf(text);
    const headings = parseMarkdown(text).units.filter(unit => unit.key.startsWith('heading:'));
    for (let index = 0; index < headings.length; index++) {
      const heading = headings[index];
      if (!heading.key.startsWith('heading:2:')) continue;
      const title = lines[heading.line - 1].match(/^\s{0,3}##\s+(.+?)\s*#*\s*$/)?.[1] ||
        heading.key.slice('heading:2:'.length);
      let end = lines.length;
      for (let next = index + 1; next < headings.length; next++) {
        const level = Number(headings[next].key.match(/^heading:(\d):/)?.[1]);
        if (level <= 2) { end = headings[next].line - 1; break; }
      }
      const range = [heading.line, Math.max(heading.line, end)];
      const sectionText = lines.slice(range[0] - 1, range[1]).join('\n');
      add({ id: `section:${relative}#${title}`, kind: 'section', parent: noteId,
        label: title, path: relative, lines: range, fingerprint: digest(sectionText),
        module: moduleId || null, layer: layer || null, tokens: tokens(sectionText),
        summary: short(plainMarkdown(sectionText), 240), warnings: sectionWarnings(sectionText) });
    }
  }

  if (data) {
    for (const module of data.modules || []) {
      if (typeof module.id !== 'string' || !records.has(`module:${module.id}`)) continue;
      await addNote(module.note, `module:${module.id}`, module.id, null);
      for (const layer of module.layers || []) {
        if (!layer?.name) continue;
        await addNote(layer.note, `layer:${module.id}:${layer.name}`, module.id, layer.name);
      }
    }
    await addNote(MAP_NOTE, 'project', null, null);
  }

  const sorted = [...records.values()].sort((a, b) => compare(a.id, b.id));
  const counts = { modules: 0, layers: 0, files: 0, units: 0, notes: 0, sections: 0 };
  const names = { module: 'modules', layer: 'layers', file: 'files', unit: 'units', note: 'notes', section: 'sections' };
  for (const record of sorted) if (names[record.kind]) counts[names[record.kind]]++;
  const classificationMeta = { present: Boolean(classification?.present ?? report.classification?.present ?? data),
    revision: data?.revision ?? report.classification?.revision ?? null,
    stale: Boolean(classification?.stale ?? report.classification?.stale), profile: data?.profile || null };
  const meta = { schemaVersion: 1, generator: 'agentorchestra', revision: report.revision || null,
    classification: classificationMeta, counts, warnings: [...(report.warnings || []), ...(classification?.warnings || [])] };
  return { records: sorted, meta };
}

async function rejectSymlinks(root, target) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Raiz inválida: ${root}`);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Link simbólico não permitido: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function atomicWrite(target, content) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temporary, target); }
  finally { await fs.rm(temporary, { force: true }); }
}

/** Atomically publish the JSONL index and metadata under .agentorchestra/context. */
async function writeContextIndex(root, index) {
  const projectRoot = path.resolve(root);
  const directory = path.join(projectRoot, CONTEXT_DIR);
  const indexPath = path.join(directory, 'index.jsonl');
  const metaPath = path.join(directory, 'index-meta.json');
  await rejectSymlinks(projectRoot, directory);
  await fs.mkdir(directory, { recursive: true });
  await rejectSymlinks(projectRoot, indexPath);
  await rejectSymlinks(projectRoot, metaPath);
  const records = [...index.records].sort((a, b) => compare(a.id, b.id));
  await atomicWrite(indexPath, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  await atomicWrite(metaPath, `${JSON.stringify(index.meta, null, 2)}\n`);
  return { indexPath, metaPath };
}

module.exports = { buildContextIndex, writeContextIndex };
