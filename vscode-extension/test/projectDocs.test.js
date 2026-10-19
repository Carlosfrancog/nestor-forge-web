'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildHandoff, writeHandoff } = require('../src/projectDocs');

async function project(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-handoff-test-'));
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

test('publishes only atomic JSON handoff and leaves existing documentation untouched', async t => {
  const root = await project(t);
  const docs = path.join(root, 'docs', 'architecture');
  await fs.mkdir(docs, { recursive: true });
  await fs.writeFile(path.join(docs, 'index.md'), '# Manual\n');
  const rename = fs.rename;
  let atomic = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    assert.match(from, /\.tmp$/);
    assert.equal(path.basename(to), 'project-handoff.json');
    const draft = JSON.parse(await fs.readFile(from, 'utf8'));
    assert.equal(draft.revision, 'abc123');
    atomic = true;
    return rename(from, to);
  });
  const result = await writeHandoff(root, report(root));
  assert.ok(atomic);
  assert.equal((await fs.readFile(result.handoffPath, 'utf8')).includes('SECRET RAW CODE'), false);
  assert.equal(await fs.readFile(path.join(docs, 'index.md'), 'utf8'), '# Manual\n');
  assert.deepEqual(await fs.readdir(docs), ['index.md']);
});

test('failed publication preserves prior handoff', async t => {
  const root = await project(t);
  const first = await writeHandoff(root, report(root));
  const original = await fs.readFile(first.handoffPath, 'utf8');
  t.mock.method(fs, 'rename', async () => { throw new Error('rename failed'); });
  await assert.rejects(writeHandoff(root, report(root, { revision: 'new' })), /rename failed/);
  assert.equal(await fs.readFile(first.handoffPath, 'utf8'), original);
  assert.equal((await fs.readdir(path.dirname(first.handoffPath))).some(name => name.endsWith('.tmp')), false);
});

test('rejects symlink in handoff destination', async t => {
  const root = await project(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-handoff-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  try { await fs.symlink(outside, path.join(root, '.agentorchestra'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlinks não permitidos neste ambiente.'); throw error; }
  await assert.rejects(writeHandoff(root, report(root)), /Link simbólico/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('warns once about old generated Markdown without deleting it', async t => {
  const root = await project(t);
  const docs = path.join(root, 'docs', 'architecture');
  await fs.mkdir(docs, { recursive: true });
  await fs.writeFile(path.join(docs, '.agentorchestra-docs-manifest.json'), '{}');
  await fs.writeFile(path.join(docs, 'index.md'), '# antigo');
  const first = await writeHandoff(root, report(root));
  const second = await writeHandoff(root, report(root));
  assert.equal(first.warnings.length, 1);
  assert.deepEqual(second.warnings, []);
  assert.equal(await fs.readFile(path.join(docs, 'index.md'), 'utf8'), '# antigo');
});
