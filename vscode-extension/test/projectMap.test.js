'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanProject } = require('../src/projectMap');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-project-map-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, contents) => {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  };
  return { root, write };
}

test('maps folders, stable IDs, symbols and only verifiable relative imports', async t => {
  const { root, write } = await fixture(t);
  await write('src/orders/index.js', "import { total } from './math.js';\nimport missing from './missing.js';\nexport function checkout() { return total(); }\n");
  await write('src/orders/math.js', 'export function total() { return 2; }\n');
  await write('src/orders/README.md', '# Orders\n');
  const cacheDir = `${root}-cache`;
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const first = await scanProject(root, { cacheDir });
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first.files.map(file => file.id), ['src/orders/README.md', 'src/orders/index.js', 'src/orders/math.js']);
  assert.equal(first.files.find(file => file.id === 'src/orders/index.js').module, 'orders');
  assert.equal(first.files.find(file => file.id === 'src/orders/README.md').status, 'parsed');
  assert.ok(first.files.find(file => file.id === 'src/orders/README.md').symbols.some(symbol => symbol.key === 'heading:1:Orders'));
  assert.deepEqual(await fs.readdir(cacheDir), ['project-map-cache.json']);
  await assert.rejects(fs.access(path.join(root, '.agentorchestra', 'cache')));
  assert.ok(first.files.find(file => file.id === 'src/orders/index.js').symbols.some(symbol => symbol.key === 'function:checkout'));
  assert.deepEqual(first.edges, [{ source: 'src/orders/index.js', target: 'src/orders/math.js', kind: 'imports', count: 1 }]);
  assert.ok(first.folders.some(folder => folder.id === 'src/orders' && folder.parent === 'src'));
  const second = await scanProject(root, { cacheDir });
  assert.equal(second.stats.cacheHits, 3);
  assert.equal(second.stats.parsed, 0);
  assert.deepEqual(second.edges, first.edges);
  assert.deepEqual(second.files.map(file => file.id), first.files.map(file => file.id));
  await write('src/orders/math.js', 'export function total() { return 3; }\n');
  const third = await scanProject(root, { cacheDir });
  assert.equal(third.stats.cacheHits, 2);
  assert.equal(third.stats.parsed, 1);
});

test('omits generated folders and secrets, retains unsupported files, and reports unknown modules', async t => {
  const { root, write } = await fixture(t);
  await write('node_modules/pkg/index.js', 'export const hidden = true;');
  await write('graphify-out/graph.json', '{}');
  await write('.env', 'SECRET=hidden');
  await write('src/.env.local', 'TOKEN=hidden');
  await write('notes.txt', 'context');
  await write('src/start.js', 'export function start() {}');
  await write('src/huge.js', 'x'.repeat(200));
  await write('.agentorchestra/documentation.json', JSON.stringify({ maxFileBytes: 100 }));
  const result = await scanProject(root, { cacheDir: path.join(root, '.agentorchestra', 'cache') });
  assert.deepEqual(result.files.map(file => file.id), ['notes.txt', 'src/huge.js', 'src/start.js']);
  assert.equal(result.files.find(file => file.id === 'src/huge.js').status, 'too-large');
  assert.equal(result.files.find(file => file.id === 'notes.txt').status, 'without-parser');
  assert.ok(result.warnings.some(warning => warning.kind === 'classification'));
  assert.equal(result.stats.ignored >= 3, true);
});

test('configuration assigns module and excludes a custom directory', async t => {
  const { root, write } = await fixture(t);
  await write('.agentorchestra/documentation.json', JSON.stringify({
    exclude: ['generated'],
    modules: [{ id: 'billing', label: 'Faturamento', paths: ['src/payments'] }],
  }));
  await write('src/payments/api.ts', 'export function invoice() {}');
  await write('generated/api.ts', 'export function generated() {}');
  const result = await scanProject(root, { cacheDir: path.join(root, '.agentorchestra', 'cache') });
  assert.deepEqual(result.modules, [{ id: 'billing', label: 'Faturamento', fileCount: 1 }]);
  assert.deepEqual(result.files.map(file => file.id), ['src/payments/api.ts']);
});

test('does not map generated documentation back into its own context', async t => {
  const { root, write } = await fixture(t);
  await write('src/main.js', 'export function start() {}');
  await write('docs/architecture/.agentorchestra-docs-manifest.json', '{"schemaVersion":1}');
  await write('docs/architecture/index.md', '# Generated map');
  const result = await scanProject(root);
  assert.deepEqual(result.files.map(file => file.path), ['src/main.js']);
});

test('links local Markdown and HTML references but skips remote URLs', async t => {
  const { root, write } = await fixture(t);
  await write('docs/README.md', '[Guide](guide.md)\n[External](https://example.com/x)\n');
  await write('docs/guide.md', '# Guide\n');
  await write('web/index.html', '<!doctype html><html><head><link href="styles.css"></head><body><script src="./app.js"></script></body></html>');
  await write('web/styles.css', 'body { color: blue }');
  await write('web/app.js', 'console.log("ok")');
  const result = await scanProject(root);
  assert.deepEqual(result.edges.map(edge => [edge.source, edge.target]), [
    ['docs/README.md', 'docs/guide.md'],
    ['web/index.html', 'web/app.js'],
    ['web/index.html', 'web/styles.css'],
  ]);
  assert.equal(result.stats.parseErrors, 0);
});
