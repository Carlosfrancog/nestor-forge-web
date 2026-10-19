'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { trackedPaths } = require('../src/gitChanges');

const HANDOFF = '.agentorchestra/context/project-handoff.json';
const INDEX = '.agentorchestra/context/index.jsonl';

test('trackedPaths devolve só as saídas de contexto versionadas', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-tracked-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    fs.mkdirSync(path.join(root, '.agentorchestra', 'context'), { recursive: true });
    fs.writeFileSync(path.join(root, ...HANDOFF.split('/')), '{}');
    fs.writeFileSync(path.join(root, ...INDEX.split('/')), '');
    assert.deepEqual(await trackedPaths(root, [HANDOFF, INDEX]), []);
    git('add', HANDOFF);
    assert.deepEqual(await trackedPaths(root, [HANDOFF, INDEX]), [HANDOFF]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fora de um repositório Git nenhum caminho conta como versionado', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-untracked-'));
  try { assert.deepEqual(await trackedPaths(root, [HANDOFF]), []); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
