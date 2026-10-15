'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { compareVersions, validateRelease, verifyPackage, resolveCli } = require('../src/updates');

const manifest = 'https://example.test/project/updates/agentorchestra.json';
const id = 'CarlosEFranco.agentorchestra';
const release = {
  schemaVersion: 1,
  extensionId: id,
  version: '0.4.1',
  url: '../downloads/agentorchestra-0.4.1.vsix',
  sha256: 'a'.repeat(64),
  size: 12345
};

test('compares semantic versions and resolves the VSIX relative to the published manifest', () => {
  assert.equal(compareVersions('0.4.1', '0.4.0'), 1);
  assert.equal(compareVersions('0.4.1', '0.4.1'), 0);
  assert.equal(compareVersions('0.4.0', '0.4.1'), -1);
  assert.equal(validateRelease(release, manifest, id).url, 'https://example.test/project/downloads/agentorchestra-0.4.1.vsix');
});

test('rejects a different extension, unsafe URLs and incomplete package metadata', () => {
  assert.throws(() => validateRelease({ ...release, extensionId: 'other.extension' }, manifest, id));
  assert.throws(() => validateRelease({ ...release, url: 'http://example.test/file.vsix' }, manifest, id));
  assert.throws(() => validateRelease({ ...release, url: 'https://other.test/file.vsix' }, manifest, id));
  assert.throws(() => validateRelease({ ...release, sha256: 'bad' }, manifest, id));
  assert.throws(() => validateRelease({ ...release, size: 0 }, manifest, id));
});

test('refuses a downloaded package with a different hash or size', () => {
  const contents = Buffer.from('VSIX content');
  const expected = { size: contents.length, sha256: crypto.createHash('sha256').update(contents).digest('hex') };
  assert.doesNotThrow(() => verifyPackage(contents, expected));
  assert.throws(() => verifyPackage(contents, { ...expected, size: contents.length + 1 }));
  assert.throws(() => verifyPackage(contents, { ...expected, sha256: '0'.repeat(64) }));
});

test('uses the bundled VS Code CLI on Windows instead of passing extension flags to Code.exe', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const exe = path.join(root, 'Code.exe');
  const script = path.join(root, '16507d91be', 'resources', 'app', 'out', 'cli.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(exe, '');
  fs.writeFileSync(script, '');
  const environment = { TEST_VALUE: 'preserved' };

  for (const configured of ['auto', exe, path.join(root, 'bin', 'code.cmd')]) {
    const invocation = resolveCli(configured, { platform: 'win32', executable: exe, environment });
    assert.equal(invocation.command, exe);
    assert.deepEqual(invocation.args, [script]);
    assert.equal(invocation.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(invocation.env.VSCODE_DEV, '');
    assert.equal(invocation.env.TEST_VALUE, 'preserved');
  }
});

test('reports a missing bundled VS Code CLI before attempting an update', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => resolveCli('auto', { platform: 'win32', executable: path.join(root, 'Code.exe') }), /CLI do VS Code/);
});
