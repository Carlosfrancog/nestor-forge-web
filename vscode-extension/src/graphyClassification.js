'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const CLASSIFICATION_PATH = 'graphify-out/classification.json';
const FORMAT = 'graphy-refat.classification.v1';

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      value.startsWith('/') || /^[a-z]:/i.test(value)) return null;
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return value;
}

function warning(pathValue, message, kind = 'classification') {
  return { kind, path: pathValue, message };
}

async function headRevision(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'],
      { cwd: root, windowsHide: true, timeout: 5000 });
    return stdout.trim() || null;
  } catch { return null; }
}

async function readClassification(root) {
  const warnings = [];
  const result = { present: false, valid: false, warnings };
  const file = path.join(root, ...CLASSIFICATION_PATH.split('/'));
  try {
    const stat = await fs.lstat(file);
    result.present = true;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      warnings.push(warning(CLASSIFICATION_PATH, 'Classificação deve ser um arquivo regular, sem symlink.'));
      return result;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push(warning(CLASSIFICATION_PATH, error.message));
    return result;
  }
  let source;
  try { source = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { warnings.push(warning(CLASSIFICATION_PATH, `JSON inválido: ${error.message}`)); return result; }
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      source.schemaVersion !== 1 || source.format !== FORMAT) {
    warnings.push(warning(CLASSIFICATION_PATH, 'Versão ou formato de classificação desconhecido.'));
    return result;
  }
  if (!Array.isArray(source.modules) || !source.files || typeof source.files !== 'object' || Array.isArray(source.files)) {
    warnings.push(warning(CLASSIFICATION_PATH, 'Classificação sem modules ou files válidos.'));
    return result;
  }
  const modules = [];
  const moduleById = new Map();
  for (const item of source.modules) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name ||
        !Array.isArray(item.layers) || moduleById.has(item.id)) {
      warnings.push(warning(CLASSIFICATION_PATH, 'Módulo inválido ou duplicado ignorado.'));
      continue;
    }
    const note = item.note == null ? null : safePath(item.note);
    if (item.note != null && !note) warnings.push(warning(CLASSIFICATION_PATH, `Caminho de nota inválido no módulo ${item.id}.`));
    const layers = [];
    for (const layer of item.layers) {
      if (!layer || typeof layer.name !== 'string' || !layer.name) continue;
      const layerNote = layer.note == null ? null : safePath(layer.note);
      if (layer.note != null && !layerNote) warnings.push(warning(CLASSIFICATION_PATH, `Caminho de nota inválido na camada ${item.id}:${layer.name}.`));
      layers.push({ ...layer, note: layerNote });
    }
    const normalized = { ...item, note, layers };
    modules.push(normalized);
    moduleById.set(item.id, normalized);
  }
  const files = Object.create(null);
  for (const [rawPath, entry] of Object.entries(source.files)) {
    const filePath = safePath(rawPath);
    if (!filePath) {
      warnings.push(warning(rawPath, 'Caminho de arquivo inválido ignorado.'));
      continue;
    }
    if (!entry || !moduleById.has(entry.module) || typeof entry.layer !== 'string' || !entry.layer) {
      warnings.push(warning(filePath, 'Módulo ou camada inválida; arquivo ignorado.'));
      continue;
    }
    files[filePath] = { module: entry.module, layer: entry.layer };
  }
  result.valid = true;
  result.data = { ...source, modules, files };
  const revision = source.revision;
  const head = typeof revision === 'string' && revision ? await headRevision(root) : null;
  result.stale = Boolean(head && head !== revision);
  if (result.stale) warnings.push(warning(CLASSIFICATION_PATH,
    'Classificação defasada; rode `bash graphy-refat/run.sh all`.', 'classification-stale'));
  return result;
}

function classifyFile(classification, filePath) {
  const data = classification?.data || classification;
  if (!data || !safePath(filePath)) return null;
  const entry = data.files?.[filePath];
  if (!entry) return null;
  const module = data.modules?.find(item => item.id === entry.module);
  if (!module) return null;
  const layer = module.layers.find(item => item.name === entry.layer);
  return { module: module.id, label: module.name, layer: entry.layer, kind: 'graphy', note: layer?.note || module.note || null };
}

module.exports = { readClassification, classifyFile };
