'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const { TEMPLATES, discover, filterRoots, createFile } = require('./catalog');
const forge = require('./forge');
const activity = require('./activity');
const agentRuns = require('./agentRuns');
const updates = require('./updates');
const sharing = require('./share');
const pythonRuntime = require('./python');
const { openDashboard } = require('./dashboard');
const { scanInWorker } = require('./projectMapRunner');
const { openProjectMap } = require('./projectMapView');
const { hasTrackedGeneratedOutput, writeProjectDocs } = require('./projectDocs');
const { documentationPrompt } = require('./projectDocumentationAgent');

const setting = key => vscode.workspace.getConfiguration('agentOrchestra').get(key);
const localFolders = () => (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file');

class AgentsTreeProvider {
  constructor(extensionPath, logFile, platformFilter = 'all') {
    this.extensionPath = extensionPath;
    this.logFile = logFile;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.roots = [];
    this.platformFilter = platformFilter;
    this.refresh();
  }

  visibleRoots() { return filterRoots(this.roots, this.platformFilter); }

  setPlatformFilter(value) {
    this.platformFilter = value;
    this.changed.fire();
  }

  refresh() {
    const folders = localFolders().map(folder => ({ name: folder.name, path: folder.uri.fsPath }));
    this.roots = discover(folders, os.homedir(), setting('includeUserInstallations'), {
      file: path.join(this.extensionPath, 'scripts', 'diff-ast.js'),
      documentation: path.join(this.extensionPath, 'scripts', 'DIFF_AST.md'),
      presets: agentRuns.PRESETS,
      presetDocumentation: path.join(this.extensionPath, 'scripts', 'AGENT_RUNS.md')
    });
    this.records = activity.readRecords(this.logFile);
    this.changed.fire();
  }

  getChildren(element) {
    if (!element) return this.visibleRoots().map(root => ({ kind: 'root', root }));
    if (element.kind === 'root') return element.root.groups.map(group => ({ kind: 'group', root: element.root, group }));
    if (element.kind === 'group') return element.group.items.map(item => ({ kind: 'file', root: element.root, item }));
    return [];
  }

  getTreeItem(element) {
    if (element.kind === 'root') {
      const item = new vscode.TreeItem(element.root.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon(element.root.scope === 'user' ? 'account' : 'folder-library');
      item.description = element.root.scope === 'user' ? 'usuário' : 'projeto';
      item.tooltip = element.root.path;
      return item;
    }
    if (element.kind === 'group') {
      const item = new vscode.TreeItem(element.group.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(element.group.items.length);
      item.iconPath = new vscode.ThemeIcon(element.group.id === 'scripts' ? 'terminal' : element.group.id === 'presets' ? 'play' : 'symbol-namespace');
      return item;
    }
    const file = element.item.file;
    const category = element.item.category;
    const isMarkdown = path.extname(file).toLowerCase() === '.md';
    const item = new vscode.TreeItem(element.item.label, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(file);
    item.description = element.item.detail || (element.item.builtIn ? 'Ferramenta integrada' : path.relative(element.root.path, path.dirname(file)));
    item.tooltip = category === 'scripts'
      ? `${file}\nAções: executar sem argumentos, executar com argumentos, ler instruções.`
      : ['claudeAgents', 'codexAgents'].includes(category)
        ? `${file}\nAções: executar agente, abrir painel, compartilhar.` : file;
    item.contextValue = category === 'agentPreset' ? 'orchestraPreset' : category === 'scripts' ? 'orchestraScript' : category === 'specs' ? 'orchestraSpec' :
      ['claudeAgents', 'codexAgents'].includes(category) ? 'orchestraAgent' : category === 'skills' ? 'orchestraSkill' :
        isMarkdown ? 'orchestraMarkdown' : 'orchestraConfig';
    item.iconPath = new vscode.ThemeIcon(category === 'agentPreset' ? 'play' : category === 'scripts' ? 'terminal' : category === 'specs' ? 'symbol-object' : isMarkdown ? 'markdown' : 'settings-gear');
    if (category === 'claudeAgents' || category === 'codexAgents') {
      const run = this.runRegistry?.get(file);
      if (run?.status === 'running') item.description = '● processo no terminal';
      else if (run?.status === 'starting') item.description = '◌ abrindo terminal';
      else if (run?.status === 'prepared') item.description = '◌ instrução preparada';
      else {
        const summary = activity.summarize(this.records, element.item, element.root);
        if (summary.state === 'observed-active') item.description = '● uso observado';
        else if (summary.state === 'stale') item.description = '◌ sinal antigo';
      }
    }
    item.command = { command: category === 'agentPreset' ? 'agentOrchestra.runAgent' : category === 'scripts' ? 'agentOrchestra.instructions' : isMarkdown ? 'agentOrchestra.preview' : 'agentOrchestra.open', title: 'Abrir', arguments: [element] };
    return item;
  }
}

const fileFrom = element => element?.kind === 'file' ? element.item.file : undefined;
async function openFile(element) {
  const file = fileFrom(element);
  if (file) await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
}
async function previewFile(element) {
  const file = fileFrom(element);
  if (!file) return;
  if (path.extname(file).toLowerCase() !== '.md') return openFile(element);
  await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
}
async function showInstructions(element) {
  const file = element?.item?.documentation;
  if (file && fs.existsSync(file)) await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
  else vscode.window.showInformationMessage('Este script não tem um SKILL.md com instruções.');
}
async function selectFolder(placeHolder) {
  const folders = localFolders();
  if (!folders.length) { vscode.window.showInformationMessage('Abra uma pasta local para continuar.'); return; }
  if (folders.length === 1) return folders[0];
  const selected = await vscode.window.showQuickPick(folders.map(value => ({ label: value.name, description: value.uri.fsPath, value })), { placeHolder });
  return selected?.value;
}
async function findFile(provider) {
  const options = provider.visibleRoots().flatMap(root => root.groups.flatMap(group => group.items.map(item => ({
    label: item.label, description: `${root.name} · ${group.label}`, detail: item.file, element: { kind: 'file', root, item }
  }))));
  if (!options.length) return vscode.window.showInformationMessage('Nenhum agente ou skill encontrado.');
  const selected = await vscode.window.showQuickPick(options, { placeHolder: 'Buscar agente, skill, script ou instrução', matchOnDescription: true, matchOnDetail: true });
  if (selected) await (selected.element.item.category === 'scripts' ? showInstructions(selected.element) : previewFile(selected.element));
}
async function createArtifact(provider) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de criar agentes ou skills.');
  const folder = await selectFolder('Escolha o projeto');
  if (!folder) return;
  const kind = await vscode.window.showQuickPick(Object.entries(TEMPLATES).map(([value, template]) => ({ label: template.label, value })), { placeHolder: 'O que deseja criar?' });
  if (!kind) return;
  const name = await vscode.window.showInputBox({ prompt: 'Nome do agente ou skill', placeHolder: 'meu-agente',
    validateInput: value => /^[a-z][a-z0-9-]{0,63}$/.test(value) ? undefined : 'Use letras minúsculas, números e hífens; comece com uma letra.' });
  if (!name) return;
  try {
    const file = createFile(folder.uri.fsPath, kind.value, name);
    provider.refresh();
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
  } catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.code === 'EEXIST' ? 'Arquivo existente; nenhum arquivo foi substituído.' : error.message}`); }
}
async function buildSpec(context, provider, specFile, rootPath) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de gerar arquivos.');
  const target = await vscode.window.showQuickPick([
    { label: 'Codex + Claude no projeto', value: 'unified-project' },
    { label: 'Somente Claude no projeto', value: 'claude-project' }
  ], { placeHolder: 'Destino da Forja' });
  if (!target) return;
  try {
    const report = await forge.build(await pythonRuntime.resolvePython(context, vscode), context.extensionPath, rootPath, specFile, target.value);
    provider.refresh();
    vscode.window.showInformationMessage(`Forja gerou ${report.files.length} arquivo(s) em ${rootPath}.`);
    if (report.build_report) await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(report.build_report));
  } catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
}
async function createWithForge(context, provider) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de criar agentes.');
  const folder = await selectFolder('Projeto para a Forja');
  if (!folder) return;
  const profile = await vscode.window.showQuickPick(forge.PROFILES, { placeHolder: 'Perfil do agente' });
  if (!profile) return;
  const name = await vscode.window.showInputBox({ prompt: 'Nome do agente', placeHolder: 'reviewer-laravel', validateInput: value => value.trim() ? undefined : 'Informe o nome.' });
  if (name === undefined) return;
  const role = await vscode.window.showInputBox({ prompt: 'Papel do agente', placeHolder: 'Revisar mudanças Laravel', validateInput: value => value.trim() ? undefined : 'Informe o papel.' });
  if (role === undefined) return;
  const mission = await vscode.window.showInputBox({ prompt: 'Missão do agente', placeHolder: 'Analisar diffs e apontar riscos concretos', validateInput: value => value.trim() ? undefined : 'Informe a missão.' });
  if (mission === undefined) return;
  try {
    const spec = await forge.makeSpec(await pythonRuntime.resolvePython(context, vscode), context.extensionPath, folder.uri.fsPath, { name, role, mission, profile });
    const specFile = forge.saveSpec(folder.uri.fsPath, spec);
    provider.refresh();
    await vscode.window.showTextDocument(vscode.Uri.file(specFile), { preview: false });
    const action = await vscode.window.showInformationMessage('Especificação criada. Revise o JSON antes de gerar os arquivos.', 'Gerar agora');
    if (action === 'Gerar agora') await buildSpec(context, provider, specFile, folder.uri.fsPath);
  } catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
}
async function runBuiltinScript(context, provider, root) {
  const base = await vscode.window.showInputBox({ prompt: 'Commit ou branch de referência', value: 'HEAD' });
  if (base === undefined) return;
  let python;
  try { python = await pythonRuntime.resolvePython(context, vscode); }
  catch (error) { return vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
  const args = [path.join(context.extensionPath, 'scripts', 'diff-ast.js'), root, base || 'HEAD', python, setting('goPath')];
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Agent Orchestra: analisando diff estrutural…' }, () => new Promise(resolve => {
    execFile(setting('nodePath'), args, { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 }, async (error, stdout, stderr) => {
      try {
        if (error) throw new Error(stderr.trim() || error.message);
        fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
        const report = path.join(context.globalStorageUri.fsPath, 'diff-report.md');
        fs.writeFileSync(report, stdout, 'utf8');
        await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(report));
        provider.refresh();
      } catch (failure) { vscode.window.showErrorMessage(`Agent Orchestra: ${failure.message}`); }
      resolve();
    });
  }));
}
async function runScript(context, provider, element, withArguments = true) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de executar scripts.');
  if (element?.item?.category !== 'scripts') return;
  const folder = element.root.scope === 'workspace' ? localFolders().find(value => value.uri.fsPath === element.root.path) : await selectFolder('Projeto em que o script será executado');
  if (!folder) return;
  if (element.item.builtIn) return runBuiltinScript(context, provider, folder.uri.fsPath);
  let scriptArgs = [];
  if (withArguments) {
    const rawArgs = await vscode.window.showInputBox({ prompt: 'Argumentos do script como lista JSON', value: '[]', validateInput: value => {
      try { const args = JSON.parse(value); return Array.isArray(args) && args.every(arg => typeof arg === 'string') ? undefined : 'Use uma lista JSON de strings.'; }
      catch (_) { return 'Use uma lista JSON de strings.'; }
    } });
    if (rawArgs === undefined) return;
    scriptArgs = JSON.parse(rawArgs);
  }
  const ext = path.extname(element.item.file).toLowerCase();
  let command;
  try {
    command = ext === '.py' ? await pythonRuntime.resolvePython(context, vscode) : ({
      '.js': setting('nodePath'), '.cjs': setting('nodePath'), '.mjs': setting('nodePath'),
      '.go': setting('goPath'), '.sh': setting('shellPath'), '.ps1': setting('powershellPath')
    })[ext];
  } catch (error) { return vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
  const args = ext === '.go' ? ['run', element.item.file, ...scriptArgs] : [element.item.file, ...scriptArgs];
  const task = new vscode.Task({ type: 'agentOrchestra', task: element.item.label }, folder,
    `Agent Orchestra: ${element.item.label}`, 'Agent Orchestra', new vscode.ProcessExecution(command, args, { cwd: folder.uri.fsPath }));
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated };
  await vscode.tasks.executeTask(task);
}

function createRunRegistry(context) {
  const runs = new Map();
  const executions = new Map();
  const pendingTasks = new Map();
  const changed = new vscode.EventEmitter();
  const tracked = execution => executions.get(execution) || pendingTasks.get(execution.task);
  context.subscriptions.push(changed, vscode.tasks.onDidStartTaskProcess(event => {
    const record = tracked(event.execution);
    if (!record) return;
    const previous = runs.get(record.file);
    if (previous?.runId !== record.runId) return;
    executions.set(event.execution, record);
    runs.set(record.file, { ...previous, status: 'running', execution: event.execution });
    changed.fire(record.file);
  }), vscode.tasks.onDidEndTaskProcess(event => {
    const record = tracked(event.execution);
    if (!record) return;
    executions.delete(event.execution);
    pendingTasks.delete(event.execution.task);
    const previous = runs.get(record.file);
    if (previous?.runId === record.runId) {
      runs.set(record.file, { ...previous, status: event.exitCode === 0 ? 'finished' : event.exitCode == null ? 'closed' : 'failed',
        exitCode: event.exitCode, finishedAt: new Date().toISOString() });
      changed.fire(record.file);
    }
  }));
  return {
    get: file => runs.get(file),
    set(file, state) { const runId = crypto.randomUUID(); runs.set(file, { ...state, runId }); changed.fire(file); return runId; },
    expect(file, task, runId) { pendingTasks.set(task, { file, runId }); },
    fail(file, task, runId) {
      pendingTasks.delete(task);
      const current = runs.get(file);
      if (current?.runId === runId) { runs.set(file, { ...current, status: 'failed', finishedAt: new Date().toISOString() }); changed.fire(file); }
    },
    attach(file, execution, runId) {
      pendingTasks.delete(execution.task);
      const current = runs.get(file);
      if (current?.runId !== runId || ['finished', 'failed'].includes(current.status)) return;
      executions.set(execution, { file, runId });
      runs.set(file, { ...current, execution });
    },
    onDidChange: changed.event
  };
}

async function checkCli(command) {
  await new Promise((resolve, reject) => execFile(command, ['--version'], { windowsHide: true, timeout: 12000 }, error => {
    if (error) reject(new Error(`Executável não encontrado ou indisponível: ${command}. Ajuste o caminho nas configurações do Agent Orchestra.`));
    else resolve();
  }));
}

async function runAgent(context, provider, registry, showPanel, element, showPanelAfter = true) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de executar agentes.');
  const requestedPreset = element?.item?.category === 'agentPreset' ? element.item.preset : null;
  if (!element || !['claudeAgents', 'codexAgents'].includes(element.item?.category)) {
    const choices = provider.visibleRoots().flatMap(root => root.groups.flatMap(group => group.items
      .filter(item => ['claudeAgents', 'codexAgents'].includes(item.category))
      .map(item => ({ label: item.label, description: `${root.name} · ${item.category === 'claudeAgents' ? 'Claude' : 'Codex'}`,
        value: { kind: 'file', root, item } }))));
    if (!choices.length) return vscode.window.showInformationMessage('Nenhum agente Claude ou Codex encontrado. Crie um agente primeiro.');
    element = (await vscode.window.showQuickPick(choices, { placeHolder: 'Agente para executar', matchOnDescription: true }))?.value;
    if (!element) return;
  }
  const folder = element.root.scope === 'workspace'
    ? localFolders().find(value => value.uri.fsPath === element.root.path)
    : await selectFolder('Projeto em que o agente trabalhará');
  if (!folder) return;
  const preset = requestedPreset
    ? agentRuns.PRESETS.find(value => value.id === requestedPreset)
    : (await vscode.window.showQuickPick(agentRuns.PRESETS.map(value => ({ ...value, value })),
      { placeHolder: `Roteiro para ${element.item.label}` }))?.value;
  if (!preset) return;
  const detail = await vscode.window.showInputBox({
    prompt: preset.needsTask ? 'Descreva a tarefa para o agente' : 'Contexto adicional para o agente (opcional)',
    placeHolder: preset.needsTask ? 'O que o agente deve entregar?' : 'Arquivos, módulo ou foco específico',
    validateInput: value => preset.needsTask && !value.trim() ? 'Descreva a tarefa.' : undefined
  });
  if (detail === undefined) return;
  const surface = await vscode.window.showQuickPick([
    { label: 'Terminal integrado', detail: 'Inicia o CLI interativo e mostra a execução no terminal', value: 'terminal' },
    { label: 'Extensão oficial', detail: 'Abre Claude Code ou Codex e copia a instrução para colar', value: 'extension' }
  ], { placeHolder: 'Onde acompanhar o agente?' });
  if (!surface) return;
  let pendingTask;
  let pendingRunId;
  let pendingFile;
  try {
    const platform = agentRuns.platformFor(element.item.category);
    const name = agentRuns.agentName(element.item);
    let prompt = agentRuns.buildPrompt(platform, name, preset, detail);
    const projectContext = path.join(folder.uri.fsPath, '.agentorchestra', 'context', 'project-handoff.json');
    if (fs.existsSync(projectContext)) {
      prompt += '\n\nAntes de começar, leia .agentorchestra/context/project-handoff.json para localizar módulos, arquivos-chave e mudanças recentes. Abra os arquivos citados conforme a tarefa; confirme informações que possam ter mudado.';
    }
    const startedAt = new Date().toISOString();
    if (surface.value === 'extension') {
      const extensionId = platform === 'claude' ? 'anthropic.claude-code' : 'openai.chatgpt';
      const commandId = platform === 'claude' ? 'claude-vscode.newConversation' : 'chatgpt.newCodexPanel';
      if (!vscode.extensions.getExtension(extensionId)) throw new Error(`Instale a extensão oficial ${platform === 'claude' ? 'Claude Code' : 'Codex'} ou escolha o terminal integrado.`);
      await vscode.env.clipboard.writeText(prompt);
      await vscode.commands.executeCommand(commandId);
      registry.set(element.item.file, { status: 'prepared', platform, preset: preset.label, project: folder.name, startedAt });
      if (showPanelAfter) showPanel(element);
      vscode.window.showInformationMessage('Instrução copiada. Cole e envie na extensão oficial para iniciar o agente.');
      return;
    }
    const executable = setting(platform === 'claude' ? 'claudePath' : 'codexPath');
    await checkCli(executable);
    const task = new vscode.Task({ type: 'agentOrchestra.agent', agent: name, preset: preset.id }, folder,
      `Agent Orchestra: ${name} · ${preset.label}`, 'Agent Orchestra',
      new vscode.ProcessExecution(executable, agentRuns.cliArgs(platform, name, prompt, folder.uri.fsPath), { cwd: folder.uri.fsPath }));
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated };
    const runId = registry.set(element.item.file, { status: 'starting', platform, preset: preset.label, project: folder.name, startedAt });
    pendingTask = task;
    pendingRunId = runId;
    pendingFile = element.item.file;
    registry.expect(element.item.file, task, runId);
    if (showPanelAfter) showPanel(element);
    const execution = await vscode.tasks.executeTask(task);
    registry.attach(element.item.file, execution, runId);
  } catch (error) {
    if (pendingTask) registry.fail(pendingFile, pendingTask, pendingRunId);
    vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`);
  }
}

