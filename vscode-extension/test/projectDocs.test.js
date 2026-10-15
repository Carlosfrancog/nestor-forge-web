'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildHandoff, writeProjectDocs } = require('../src/projectDocs');

async function project(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-docs-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function report(root, override = {}) {
  return {
    schemaVersion: 1, root, revision: 'abc123', generatedAt: '2026-10-15T00:00:00Z',
    folders: [{ id: 'src', path: 'src' }],
    files: [
      { id: 'src/main.ts', path: 'src/main.ts', moduleId: 'app', isEntry: true, line: 1, fingerprint: 'hash1', source: 'SECRET RAW CODE' },
      { id: 'src/api.ts', path: 'src/api.ts', moduleId: 'app', line: 5, fingerprint: 'hash2' },
    ],
    modules: [{ id: 'app', name: 'Aplicação', path: 'src', evidence: [{ path: 'src/main.ts', line: 1 }] }],
    edges: [{ from: 'src/main.ts', to: 'src/api.ts', type: 'imports', evidence: { path: 'src/main.ts', line: 2 } }],
    warnings: [{ moduleId: 'app', message: 'rota dinâmica não resolvida', path: 'src/api.ts' }],
    stats: { total: 2 }, ...override,
  };
}

test('handoff is compact, stable and carries path/line evidence without source text', async t => {
  const root = await project(t);
  const data = report(root);
  const handoff = buildHandoff(data);
  assert.equal(handoff.counts.files, 2);
  assert.equal(handoff.modules[0].counts.relations, 1);
  assert.deepEqual(handoff.modules[0].relations[0].evidence, { path: 'src/main.ts', line: 2 });
  assert.ok(handoff.modules[0].gaps.includes('rota dinâmica não resolvida'));
  assert.ok(!JSON.stringify(handoff).includes('SECRET RAW CODE'));
  assert.ok(!JSON.stringify(handoff).includes(root));
  const reordered = report(root, { generatedAt: 'tomorrow', files: [...data.files].reverse() });
  assert.equal(buildHandoff(reordered).mapHash, handoff.mapHash);
  assert.notEqual(buildHandoff(report(root, { revision: 'def456' })).mapHash, handoff.mapHash);
});

test('consumes scanner module labels, file symbols and source/target edges', async t => {
  const root = await project(t);
  const data = report(root, {
    files: [{ id: 'src/main.ts', path: 'src/main.ts', module: 'app', symbols: [{ key: 'function:start', line: 7 }] }],
    modules: [{ id: 'app', label: 'Aplicação', fileCount: 1 }],
    edges: [{ source: 'src/main.ts', target: 'src/other.ts', kind: 'imports', count: 1 }],
    stats: { folders: 4 },
  });
  const handoff = buildHandoff(data);
  assert.equal(handoff.modules[0].name, 'Aplicação');
  assert.deepEqual(handoff.modules[0].keyFiles, [{ path: 'src/main.ts', line: 7 }]);
  assert.equal(handoff.modules[0].relations[0].type, 'imports');
  assert.equal(handoff.counts.folders, 4);
});

test('publishing preserves manual notes and replaces only manifest-owned notes', async t => {
  const root = await project(t);
  const first = await writeProjectDocs(root, report(root));
  const modulePath = first.generatedPaths.find(filename => filename.includes(`${path.sep}modules${path.sep}`));
  const manualPath = path.join(first.outputDir, 'manual.md');
  await fs.writeFile(manualPath, '# Anotações do time\n');
  await fs.writeFile(modulePath, 'old generated content');
  const second = await writeProjectDocs(root, report(root, { revision: 'next' }));
  assert.equal(await fs.readFile(manualPath, 'utf8'), '# Anotações do time\n');
  assert.ok(!(await fs.readFile(modulePath, 'utf8')).includes('old generated content'));
  assert.ok((await fs.readFile(second.indexPath, 'utf8')).includes('next'));
  const handoff = JSON.parse(await fs.readFile(second.handoffPath, 'utf8'));
  assert.equal(handoff.revision, 'next');
  assert.equal(handoff.mapHash.length, 64);
});

test('copies existing documentation into a stage that does not already exist', async t => {
  const root = await project(t);
  await writeProjectDocs(root, report(root));
  const copy = fs.cp;
  t.mock.method(fs, 'cp', async (source, destination, options) => {
    await assert.rejects(fs.access(destination), { code: 'ENOENT' });
    return copy(source, destination, options);
  });
  const result = await writeProjectDocs(root, report(root, { revision: 'next' }));
  assert.ok((await fs.readFile(result.indexPath, 'utf8')).includes('next'));
});

test('generation failure leaves published docs and manual files untouched', async t => {
  const root = await project(t);
  const first = await writeProjectDocs(root, report(root));
  const original = await fs.readFile(first.indexPath, 'utf8');
  const manual = path.join(first.outputDir, 'manual.md');
  await fs.writeFile(manual, 'manual');
  await fs.rm(path.join(first.outputDir, 'modules'), { recursive: true });
  await fs.writeFile(path.join(first.outputDir, 'modules'), 'conflicting manual file');
  await assert.rejects(writeProjectDocs(root, report(root, { revision: 'new' })));
  assert.equal(await fs.readFile(first.indexPath, 'utf8'), original);
  assert.equal(await fs.readFile(manual, 'utf8'), 'manual');
  assert.equal(await fs.readFile(path.join(first.outputDir, 'modules'), 'utf8'), 'conflicting manual file');
});

test('handoff publication failure restores the prior documentation', async t => {
  const root = await project(t);
  const first = await writeProjectDocs(root, report(root));
  const original = await fs.readFile(first.indexPath, 'utf8');
  await fs.rm(first.handoffPath);
  await fs.mkdir(first.handoffPath);
  await assert.rejects(writeProjectDocs(root, report(root, { revision: 'new' })));
  assert.equal(await fs.readFile(first.indexPath, 'utf8'), original);
});

test('rejects an output path whose parent redirects outside the project', async t => {
  const root = await project(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-docs-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  try { await fs.symlink(outside, path.join(root, 'docs'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlinks não permitidos neste ambiente.'); throw error; }
  await assert.rejects(writeProjectDocs(root, report(root)), /Link simbólico/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('module links are stable and Obsidian links are opt-in', async t => {
  const root = await project(t);
  const data = report(root);
  const first = await writeProjectDocs(root, data);
  const expected = `modules/app-${crypto.createHash('sha256').update(JSON.stringify('app')).digest('hex').slice(0, 8)}.md`;
  assert.ok((await fs.readFile(first.indexPath, 'utf8')).includes(`](${expected})`));
  await fs.mkdir(path.join(root, '.agentorchestra'), { recursive: true });
  await fs.writeFile(path.join(root, '.agentorchestra', 'documentation.json'), JSON.stringify({ linkStyle: 'obsidian' }));
  const second = await writeProjectDocs(root, report(root, { modules: [{ ...data.modules[0], name: 'Aplicação Renomeada' }] }));
  assert.ok((await fs.readFile(second.indexPath, 'utf8')).includes(`[[${expected.replace(/\.md$/, '')}|Aplicação Renomeada]]`));
  assert.deepEqual(first.generatedPaths.sort(), second.generatedPaths.sort());
});

test('manual index is not overwritten on first generation', async t => {
  const root = await project(t);
  const output = path.join(root, 'docs', 'architecture');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'index.md'), '# Índice manual\n');
  await assert.rejects(writeProjectDocs(root, report(root)), /Nota manual ocupa/);
  assert.equal(await fs.readFile(path.join(output, 'index.md'), 'utf8'), '# Índice manual\n');
});

test('git note is emitted only when report contains a summary', async t => {
  const root = await project(t);
  const first = await writeProjectDocs(root, report(root));
  assert.ok(!first.generatedPaths.some(filename => filename.endsWith('changes.md')));
  const second = await writeProjectDocs(root, report(root, { git: { commits: [{ hash: 'abc123', message: 'Ajusta parser', paths: ['src/api.ts'] }] } }));
  assert.ok(second.generatedPaths.some(filename => filename.endsWith('changes.md')));
  assert.ok((await fs.readFile(path.join(second.outputDir, 'changes.md'), 'utf8')).includes('Ajusta parser'));
  const handoff = JSON.parse(await fs.readFile(second.handoffPath, 'utf8'));
  assert.deepEqual(handoff.git.changes, [{ hash: 'abc123', subject: 'Ajusta parser', paths: ['src/api.ts'] }]);
  const third = await writeProjectDocs(root, report(root));
  await assert.rejects(fs.access(path.join(third.outputDir, 'changes.md')));
});
