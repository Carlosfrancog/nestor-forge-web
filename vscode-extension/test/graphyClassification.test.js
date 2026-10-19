'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readClassification, classifyFile } = require('../src/graphyClassification');
const { scanProject } = require('../src/projectMap');

const fixturePath = path.join(__dirname, 'fixtures', 'graphy', 'classification.json');

async function project(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-graphy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, content) => {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  };
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  return { root, write, fixture };
}

test('missing classification keeps degraded mode', async t => {
  const { root } = await project(t);
  assert.deepEqual(await readClassification(root), { present: false, valid: false, warnings: [] });
});

test('invalid JSON and unknown version yield warnings', async t => {
  const { root, write, fixture } = await project(t);
  await write('graphify-out/classification.json', '{');
  const invalid = await readClassification(root);
  assert.equal(invalid.present, true);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.warnings.length);
  await write('graphify-out/classification.json', JSON.stringify({ ...fixture, schemaVersion: 99 }));
  const unknown = await readClassification(root);
  assert.equal(unknown.valid, false);
  assert.match(unknown.warnings[0].message, /Versão/);
});

test('unsafe paths and note paths are ignored', async t => {
  const { root, write, fixture } = await project(t);
  fixture.files['../escape.php'] = { module: 'BACKEND:Book', layer: 'Model' };
  fixture.files['C:/escape.php'] = { module: 'BACKEND:Book', layer: 'Model' };
  fixture.files['app\\escape.php'] = { module: 'BACKEND:Book', layer: 'Model' };
  fixture.modules[0].note = '../secret.md';
  fixture.modules[0].layers[0].note = 'C:/secret.md';
  await write('graphify-out/classification.json', JSON.stringify(fixture));
  const result = await readClassification(root);
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.data.files).length, 3);
  assert.equal(result.data.modules[0].note, null);
  assert.equal(classifyFile(result, 'app/Models/Book.php').note, null);
  assert.ok(result.warnings.length >= 5);
});

test('classification symlink is rejected', async t => {
  const { root, write, fixture } = await project(t);
  await write('source.json', JSON.stringify(fixture));
  await fs.mkdir(path.join(root, 'graphify-out'));
  try { await fs.symlink(path.join(root, 'source.json'), path.join(root, 'graphify-out', 'classification.json')); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  const result = await readClassification(root);
  assert.equal(result.present, true);
  assert.equal(result.valid, false);
  assert.match(result.warnings[0].message, /symlink/);
});

test('different Git HEAD marks classification stale', async t => {
  const { root, write, fixture } = await project(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com',
    'commit', '--allow-empty', '-m', 'fixture', '-q'], { cwd: root });
  fixture.revision = '0'.repeat(40);
  await write('graphify-out/classification.json', JSON.stringify(fixture));
  const result = await readClassification(root);
  assert.equal(result.valid, true);
  assert.equal(result.stale, true);
  assert.ok(result.warnings.some(item => item.kind === 'classification-stale'));
});

test('scanProject uses Graphy for covered files and generic groups elsewhere', async t => {
  const { root, write, fixture } = await project(t);
  await write('graphify-out/classification.json', JSON.stringify(fixture));
  await write('composer.json', JSON.stringify({ require: { 'laravel/framework': '^13.0' } }));
  await write('app/Models/Book.php', '<?php class Book {}');
  await write('app/Services/Book/BookService.php', '<?php class BookService {}');
  await write('resources/js/pages/admin/books/Index.vue', '<template><div>Book</div></template>');
  await write('routes/web.php', '<?php return [];');
  const report = await scanProject(root);
  assert.deepEqual(report.classification, { present: true, revision: null, stale: false });
  assert.equal(report.files.find(file => file.path === 'app/Models/Book.php').module, 'BACKEND:Book');
  assert.equal(report.files.find(file => file.path === 'app/Models/Book.php').layer, 'Model');
  assert.equal(report.files.find(file => file.path === 'resources/js/pages/admin/books/Index.vue').module, 'frontend:Book');
  assert.equal(report.files.find(file => file.path === 'routes/web.php').module, 'routes');
  assert.deepEqual(report.modules.find(item => item.id === 'BACKEND:Book'),
    { id: 'BACKEND:Book', label: 'Book', kind: 'graphy', path: 'app', fileCount: 2 });
  assert.ok(!report.files.some(file => file.path.startsWith('graphify-out/')));
});
