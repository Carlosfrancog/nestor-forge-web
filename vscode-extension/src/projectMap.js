'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { parseSource } = require('./structural');

const execFileAsync = promisify(execFile);
const CACHE_VERSION = 2;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'out',
  'coverage', '.next', '.nuxt', '.output', '.turbo', '.cache', '.venv', 'venv',
  '__pycache__', 'target', 'graphify-out', 'vault-modules', '.agentorchestra',
  '.uv-cache', 'build-agent', '.chrome-design',
]);
const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'id_rsa', 'id_ed25519']);
const SOURCE_ROOTS = new Set(['src', 'app', 'lib', 'packages', 'apps', 'internal', 'pkg']);
const LAYERS = [
  ['test', /^(test|tests|__tests__|spec|specs)$/i],
  ['controller', /^(controller|controllers|handler|handlers)$/i],
  ['service', /^(service|services|usecase|usecases)$/i],
  ['model', /^(model|models|entity|entities)$/i],
  ['view', /^(view|views|page|pages|component|components)$/i],
  ['route', /^(route|routes|router|routers)$/i],
  ['database', /^(database|db|migration|migrations|schema)$/i],
  ['config', /^(config|configuration)$/i],
  ['documentation', /^(docs|doc|documentation)$/i],
];

function unix(value) { return value.split(path.sep).join('/'); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function yieldLoop() { return new Promise(resolve => setImmediate(resolve)); }
function aborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Mapeamento cancelado.');
    error.name = 'AbortError';
    throw error;
  }
}
function safeRelative(value) {
  if (typeof value !== 'string') return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/').replace(/^\.\//, ''));
  return normalized !== '..' && !normalized.startsWith('../') && !path.posix.isAbsolute(normalized)
    ? normalized.replace(/\/$/, '') : null;
}
function isIgnoredFile(name) {
  const lower = name.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.pem') ||
    lower.endsWith('.key') || lower.endsWith('.p12') || lower.endsWith('.pfx') ||
    IGNORED_FILES.has(lower);
}
function languageFor(file) {
  if (/^dockerfile(?:\..*)?$/i.test(path.posix.basename(file))) return 'Dockerfile';
  const extension = path.posix.extname(file).toLowerCase();
  return ({ '.php': 'PHP', '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.vue': 'Vue',
    '.css': 'CSS/Tailwind', '.sql': 'PostgreSQL', '.py': 'Python', '.go': 'Go',
    '.md': 'Markdown', '.markdown': 'Markdown', '.mdx': 'Markdown', '.json': 'JSON',
    '.yaml': 'YAML', '.yml': 'YAML', '.html': 'HTML', '.htm': 'HTML', '.xml': 'XML' })[extension] || null;
}
function moduleAndLayer(file, config) {
  const parts = file.split('/');
  const folders = parts.slice(0, -1);
  for (const entry of config.modules || []) {
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.paths)) continue;
    if (entry.paths.some(prefix => {
      const clean = safeRelative(prefix);
      return clean && (file === clean || file.startsWith(`${clean}/`));
    })) return { module: entry.id, label: entry.label || entry.id, layer: inferLayer(folders) };
  }
  let offset = SOURCE_ROOTS.has(folders[0]?.toLowerCase()) ? 1 : 0;
  if (['packages', 'apps'].includes(folders[0]?.toLowerCase())) offset = 1;
  const candidate = folders[offset];
  return {
    module: candidate || 'unclassified',
    label: candidate || 'Não classificado',
    layer: inferLayer(folders),
  };
}
function inferLayer(folders) {
  for (const [layer, matcher] of LAYERS) if (folders.some(folder => matcher.test(folder))) return layer;
  return 'unknown';
}
function symbolsOf(parsed) {
  return (parsed.units || []).map(unit => ({ key: unit.key, kind: unit.kind, line: unit.line || 1 }));
}
function relativeImports(source, language) {
  if (!['JavaScript', 'TypeScript', 'Vue', 'PHP', 'Markdown', 'HTML'].includes(language)) return [];
  const matches = [];
  const patterns = language === 'PHP'
    ? [/\b(?:require|require_once|include|include_once)\s*(?:\(\s*)?['"](\.{1,2}\/[^'"]+)['"]/g]
    : language === 'Markdown' ? [/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g]
    : language === 'HTML' ? [/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi]
    : [/(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm,
      /\b(?:require|import)\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) matches.push(match[1]);
  return matches;
}
function resolveImport(from, specifier, known) {
  if (/^(?:[a-z][\w+.-]*:|#|\/)/i.test(specifier)) return null;
  const local = specifier.split(/[?#]/)[0];
  if (!local) return null;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), local));
  if (target === '..' || target.startsWith('../') || target.startsWith('/')) return null;
  const candidates = new Set([target]);
  if (!path.posix.extname(target)) {
    for (const extension of ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.php', '.css', '.md', '.html', '.json', '.yaml', '.xml']) {
      candidates.add(`${target}${extension}`);
      candidates.add(`${target}/index${extension}`);
    }
  }
  const found = [...candidates].filter(candidate => known.has(candidate));
  return found.length === 1 ? found[0] : null;
}
async function readConfig(root, warnings) {
  const file = path.join(root, '.agentorchestra', 'documentation.json');
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('objeto JSON esperado');
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push({ kind: 'config', path: '.agentorchestra/documentation.json', message: error.message });
    return {};
  }
}
async function gitRevision(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, timeout: 5000 });
    return stdout.trim() || null;
  } catch { return null; }
}

