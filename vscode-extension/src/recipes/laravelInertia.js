'use strict';

const path = require('node:path');

const SYMBOL = /\b(?:[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[A-Z][A-Za-z0-9]*::[A-Za-z_][\w]*)\b/g;
const ROUTE = /\b[a-z][\w-]*(?:\.[a-z][\w-]*)+\b|\/[a-z][\w/{}.-]*/gi;
const PERMISSION = /\b[a-z][\w]*_(?:list|view|details|edit|create|delete|notifications|multi_collection)\b/gi;
const EVENT = /\b[A-Z][\w]*(?:Created|Updated|Deleted|Restored|PermanentRemoved)\b/g;
const PAGE = /\b(?:[a-z][\w-]*\/)+[A-Z][\w]*(?:\.vue)?\b|(?:página|pagina|tela)\s+(?:de\s+)?([A-Z][\w]*)/gi;
const CONFIG_CALL = /\b(?:config|env)\s*\(\s*['"]([^'"]+)['"]/g;
const CONFIG_KEY = /\b[a-z][\w-]*\.[a-z][\w.-]*\b/g;
// O lookahead impede capturar "s" em "coluna só": \b do JS não considera letras acentuadas.
const TABLE = /\b(?:tabela|table|coluna|column)\s+(?:de\s+)?([a-z][\w]{2,})(?![\p{L}\p{N}_])/giu;

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function safeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function identity(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function hit(record, evidence, weight = 12) {
  return { record, path: record.path, lines: record.lines, evidence: String(evidence || record.label || '').trim().slice(0, 160), weight };
}
function findRecords(ctx, predicate, max = 200) {
  return ctx.records.filter(predicate).slice(0, max);
}
function grep(ctx, matcher, predicate = () => true, max = 200, weight = 11) {
  const hits = [];
  for (const file of ctx.files) {
    if (hits.length >= max) break;
    if (!predicate(file)) continue;
    const lines = ctx.readLines(file.path);
    if (!lines) continue;
    for (let index = 0; index < lines.length && hits.length < max; index++) {
      if (!matcher(lines[index], file.path)) continue;
      const unit = ctx.unitsByFile.get(file.path)?.find(unit => unit.lines?.[0] <= index + 1 && index + 1 <= unit.lines?.[1]);
      hits.push({ record: unit || file, path: file.path,
        lines: unit?.lines || [Math.max(1, index - 2), Math.min(lines.length, index + 4)],
        evidence: lines[index].trim().slice(0, 160), weight });
    }
  }
  return hits;
}
function allObjects(value, output = [], depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6 || output.length > 50000) return output;
  if (Array.isArray(value)) { for (const part of value) allObjects(part, output, depth + 1); return output; }
  output.push(value);
  for (const part of Object.values(value)) if (part && typeof part === 'object') allObjects(part, output, depth + 1);
  return output;
}
function routeFromLogic(entity, ctx) {
  if (!ctx.logic) return [];
  const objects = allObjects(ctx.logic);
  const routes = objects.filter(node => node.kind === 'route' &&
    [node.route_name, node.name, node.uri, node.path].some(value => value === entity));
  const hits = [];
  for (const node of routes) {
    const ownPath = node.source_file || node.path || node.file;
    if (ownPath) {
      const file = ctx.files.find(item => item.path === ownPath);
      const line = Number(node.line);
      if (file && Number.isSafeInteger(line)) hits.push({ record: file, path: ownPath,
        lines: [Math.max(1, line - 3), line + 3], evidence: node.label || entity, weight: 24 });
    }
    const routeId = node.id || node.key;
    for (const edge of objects.filter(value => (value.kind || value.relation) === 'route_handler' &&
      [value.source, value.from, value.src, value.route].includes(routeId))) {
      const target = edge.target || edge.to || edge.dst || edge.handler;
      const targetNode = objects.find(value => value.id === target || value.key === target);
      const candidate = typeof target === 'string' ? target : '';
      const targets = [targetNode];
      for (const related of objects.filter(value =>
        ['calls', 'call', 'invokes', 'uses_service', 'handler_service'].includes(value.kind || value.relation) &&
        [value.source, value.from, value.src].includes(target))) {
        targets.push(objects.find(value => value.id === (related.target || related.to || related.dst)));
      }
      for (const targetObject of targets.filter(Boolean)) {
        const targetPath = targetObject.source_file || targetObject.path || targetObject.file;
        const targetLine = Number(targetObject.line || targetObject.start_line);
        const targetName = targetObject.name || targetObject.label;
        const matched = findRecords(ctx, item => item.kind === 'unit' && (
          item.id === `unit:${candidate}` || item.label === candidate ||
          (targetPath && item.path === targetPath &&
            (!targetLine || item.lines?.[0] <= targetLine && targetLine <= item.lines?.[1])) ||
          (targetName && item.label?.replace(/\./g, '::').includes(targetName))))
          .sort((a, b) => (a.lines?.[1] - a.lines?.[0]) - (b.lines?.[1] - b.lines?.[0]) ||
            compare(a.id, b.id)).slice(0, 1);
        for (const record of matched)
          hits.push(hit(record, entity, targetObject === targetNode ? 35 : 30));
      }
    }
  }
  return hits.slice(0, 200);
}

const symbol = {
  id: 'symbol', label: 'símbolo', detect: mission => unique(mission.match(SYMBOL) || []),
  resolve(entity, ctx) {
    const name = entity.replace('::', '.');
    return findRecords(ctx, record => ['unit', 'file'].includes(record.kind) &&
      [record.label, path.posix.basename(record.path || '', path.posix.extname(record.path || ''))].some(label =>
        label === entity || label === name || label?.endsWith(`.${name}`) || label?.startsWith(`${name}.`)))
      .map(record => hit(record, entity, 30));
  },
};
const route = {
  id: 'route', label: 'rota', detect: mission => unique(mission.match(ROUTE) || []).filter(value => !/^\d+\./.test(value)),
  resolve(entity, ctx) {
    const graph = routeFromLogic(entity, ctx);
    if (graph.length) return graph;
    const quoted = safeRegex(entity);
    const named = new RegExp(`->name\\s*\\(\\s*['"]${quoted}['"]`);
    const matcher = entity.startsWith('/')
      ? line => line.includes(entity)
      : line => named.test(line);
    return grep(ctx, matcher, file => /^routes\/.*\.php$/.test(file.path), 200, 26);
  },
};
const permission = {
  id: 'permission', label: 'permissão', detect: mission => unique(mission.match(PERMISSION) || []),
  resolve(entity, ctx) {
    const escaped = safeRegex(entity);
    const patterns = [new RegExp(`can:${escaped}\\b`, 'i'),
      new RegExp(`(?:->can|\\bcan|usePermissions\\(\\)\\.can)\\s*\\(\\s*['"]${escaped}['"]`, 'i'),
      new RegExp(`['"]${escaped}['"]`, 'i')];
    return grep(ctx, line => patterns.some(pattern => pattern.test(line)), file =>
      /^routes\/.*\.php$/.test(file.path) || /^database\/seeders\//.test(file.path) ||
      /^resources\/js\//.test(file.path), 200, 25);
  },
};
const event = {
  id: 'event', label: 'evento', detect: mission => unique([...(mission.match(EVENT) || []),
    ...[...mission.matchAll(/\bevento\s+([A-Z][\w]*)/gi)].map(match => match[1])]),
  resolve(entity, ctx) {
    const direct = findRecords(ctx, record => record.kind === 'unit' &&
      (record.calls || []).some(call => String(call).includes(entity))).map(record => hit(record, entity, 24));
    const typedEvent = new RegExp(`\\b${safeRegex(entity)}\\s+\\$`);
    const typed = grep(ctx, line => /\bhandle\s*\(/.test(line) &&
      typedEvent.test(line),
      file => /^app\/Listeners\//.test(file.path), 200, 25);
    return [...direct, ...typed].slice(0, 200);
  },
};
const inertiaPage = {
  id: 'inertia-page', label: 'página Inertia', detect: mission => unique([...mission.matchAll(PAGE)].map(match => match[1] || match[0])),
  resolve(entity, ctx) {
    const page = entity.replace(/\.vue$/, '');
    const exact = findRecords(ctx, record => record.kind === 'file' &&
      record.path?.toLowerCase() === `resources/js/pages/${page}.vue`.toLowerCase()).map(record => hit(record, page, 30));
    const render = grep(ctx, line => line.includes('Inertia::render') && line.includes(page),
      file => /^app\/.*\.php$/.test(file.path), 200, 26);
    return [...exact, ...render].slice(0, 200);
  },
};
const frontRouteCall = {
  id: 'front-route-call', label: 'chamada de rota no front',
  detect: mission => /\b(front|frontend|tela|chamada|vue|página|pagina)\b/i.test(mission) ? route.detect(mission) : [],
  resolve(entity, ctx) {
    const pattern = new RegExp(`\\broute\\s*\\(\\s*['"]${safeRegex(entity)}['"]`);
    return grep(ctx, line => pattern.test(line), file => /^resources\/js\//.test(file.path), 200, 24);
  },
};
const configEnv = {
  id: 'config-env', label: 'configuração',
  detect(mission) { return unique([...mission.matchAll(CONFIG_CALL)].map(match => match[1]).concat(mission.match(CONFIG_KEY) || [])); },
  resolve(entity, ctx) {
    const key = safeRegex(entity);
    const call = new RegExp(`\\b(?:config|env)\\s*\\(\\s*['"]${key}['"]`);
    const direct = grep(ctx, line => call.test(line), () => true, 200, 24);
    const base = entity.split('.')[0];
    return [...direct, ...findRecords(ctx, record => record.kind === 'file' &&
      record.path === `config/${base}.php`).map(record => hit(record, entity, 20))].slice(0, 200);
  },
};
const tableColumn = {
  id: 'table-column', label: 'tabela ou coluna',
  detect(mission, ctx) {
    const terms = [...mission.matchAll(TABLE)].map(match => match[1]);
    const snake = mission.match(/\b[a-z][\w]*_[a-z][\w]*\b/g) || [];
    if (!terms.length && !snake.length) return [];
    const known = new Set(allObjects(ctx.schema).flatMap(value => [value.table, value.column, value.name]).filter(value =>
      typeof value === 'string' && /^[a-z][\w]*$/.test(value)));
    // Com schema, só nomes que existem nele; sem schema, só o que veio após "tabela"/"coluna".
    return unique([...terms.filter(value => !known.size || known.has(value)), ...snake.filter(value => known.has(value))]);
  },
  resolve(entity, ctx) {
    const schema = allObjects(ctx.schema).filter(value =>
      [value.table, value.column, value.name].includes(entity));
    const graph = schema.flatMap(value => {
      const file = value.path || value.file || value.migration;
      const line = Number(value.line);
      if (!file || !Number.isSafeInteger(line)) return [];
      const record = ctx.files.find(item => item.path === file);
      return record ? [{ record, path: file, lines: [Math.max(1, line - 3), line + 3], evidence: entity, weight: 28 }] : [];
    });
    const quoted = new RegExp(`['"]${safeRegex(entity)}['"]`);
    const model = grep(ctx, line => quoted.test(line),
      file => /^app\/Models\//.test(file.path), 200, 20);
    return [...graph, ...model].slice(0, 200);
  },
};

const generic = [symbol, configEnv];
const laravelInertia = [symbol, route, permission, event, inertiaPage, frontRouteCall, configEnv, tableColumn];
module.exports = { generic, laravelInertia, grep, identity };
