'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const babel = require('@babel/parser');
const html = require('@vue/compiler-dom');
const PhpParser = require('php-parser');
const vue = require('@vue/compiler-sfc');
const postcss = require('postcss');
const pgsql = require('pgsql-ast-parser');
const yaml = require('yaml');

const php = new PhpParser.Engine({ parser: { suppressErrors: false }, ast: { withPositions: true } });
const SKIP = new Set(['loc', 'start', 'end', 'range', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'parent', 'raw']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!SKIP.has(key) && typeof value[key] !== 'function') result[key] = canonical(value[key]);
  }
  return result;
}

function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const part of node) walk(part, visit); return; }
  if (node.type || node.kind) visit(node);
  for (const [key, value] of Object.entries(node)) if (!SKIP.has(key) && value && typeof value === 'object') walk(value, visit);
}

function named(value) {
  if (typeof value === 'string') return value;
  return value?.name || value?.value || value?.parts?.join('\\') || '';
}

function jsCallee(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') return `${jsCallee(node.object)}.${jsCallee(node.property)}`;
  return '';
}

function jsCalls(node) {
  const calls = new Set();
  walk(node, part => {
    if (part.type === 'CallExpression' || part.type === 'NewExpression') {
      const value = jsCallee(part.callee);
      if (value) calls.add(value);
    }
  });
  return [...calls].sort();
}

function phpCalls(node) {
  const calls = new Set();
  walk(node, part => {
    if (['call', 'methodcall', 'staticcall', 'new'].includes(part.kind)) {
      const value = named(part.what) || named(part.offset);
      if (value) calls.add(value);
    }
  });
  return [...calls].sort();
}

function unit(key, kind, node, body, calls, line) {
  return { key, kind, line: line || 1, endLine: node?.loc?.end?.line || line || 1, fingerprint: fingerprint(body || node), calls };
}

function parsePhp(source, file) {
  const ast = php.parseCode(source, file);
  const units = [];
  function visit(children, namespace = '') {
    for (const node of children || []) {
      if (node.kind === 'namespace') { visit(node.children, named(node.name)); continue; }
      if (['class', 'trait', 'interface', 'enum'].includes(node.kind)) {
        const className = [namespace, named(node.name)].filter(Boolean).join('\\');
        units.push(unit(`class:${className}`, node.kind, node, { kind: node.kind, extends: node.extends, implements: node.implements }, [], node.loc?.start?.line));
        for (const child of node.body || []) {
          if (child.kind === 'method') units.push(unit(`method:${className}.${named(child.name)}`, 'method', child, child.body, phpCalls(child.body), child.loc?.start?.line));
        }
      }
      if (node.kind === 'function') units.push(unit(`function:${namespace}\\${named(node.name)}`, 'function', node, node.body, phpCalls(node.body), node.loc?.start?.line));
    }
  }
  visit(ast.children);
  return { language: 'PHP', units, features: [] };
}

function parseJs(source, file) {
  const extension = path.extname(file).toLowerCase();
  const plugins = [];
  if (['.ts', '.tsx'].includes(extension)) plugins.push('typescript');
  if (['.jsx', '.tsx'].includes(extension)) plugins.push('jsx');
  const ast = babel.parse(source, { sourceType: 'unambiguous', plugins, errorRecovery: false, allowReturnOutsideFunction: true });
  const units = [];
  const features = [];
  walk(ast.program, node => {
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const className = node.id?.name;
      if (!className) return;
      units.push(unit(`class:${className}`, 'class', node, { superClass: node.superClass, implements: node.implements }, [], node.loc?.start?.line));
      for (const child of node.body.body) {
        if (child.type === 'ClassMethod' || child.type === 'ClassPrivateMethod') {
          const method = named(child.key);
          units.push(unit(`method:${className}.${method}`, 'method', child, child.body, jsCalls(child.body), child.loc?.start?.line));
        }
      }
    }
    if (node.type === 'FunctionDeclaration' && node.id?.name) units.push(unit(`function:${node.id.name}`, 'function', node, node.body, jsCalls(node.body), node.loc?.start?.line));
    if (node.type === 'VariableDeclarator' && node.id?.name && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) {
      units.push(unit(`function:${node.id.name}`, 'function', node, node.init.body, jsCalls(node.init.body), node.loc?.start?.line));
    }
    if (node.type === 'NewExpression' && jsCallee(node.callee) === 'Worker') {
      features.push({ type: 'worker', line: node.loc?.start?.line || 1, target: source.slice(node.arguments?.[0]?.start || node.start, node.arguments?.[0]?.end || node.end).slice(0, 160) });
    }
  });
  const declaredSeparately = statement => {
    const node = ['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(statement.type) && statement.declaration
      ? statement.declaration : statement;
    if (['ClassDeclaration', 'FunctionDeclaration'].includes(node.type)) return true;
    return node.type === 'VariableDeclaration' && node.declarations.every(part =>
      ['ArrowFunctionExpression', 'FunctionExpression'].includes(part.init?.type));
  };
  const topLevel = ast.program.body.filter(statement => !declaredSeparately(statement));
  if (topLevel.length) {
    const first = topLevel[0];
    const last = topLevel[topLevel.length - 1];
    units.push({ ...unit('module:top-level', 'module', first, topLevel, jsCalls(topLevel), first.loc?.start?.line),
      endLine: last.loc?.end?.line || first.loc?.start?.line || 1 });
  }
  for (const feature of features) {
    const owner = units.filter(value => value.kind === 'method' && value.line <= feature.line && feature.line <= value.endLine)
      .sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
    if (owner) feature.owner = owner.key;
  }
  return { language: ['.ts', '.tsx'].includes(extension) ? 'TypeScript' : 'JavaScript', units, features };
}