async function pruneLegacyCache(root) {
  const workspaceDir = path.join(root, '.agentorchestra');
  const cacheParent = path.join(workspaceDir, 'cache');
  const oldCache = path.join(cacheParent, 'project-map');
  let entries;
  try {
    for (const directory of [workspaceDir, cacheParent, oldCache]) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    }
    entries = await fs.readdir(oldCache, { withFileTypes: true });
  } catch { return; }
  // The former mapper stored one content hash JSON per parsed file here.
  // Leave the directory untouched if it contains anything else.
  if (!entries.every(entry => entry.isFile() && /^[a-f0-9]{64}-[a-z0-9]+\.json$/i.test(entry.name))) return;
  try {
    for (const entry of entries) await fs.unlink(path.join(oldCache, entry.name));
    await fs.rmdir(oldCache);
    await fs.rmdir(cacheParent).catch(() => {});
  } catch { /* Another extension instance may still be writing the old cache. */ }
}

/**
 * Build a local, deterministic inventory. Optional documentation.json accepts
 * {maxFileBytes, exclude:[relative directory/file prefixes], modules:[{id,label,paths:[prefixes]}]}.
 * Content hashes cache AST summaries; no embeddings or network requests are used.
 */
async function scanProject(root, { cacheDir, python, go, onProgress, signal } = {}) {
  const absoluteRoot = path.resolve(root);
  const rootStat = await fs.stat(absoluteRoot);
  if (!rootStat.isDirectory()) throw new Error(`Raiz do projeto não é uma pasta: ${absoluteRoot}`);
  aborted(signal);
  const warnings = [];
  const config = await readConfig(absoluteRoot, warnings);
  const limit = Number.isSafeInteger(config.maxFileBytes) && config.maxFileBytes > 0
    ? Math.min(config.maxFileBytes, 16 * 1024 * 1024) : DEFAULT_MAX_BYTES;
  const excludes = (Array.isArray(config.exclude) ? config.exclude : [])
    .map(safeRelative).filter(Boolean);
  const generatedDocs = safeRelative(config.outputDir || 'docs/architecture');
  if (generatedDocs && generatedDocs !== '.') {
    try {
      await fs.access(path.join(absoluteRoot, generatedDocs, '.agentorchestra-docs-manifest.json'));
      excludes.push(generatedDocs);
    } catch { /* Ainda não há documentação gerada nesta pasta. */ }
  }
  const cacheRoot = cacheDir ? path.resolve(cacheDir)
    : path.join(os.tmpdir(), 'agentorchestra-project-map', sha256(Buffer.from(absoluteRoot)).slice(0, 24));
  const cacheRelative = safeRelative(unix(path.relative(absoluteRoot, cacheRoot)));
  if (cacheRelative && cacheRelative !== '.') excludes.push(cacheRelative);
  const cacheFile = path.join(cacheRoot, 'project-map-cache.json');
  let previousCache = {};
  try {
    const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (saved.version === CACHE_VERSION && saved.entries && typeof saved.entries === 'object') previousCache = saved.entries;
  } catch { /* primeira leitura ou cache corrompido */ }
  const nextCache = {};
  const files = [];
  const folders = [{ id: '.', path: '.', parent: null }];
  const pending = [{ absolute: absoluteRoot, relative: '.' }];
  const stats = { folders: 0, files: 0, parsed: 0, cacheHits: 0, withoutParser: 0,
    tooLarge: 0, binary: 0, parseErrors: 0, ignored: 0 };
  const contentImports = new Map();
  const modules = new Map();
  await fs.mkdir(cacheRoot, { recursive: true });

  while (pending.length) {
    aborted(signal);
    const folder = pending.shift();
    let entries;
    try { entries = await fs.readdir(folder.absolute, { withFileTypes: true }); }
    catch (error) { warnings.push({ kind: 'read', path: folder.relative, message: error.message }); continue; }
    entries.sort((a, b) => compare(a.name, b.name));
    stats.folders++;
    onProgress?.({ folder: folder.relative, folders: stats.folders, files: stats.files });
    for (const entry of entries) {
      aborted(signal);
      const relative = folder.relative === '.' ? entry.name : `${folder.relative}/${entry.name}`;
      if (entry.isSymbolicLink()) { stats.ignored++; continue; }
      if (excludes.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) { stats.ignored++; continue; }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name.toLowerCase()) || /^\.(?:chrome|edge)-/i.test(entry.name)) { stats.ignored++; continue; }
        folders.push({ id: relative, path: relative, parent: folder.relative });
        pending.push({ absolute: path.join(folder.absolute, entry.name), relative });
        continue;
      }
      if (!entry.isFile() || isIgnoredFile(entry.name)) { stats.ignored++; continue; }
      let bytes;
      try {
        const stat = await fs.stat(path.join(folder.absolute, entry.name));
        bytes = stat.size;
      } catch (error) { warnings.push({ kind: 'read', path: relative, message: error.message }); continue; }
      const assignment = moduleAndLayer(relative, config);
      const language = languageFor(relative);
      const file = { id: relative, path: relative, folder: folder.relative,
        module: assignment.module, layer: assignment.layer, language: language || 'unknown',
        bytes, hash: null, symbols: [], status: 'without-parser' };
      files.push(file);
      stats.files++;
      if (!modules.has(assignment.module)) modules.set(assignment.module, { id: assignment.module, label: assignment.label, fileCount: 0 });
      modules.get(assignment.module).fileCount++;
      if (bytes > limit) { file.status = 'too-large'; stats.tooLarge++; continue; }
      let content;
      try { content = await fs.readFile(path.join(folder.absolute, entry.name)); }
      catch (error) { file.status = 'read-error'; warnings.push({ kind: 'read', path: relative, message: error.message }); continue; }
      file.hash = sha256(content);
      if (content.includes(0)) { file.status = 'binary'; stats.binary++; continue; }
      if (!language) { stats.withoutParser++; continue; }
      // JSX/TSX and plain JS/TS require different parser options even when
      // their bytes match; Dockerfiles also have a filename-based parser.
      const parserKind = language === 'Dockerfile' ? 'dockerfile' : path.posix.extname(relative).toLowerCase().slice(1);
      const cacheKey = `${file.hash}-${parserKind}`;
      let summary;
      const cached = previousCache[cacheKey];
      if (cached?.version === CACHE_VERSION) { summary = cached; stats.cacheHits++; }
      if (!summary) {
        try {
          const parsed = parseSource(content.toString('utf8'), relative, { python, go });
          summary = { version: CACHE_VERSION, symbols: symbolsOf(parsed), imports: relativeImports(content.toString('utf8'), language) };
          stats.parsed++;
        } catch (error) {
          file.status = 'parse-error'; stats.parseErrors++;
          warnings.push({ kind: 'parse', path: relative, message: error.message });
          continue;
        }
      }
      nextCache[cacheKey] = summary;
      file.symbols = summary.symbols;
      file.status = 'parsed';
      contentImports.set(relative, summary.imports);
      if (stats.files % 32 === 0) await yieldLoop();
    }
    await yieldLoop();
  }

  files.sort((a, b) => compare(a.path, b.path));
  folders.sort((a, b) => compare(a.path, b.path));
  const known = new Set(files.map(file => file.path));
  const edgeCounts = new Map();
  for (const [source, imports] of contentImports) for (const specifier of imports) {
    const target = resolveImport(source, specifier, known);
    if (!target || source === target) continue;
    const key = `${source}\0${target}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  }
  const edges = [...edgeCounts].map(([key, count]) => {
    const [source, target] = key.split('\0');
    return { source, target, kind: 'imports', count };
  }).sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target));
  const unclassified = modules.get('unclassified')?.fileCount || 0;
  if (unclassified) warnings.push({ kind: 'classification', path: '.', message: `${unclassified} arquivo(s) sem módulo; configure .agentorchestra/documentation.json para classificar.` });
  const temporary = `${cacheFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, entries: nextCache }));
    await fs.rename(temporary, cacheFile);
  } catch { await fs.rm(temporary, { force: true }); }
  if (!cacheRoot.startsWith(path.join(absoluteRoot, '.agentorchestra') + path.sep)) await pruneLegacyCache(absoluteRoot);
  stats.edges = edges.length;
  stats.modules = modules.size;
  return { schemaVersion: 1, root: absoluteRoot, revision: await gitRevision(absoluteRoot),
    generatedAt: new Date().toISOString(), folders, files,
    modules: [...modules.values()].sort((a, b) => compare(a.id, b.id)), edges, warnings, stats };
}

module.exports = { scanProject };