async function shareAgent(context, provider, element) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de compartilhar agentes.');
  if (element?.kind !== 'file' || !['claudeAgents', 'codexAgents', 'skills'].includes(element.item.category)) return;
  const action = await vscode.window.showQuickPick([
    { label: 'Instalar em outro projeto aberto', detail: 'Copia agente, skills e referências relacionadas', value: 'local' },
    { label: 'Exportar pacote ZIP', detail: 'Inclui manifesto e install.sh para compartilhar como arquivo', value: 'zip' }
  ], { placeHolder: `Compartilhar ${element.item.label}` });
  if (!action) return;
  try {
    if (action.value === 'zip') {
      const selected = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(element.root.path, `${element.item.label}.agentorchestra.zip`)),
        filters: { 'Pacote Agent Orchestra': ['zip'] }, saveLabel: 'Exportar pacote'
      });
      if (!selected) return;
      const result = await sharing.exportAgent(await pythonRuntime.resolvePython(context, vscode), context.extensionPath, element.root.path, element.item.file, selected.fsPath);
      vscode.window.showInformationMessage(`Pacote criado com ${result.files.length} arquivo(s): ${selected.fsPath}`);
      return;
    }
    const folders = localFolders().filter(folder => folder.uri.fsPath !== element.root.path);
    if (!folders.length) return vscode.window.showInformationMessage('Abra também o projeto de destino no VS Code para compartilhar diretamente.');
    const target = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(
      folders.map(value => ({ label: value.name, description: value.uri.fsPath, value })),
      { placeHolder: 'Projeto que receberá o agente' }
    ).then(choice => choice?.value);
    if (!target) return;
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    const archive = path.join(context.globalStorageUri.fsPath, `transfer-${crypto.randomUUID()}.zip`);
    try {
      const python = await pythonRuntime.resolvePython(context, vscode);
      await sharing.exportAgent(python, context.extensionPath, element.root.path, element.item.file, archive);
      const review = await sharing.inspectPackage(python, context.extensionPath, archive, target.uri.fsPath);
      if (review.conflicts.length) throw new Error(`Arquivos existentes em ${target.name}: ${review.conflicts.slice(0, 8).join(', ')}`);
      const result = await sharing.importPackage(python, context.extensionPath, archive, target.uri.fsPath);
      provider.refresh();
      vscode.window.showInformationMessage(`${element.item.label} instalado em ${target.name} (${result.files.length} arquivo(s)).`);
    } finally { fs.rmSync(archive, { force: true }); }
  } catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
}