function parseVue(source, file) {
  const result = vue.parse(source, { filename: file });
  if (result.errors.length) throw new Error(String(result.errors[0]));
  const units = [];
  const features = [];
  for (const block of [result.descriptor.script, result.descriptor.scriptSetup].filter(Boolean)) {
    const parsed = parseJs(block.content, block.lang === 'tsx' ? 'component.tsx' : block.lang === 'ts' ? 'component.ts' : 'component.js');
    const scope = block === result.descriptor.scriptSetup ? 'setup' : 'script';
    const offset = block.loc.start.line - 1;
    units.push(...parsed.units.map(value => ({ ...value, line: value.line + offset, endLine: value.endLine + offset, key: `${scope}:${value.key}` })));
    features.push(...parsed.features.map(value => ({ ...value, line: value.line + offset, owner: value.owner ? `${scope}:${value.owner}` : undefined })));
  }
  const classes = new Set();
  walk(result.descriptor.template?.ast, node => {
    if (node.type === 1) for (const prop of node.props || []) {
      if (prop.type === 6 && prop.name === 'class' && prop.value?.content) prop.value.content.split(/\s+/).filter(Boolean).forEach(value => classes.add(value));
    }
  });
  if (classes.size) features.push({ type: 'tailwind-classes', values: [...classes].sort() });
  for (const style of result.descriptor.styles) {
    const parsed = parseCss(style.content);
    const offset = style.loc.start.line - 1;
    units.push(...parsed.units.map(value => ({ ...value, line: value.line + offset, endLine: value.endLine + offset, key: `style:${value.key}` })));
  }
  return { language: 'Vue', units, features };
}

function parseCss(source) {
  const root = postcss.parse(source);
  const units = [];
  root.walk(node => {
    if (node.type === 'rule') units.push(unit(`rule:${node.selector}`, 'rule', node, node.nodes?.map(part => ({ prop: part.prop, value: part.value, params: part.params })), [], node.source?.start?.line));
    if (node.type === 'atrule' && ['theme', 'tailwind', 'config', 'apply'].includes(node.name)) {
      units.push(unit(`at:${node.name}:${node.params}`, 'at-rule', node, node.nodes || node.params, [], node.source?.start?.line));
    }
  });
  return { language: 'CSS/Tailwind', units, features: [] };
}

function parseSql(source) {
  const ast = pgsql.parse(source);
  const units = ast.map((node, index) => unit(`statement:${index + 1}:${node.type}`, 'statement', node, node, [], 1));
  return { language: 'PostgreSQL', units, features: [] };
}

function parseDocker(source) {
  const logical = source.replace(/\\\r?\n\s*/g, ' ');
  const units = [];
  for (const [index, line] of logical.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(FROM|RUN|COPY|ADD|ARG|ENV|CMD|ENTRYPOINT|WORKDIR|EXPOSE|USER|VOLUME|HEALTHCHECK|SHELL|LABEL|STOPSIGNAL|ONBUILD)\s+(.+)$/i);
    if (match) units.push(unit(`instruction:${units.length + 1}:${match[1].toUpperCase()}`, 'instruction', match[2], match[2], [], index + 1));
  }
  return { language: 'Dockerfile', units, features: [], structuralOnly: true };
}

