'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const manifest = require('../package.json');
const { buildCatalogModel, createCatalogView } = require('../src/catalogView');

test('sidebar is a styled webview with the export and import commands', () => {
  const view = manifest.contributes.views.agentOrchestra[0];
  assert.equal(view.id, 'agentOrchestra.files');
  assert.equal(view.type, 'webview');
  assert.equal(view.name, 'Agentes');
  const commands = Object.fromEntries(manifest.contributes.commands.map(item => [item.command, item]));
  assert.match(commands['agentOrchestra.shareAgent'].title, /Exportar agente em ZIP/);
  assert.ok(commands['agentOrchestra.importPackage']);
  assert.equal(manifest.contributes.menus['view/item/context'], undefined);
});

test('catalog shows only the selected platform and folds duplicate skills into resources', () => {
  const root = { name: 'projeto', path: '/projeto', scope: 'workspace', groups: [
    { id: 'claudeAgents', items: [{ label: 'reviewer', file: '/projeto/.claude/agents/reviewer.md', category: 'claudeAgents' }] },
    { id: 'codexAgents', items: [{ label: 'reviewer', file: '/projeto/.codex/agents/reviewer.toml', category: 'codexAgents' }] },
    { id: 'skills', items: [
      { label: 'reviewer', file: '/projeto/.agents/skills/reviewer/SKILL.md', category: 'skills' },
      { label: 'reviewer', file: '/projeto/.claude/skills/reviewer/SKILL.md', category: 'skills' }
    ] }
  ] };
  const { model, entries } = buildCatalogModel([root], 'claude');
  assert.equal(model.agentCount, 1);
  assert.deepEqual(model.projects[0].agents.map(agent => agent.name), ['reviewer']);
  assert.equal(model.projects[0].agents[0].hasCounterpart, true);
  assert.equal(model.projects[0].resources.length, 1);
  assert.equal(entries.get(model.projects[0].agents[0].id).item.category, 'claudeAgents');
  const codex = buildCatalogModel([root], 'codex');
  assert.equal(codex.model.agentCount, 1);
  assert.equal(codex.entries.get(codex.model.projects[0].agents[0].id).item.category, 'codexAgents');
});

test('webview switch and export resolve actions from the host catalog', async () => {
  const root = { name: 'projeto', path: '/projeto', scope: 'workspace', groups: [
    { id: 'claudeAgents', items: [{ label: 'reviewer', file: '/projeto/.claude/agents/reviewer.md', category: 'claudeAgents' }] }
  ] };
  const messages = [];
  const actions = [];
  let receive;
  const webview = { cspSource: 'vscode-resource:', asWebviewUri: uri => uri.fsPath,
    postMessage: message => { messages.push(message); }, onDidReceiveMessage: callback => { receive = callback; } };
  const vscode = { Uri: { file: fsPath => ({ fsPath }) }, window: {
    registerWebviewViewProvider: (_id, provider) => {
      provider.resolveWebviewView({ webview, onDidDispose: () => ({ dispose() {} }) });
      return { dispose() {} };
    }
  } };
  const context = { extensionPath: '/ext', subscriptions: [] };
  createCatalogView(vscode, context, { roots: [root], platformFilter: 'claude',
    onDidChangeTreeData: () => ({ dispose() {} }) }, (...args) => { actions.push(args); });
  assert.match(webview.html, /Content-Security-Policy/);
  assert.match(webview.html, /catalog\.css/);
  const id = messages.at(-1).catalog.projects[0].agents[0].id;
  await receive({ type: 'platform', value: 'codex' });
  await receive({ type: 'entry', name: 'shareAgent', id });
  await receive({ type: 'entry', name: 'shareAgent', id: 'unknown' });
  assert.deepEqual(actions.map(action => action.slice(0, 2)), [['platform', 'codex'], ['entry', 'shareAgent']]);
  assert.equal(actions[1][2].item.file, '/projeto/.claude/agents/reviewer.md');
});
