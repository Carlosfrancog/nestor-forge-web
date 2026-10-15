'use strict';

const path = require('node:path');

// Graphify's vault generator groups files by domain across technical layers.
// Its BIBLIOFUT-specific dictionaries belong in project configuration, not here.
const FILE_SUFFIX = /(?:Controller|Request|Service|Action|Policy|Observer|Repository|Resource|Notification|Job|Event|Listener|DTO)$/i;
const ACTION_PREFIX = /^(?:Create|Update|Delete|Remove|Store|Show|Index|List|Edit|Save|Search|Restore|Destroy|Get|Post|Put|Patch)(?=[A-Z])/;
const GENERIC = new Set(['base', 'abstract', 'model', 'controller', 'request', 'service', 'action', 'policy', 'observer', 'repository', 'resource', 'notification', 'job', 'event', 'listener', 'dto', 'admin', 'api', 'web', 'http', 'index', 'shared', 'common', 'components', 'pages']);
const BACKEND_LAYERS = new Set(['Services', 'Actions', 'DTOs', 'Enums', 'Events', 'Listeners', 'Jobs', 'Notifications', 'Observers', 'Policies', 'Repositories', 'Resources']);

function key(value) {
  let result = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (result.endsWith('ies') && result.length > 4) result = `${result.slice(0, -3)}y`;
  else if (result.endsWith('sses')) result = result.slice(0, -2);
  else if (result.endsWith('s') && !result.endsWith('ss') && result.length > 3) result = result.slice(0, -1);
  return result;
}

function stem(filename) { return path.posix.basename(filename, path.posix.extname(filename)); }
function domainName(value) {
  let result = stem(value);
  for (let i = 0; i < 2; i++) result = result.replace(ACTION_PREFIX, '').replace(FILE_SUFFIX, '');
  return result;
}
function entries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter(([alias, module]) => typeof alias === 'string' && typeof module === 'string' && alias && module);
}

function createLaravelTaxonomy(paths, taxonomy = {}) {
  const models = new Map();
  const aliases = new Map();
  const modelOverrides = new Map(entries(taxonomy.modelToModule).map(([from, to]) => [key(from), to]));
  const domainOverrides = new Map(entries(taxonomy.domainToModule).map(([from, to]) => [key(from), to]));
  const frontendPages = entries(taxonomy.frontendPages).sort((a, b) => b[0].length - a[0].length);
  const frontendComponents = entries(taxonomy.frontendComponents).sort((a, b) => b[0].length - a[0].length);

  for (const file of paths) {
    if (!/^app\/Models\/.+\.php$/i.test(file)) continue;
    const name = stem(file);
    const normalized = key(name);
    if (GENERIC.has(normalized) || /^(?:Base|Abstract)/.test(name) || /(?:Pivot|Trait)$/.test(name)) continue;
    const module = modelOverrides.get(normalized) || name;
    if (!models.has(key(module))) models.set(key(module), { label: module, path: file });
    aliases.set(normalized, module);
  }
  for (const [, module] of [...modelOverrides, ...domainOverrides]) {
    if (!models.has(key(module))) models.set(key(module), { label: module, path: '.' });
  }

  function resolve(value, overrides = domainOverrides) {
    const normalized = key(domainName(value));
    if (!normalized || GENERIC.has(normalized)) return null;
    const explicit = overrides.get(normalized);
    const name = explicit || aliases.get(normalized) || models.get(normalized)?.label;
    if (!name) return null;
    const registered = models.get(key(name));
    return { module: `domain:${name}`, label: name, kind: 'domain', path: registered?.path || '.' };
  }
  function mappedPath(segments, mappings) {
    for (const [prefix, module] of mappings) {
      const parts = prefix.toLowerCase().split('/');
      if (parts.every((part, index) => key(segments[index]) === key(part))) {
        const registered = models.get(key(module));
        return { module: `domain:${module}`, label: module, kind: 'domain', path: registered?.path || '.' };
      }
    }
    return null;
  }
  function classify(file) {
    const parts = file.split('/');
    const [root, top] = parts;
    let candidate = null;
    if (root === 'app') {
      if (top === 'Models') {
        const name = stem(file);
        candidate = modelOverrides.get(key(name)) ? resolve(modelOverrides.get(key(name))) : resolve(name);
      } else if (top === 'Http' && ['Controllers', 'Requests', 'Resources'].includes(parts[2])) {
        const area = parts.slice(3, -1).filter(part => !['Admin', 'Api', 'Web', 'V1', 'V2'].includes(part));
        candidate = area.map(part => resolve(part)).find(Boolean) || resolve(parts.at(-1));
      } else if (['Observers', 'Policies'].includes(top) || BACKEND_LAYERS.has(top)) {
        candidate = parts.slice(2, -1).map(part => resolve(part)).find(Boolean) || resolve(parts.at(-1));
      }
    } else if (root === 'resources' && parts[1] === 'js') {
      const section = parts[2]?.toLowerCase();
      if (['pages', 'components'].includes(section)) {
        const subpath = parts.slice(3, -1).filter(part => !['admin', 'api', 'web'].includes(part.toLowerCase()));
        const mappings = section === 'pages' ? frontendPages : frontendComponents;
        candidate = mappedPath(subpath, mappings) || subpath.map(part => resolve(part)).find(Boolean) || resolve(parts.at(-1));
      }
    }
    return candidate;
  }
  return { classify };
}

module.exports = { createLaravelTaxonomy };
