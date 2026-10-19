'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseSource } = require('../src/structural');
const { scanProject } = require('../src/projectMap');
const { readClassification } = require('../src/graphyClassification');
const { buildContextIndex, writeContextIndex } = require('../src/contextIndex');

const phpPath = 'app/Services/Book/BookService.php';
const vuePath = 'resources/js/pages/books/Index.vue';
const moduleNote = 'graphify-out/vault-modules/CONTEXTO/BACKEND/Book/_Book.md';
const layerNote = 'graphify-out/vault-modules/CONTEXTO/BACKEND/Book/Services.md';
const mapNote = 'graphify-out/vault-modules/CONTEXTO/_Mapa contextual.md';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-context-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (relative, source) => {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source, 'utf8');
  };
  const php = `<?php
class BookService {
    /**
     * Saves a book in the catalog.
     */
    public function save() {
        $marker = 'SECRET_BODY';
        return true;
    }
}
`;
  const vue = `<template><div>Books</div></template>
<script setup>
function loadBooks() {
  return fetch('/books');
}
</script>
`;
  await write(phpPath, php);
  await write(vuePath, vue);
  await write(moduleNote, '# Book\n## Visão geral\nLivros do catálogo.\n## Riscos e pendências\n> [!warning] O cache pode estar antigo.\n');
  await write(layerNote, '# Services\n## Fluxo\nSalva livros.\n### Detalhes\nUsa o serviço.\n```md\n## Não é uma seção\n```\n## Riscos e pendências\n> [!warning] Valide antes de persistir.\n');
  await write(mapNote, '# Mapa\n## Módulos\nBook é o módulo de livros.\n');
  const sourceFile = (relative, source, module, layer) => ({
    path: relative, status: 'parsed', module, layer,
    language: relative.endsWith('.vue') ? 'Vue' : 'PHP', bytes: Buffer.byteLength(source),
    hash: crypto.createHash('sha256').update(source).digest('hex'), imports: [],
    symbols: parseSource(source, relative).units,
  });
  const report = { revision: 'abc123', warnings: [], modules: [
    { id: 'BACKEND:Book', label: 'Book', kind: 'graphy' },
    { id: 'frontend:Book', label: 'Book', kind: 'graphy' },
  ], files: [sourceFile(phpPath, php, 'BACKEND:Book', 'Services'),
    sourceFile(vuePath, vue, 'frontend:Book', 'Páginas')] };
  const classification = { present: true, valid: true, stale: false, data: {
    schemaVersion: 1, format: 'graphy-refat.classification.v1', revision: 'abc123',
    modules: [
      { id: 'BACKEND:Book', name: 'Book', note: moduleNote,
        layers: [{ name: 'Services', note: layerNote }] },
      { id: 'frontend:Book', name: 'Book', layers: [{ name: 'Páginas' }] },
    ],
  } };
  return { root, write, report, classification };
}

test('builds valid file, class, method and note hierarchy with bounded ranges', async t => {
  const { root, report, classification } = await fixture(t);
  const index = await buildContextIndex(root, report, { classification });
  const byId = new Map(index.records.map(record => [record.id, record]));
  for (const record of index.records) if (record.parent) assert.ok(byId.has(record.parent), record.id);
  const method = byId.get(`unit:${phpPath}#method:BookService.save`);
  assert.equal(method.parent, `unit:${phpPath}#class:BookService`);
  assert.equal(method.summary, 'Saves a book in the catalog.');
  assert.ok(byId.has(`unit:${vuePath}#setup:function:loadBooks`));
  assert.equal(index.meta.counts.notes, 3);
  assert.equal(index.meta.counts.sections, 5);
  for (const record of index.records.filter(item => item.lines)) {
    const source = await fs.readFile(path.join(root, record.path), 'utf8');
    const last = source.split(/\r?\n/).length;
    assert.ok(record.lines[0] >= 1 && record.lines[0] <= record.lines[1] && record.lines[1] <= last, record.id);
  }
  const sections = index.records.filter(item => item.kind === 'section' && item.path === layerNote)
    .sort((a, b) => a.lines[0] - b.lines[0]);
  assert.ok(sections[0].lines[1] < sections[1].lines[0]);
  assert.equal(sections[0].lines[1], 8);
  assert.deepEqual(sections[1].warnings, ['Valide antes de persistir.']);
  assert.equal(index.records.some(item => item.kind === 'section' && item.label === 'Não é uma seção'), false);
});

