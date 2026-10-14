'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('agent command opens dashboard and starts an interactive CLI task for both platforms', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of [
    ['.claude/agents/reviewer.md', '---\nname: reviewer\n---\n# Reviewer\n'],
    ['.codex/agents/builder.toml', 'name = "builder"\ndescription = "Build"\n']
  ]) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  class Emitter {
    listeners = new Set();
    event = callback => { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; };
    fire(value) { for (const callback of this.listeners) callback(value); }
    dispose() { this.listeners.clear(); }
  }
  const callbacks = new Map();
  const processStarted = new Emitter();
  const processEnded = new Emitter();
  const tasks = [];
  const taskExecutions = [];
  const panels = [];
  let treeProvider;
  const openedCommands = [];
  let copiedPrompt = '';
  let surfaceMode = 'terminal';
  const context = {
    extensionPath: path.join(__dirname, '..'), globalStorageUri: { fsPath: root },
    extension: { packageJSON: require('../package.json') },
    globalState: { get: () => undefined, update: async () => undefined },
    workspaceState: { get: () => undefined }, subscriptions: []
  };
  const vscode = {
    EventEmitter: Emitter,
    TreeItem: class { constructor(label) { this.label = label; } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    TreeItemCollapsibleState: { Expanded: 2, None: 0 },
    Uri: { file: fsPath => ({ fsPath, scheme: 'file' }) },
    ViewColumn: { Beside: 2 },
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 2 },
    Task: class { constructor(definition, folder, name, source, execution) { Object.assign(this, { definition, folder, name, source, execution }); } },
    ProcessExecution: class { constructor(process, args, options) { Object.assign(this, { process, args, options }); } },
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ name: 'project', uri: { fsPath: root, scheme: 'file' } }],
      getConfiguration: () => ({ get: key => ({ includeUserInstallations: false, claudePath: process.execPath, codexPath: process.execPath, updateMode: 'off' })[key] }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      createFileSystemWatcher: () => ({ onDidCreate() {}, onDidDelete() {}, onDidChange() {}, dispose() {} })
    },
    commands: {
      registerCommand: (id, callback) => { callbacks.set(id, callback); return { dispose() {} }; },
      executeCommand: async id => { openedCommands.push(id); }
    },
    extensions: { getExtension: () => ({}) },
    env: { clipboard: { writeText: async value => { copiedPrompt = value; } } },
    tasks: {
      onDidStartTaskProcess: processStarted.event,
      onDidEndTaskProcess: processEnded.event,
      executeTask: async task => { const execution = { task }; tasks.push(task); taskExecutions.push(execution); return execution; }
    },
    window: {
      createTreeView: (_id, options) => { treeProvider = options.treeDataProvider; return { dispose() {} }; },
      createWebviewPanel: () => {
        const disposers = [];
        const panel = { webview: { html: '', onDidReceiveMessage: () => ({ dispose() {} }) },
          onDidDispose: callback => { disposers.push(callback); return { dispose() {} }; },
          dispose: () => disposers.forEach(callback => callback()), reveal() {} };
        panels.push(panel);
        return panel;
      },
      showQuickPick: async (items, options) => options.placeHolder === 'Onde acompanhar o agente?' && surfaceMode === 'extension' ? items[1] : items[0],
      showInputBox: async () => 'Revise o serviço de pedidos',
      showErrorMessage: message => { throw new Error(message); },
      showInformationMessage: () => undefined
    }
  };
  const previousLoad = Module._load;
  Module._load = function (id, parent, isMain) {
    return id === 'vscode' ? vscode : previousLoad.call(this, id, parent, isMain);
  };
  let extension;
  try { extension = require('../src/extension'); }
  finally { Module._load = previousLoad; }
  extension.activate(context);
  t.after(() => { for (const panel of panels) panel.dispose?.(); for (const item of context.subscriptions) item.dispose?.(); });
  for (const [category, relative, expectedFlag] of [
    ['claudeAgents', '.claude/agents/reviewer.md', '--agent'],
    ['codexAgents', '.codex/agents/builder.toml', '--cd']
  ]) {
    const file = path.join(root, relative);
    await callbacks.get('agentOrchestra.runAgent')({ kind: 'file', root: { name: 'project', path: root, scope: 'workspace' },
      item: { file, label: path.parse(file).name, category } });
    const task = tasks.at(-1);
    assert.equal(task.execution.process, process.execPath);
    assert.equal(task.execution.args[0], expectedFlag);
    assert.match(task.execution.args.at(-1), /Revise o serviço de pedidos/);
    assert.equal(task.execution.options.cwd, root);
    assert.match(panels.at(-1).webview.html, /Abrindo terminal/);
    processStarted.fire({ execution: taskExecutions.at(-1) });
    assert.match(panels.at(-1).webview.html, /Processo iniciado no terminal/);
    assert.equal(treeProvider.getTreeItem({ kind: 'file', root: { name: 'project', path: root, scope: 'workspace' },
      item: { file, label: path.parse(file).name, category } }).description, '● processo no terminal');
    processEnded.fire({ execution: taskExecutions.at(-1), exitCode: 0 });
    assert.match(panels.at(-1).webview.html, /Processo encerrado/);
  }
  assert.equal(tasks.length, 2);
  await callbacks.get('agentOrchestra.runAgent')({ kind: 'file', root: { name: 'project', path: root, scope: 'workspace' },
    item: { file: path.join(__dirname, '..', 'scripts', 'AGENT_RUNS.md'), label: 'Revisar alterações',
      category: 'agentPreset', preset: 'diff' } });
  assert.equal(tasks.length, 3);
  assert.match(tasks.at(-1).name, /Revisar alterações/);
  assert.match(tasks.at(-1).execution.args.at(-1), /Revise o diff atual/);
  surfaceMode = 'extension';
  await callbacks.get('agentOrchestra.runAgent')({ kind: 'file', root: { name: 'project', path: root, scope: 'workspace' },
    item: { file: path.join(root, '.claude/agents/reviewer.md'), label: 'reviewer', category: 'claudeAgents' } });
  assert.equal(tasks.length, 3);
  assert.ok(openedCommands.includes('claude-vscode.newConversation'));
  assert.match(copiedPrompt, /Revise o serviço de pedidos/);
  assert.match(panels[0].webview.html, /Instrução copiada para a extensão oficial/);
});
