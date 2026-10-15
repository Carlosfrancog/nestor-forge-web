'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanProject } = require('../src/projectMap');
const { buildHandoff } = require('../src/projectDocs');

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
  assert.equal(first.stats.cacheEntries, 3);
  assert.ok(first.stats.cacheBytes > 0);
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
  assert.deepEqual(result.modules, [{ id: 'billing', label: 'Faturamento', kind: 'configured', path: 'src/payments', fileCount: 1 }]);
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

test('scans without persistent cache unless the caller supplies a cache directory', async t => {
  const { root, write } = await fixture(t);
  await write('src/main.js', 'export function start() {}');
  const first = await scanProject(root);
  const second = await scanProject(root);
  assert.equal(first.stats.parsed, 1);
  assert.equal(second.stats.parsed, 1);
  assert.equal(second.stats.cacheHits, 0);
  assert.equal(second.stats.cacheEntries, 0);
  await assert.rejects(fs.access(path.join(root, '.agentorchestra', 'cache')));
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

test('migrates only recognized legacy cache entries out of the project', async t => {
  const { root, write } = await fixture(t);
  await write('src/main.js', 'export function run() {}');
  const legacy = path.join(root, '.agentorchestra', 'cache', 'project-map');
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, `${'a'.repeat(64)}-js.json`), '{}');
  await scanProject(root, { cacheDir: `${root}-external-cache` });
  await assert.rejects(fs.access(legacy));
  t.after(() => fs.rm(`${root}-external-cache`, { recursive: true, force: true }));
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'manual.txt'), 'keep');
  await scanProject(root, { cacheDir: `${root}-external-cache` });
  assert.equal(await fs.readFile(path.join(legacy, 'manual.txt'), 'utf8'), 'keep');
});

test('Laravel distinguishes domain folders from framework layers', async t => {
  const { root, write } = await fixture(t);
  await write('composer.json', JSON.stringify({ require: { 'laravel/framework': '^13.0' } }));
  await write('artisan', '#!/usr/bin/env php');
  await write('app/Modules/Billing/Services/InvoiceService.php', '<?php class InvoiceService {}');
  await write('app/Modules/Billing/Http/InvoiceController.php', '<?php class InvoiceController {}');
  await write('app/Http/Controllers/HomeController.php', '<?php\nuse App\\Modules\\Billing\\Services\\InvoiceService;\nclass HomeController {}');
  await write('app/Models/User.php', '<?php class User {}');
  await write('routes/web.php', '<?php return [];');
  const report = await scanProject(root);
  assert.equal(report.framework, 'Laravel');
  const domain = report.modules.find(item => item.id === 'app/Modules/Billing');
  assert.deepEqual({ kind: domain.kind, fileCount: domain.fileCount }, { kind: 'domain', fileCount: 2 });
  assert.equal(report.modules.find(item => item.id === 'app/Http').kind, 'layer');
  assert.equal(report.modules.find(item => item.id === 'domain:User').kind, 'domain');
  assert.equal(report.modules.find(item => item.id === 'routes').kind, 'layer');
  assert.ok(report.edges.some(edge => edge.source === 'app/Http/Controllers/HomeController.php' && edge.target === 'app/Modules/Billing/Services/InvoiceService.php'));
});

test('Laravel maps a model and matching controller to one domain across layers', async t => {
  const { root, write } = await fixture(t);
  await write('composer.json', JSON.stringify({ require: { 'laravel/framework': '^13.0' } }));
  await write('app/Http/Controllers/OrderController.php', '<?php class OrderController {}');
  await write('app/Models/Order.php', '<?php class Order {}');
  const report = await scanProject(root);
  const order = report.modules.find(item => item.id === 'domain:Order');
  assert.deepEqual({ kind: order.kind, fileCount: order.fileCount, path: order.path },
    { kind: 'domain', fileCount: 2, path: 'app/Models/Order.php' });
  assert.equal(report.warnings.some(item => item.message.includes('camadas técnicas')), false);
});

test('Graphify-style taxonomy joins Laravel domains across backend and frontend without merging technical groups', async t => {
  const { root, write } = await fixture(t);
  await write('composer.json', JSON.stringify({ require: { 'laravel/framework': '^13.0' } }));
  await write('.agentorchestra/documentation.json', JSON.stringify({ taxonomy: {
    modelToModule: { UserProfile: 'User' },
    domainToModule: { Profile: 'User' },
    frontendPages: { 'settings/permissions': 'Permission', settings: 'Setting' },
    frontendComponents: { '011/profile': 'User' },
  } }));
  for (const file of [
    'app/Models/User.php', 'app/Models/UserProfile.php', 'app/Models/Order.php',
    'app/Http/Controllers/Admin/Orders/IndexController.php',
    'app/Services/Orders/CreateOrderService.php',
    'app/Policies/OrderPolicy.php',
    'app/Http/Controllers/Admin/Profile/UpdateController.php',
    'resources/js/pages/admin/orders/Index.vue',
    'resources/js/components/011/profile/Card.vue',
    'resources/js/pages/admin/settings/permissions/Index.vue',
    'app/Http/Middleware/VerifyCsrfToken.php',
    'routes/web.php',
  ]) await write(file, file.endsWith('.php') ? '<?php class Example {}' : '<template><div /></template>');
  const report = await scanProject(root);
  const byPath = new Map(report.files.map(file => [file.path, file.module]));
  for (const file of ['app/Models/Order.php', 'app/Http/Controllers/Admin/Orders/IndexController.php',
    'app/Services/Orders/CreateOrderService.php', 'app/Policies/OrderPolicy.php',
    'resources/js/pages/admin/orders/Index.vue']) assert.equal(byPath.get(file), 'domain:Order');
  for (const file of ['app/Models/User.php', 'app/Models/UserProfile.php',
    'app/Http/Controllers/Admin/Profile/UpdateController.php', 'resources/js/components/011/profile/Card.vue']) {
    assert.equal(byPath.get(file), 'domain:User');
  }
  assert.equal(byPath.get('resources/js/pages/admin/settings/permissions/Index.vue'), 'domain:Permission');
  assert.equal(byPath.get('app/Http/Middleware/VerifyCsrfToken.php'), 'app/Http');
  assert.equal(byPath.get('routes/web.php'), 'routes');
  assert.equal(report.modules.find(item => item.id === 'domain:Order').fileCount, 5);
  assert.equal(report.files.find(file => file.path === 'app/Policies/OrderPolicy.php').layer, 'policy');
  const handoff = buildHandoff(report);
  assert.equal(handoff.modules.find(item => item.id === 'domain:Order').counts.files, 5);
  assert.ok(handoff.modules.find(item => item.id === 'domain:Order').keyFiles.some(file => file.path === 'app/Models/Order.php'));
});

test('Laravel without a matching domain keeps technical layers and reports the gap', async t => {
  const { root, write } = await fixture(t);
  await write('composer.json', JSON.stringify({ require: { 'laravel/framework': '^13.0' } }));
  await write('app/Http/Controllers/HomeController.php', '<?php class HomeController {}');
  await write('routes/web.php', '<?php return [];');
  const report = await scanProject(root);
  assert.ok(report.modules.every(item => item.kind !== 'domain'));
  assert.ok(report.warnings.some(item => item.message.includes('camadas técnicas')));
});