test('writes deterministic JSONL without method bodies', async t => {
  const { root, report, classification } = await fixture(t);
  const first = await buildContextIndex(root, report, { classification });
  const firstPaths = await writeContextIndex(root, first);
  const firstText = await fs.readFile(firstPaths.indexPath, 'utf8');
  const second = await buildContextIndex(root, report, { classification });
  await writeContextIndex(root, second);
  assert.equal(await fs.readFile(firstPaths.indexPath, 'utf8'), firstText);
  assert.ok(!firstText.includes('SECRET_BODY'));
  assert.deepEqual(firstText.trim().split('\n').map(line => JSON.parse(line).id),
    first.records.map(record => record.id));
  const meta = JSON.parse(await fs.readFile(firstPaths.metaPath, 'utf8'));
  assert.equal(meta.schemaVersion, 1);
  assert.equal(meta.counts.units, first.records.filter(item => item.kind === 'unit').length);
});

test('works without classification and skips notes', async t => {
  const { root, report } = await fixture(t);
  report.modules = [{ id: 'app/Services', label: 'Services', kind: 'layer' }];
  report.files = report.files.slice(0, 1).map(file => ({ ...file, module: 'app/Services', layer: 'service' }));
  const index = await buildContextIndex(root, report);
  assert.ok(index.records.some(record => record.id === 'module:app/Services'));
  assert.ok(index.records.some(record => record.id === 'layer:app/Services:service'));
  assert.equal(index.meta.classification.present, false);
  assert.equal(index.meta.counts.notes, 0);
  assert.equal(index.meta.counts.sections, 0);
});

test('consumes the mapper and classification reader output', async t => {
  const { root, write, classification } = await fixture(t);
  classification.data.files = {
    [phpPath]: { module: 'BACKEND:Book', layer: 'Services' },
    [vuePath]: { module: 'frontend:Book', layer: 'Páginas' },
  };
  classification.data.profile = 'laravel-inertia';
  await write('graphify-out/classification.json', JSON.stringify(classification.data));
  const report = await scanProject(root);
  const loaded = await readClassification(root);
  const index = await buildContextIndex(root, report, { classification: loaded });
  assert.equal(index.meta.classification.profile, 'laravel-inertia');
  assert.equal(index.records.find(record => record.id === `file:${phpPath}`).module, 'BACKEND:Book');
  assert.ok(index.records.some(record => record.id === `unit:${phpPath}#method:BookService.save`));
  assert.ok(index.records.some(record => record.kind === 'section' && record.path === layerNote));
});

test('ignores malicious note paths supplied by classification', async t => {
  const { root, report, classification } = await fixture(t);
  classification.data.modules[0].note = '../outside.md';
  classification.data.modules[0].layers[0].note = 'graphify-out\\vault-modules\\CONTEXTO\\BACKEND\\Book\\Services.md';
  const index = await buildContextIndex(root, report, { classification });
  assert.equal(index.records.some(record => record.path === '../outside.md'), false);
  assert.equal(index.meta.counts.notes, 1); // only the contextual map
});

test('refuses symbolic links at the output destination', async t => {
  const { root, report } = await fixture(t);
  const index = await buildContextIndex(root, report);
  const target = path.join(root, '.agentorchestra');
  try { await fs.symlink(path.join(root, 'elsewhere'), target, 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlinks unavailable'); throw error; }
  await assert.rejects(writeContextIndex(root, index), /Link simbólico/);
});
