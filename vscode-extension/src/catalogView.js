'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { filterRoots } = require('./catalog');

const AGENT_CATEGORIES = new Set(['claudeAgents', 'codexAgents']);
const RESOURCE_LABELS = {
  skills: 'Skills', scripts: 'Scripts', routes: 'Rotas da Forja', specs: 'Especificações',
  instructions: 'Instruções', agentPreset: 'Roteiros prontos'
};

function buildCatalogModel(roots, platform, getRun = () => undefined) {
  const entries = new Map();
  let nextId = 0;
  const projects = filterRoots(roots, platform).map(root => {
    const source = roots.find(candidate => candidate.path === root.path && candidate.scope === root.scope) || root;
    const agents = [];
    const resources = [];
    const seenSkills = new Set();
    for (const group of root.groups) for (const item of group.items) {
      if (AGENT_CATEGORIES.has(item.category) && item.category !== `${platform}Agents`) continue;
      if (item.category === 'skills') {
        // The same skill may be installed in .agents and .claude/.codex.
        if (seenSkills.has(item.label)) continue;
        seenSkills.add(item.label);
      }
      const id = String(nextId++);
      entries.set(id, { kind: 'file', root, item });
      if (AGENT_CATEGORIES.has(item.category)) {
        agents.push({ id, name: item.label, platform, status: getRun(item.file)?.status || null,
          hasCounterpart: source.groups.some(other => other.items.some(candidate =>
            candidate.category === (platform === 'claude' ? 'codexAgents' : 'claudeAgents') && candidate.label === item.label)) });
      } else if (RESOURCE_LABELS[item.category]) {
        resources.push({ id, name: item.label, kind: RESOURCE_LABELS[item.category], category: item.category });
      }
    }
    return { name: root.name, scope: root.scope, agents, resources };
  }).filter(project => project.agents.length || project.resources.length);
  return { model: { platform, projects, agentCount: projects.reduce((sum, project) => sum + project.agents.length, 0) }, entries };
}

function createCatalogView(vscode, context, provider, onAction) {
  let view;
  let entries = new Map();
  let lastModel;
  const render = (force = false) => {
    const result = buildCatalogModel(provider.roots, provider.platformFilter, file => provider.runRegistry?.get(file));
    entries = result.entries;
    const serialized = JSON.stringify(result.model);
    if (!force && serialized === lastModel) return;
    lastModel = serialized;
    view?.webview.postMessage({ type: 'catalog', catalog: result.model });
  };
  const registration = vscode.window.registerWebviewViewProvider('agentOrchestra.files', {
    resolveWebviewView(webviewView) {
      view = webviewView;
      const webview = view.webview;
      webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))] };
      const nonce = crypto.randomBytes(16).toString('hex');
      const css = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'catalog.css')));
      const script = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'catalog.js')));
      webview.html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"><title>Agent Orchestra</title></head><body><main id="app"><div class="loading">Carregando agentes…</div></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
      webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') return render(true);
        if (message.type === 'platform' && ['claude', 'codex'].includes(message.value)) return onAction('platform', message.value);
        if (message.type === 'command' && ['forgeCreate', 'importPackage', 'projectMap', 'checkUpdates', 'refresh'].includes(message.name)) {
          return onAction('command', message.name);
        }
        if (message.type === 'entry' && ['open', 'preview', 'runAgent', 'dashboard', 'shareAgent', 'forgeBuild',
          'runScriptQuick', 'instructions', 'agentRunInstructions'].includes(message.name)) {
          const element = entries.get(String(message.id));
          if (element) return onAction('entry', message.name, element);
        }
      });
      view.onDidDispose?.(() => { if (view === webviewView) view = undefined; });
      render(true);
    }
  });
  const changed = provider.onDidChangeTreeData(() => render());
  context.subscriptions.push(registration, changed);
  return { render };
}

module.exports = { buildCatalogModel, createCatalogView };
