'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseSource } = require('./structural');

const SUPPORTED = /\.(php|js|mjs|cjs|jsx|ts|tsx|vue|css|sql|py|go)$/i;

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding: encoding === 'buffer' ? null : encoding,
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

function changedPaths(root, base) {
  const revision = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  const tracked = git(root, ['diff', '--name-only', '-z', revision, '--'], 'buffer').toString('utf8').split('\0').filter(Boolean);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'], 'buffer').toString('utf8').split('\0').filter(Boolean);
  const prefix = git(root, ['rev-parse', '--show-prefix']).trim().replace(/\\/g, '/');
  const allPaths = [...new Set([...tracked, ...untracked])].sort();
  const paths = allPaths.filter(file => SUPPORTED.test(file) || path.basename(file).toLowerCase().startsWith('dockerfile'));
  return { revision, prefix, paths, allPaths, untracked: new Set(untracked),
    ignored: allPaths.filter(file => !paths.includes(file)) };
}

function parseHunks(diff) {
  return [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)]
    .map(match => ({ oldStart: Number(match[1]), oldLines: Number(match[2] ?? 1), newStart: Number(match[3]), newLines: Number(match[4] ?? 1) }));
}

function snippet(source, start, count) {
  if (!count) return '';
  return source.split(/\r?\n/).slice(start - 1, start - 1 + count).join('\n').slice(0, 2000);
}

function compareUnits(before, after) {
  const previous = new Map(before.units.map(value => [value.key, value]));
  const current = new Map(after.units.map(value => [value.key, value]));
  const added = [...current.values()].filter(value => !previous.has(value.key));
  const removed = [...previous.values()].filter(value => !current.has(value.key));
  const modified = [...current.values()].filter(value => previous.has(value.key) && previous.get(value.key).fingerprint !== value.fingerprint);
  return { added, removed, modified };
}

function overlap(a, b) {
  const left = new Set(a), right = new Set(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter(value => right.has(value)).length;
  return common / (left.size + right.size - common);
}

function findMoves(files) {
  const removed = files.flatMap(file => file.changes.removed.map(unit => ({ file: file.path, unit })));
  const added = files.flatMap(file => file.changes.added.map(unit => ({ file: file.path, unit })));
  const moves = [];
  for (const from of removed) for (const to of added) {
    if (from.file === to.file || !['method', 'function'].includes(from.unit.kind) || from.unit.kind !== to.unit.kind) continue;
    const exact = from.unit.fingerprint === to.unit.fingerprint;
    const callOverlap = overlap(from.unit.calls, to.unit.calls);
    if (exact || (from.unit.calls.length >= 2 && to.unit.calls.length >= 2 && callOverlap >= 0.67)) {
      moves.push({ from, to, evidence: exact ? 'corpo estrutural equivalente' : `chamadas em comum: ${Math.round(callOverlap * 100)}%`, exact });
    }
  }
  return moves.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 30);
}

function analyzeRepository(root, base = 'HEAD', options = {}) {
  const { revision, prefix, paths, allPaths, untracked, ignored } = changedPaths(root, base);
  const files = [];
  for (const relative of paths.slice(0, 100)) {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(path.resolve(root) + path.sep)) continue;
    let oldSource = '';
    let oldExists = false;
    if (!untracked.has(relative)) {
      try { oldSource = git(root, ['show', `${revision}:${prefix}${relative.replace(/\\/g, '/')}`]); oldExists = true; } catch (_) {}
    }
    let newSource = '';
    const newExists = fs.existsSync(absolute);
    if (newExists) newSource = fs.readFileSync(absolute, 'utf8');
    const status = untracked.has(relative) ? 'untracked' : !newExists ? 'deleted' : !oldExists ? 'added' : 'modified';
    const warnings = [];
    if (Buffer.byteLength(oldSource) > 1024 * 1024 || Buffer.byteLength(newSource) > 1024 * 1024) {
      warnings.push('Arquivo acima de 1 MiB; análise AST ignorada.');
      files.push({ path: relative, status, language: '—', changes: { added: [], removed: [], modified: [] }, hunks: [], features: [], warnings });
      continue;
    }
    const empty = { units: [], features: [] };
    let before = empty, after = empty;
    try { if (oldExists && oldSource) before = parseSource(oldSource, relative, options); }
    catch (error) { warnings.push(`Versão anterior: ${error.message}`); }
    try { if (newExists && newSource) after = parseSource(newSource, relative, options); }
    catch (error) { warnings.push(`Versão atual: ${error.message}`); }
    const changes = warnings.length ? { added: [], removed: [], modified: [] } : compareUnits(before, after);
    let diff = '';
    try { diff = git(root, ['diff', '--unified=0', revision, '--', relative]); } catch (_) {}
    const hunks = parseHunks(diff);
    if (!oldExists && newExists && newSource && !hunks.length) hunks.push({ oldStart: 0, oldLines: 0, newStart: 1,
      newLines: newSource.replace(/\r?\n$/, '').split(/\r?\n/).length });
    for (const hunk of hunks) {
      hunk.before = snippet(oldSource, hunk.oldStart, hunk.oldLines);
      hunk.after = snippet(newSource, hunk.newStart, hunk.newLines);
    }
    files.push({ path: relative, status, language: after.language || before.language || '—', changes, hunks,
      features: (after.features || []).filter(feature => !(before.features || []).some(old => JSON.stringify(old) === JSON.stringify(feature))), warnings });
  }
  return { project: path.basename(path.resolve(root)), base: revision.slice(0, 12), total: paths.length,
    changedTotal: allPaths.length, ignored, truncated: paths.length > 100, files, moves: findMoves(files) };
}

