'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { discover } = require('../src/catalog');
const { analyzeRepository, renderMarkdown } = require('../src/diffAst');
const { planMonitoring, saveMonitoring, summarize } = require('../src/activity');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-integration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('script catalog includes skill scripts and integrated analyzer', t => {
  const root = temporary(t);
  const skill = path.join(root, '.agents', 'skills', 'review', 'scripts', 'scan.py');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, 'print(1)');
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md'), '# Review');
  const roots = discover([{ name: 'project', path: root }], null, false,
    { file: path.join(__dirname, '..', 'scripts', 'diff-ast.js'), documentation: path.join(__dirname, '..', 'scripts', 'DIFF_AST.md') });
  const scripts = roots[0].groups.find(group => group.id === 'scripts').items;
  assert.equal(scripts.length, 2);
  assert.equal(scripts.find(item => item.label === 'review / scan.py').documentation, path.join(root, '.agents', 'skills', 'review', 'SKILL.md'));
});

test('diff analysis links a PHP controller method to a service and names its evidence', t => {
  const root = temporary(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  const controller = path.join(root, 'OrderController.php');
  fs.writeFileSync(controller, '<?php class OrderController { public function save() { validate(); persist(); return true; } }');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  fs.writeFileSync(controller, '<?php class OrderController {}');
  fs.writeFileSync(path.join(root, 'OrderService.php'), '<?php class OrderService { public function save() { validate(); persist(); return true; } }');
  const report = analyzeRepository(root);
  assert.equal(report.project, path.basename(root));
  assert.equal(report.changedTotal, 2);
  assert.equal(report.files.find(file => file.path === 'OrderService.php').status, 'untracked');
  assert.ok(report.moves.some(move => move.from.unit.key === 'method:OrderController.save' && move.to.unit.key === 'method:OrderService.save' && move.exact));
  assert.match(renderMarkdown(report), /controller → service/);
  assert.match(renderMarkdown(report), /Trecho 1: antes → depois/);
  assert.match(renderMarkdown(report), /class OrderService/);
});

test('report distinguishes new files from modifications and lists unsupported changed files', t => {
  const root = temporary(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), '# Before\n');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(root, 'README.md'), '# After\n');
  fs.writeFileSync(path.join(root, 'hook.js'), "process.stdin.on('data', () => {});\n");
  const report = analyzeRepository(root);
  assert.deepEqual(report.ignored, ['README.md']);
  assert.equal(report.changedTotal, 2);
  assert.equal(report.files[0].status, 'untracked');
  assert.ok(report.files[0].changes.added.some(unit => unit.key === 'module:top-level'));
  assert.match(renderMarkdown(report), /Todos os arquivos de código analisados são novos/);
  assert.doesNotMatch(renderMarkdown(report), /Trecho 1: antes → depois/);
});

test('diff analysis finds worker created for a JavaScript class', t => {
  const root = temporary(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'Runner.js'), 'class Runner { start() { return true; } }');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(root, 'Runner.js'), 'class Runner { start() { return new Worker("./runner.worker.js"); } }');
  assert.match(renderMarkdown(analyzeRepository(root)), /Worker instanciado em `method:Runner.start`/);
});

test('monitoring hooks preserve existing entries and report only observed activity', t => {
  const root = temporary(t);
  const file = path.join(root, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hooks: { SubagentStart: [{ hooks: [{ type: 'command', command: 'echo retained' }] }] } }));
  const script = path.join(root, 'hook.js');
  const log = path.join(root, 'events.jsonl');
  saveMonitoring(planMonitoring(root, script, log, ['claude'], true));
  const enabled = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(enabled.hooks.SubagentStart.length, 2);
  saveMonitoring(planMonitoring(root, script, log, ['claude'], false));
  const disabled = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disabled.hooks.SubagentStart.length, 1);
  assert.equal(disabled.hooks.SubagentStart[0].hooks[0].command, 'echo retained');
  const item = { category: 'claudeAgents', label: 'reviewer', file: path.join(root, 'reviewer.md') };
  const now = Date.now();
  assert.equal(summarize([{ at: new Date(now - 1000).toISOString(), platform: 'claude', event: 'SubagentStart', cwd: root, session: 's', agentId: 'a', agentType: 'reviewer' }], item,
    { scope: 'workspace', path: root }, now).state, 'observed-active');
});
