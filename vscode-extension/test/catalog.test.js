'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { discover, createFile } = require('../src/catalog');

test('discovers project and user agents, skills and instructions', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, 'project');
  const home = path.join(temporary, 'home');
  for (const file of [
    path.join(project, '.claude', 'agents', 'reviewer.md'),
    path.join(project, '.codex', 'agents', 'builder.toml'),
    path.join(project, '.agents', 'skills', 'commit-writer', 'SKILL.md'),
    path.join(project, '.agents', 'routes', 'commit-writer.toml'),
    path.join(project, 'AGENTS.md'),
    path.join(home, '.codex', 'agents', 'global.toml')
  ]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'content');
  }
  const roots = discover([{ name: 'project', path: project }], home);
  assert.equal(roots.length, 2);
  assert.deepEqual(roots[0].groups.map(group => group.id), ['codexAgents', 'claudeAgents', 'skills', 'routes', 'instructions']);
  assert.equal(roots[1].groups[0].items[0].label, 'global');
  assert.equal(discover([{ name: 'project', path: project }], home, false).length, 1);
});

test('creates valid templates and refuses overwrites and invalid names', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = createFile(root, 'sharedSkill', 'my-skill');
  assert.equal(path.relative(root, file), path.join('.agents', 'skills', 'my-skill', 'SKILL.md'));
  assert.match(fs.readFileSync(file, 'utf8'), /name: my-skill/);
  assert.throws(() => createFile(root, 'sharedSkill', 'my-skill'), { code: 'EEXIST' });
  assert.throws(() => createFile(root, 'claudeAgent', '../outside'), /Use letras minúsculas/);
  assert.throws(() => createFile(root, 'unknown', 'valid'), /desconhecido/);
});
