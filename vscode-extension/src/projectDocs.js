'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MANIFEST = '.agentorchestra-docs-manifest.json';
const HANDOFF = '.agentorchestra/context/project-handoff.json';

function list(value) { return Array.isArray(value) ? value : []; }
function str(value) { return typeof value === 'string' ? value : ''; }
function short(value, max = 160) { return str(value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function relativePath(value, root) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.replace(/\\/g, '/');
  let result = raw;
  if (path.isAbsolute(value) || /^[a-z]:\//i.test(raw)) {
    result = path.relative(root, value).replace(/\\/g, '/');
  }
  const normalized = path.posix.normalize(result.replace(/^\.\//, ''));
  return normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized) ? '' : normalized;
}

function safeId(value) { return short(String(value ?? ''), 160); }

function normalize(report, root) {
  if (!report || report.schemaVersion !== 1) throw new Error('Mapa de projeto incompatível: schemaVersion 1 é obrigatório.');
  const files = list(report.files).map((file, index) => {
    const filePath = relativePath(file?.path, root);
    if (!filePath) return null;
    return { ...file, id: safeId(file.id || filePath || index), path: filePath };
  }).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));
  const folders = list(report.folders).map(folder => ({
    id: safeId(folder?.id || folder?.path), path: relativePath(folder?.path, root),
  })).filter(folder => folder.path).sort((a, b) => a.path.localeCompare(b.path));
  const modules = list(report.modules).map((module, index) => ({
    ...module, id: safeId(module?.id || module?.path || module?.name || `module-${index + 1}`),
    name: short(module?.name || module?.label || module?.id || module?.path || `Módulo ${index + 1}`, 100),
    path: relativePath(module?.path, root),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const edges = list(report.edges).map(edge => ({
    from: safeId(edge?.from || edge?.source || edge?.sourceId),
    to: safeId(edge?.to || edge?.target || edge?.targetId),
    type: short(edge?.type || edge?.kind || 'relates', 48),
    path: relativePath(edge?.path || edge?.evidence?.path, root),
    line: positiveLine(edge?.line || edge?.evidence?.line),
  })).filter(edge => edge.from && edge.to).sort((a, b) => `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`));
  return { files, folders, modules, edges, warnings: list(report.warnings),
    revision: short(report.revision, 80), generatedAt: str(report.generatedAt), stats: report.stats || {} };
}

function positiveLine(value) { const line = Number(value); return Number.isSafeInteger(line) && line > 0 ? line : undefined; }
function relationKey(value) { return typeof value === 'object' ? str(value?.id || value?.path) : str(value); }

function moduleFiles(module, files) {
  const declared = new Set([...list(module.files), ...list(module.fileIds)].map(relationKey));
  const moduleFolders = [module.path, ...list(module.folders).map(relationKey)].filter(Boolean);
  return files.filter(file => {
    if (declared.has(file.id) || declared.has(file.path)) return true;
    if ([file.moduleId, file.module].some(value => relationKey(value) === module.id)) return true;
    return declared.size === 0 && moduleFolders.some(folder => file.path.startsWith(`${folder}/`));
  });
}

function warningText(warning) {
  if (typeof warning === 'string') return short(warning, 180);
  return short(warning?.message || warning?.reason || warning?.type, 180);
}

function moduleWarnings(module, warnings, root) {
  return unique([...list(module.gaps).map(warningText), ...warnings.filter(warning => {
    if (typeof warning !== 'object') return false;
    const location = relativePath(warning.path, root);
    return warning.moduleId === module.id || (module.path && location.startsWith(`${module.path}/`));
  }).map(warningText)]).slice(0, 6);
}

function evidence(value, root, fallback) {
  const source = typeof value === 'object' && value ? value : {};
  const filePath = relativePath(source.path || source.file || fallback, root);
  return filePath ? { path: filePath, ...(positiveLine(source.line) ? { line: positiveLine(source.line) } : {}) } : null;
}

function compactGit(report, root) {
  const source = report.git || report.gitSummary;
  if (!source || source.enabled === false) return null;
  const changes = list(source.changes || source.commits || report.changes).slice(0, 10).map(change => {
    const item = typeof change === 'string' ? { message: change } : change;
    return { hash: short(item.hash || item.commit || item.id, 12),
      subject: short(item.message || item.subject || item.summary, 120),
      paths: unique(list(item.paths || item.files).map(value => relativePath(typeof value === 'string' ? value : value?.path, root))).slice(0, 8) };
  }).filter(change => change.hash || change.subject);
  return changes.length ? { changes } : null;
}

function buildHandoff(report) {
  const root = path.resolve(str(report?.root) || process.cwd());
  const map = normalize(report, root);
  const degree = new Map();
  for (const edge of map.edges) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  }
  const modules = map.modules.map(module => {
    const files = moduleFiles(module, map.files);
    const keys = [...files].sort((a, b) => Number(Boolean(b.isEntry || b.entrypoint)) - Number(Boolean(a.isEntry || a.entrypoint))
      || (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.path.localeCompare(b.path)).slice(0, 8);
    const ids = new Set([module.id, ...files.flatMap(file => [file.id, file.path])]);
    const relations = map.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to)).slice(0, 12)
      .map(edge => ({ from: edge.from, to: edge.to, type: edge.type,
        ...(edge.path ? { evidence: { path: edge.path, ...(edge.line ? { line: edge.line } : {}) } } : {}) }));
    const anchors = [...list(module.evidence), ...keys.map(file => file.evidence || { path: file.path, line: file.line || file.symbols?.[0]?.line })]
      .map(value => evidence(value, root)).filter(Boolean).slice(0, 8);
    return { id: module.id, name: module.name, ...(module.path ? { path: module.path } : {}),
      ...(module.kind ? { kind: module.kind } : {}),
      counts: { files: files.length, relations: map.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to)).length },
      keyFiles: keys.map(file => ({ path: file.path, ...(positiveLine(file.line || file.symbols?.[0]?.line) ? { line: positiveLine(file.line || file.symbols?.[0]?.line) } : {}) })),
      relations, gaps: moduleWarnings(module, map.warnings, root), evidence: anchors };
  });
  const git = compactGit(report, root);
  const signature = { revision: map.revision, files: map.files.map(file => [file.id, file.path, file.fingerprint || file.hash || '']),
    modules: map.modules.map(module => [module.id, module.path, module.kind]), edges: map.edges, git };
  return { schemaVersion: 1, project: path.basename(root), ...(report.framework ? { framework: report.framework } : {}), revision: map.revision,
    mapHash: digest(signature), generatedAt: map.generatedAt, counts: {
      folders: Number.isSafeInteger(map.stats.folders) ? map.stats.folders : map.folders.length,
      files: map.files.length, modules: modules.length, relations: map.edges.length,
    }, modules, gaps: unique(map.warnings.map(warningText)).slice(0, 12), ...(git ? { git } : {}) };
}


