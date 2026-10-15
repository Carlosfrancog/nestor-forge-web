'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assetFor, probe, resolvePython } = require('../src/python');

test('selects pinned uv archives for supported systems', () => {
  assert.match(assetFor('win32', 'x64')[0], /windows-msvc\.zip$/);
  assert.match(assetFor('linux', 'arm64')[0], /linux-gnu\.tar\.gz$/);
  assert.match(assetFor('darwin', 'arm64')[1], /^[a-f0-9]{64}$/);
  assert.throws(() => assetFor('plan9', 'x64'), /indisponível/);
});

test('rejects missing Python executables', async () => {
  assert.equal(await probe('agentorchestra-python-that-does-not-exist'), false);
});

test('downloads Python once when the default command is absent', async () => {
  let installs = 0;
  let progress = 0;
  const context = { globalStorageUri: { fsPath: 'extension-storage' } };
  const vscode = {
    ProgressLocation: { Notification: 15 },
    workspace: { getConfiguration: () => ({ get: () => 'python' }) },
    window: { withProgress: (_, callback) => { progress++; return callback(); } }
  };
  const dependencies = {
    probePython: async () => false,
    installPython: async storage => { installs++; assert.equal(storage, 'extension-storage'); return '/managed/python'; }
  };
  const resolved = await Promise.all([
    resolvePython(context, vscode, dependencies), resolvePython(context, vscode, dependencies)
  ]);
  assert.deepEqual(resolved, ['/managed/python', '/managed/python']);
  assert.equal(installs, 1);
  assert.equal(progress, 1);
});

test('reports an invalid custom interpreter without downloading', async () => {
  const vscode = { workspace: { getConfiguration: () => ({ get: () => '/missing/python' }) } };
  await assert.rejects(resolvePython({}, vscode, { probePython: async () => false }), /pythonPath não está disponível/);
});