async function importAgentPackage(context, provider) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de importar agentes.');
  const folder = await selectFolder('Projeto que receberá o agente');
  if (!folder) return;
  const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Pacote Agent Orchestra': ['zip'] }, openLabel: 'Importar pacote' });
  if (!selected?.[0]) return;
  try {
    const archive = selected[0].fsPath;
    const python = await pythonRuntime.resolvePython(context, vscode);
    const review = await sharing.inspectPackage(python, context.extensionPath, archive, folder.uri.fsPath);
    if (review.conflicts.length) throw new Error(`Arquivos existentes no destino: ${review.conflicts.slice(0, 8).join(', ')}`);
    const source = review.format === 'legacy' ? 'ZIP de agente convertido' : 'Pacote Agent Orchestra';
    const approved = await vscode.window.showInformationMessage(
      `Instalar ${source} em ${folder.name}?`,
      { modal: true, detail: `${review.files.length} arquivo(s). Entrada: ${review.entrypoint}\n\n${review.files.slice(0, 12).join('\n')}${review.files.length > 12 ? '\n…' : ''}` },
      'Instalar'
    );
    if (approved !== 'Instalar') return;
    const result = await sharing.importPackage(python, context.extensionPath, archive, folder.uri.fsPath);
    provider.refresh();
    vscode.window.showInformationMessage(`Agente importado em ${folder.name} (${result.files.length} arquivo(s)).`);
  } catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
}

