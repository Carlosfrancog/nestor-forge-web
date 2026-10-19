'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');

function gitOutput(root, args) {
  return new Promise(resolve => execFile('git', args, {
    cwd: root, windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024
  }, (error, stdout) => resolve(error ? '' : stdout.trim())));
}

async function recentGitChanges(root) {
  const output = await gitOutput(root, ['log', '-n', '10', '--format=commit:%h%x09%s', '--name-only']);
  const changes = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('commit:')) {
      const [hash, ...subject] = line.slice(7).split('\t');
      if (/^[a-f0-9]{7,40}$/i.test(hash)) changes.push({ hash, message: subject.join(' ').slice(0, 180), paths: [] });
    } else if (line && changes.length && !line.startsWith('commit:')) {
      const value = line.replace(/\\/g, '/');
      if (!value.startsWith('../') && !path.posix.isAbsolute(value) && changes.at(-1).paths.length < 8) {
        changes.at(-1).paths.push(value);
      }
    }
  }
  return changes;
}

/** Caminhos (relativos, POSIX) que o Git do projeto versiona; fora de um repositório, nenhum. */
async function trackedPaths(root, paths) {
  const output = await gitOutput(root, ['ls-files', '--', ...paths]);
  const tracked = new Set(output.split(/\r?\n/).filter(Boolean).map(value => value.replace(/\\/g, '/')));
  return paths.filter(value => tracked.has(value));
}

module.exports = { gitOutput, recentGitChanges, trackedPaths };
