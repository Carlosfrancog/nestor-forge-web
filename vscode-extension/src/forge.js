'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROFILES = ['reader', 'coder', 'reviewer', 'infra', 'qa', 'planner', 'audio', 'custom'];

function slugify(name) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '') || 'agente';
}

function invoke(python, extensionRoot, args, cwd) {
  const entry = path.join(extensionRoot, 'backend', 'entry.py');
  if (!fs.existsSync(path.join(extensionRoot, 'vendor', 'nestor_forge', 'compiler.py'))) {
    throw new Error('Núcleo da Forja ausente. Execute npm run vscode:prepublish na pasta da extensão.');
  }
  return new Promise((resolve, reject) => {
    execFile(python, ['-B', entry, ...args], {
      cwd, windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    }, (error, stdout, stderr) => {
      let report;
      try { report = JSON.parse(stdout); }
      catch (_) { return reject(new Error(stderr.trim() || stdout.trim() || error?.message || 'A Forja não retornou JSON.')); }
      if (error || report.ok === false) return reject(new Error(report.error || stderr.trim() || error.message));
      resolve(report);
    });
  });
}

async function makeSpec(python, extensionRoot, root, { name, role, mission, profile }) {
  if (!PROFILES.includes(profile)) throw new Error('Perfil inválido.');
  if (![name, role, mission].every(value => typeof value === 'string' && value.trim())) throw new Error('Nome, papel e missão são obrigatórios.');
  return invoke(python, extensionRoot, ['template', '--profile', profile, '--name', name, '--role', role, '--mission', mission], root);
}

function saveSpec(root, spec) {
  const file = path.join(root, '.agentorchestra', 'specs', `${slugify(spec.name)}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
  return file;
}

function build(python, extensionRoot, root, specFile, target = 'unified-project') {
  if (!['unified-project', 'claude-project'].includes(target)) throw new Error('Destino de projeto inválido.');
  return invoke(python, extensionRoot, ['build', '--spec', specFile, '--target', target, '--output', root], root);
}

module.exports = { PROFILES, slugify, invoke, makeSpec, saveSpec, build };