async function monitor(context, provider, enable) {
  if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de configurar hooks.');
  const folder = await selectFolder('Projeto para o monitoramento');
  if (!folder) return;
  const options = enable ? [
    { label: 'Claude e Codex', value: ['claude', 'codex'] },
    { label: 'Claude', value: ['claude'] },
    { label: 'Codex', value: ['codex'] }
  ] : [{ label: 'Remover hooks Agent Orchestra', value: ['claude', 'codex'] }];
  const choice = await vscode.window.showQuickPick(options, { placeHolder: enable ? 'Qual plataforma observar?' : 'Desativar neste projeto' });
  if (!choice) return;
  try {
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    const script = path.join(context.globalStorageUri.fsPath, 'agentorchestra-activity-hook.js');
    if (enable) fs.copyFileSync(path.join(context.extensionPath, 'backend', 'activity-hook.js'), script);
    const logFile = path.join(context.globalStorageUri.fsPath, 'activity.jsonl');
    const plan = activity.planMonitoring(folder.uri.fsPath, script, logFile, choice.value, enable);
    activity.saveMonitoring(plan);
    provider.refresh();
    vscode.window.showInformationMessage(enable
      ? 'Hooks locais configurados. O Codex pode pedir confiança nos hooks antes de ativá-los.'
      : 'Hooks do Agent Orchestra removidos deste projeto.');
  } catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
}

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

