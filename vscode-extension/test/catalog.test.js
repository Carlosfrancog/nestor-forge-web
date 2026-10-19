'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { discover, filterRoots, createFile } = require('../src/catalog');

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

test('filters Claude and Codex entries while retaining shared Forge items', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-filter-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [
    '.claude/agents/reviewer.md', '.codex/agents/builder.toml',
    '.claude/skills/reviewer/SKILL.md', '.codex/skills/builder/SKILL.md',
    '.agents/skills/shared/SKILL.md', '.agents/routes/shared.toml',
    '.claude/skills/reviewer/scripts/check.js', '.codex/skills/builder/scripts/build.js',
    '.agents/skills/shared/scripts/common.js',
    'CLAUDE.md', 'AGENTS.md'
  ]) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'content');
  }
  const all = discover([{ name: 'project', path: root }], null);
  const labels = platform => filterRoots(all, platform)[0].groups.flatMap(group => group.items.map(item => item.label));
  assert.deepEqual(labels('claude'), ['reviewer', 'reviewer', 'shared', 'reviewer / check.js', 'shared / common.js', 'shared', 'CLAUDE.md']);
  assert.deepEqual(labels('codex'), ['builder', 'builder', 'shared', 'builder / build.js', 'shared / common.js', 'shared', 'AGENTS.md']);
  assert.equal(labels('all').length, 11);
  assert.equal(all[0].groups.length, 6);
});
