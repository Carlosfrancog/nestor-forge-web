'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PRESETS, platformFor, agentName, buildPrompt, cliArgs } = require('../src/agentRuns');
const { discover } = require('../src/catalog');

test('ready workflows create a task for the selected agent and keep CLI arguments separate', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeFile = path.join(root, 'audit.md');
  const codexFile = path.join(root, 'audit.toml');
  fs.writeFileSync(claudeFile, '---\nname: security-reviewer\n---\n# Auditor\n');
  fs.writeFileSync(codexFile, 'name = "code_reviewer"\ndescription = "Review"\n');
  const claude = agentName({ category: 'claudeAgents', file: claudeFile });
  const codex = agentName({ category: 'codexAgents', file: codexFile });
  assert.equal(claude, 'security-reviewer');
  assert.equal(codex, 'code_reviewer');
  assert.equal(platformFor('claudeAgents'), 'claude');
  assert.equal(platformFor('codexAgents'), 'codex');
  const task = 'Verifique OrderService; não execute deploy';
  const prompt = buildPrompt('claude', claude, PRESETS[0], task);
  assert.match(prompt, /Verifique OrderService/);
  assert.deepEqual(cliArgs('claude', claude, prompt, root), ['--agent', claude, prompt]);
  const codexPrompt = buildPrompt('codex', codex, PRESETS[1], 'módulo orders');
  assert.match(codexPrompt, /subagente personalizado "code_reviewer"/);
  assert.deepEqual(cliArgs('codex', codex, codexPrompt, root), ['--cd', root, codexPrompt]);
});

test('free mission and bug workflow require a concrete task', () => {
  for (const preset of PRESETS.filter(value => value.needsTask)) {
    assert.throws(() => buildPrompt('claude', 'reviewer', preset, ' '), /Descreva a tarefa/);
  }
  assert.throws(() => platformFor('skills'), /Selecione um agente/);
});

test('ready workflows appear in each project tree and point to the run command', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-presets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documentation = path.join(root, 'AGENT_RUNS.md');
  const roots = discover([{ name: 'project', path: root }], null, false,
    { file: documentation, documentation, presets: PRESETS, presetDocumentation: documentation });
  const group = roots[0].groups.find(value => value.id === 'presets');
  assert.equal(group.label, 'Roteiros prontos');
  assert.deepEqual(group.items.map(value => value.preset), PRESETS.map(value => value.id));
  assert.ok(group.items.every(value => value.category === 'agentPreset' && value.file === documentation));
});