function parseMarkdown(source) {
  const units = [];
  let fenced = false;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) units.push(unit(`heading:${heading[1].length}:${heading[2].slice(0, 100)}`, 'heading', line, line, [], index + 1));
  }
  return { language: 'Markdown', units, features: [], structuralOnly: true };
}

function parseData(source, language) {
  const value = language === 'JSON' ? JSON.parse(source) : yaml.parse(source);
  const units = [];
  function visit(item, key, depth) {
    if (units.length >= 256 || depth > 8 || item === null || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      units.push(unit(`array:${key || 'root'}`, 'array', item, { length: item.length }, [], 1));
      item.slice(0, 8).forEach((part, index) => visit(part, `${key}[${index}]`, depth + 1));
      return;
    }
    for (const [name, part] of Object.entries(item)) {
      if (units.length >= 256) break;
      const child = key ? `${key}.${name}` : name;
      units.push(unit(`key:${child.slice(0, 160)}`, 'key', part, { type: Array.isArray(part) ? 'array' : typeof part }, [], 1));
      visit(part, child, depth + 1);
    }
  }
  visit(value, '', 0);
  return { language, units, features: [], structuralOnly: true };
}

function parseMarkup(source, language) {
  const ast = language === 'HTML' ? html.parse(source, { comments: false }) : html.baseParse(source, { comments: false });
  const units = [];
  const semantic = /^(html|head|body|main|header|footer|nav|section|article|form|script|style|template|h[1-6]|link|meta)$/i;
  function visit(children, parent, depth = 0) {
    if (depth > 32 || units.length >= 256) return;
    for (const [index, part] of (children || []).entries()) {
      if (part.type !== 1) continue;
      const tag = String(part.tag);
      const id = part.props?.find(prop => prop.type === 6 && prop.name === 'id')?.value?.content || '';
      const key = `${parent}/${tag}[${index}]${id ? `#${id}` : ''}`;
      if (units.length < 256 && (language === 'XML' || semantic.test(tag) || id)) {
        units.push(unit(`element:${key.slice(0, 160)}`, 'element', part, { tag, id, children: part.children?.length || 0 }, [], part.loc?.start?.line));
      }
      visit(part.children, key, depth + 1);
    }
  }
  visit(ast.children, '');
  return { language, units, features: [], structuralOnly: true };
}

function parseExternal(executable, args, source, env = {}) {
  let output;
  try {
    output = execFileSync(executable, args, { input: source, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ...env } });
  } catch (error) {
    try {
      const result = JSON.parse(String(error.stdout || ''));
      if (result.error) throw new Error(result.error);
    } catch (parsed) {
      if (parsed instanceof SyntaxError) throw error;
      throw parsed;
    }
    throw error;
  }
  const result = JSON.parse(output);
  if (result.error) throw new Error(result.error);
  return result;
}

function parseSource(source, file, options = {}) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.php') return parsePhp(source, file);
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(extension)) return parseJs(source, file);
  if (extension === '.vue') return parseVue(source, file);
  if (extension === '.css') return parseCss(source);
  if (extension === '.sql') return parseSql(source);
  if (['.md', '.markdown', '.mdx'].includes(extension)) return parseMarkdown(source);
  if (extension === '.json') return parseData(source, 'JSON');
  if (['.yaml', '.yml'].includes(extension)) return parseData(source, 'YAML');
  if (['.html', '.htm'].includes(extension)) return parseMarkup(source, 'HTML');
  if (extension === '.xml') return parseMarkup(source, 'XML');
  if (extension === '.py') return parseExternal(options.python || 'python', ['-B', path.join(__dirname, 'helpers', 'python_ast.py')], source);
  if (extension === '.go') return parseExternal(options.go || 'go', ['run', path.join(__dirname, 'helpers', 'go_ast.go')], source, { GOCACHE: path.join(os.tmpdir(), 'agentorchestra-go-cache') });
  if (path.basename(file).toLowerCase().startsWith('dockerfile')) return parseDocker(source);
  throw new Error(`Formato sem parser: ${file}`);
}

module.exports = { parseSource, canonical, fingerprint, parsePhp, parseJs, parseVue, parseCss, parseSql, parseDocker,
  parseMarkdown, parseData, parseMarkup };