function safe(value) { return String(value).replace(/[|\r\n]/g, ' ').replace(/`/g, "'"); }
function codeFence(value) { return '~'.repeat(Math.max(4, ...[...String(value).matchAll(/~+/g)].map(match => match[0].length + 1))); }
function statusText(status) { return ({ untracked: 'Novo, ainda não versionado', added: 'Novo no Git', deleted: 'Removido', modified: 'Modificado' })[status] || 'Alterado'; }
function displayUnit(unit) { return unit.kind === 'module' ? 'código no nível do arquivo' : `\`${safe(unit.key)}\``; }

function renderMarkdown(report) {
  const lines = [
    '# Análise estrutural de diff', '',
    `Projeto: **${safe(report.project || 'projeto')}** · Base Git: \`${safe(report.base)}\``, '',
    `Arquivos alterados no projeto: ${report.changedTotal ?? report.total} · Formatos analisáveis: ${report.total} · Analisados: ${report.files.length} · Outros formatos: ${report.ignored?.length || 0}`, '',
    'A base é comparada ao estado atual da pasta aberta. Arquivos novos não possuem versão “antes”. As estruturas vêm dos parsers; a ausência delas não significa ausência de mudanças no código.', ''
  ];
  if (report.ignored?.length) {
    lines.push(`Fora da análise estrutural por formato: ${report.ignored.slice(0, 12).map(value => `\`${safe(value)}\``).join(', ')}${report.ignored.length > 12 ? ` e mais ${report.ignored.length - 12}` : ''}.`, '');
  }
  if (report.files.length && report.files.every(file => ['untracked', 'added'].includes(file.status))) {
    lines.push('> Todos os arquivos de código analisados são novos nesta base. Este relatório descreve o conteúdo criado; não há refatorações de código existente para comparar.', '');
  }
  if (report.truncated) lines.push('> Limite de 100 arquivos atingido. O relatório é parcial.', '');
  if (report.moves.length) {
    lines.push('## Possíveis transferências entre arquivos', '');
    for (const move of report.moves) {
      const contextual = /controller/i.test(move.from.file) && /service/i.test(move.to.file) ? ' (controller → service)' : '';
      lines.push(`- ${safe(move.from.file)}:${move.from.unit.line} \`${safe(move.from.unit.key)}\` → ${safe(move.to.file)}:${move.to.unit.line} \`${safe(move.to.unit.key)}\`${contextual}. Evidência: ${safe(move.evidence)}.`);
    }
    lines.push('');
  }
  for (const file of report.files) {
    lines.push(`## ${safe(file.path)}`, '', `Estado: ${statusText(file.status)} · Linguagem: ${safe(file.language)} · Estruturas: +${file.changes.added.length} / −${file.changes.removed.length} / ~${file.changes.modified.length}`, '');
    if (file.hunks.length && !['untracked', 'added'].includes(file.status)) lines.push(`Trechos: ${file.hunks.map(hunk => {
      const oldRange = hunk.oldLines ? `${hunk.oldStart}-${hunk.oldStart + hunk.oldLines - 1}` : '∅';
      const newRange = hunk.newLines ? `${hunk.newStart}-${hunk.newStart + hunk.newLines - 1}` : '∅';
      return `antigo ${oldRange} → atual ${newRange}`;
    }).join('; ')}`, '');
    if (['untracked', 'added'].includes(file.status)) {
      lines.push('Sem versão anterior. Prévia do arquivo novo:', '');
      const content = file.hunks[0]?.after?.split('\n').slice(0, 20).join('\n') || '(vazio)';
      const fence = codeFence(content);
      lines.push(`${fence}text`, content, fence, '');
    }
    for (const [index, hunk] of (['untracked', 'added'].includes(file.status) ? [] : file.hunks.slice(0, 8)).entries()) {
      lines.push(`### Trecho ${index + 1}: antes → depois`, '');
      for (const [label, value] of [['Antes', hunk.before], ['Depois', hunk.after]]) {
        const content = value || '(vazio)';
        const fence = codeFence(content);
        lines.push(`${label}:`, '', `${fence}text`, content, fence, '');
      }
    }
    if (!['untracked', 'added'].includes(file.status) && file.hunks.length > 8) lines.push(`Mais ${file.hunks.length - 8} trecho(s) omitidos neste arquivo.`, '');
    for (const unit of file.changes.added) lines.push(`- Adicionado ${displayUnit(unit)} (linha ${unit.line}).`);
    for (const unit of file.changes.removed) lines.push(`- Removido ${displayUnit(unit)} (linha antiga ${unit.line}).`);
    for (const unit of file.changes.modified) lines.push(`- Alterado ${displayUnit(unit)} (linha ${unit.line}).`);
    for (const feature of file.features) {
      if (feature.type === 'worker') lines.push(`- Worker instanciado${feature.owner ? ` em \`${safe(feature.owner)}\`` : ''} na linha ${feature.line}: \`${safe(feature.target)}\`.`);
      if (feature.type === 'tailwind-classes') lines.push(`- Classes estáticas observadas no template: ${feature.values.map(safe).join(', ')}.`);
    }
    for (const warning of file.warnings) lines.push(`- Não analisado completamente: ${safe(warning)}.`);
    if (!file.changes.added.length && !file.changes.removed.length && !file.changes.modified.length && !file.features.length && !file.warnings.length) lines.push('- Nenhuma estrutura reconhecida mudou. Confira os trechos de código acima.');
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { analyzeRepository, renderMarkdown, parseHunks, compareUnits, findMoves, changedPaths };
