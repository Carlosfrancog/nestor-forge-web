'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

function invoke(python, extensionRoot, command, args) {
  const script = path.join(extensionRoot, 'backend', 'share.py');
  return new Promise((resolve, reject) => {
    execFile(python, ['-B', script, command, ...args], {
      windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    }, (error, stdout, stderr) => {
      let result;
      try { result = JSON.parse(stdout); }
      catch (_) { return reject(new Error(stderr.trim() || stdout.trim() || error?.message || 'O pacote não retornou um relatório.')); }
      if (error || result.ok === false) return reject(new Error(result.error || stderr.trim() || error.message));
      resolve(result);
    });
  });
}

function exportAgent(python, extensionRoot, source, entry, output) {
  return invoke(python, extensionRoot, 'export', ['--source', source, '--entry', entry, '--output', output]);
}

function inspectPackage(python, extensionRoot, archive, target) {
  return invoke(python, extensionRoot, 'inspect', ['--archive', archive, '--target', target]);
}

function importPackage(python, extensionRoot, archive, target) {
  return invoke(python, extensionRoot, 'import', ['--archive', archive, '--target', target]);
}

module.exports = { invoke, exportAgent, inspectPackage, importPackage };