function inside(root, target) {
  const relative = path.relative(root, target);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function rejectPathSymlinks(root, target) {
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`Link simbólico não permitido no destino: ${current}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}


async function rejectSymlinkAncestors(root, target) {
  const parts = path.relative(root, target).split(path.sep);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Link simbólico não permitido no destino: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function readConfig(root) {
  const filename = path.join(root, '.agentorchestra', 'documentation.json');
  try {
    const config = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuração inválida.');
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Não foi possível ler ${filename}: ${error.message}`);
  }
}

const legacyWarnings = new Set();

async function writeHandoff(root, report) {
  const projectRoot = path.resolve(root);
  const config = await readConfig(projectRoot);
  const handoffPath = path.join(projectRoot, HANDOFF);
  await rejectPathSymlinks(projectRoot, handoffPath);
  await rejectSymlinkAncestors(projectRoot, handoffPath);
  const handoff = buildHandoff({ ...report, root: projectRoot });
  const temporary = `${handoffPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.mkdir(path.dirname(handoffPath), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, handoffPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  const outputDir = path.resolve(projectRoot, config.outputDir || 'docs/architecture');
  const warnings = [];
  if (inside(projectRoot, outputDir) && !legacyWarnings.has(projectRoot)) {
    try {
      await fs.access(path.join(outputDir, MANIFEST));
      warnings.push('documentação gerada antiga em docs/architecture não é mais atualizada; pode ser removida');
      legacyWarnings.add(projectRoot);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { handoffPath, outputDir, warnings };
}

module.exports = { buildHandoff, writeHandoff };