function activate(context) {
  updates.start(context, vscode);
  const logFile = path.join(context.globalStorageUri.fsPath, 'activity.jsonl');
  const savedFilter = context.workspaceState.get('platformFilter', 'all');
  const provider = new AgentsTreeProvider(context.extensionPath, logFile,
    ['all', 'claude', 'codex'].includes(savedFilter) ? savedFilter : 'all');
  const registry = createRunRegistry(context);
  provider.runRegistry = registry;
  context.subscriptions.push(registry.onDidChange(() => provider.changed.fire()));
  const dashboards = new Map();
  const showPanel = element => {
    const key = element.item.file;
    const existing = dashboards.get(key);
    if (existing) { existing.reveal(vscode.ViewColumn.Beside); return existing; }
    const panel = openDashboard(vscode, context, element, logFile, (file, root) => buildSpec(context, provider, file, root), {
      getRun: () => registry.get(key), onDidChangeRun: registry.onDidChange,
      onRun: () => runAgent(context, provider, registry, showPanel, element, false),
      onFocusTerminal: () => vscode.commands.executeCommand('workbench.action.terminal.focus')
    });
    dashboards.set(key, panel);
    panel.onDidDispose(() => dashboards.delete(key));
    return panel;
  };
  const projectStates = new Map();
  const projectState = folder => {
    const root = folder.uri.fsPath;
    if (projectStates.has(root)) return projectStates.get(root);
    const handoff = path.join(root, '.agentorchestra', 'context', 'project-handoff.json');
    const state = { root, name: folder.name, view: null, report: null, scanPromise: null,
      docsEnabled: fs.existsSync(handoff), lastRevision: null };
    if (state.docsEnabled) {
      try { state.lastRevision = JSON.parse(fs.readFileSync(handoff, 'utf8')).revision || null; }
      catch { /* A próxima leitura reconstruirá o contexto. */ }
    }
    projectStates.set(root, state);
    return state;
  };
  const scanState = state => {
    if (state.scanPromise) return state.scanPromise;
    state.scanPromise = vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: `Mapeando ${state.name}…`, cancellable: true
    }, async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const cacheKey = crypto.createHash('sha256').update(state.root).digest('hex').slice(0, 24);
      const options = { python: setting('pythonPath'), go: setting('goPath'),
        cacheDir: path.join(context.globalStorageUri.fsPath, 'project-map', cacheKey), signal: controller.signal,
        onProgress: ({ folder, folders }) => {
          if (folders % 12 === 0) { progress.report({ message: `${folders} pastas` }); state.view?.loading(`Lendo ${folder}…`); }
        } };
      let report = await scanInWorker(state.root, options);
      const missingPython = report.warnings.some(item => item.kind === 'parse' &&
        /\.py$/i.test(item.path || '') && /ENOENT|not found|não (é|foi) (encontrad|reconhecid)/i.test(item.message || ''));
      if (missingPython && !controller.signal.aborted) {
        options.python = await pythonRuntime.resolvePython(context, vscode);
        report = await scanInWorker(state.root, options);
      }
      report.git = { changes: await recentGitChanges(state.root) };
      state.report = report;
      state.lastRevision = report.revision;
      state.view?.update(report);
      return report;
    }).finally(() => { state.scanPromise = null; });
    return state.scanPromise;
  };
  const generateProjectDocs = async state => {
    if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de gerar documentação.');
    const report = await scanState(state);
    const result = await writeProjectDocs(state.root, report);
    state.docsEnabled = true;
    const relative = value => path.relative(state.root, value).split(path.sep).join('/');
    const prompt = documentationPrompt({ handoff: relative(result.handoffPath), docs: relative(result.outputDir), framework: report.framework });
    const choice = await vscode.window.showQuickPick([
      { label: 'Codex no terminal', detail: 'O agente lê o mapa e escreve guias verificados', value: 'codex' },
      { label: 'Claude no terminal', detail: 'O agente lê o mapa e escreve guias verificados', value: 'claude' },
      { label: 'Copiar instrução', detail: 'Use o agente na extensão oficial ou em outro ambiente', value: 'copy' }
    ], { placeHolder: 'Contexto pronto. Qual agente deve redigir a documentação?' });
    if (!choice) { vscode.window.showInformationMessage('Contexto preparado. A documentação por agente não foi iniciada.'); return report; }
    if (choice.value === 'copy') {
      await vscode.env.clipboard.writeText(prompt);
      vscode.window.showInformationMessage('Instrução de documentação copiada. Envie-a ao agente no projeto aberto.');
      return report;
    }
    const folder = localFolders().find(item => item.uri.fsPath === state.root);
    if (!folder) throw new Error('Projeto local não está aberto para executar o agente de documentação.');
    const executable = setting(choice.value === 'claude' ? 'claudePath' : 'codexPath');
    await checkCli(executable);
    const args = choice.value === 'codex' ? agentRuns.cliArgs('codex', '', prompt, state.root) : [prompt];
    const task = new vscode.Task({ type: 'agentOrchestra.documentation' }, folder,
      `Agent Orchestra: documentar ${state.name}`, 'Agent Orchestra',
      new vscode.ProcessExecution(executable, args, { cwd: state.root }));
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated };
    await vscode.tasks.executeTask(task);
    return report;
  };
  const showProjectMap = async () => {
    if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de mapear arquivos.');
    const folder = await selectFolder('Projeto para mapear');
    if (!folder) return;
    const state = projectState(folder);
    if (state.view) { state.view.panel.reveal(vscode.ViewColumn.One); return state.view; }
    const view = openProjectMap(vscode, context, { path: state.root, name: state.name }, {
      onRescan: () => scanState(state), onGenerateDocs: () => generateProjectDocs(state)
    });
    state.view = view;
    view.panel.onDidDispose(() => { if (state.view === view) state.view = null; });
    if (state.report) view.update(state.report);
    else scanState(state).catch(error => { if (error.name !== 'AbortError') view.error(error); });
    return view;
  };
  const view = vscode.window.createTreeView('agentOrchestra.files', { treeDataProvider: provider, showCollapseAll: true });
  const updateViewLabel = () => {
    view.description = provider.platformFilter === 'all' ? undefined : provider.platformFilter === 'claude' ? 'Claude' : 'Codex';
    view.message = provider.visibleRoots().length ? undefined :
      provider.platformFilter === 'all' ? 'Nenhum agente encontrado. Use a Forja para criar um no projeto.' :
        `Nenhum item encontrado para ${view.description}.`;
  };
  updateViewLabel();
  context.subscriptions.push(view, provider.changed);
  const refresh = () => { provider.refresh(); updateViewLabel(); };
  const commands = {
    'agentOrchestra.refresh': refresh,
    'agentOrchestra.cyclePlatformFilter': async () => {
      const filters = ['all', 'claude', 'codex'];
      const next = filters[(filters.indexOf(provider.platformFilter) + 1) % filters.length];
      provider.setPlatformFilter(next);
      updateViewLabel();
      await context.workspaceState.update('platformFilter', next);
    },
    'agentOrchestra.find': () => findFile(provider),
    'agentOrchestra.create': () => createArtifact(provider),
    'agentOrchestra.forgeCreate': () => createWithForge(context, provider),
    'agentOrchestra.forgeBuild': element => element?.item?.category === 'specs' && buildSpec(context, provider, element.item.file, element.root.path),
    'agentOrchestra.dashboard': element => element?.kind === 'file' && showPanel(element),
    'agentOrchestra.runAgent': element => runAgent(context, provider, registry, showPanel, element),
    'agentOrchestra.agentRunInstructions': () => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(context.extensionPath, 'scripts', 'AGENT_RUNS.md'))),
    'agentOrchestra.enableMonitoring': () => monitor(context, provider, true),
    'agentOrchestra.disableMonitoring': () => monitor(context, provider, false),
    'agentOrchestra.instructions': showInstructions,
    'agentOrchestra.runScript': element => runScript(context, provider, element),
    'agentOrchestra.runScriptQuick': element => runScript(context, provider, element, false),
    'agentOrchestra.shareAgent': element => shareAgent(context, provider, element),
    'agentOrchestra.importPackage': () => importAgentPackage(context, provider),
    'agentOrchestra.projectMap': showProjectMap,
    'agentOrchestra.generateProjectDocs': async () => {
      if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Confie no projeto antes de gerar documentação.');
      const folder = await selectFolder('Projeto para documentar');
      if (folder) try { await generateProjectDocs(projectState(folder)); }
      catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
    },
    'agentOrchestra.open': openFile,
    'agentOrchestra.preview': previewFile,
    'agentOrchestra.reveal': element => { const file = fileFrom(element); if (file) return vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(file)); },
    'agentOrchestra.copyPath': element => { const file = fileFrom(element); if (file) return vscode.env.clipboard.writeText(file); }
  };
  for (const [id, callback] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refresh));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('agentOrchestra')) refresh();
  }));
  for (const glob of ['**/{.agents,.claude,.codex,.agentorchestra}/**/*', '**/AGENTS.md', '**/CLAUDE.md']) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(refresh, null, context.subscriptions);
    watcher.onDidDelete(refresh, null, context.subscriptions);
    watcher.onDidChange(refresh, null, context.subscriptions);
    context.subscriptions.push(watcher);
  }
  const timer = setInterval(refresh, 15000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  for (const folder of localFolders()) {
    const handoff = path.join(folder.uri.fsPath, '.agentorchestra', 'context', 'project-handoff.json');
    if (fs.existsSync(handoff)) projectState(folder);
  }
  let checkingProjects = false;
  const refreshProjectContexts = async () => {
    if (checkingProjects || !vscode.workspace.isTrusted) return;
    checkingProjects = true;
    try {
      for (const state of projectStates.values()) {
        if (!state.docsEnabled && !state.view) continue;
        const revision = await gitOutput(state.root, ['rev-parse', 'HEAD']);
        if (!revision || revision === state.lastRevision || state.scanPromise) continue;
        const previous = state.lastRevision;
        try {
          const report = await scanState(state);
          // Generated files record HEAD and recent commits. Rewriting tracked
          // output after every commit would always leave another change to commit.
          const trackedOutput = state.docsEnabled && await hasTrackedGeneratedOutput(state.root);
          if (state.docsEnabled && !trackedOutput) await writeProjectDocs(state.root, report);
        } catch (error) {
          state.lastRevision = previous;
          state.view?.error(error);
        }
      }
    } finally { checkingProjects = false; }
  };
  const projectTimer = setInterval(refreshProjectContexts, 45000);
  const firstProjectRefresh = setTimeout(refreshProjectContexts, 4000);
  context.subscriptions.push({ dispose: () => { clearInterval(projectTimer); clearTimeout(firstProjectRefresh); } });
}
function deactivate() {}
module.exports = { activate, deactivate };
