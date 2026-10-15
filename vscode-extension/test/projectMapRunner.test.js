'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanInWorker } = require('../src/projectMapRunner');

test('maps a project in a worker without blocking the extension host', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-worker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src', 'orders'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'orders', 'index.js'), 'export function checkout() {}\n');
  const progress = [];
  const report = await scanInWorker(root, { onProgress: item => progress.push(item.folder) });
  assert.equal(report.schemaVersion, 1);
  assert.ok(progress.includes('src/orders'));
  assert.equal(report.files[0].path, 'src/orders/index.js');
  assert.equal(report.files[0].status, 'parsed');
});

test('cancels a worker scan before starting', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-worker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanInWorker(root, { signal: controller.signal }), { name: 'AbortError' });
});
