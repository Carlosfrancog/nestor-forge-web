'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { compareVersions, validateRelease, verifyPackage } = require('../src/updates');

const manifest = 'https://example.test/project/updates/agentorchestra.json';
const id = 'nestor-forge.agentorchestra';
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
