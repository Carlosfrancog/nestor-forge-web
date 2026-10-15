'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { slugify } = require('./forge');
const { readRecords, summarize } = require('./activity');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function specFor(item, root, linked) {
  const file = linked || (item.category === 'specs' ? item.file
    : path.join(root.path, '.agentorchestra', 'specs', `${slugify(item.label)}.json`));
  if (!fs.existsSync(file)) return { file: null, spec: null };
  try { return { file, spec: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (_) { return { file, spec: null }; }
}

function notesPath(item, root, globalStorage) {
  const directory = root.scope === 'user' ? path.join(globalStorage, 'notes') : path.join(root.path, '.agentorchestra', 'notes');
  const name = `${item.category}-${slugify(item.label)}.md`;
  return path.join(directory, name);
}

function flowGraph(spec) {
  if (!spec) return '<p class="muted">Vincule uma especificação da Forja para mostrar o grafo.</p>';
  const decisions = Array.isArray(spec.decision_order) ? spec.decision_order : [];
  const steps = Array.isArray(spec.analysis_pipeline) ? spec.analysis_pipeline : [];
  const nodes = [
    { type: 'start', label: 'Entrada da tarefa' },
    ...decisions.map((label, index) => ({ type: 'decision', label: `${index + 1}. ${label}` })),
    ...steps.map((label, index) => ({ type: 'step', label: `${index + 1}. ${label}` })),
    { type: 'end', label: 'Resposta e validação' }
  ];
  return `<div class="graph">${nodes.map((node, index) => `
    ${index ? '<div class="edge" aria-hidden="true">↓</div>' : ''}
    <div class="node ${node.type}"><small>${node.type === 'decision' ? 'Prioridade de decisão' : node.type === 'step' ? 'Etapa de análise' : 'Fluxo'}</small><span>${escapeHtml(node.label)}</span></div>
  `).join('')}</div><p class="muted">Grafo da especificação: mostra prioridades e etapas declaradas, não decisões reais tomadas durante uma execução.</p>`;
}

function statusText(summary) {
  return ({
    'observed-active': 'Uso observado recentemente',
    stale: 'Início observado; sinal antigo',
    idle: 'Última execução encerrada',
    'no-data': 'Sem atividade registrada',
    unavailable: 'Monitoramento por agente indisponível para este tipo'
  })[summary.state];
}

function runStatusText(run) {
  if (!run) return 'Nenhuma execução iniciada neste painel';
  return ({ starting: 'Abrindo terminal', running: 'Processo iniciado no terminal', finished: 'Processo encerrado', closed: 'Terminal encerrado; código indisponível',
    failed: 'Processo encerrado com erro', prepared: 'Instrução copiada para a extensão oficial' })[run.status] || 'Estado desconhecido';
}

function render(item, root, specInfo, noteText, summary, nonce, run) {
  const last = summary.lastAt ? new Date(summary.lastAt).toLocaleString('pt-BR') : '—';
  const canRun = ['claudeAgents', 'codexAgents'].includes(item.category);
  const runDetails = run ? `${run.platform === 'claude' ? 'Claude' : 'Codex'} · ${run.preset} · ${run.project} · ${new Date(run.startedAt).toLocaleString('pt-BR')}${run.exitCode == null ? '' : ` · código ${run.exitCode}`}` : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:900px;margin:auto}
      h1{margin-bottom:4px}h2{margin-top:30px}.muted{color:var(--vscode-descriptionForeground);line-height:1.5}
      .bar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:7px 11px;cursor:pointer;border-radius:4px}
      button:hover{background:var(--vscode-button-secondaryHoverBackground)}.metric{display:inline-block;padding:12px 16px;margin:5px 6px 5px 0;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);border-radius:6px;min-width:155px}
      .metric strong{display:block;margin-bottom:5px}.graph{display:flex;flex-direction:column;align-items:center;max-width:560px}.node{box-sizing:border-box;width:100%;padding:12px 16px;border:1px solid var(--vscode-widget-border);border-radius:7px;background:var(--vscode-editorWidget-background)}
      .node.decision{border-left:4px solid var(--vscode-charts-yellow)}.node.step{border-left:4px solid var(--vscode-charts-blue)}.node small{display:block;color:var(--vscode-descriptionForeground);margin-bottom:5px}.node span{white-space:pre-wrap}.edge{font-size:20px;line-height:28px;color:var(--vscode-charts-blue)}
      pre{white-space:pre-wrap;word-break:break-word;background:var(--vscode-editorWidget-background);padding:14px;border-radius:5px}
    </style></head><body>
    <h1>${escapeHtml(item.label)}</h1><p class="muted">${escapeHtml(root.name)} · ${escapeHtml(item.category)}<br>${escapeHtml(item.file)}</p>
    <div class="bar"><button data-action="openSource">Abrir fonte</button><button data-action="openSpec">Abrir spec</button><button data-action="linkSpec">Vincular spec</button><button data-action="build">Gerar com a Forja</button><button data-action="editNotes">Editar notas</button>${canRun ? '<button data-action="runAgent">Executar agente</button><button data-action="focusTerminal">Abrir terminal</button>' : ''}<button data-action="refresh">Atualizar</button></div>
    ${canRun ? `<h2>Execução iniciada pelo Agent Orchestra</h2><div class="metric"><strong>Estado</strong>${escapeHtml(runStatusText(run))}</div><p class="muted">${escapeHtml(runDetails)}</p><p class="muted">Mensagens, ferramentas e aprovações aparecem no terminal ou na extensão oficial. Este painel acompanha o processo iniciado no terminal; uma instrução copiada só começa após ser enviada na extensão.</p>` : ''}
    <h2>Atividade observada</h2><div class="metric"><strong>Estado</strong>${escapeHtml(statusText(summary))}</div><div class="metric"><strong>Inícios no histórico local</strong>${summary.starts}</div><div class="metric"><strong>Último evento</strong>${escapeHtml(last)}</div>
    <p class="muted">O estado depende de hooks locais opcionais. “Uso observado recentemente” significa início sem parada registrada nos últimos 10 minutos; não é prova de que o processo ainda está ativo. O histórico guarda apenas horário, pasta, tipo e identificadores do agente.</p>
    <h2>Grafo de decisões</h2>${flowGraph(specInfo.spec)}
    <h2>Notas importantes</h2><pre>${escapeHtml(noteText || 'Nenhuma nota ainda.')}</pre>
    <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('button[data-action]').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({action:button.dataset.action})));</script>
    </body></html>`;
}

function openDashboard(vscode, context, element, logFile, onBuild, options = {}) {
  const { item, root } = element;
  const key = `spec:${item.file}`;
  let linked = context.workspaceState.get(key);
  let lastState = '';
  const panel = vscode.window.createWebviewPanel('agentOrchestra.dashboard', `Agent Orchestra: ${item.label}`, vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
  const update = () => {
    const specInfo = specFor(item, root, linked);
    const noteFile = notesPath(item, root, context.globalStorageUri.fsPath);
    let noteText = '';
    try { noteText = fs.readFileSync(noteFile, 'utf8').slice(0, 5000); } catch (_) {}
    const summary = summarize(readRecords(logFile), item, root);
    const active = options.getRun?.();
    const run = active && { status: active.status, platform: active.platform, preset: active.preset,
      project: active.project, startedAt: active.startedAt, exitCode: active.exitCode, finishedAt: active.finishedAt };
    const state = JSON.stringify({ spec: specInfo.spec, noteText, summary, run });
    if (state === lastState) return;
    lastState = state;
    panel.webview.html = render(item, root, specInfo, noteText, summary, crypto.randomBytes(16).toString('hex'), run);
  };
  panel.webview.onDidReceiveMessage(async message => {
    try {
      if (message.action === 'openSource') await vscode.window.showTextDocument(vscode.Uri.file(item.file));
      if (message.action === 'openSpec') {
        const info = specFor(item, root, linked);
        if (info.file) await vscode.window.showTextDocument(vscode.Uri.file(info.file));
        else vscode.window.showInformationMessage('Vincule uma especificação da Forja primeiro.');
      }
      if (message.action === 'linkSpec') {
        const selected = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(root.path), canSelectMany: false, filters: { JSON: ['json'] }, openLabel: 'Vincular spec' });
        if (selected?.[0]) { linked = selected[0].fsPath; await context.workspaceState.update(key, linked); update(); }
      }
      if (message.action === 'editNotes') {
        const file = notesPath(item, root, context.globalStorageUri.fsPath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${item.label}\n\n`, { flag: 'wx' });
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
      }
      if (message.action === 'build') {
        const info = specFor(item, root, linked);
        if (info.file) await onBuild(info.file, root.path);
        else vscode.window.showInformationMessage('Vincule uma especificação da Forja primeiro.');
      }
      if (message.action === 'runAgent' && options.onRun) await options.onRun();
      if (message.action === 'focusTerminal' && options.onFocusTerminal) await options.onFocusTerminal();
      if (message.action === 'refresh') update();
    } catch (error) { vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`); }
  });
  const timer = setInterval(update, 10000);
  const subscription = options.onDidChangeRun?.(file => { if (file === item.file) update(); });
  panel.onDidDispose(() => { clearInterval(timer); subscription?.dispose(); });
  update();
  return panel;
}

module.exports = { escapeHtml, specFor, notesPath, flowGraph, openDashboard };
