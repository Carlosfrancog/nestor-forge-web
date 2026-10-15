'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// The webview sends only an index. Resolve the file from the current report and
// check both its lexical path and its real path before opening it in the editor.
function safeProjectFile(root, relativeFile) {
  if (typeof root !== 'string' || typeof relativeFile !== 'string' || !relativeFile || relativeFile.includes('\0')) {
    throw new Error('Caminho de arquivo inválido.');
  }
  const normalized = relativeFile.replace(/\\/g, '/');
  if (path.isAbsolute(relativeFile) || path.win32.isAbsolute(relativeFile) || normalized.startsWith('/') ||
      normalized.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('Arquivo fora do projeto.');
  }
  const rootReal = fs.realpathSync(root);
  const fileReal = fs.realpathSync(path.resolve(rootReal, ...normalized.split('/')));
  const within = path.relative(rootReal, fileReal);
  if (!within || within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
    throw new Error('Arquivo fora do projeto.');
  }
  if (!fs.statSync(fileReal).isFile()) throw new Error('O caminho selecionado não é um arquivo.');
  return fileReal;
}

function text(value, limit = 500) { return String(value ?? '').slice(0, limit); }
function list(value, limit = 100000) { return Array.isArray(value) ? value.slice(0, limit) : []; }
function normalizeReport(report) {
  if (!report || report.schemaVersion !== 1) throw new Error('Mapa do projeto com formato inválido.');
  return {
    schemaVersion: 1,
    root: text(report.root, 2000),
    generatedAt: text(report.generatedAt, 100),
    folders: list(report.folders).map(folder => ({ id: text(folder.id), path: text(folder.path, 2000), parent: folder.parent == null ? null : text(folder.parent) })),
    files: list(report.files).map((file, index) => ({ index, id: text(file.id), path: text(file.path, 2000), folder: text(file.folder), module: text(file.module), layer: text(file.layer), language: text(file.language), bytes: Number.isFinite(file.bytes) ? file.bytes : 0, symbols: Array.isArray(file.symbols) ? file.symbols.length : Number.isFinite(file.symbols) ? file.symbols : 0 })),
    modules: list(report.modules).map(module => ({ id: text(module.id), label: text(module.label), fileCount: Number.isFinite(module.fileCount) ? module.fileCount : 0 })),
    edges: list(report.edges).map(edge => ({ source: text(edge.source), target: text(edge.target), kind: text(edge.kind), count: Number.isFinite(edge.count) ? edge.count : 1 })),
    warnings: list(report.warnings, 100).map(warning => text(typeof warning === 'string' ? warning : warning?.message || JSON.stringify(warning), 500)),
    stats: report.stats && typeof report.stats === 'object' ? {
      files: Number.isFinite(report.stats.files) ? report.stats.files : undefined,
      folders: Number.isFinite(report.stats.folders) ? report.stats.folders : undefined,
      modules: Number.isFinite(report.stats.modules) ? report.stats.modules : undefined,
      edges: Number.isFinite(report.stats.edges) ? report.stats.edges : undefined
    } : {}
  };
}

const STYLE = `
  :root {color-scheme:light dark; --canvas:var(--vscode-editor-background); --surface:var(--vscode-sideBar-background,var(--vscode-editorWidget-background)); --line:var(--vscode-panel-border,var(--vscode-widget-border)); --ink:var(--vscode-foreground); --muted:var(--vscode-descriptionForeground); --accent:var(--vscode-focusBorder,#33b5ad); --blue:var(--vscode-charts-blue,#52a9f0); --green:var(--vscode-charts-green,#54ba87); --orange:var(--vscode-charts-orange,#d99850)}
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--canvas);color:var(--ink);font:13px/1.5 var(--vscode-font-family,system-ui)}button,input,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .page{max-width:1600px;margin:auto;padding:25px clamp(16px,3vw,44px) 50px}.eyebrow{text-transform:uppercase;letter-spacing:.19em;font-size:10px;font-weight:800;color:var(--accent)}.top{display:flex;justify-content:space-between;gap:18px;align-items:start}.title h1{margin:5px 0 4px;font-size:clamp(25px,3vw,38px);letter-spacing:-.045em;line-height:1.12}.subtitle{color:var(--muted);margin:0;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.button{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:8px 12px;transition:transform .16s,border-color .16s,background .16s}.button:hover{transform:translateY(-1px);border-color:var(--accent);background:var(--vscode-list-hoverBackground,var(--surface))}.button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}.button.primary:hover{background:var(--vscode-button-hoverBackground)}.button.icon{min-width:33px;padding:5px 9px;font-size:18px;line-height:20px}
  .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:24px 0 14px}.metric{padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface);min-width:0}.metric strong{display:block;font-size:24px;line-height:1.1;letter-spacing:-.04em}.metric span{display:block;color:var(--muted);font-size:11px;margin-top:5px;text-transform:uppercase;letter-spacing:.1em}
  .toolbar{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:14px}.search,.select{background:var(--vscode-input-background,var(--surface));color:var(--vscode-input-foreground,var(--ink));border:1px solid var(--vscode-input-border,var(--line));border-radius:8px;padding:8px 11px}.search{min-width:240px;flex:1}.select{min-width:160px;max-width:230px}.status{min-height:20px;margin:4px 0 14px;color:var(--muted);font-size:12px}.status.error{color:var(--vscode-errorForeground,#d55)}.status.warn{color:var(--orange)}
  .workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(245px,310px);gap:12px}.card{border:1px solid var(--line);background:var(--surface);border-radius:14px;overflow:hidden;min-width:0}.card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 17px;border-bottom:1px solid var(--line)}.card-head h2{font-size:13px;letter-spacing:.015em;margin:0}.hint{font-size:11px;color:var(--muted)}.graph-tools{display:flex;gap:5px}.graph-wrap{height:470px;position:relative;overflow:hidden;background:radial-gradient(circle at 48% 47%,color-mix(in srgb,var(--blue) 9%,transparent),transparent 55%)}svg{width:100%;height:100%}.edge{stroke:var(--vscode-descriptionForeground);stroke-opacity:.33;fill:none}.graph-node{cursor:pointer}.graph-node circle{stroke:var(--canvas);stroke-width:4;transition:stroke-width .2s,filter .2s}.graph-node:hover circle,.graph-node.selected circle{stroke:var(--accent);stroke-width:5;filter:drop-shadow(0 0 10px var(--accent))}.graph-label{fill:var(--ink);font-size:13px;font-weight:700;paint-order:stroke;stroke:var(--canvas);stroke-width:4;stroke-linejoin:round;pointer-events:none}.graph-count{fill:var(--muted);font-size:11px;paint-order:stroke;stroke:var(--canvas);stroke-width:3;pointer-events:none}.graph-empty{position:absolute;inset:0;display:grid;place-items:center;padding:30px;color:var(--muted);text-align:center}.graph-note{padding:9px 16px;color:var(--muted);border-top:1px solid var(--line);font-size:11px}
  .graph-empty[hidden]{display:none}.detail{min-height:520px}.detail-content{padding:20px}.detail-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.17em;color:var(--accent);font-weight:800}.detail-title{font-size:20px;line-height:1.25;letter-spacing:-.025em;margin:8px 0;overflow-wrap:anywhere}.detail-meta{color:var(--muted);overflow-wrap:anywhere}.detail-row{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding:10px 0;gap:10px}.detail-row strong{font-weight:600;text-align:right}.detail-actions{margin-top:16px}.pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:3px 8px;font-size:11px;margin:3px 4px 3px 0}.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px;background:var(--dot)}
  .browser{margin-top:12px}.browser-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:15px 17px;border-bottom:1px solid var(--line)}.browser-head h2{font-size:13px;margin:0}.crumbs{display:flex;gap:5px;flex-wrap:wrap;align-items:center}.crumbs button{border:0;background:none;color:var(--accent);padding:0}.browser-body{min-height:120px}.row{display:grid;grid-template-columns:25px minmax(0,1fr) minmax(50px,auto) 28px;align-items:center;gap:9px;padding:9px 16px;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}.row:hover{background:var(--vscode-list-hoverBackground)}.row-main{min-width:0}.row-title{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-sub{display:block;color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row button{background:none;border:0;color:inherit;text-align:left;padding:0;min-width:0}.row .open{font-size:17px;text-align:center;color:var(--accent)}.row .tag{color:var(--muted);font-size:11px;text-align:right;white-space:nowrap}.show-more{display:block;margin:13px auto}.empty{padding:32px;text-align:center;color:var(--muted)}.footer{color:var(--muted);font-size:11px;margin-top:11px}
  @media(max-width:850px){.workspace{grid-template-columns:1fr}.detail{min-height:0}.graph-wrap{height:400px}}@media(max-width:600px){.top{flex-direction:column}.actions{justify-content:flex-start}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.graph-wrap{height:320px}.search,.select{min-width:100%;max-width:none}}
  @media(prefers-reduced-motion:reduce){.button,.graph-node circle{transition:none}}
`;

const SCRIPT = String.raw`
  'use strict';
  const vscode = acquireVsCodeApi();
  const ns = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  let report = null, folder = '', query = '', moduleFilter = '', shown = 80, selected = null, zoom = 1;
  const svg = $('graph');
  function node(tag, className, content) { const element = document.createElement(tag); if (className) element.className = className; if (content != null) element.textContent = String(content); return element; }
  function clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
  function svgNode(tag, attrs) { const element = document.createElementNS(ns, tag); for (const [key,value] of Object.entries(attrs)) element.setAttribute(key, String(value)); return element; }
  function color(id) { let hash = 2166136261; for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return 'hsl(' + (Math.abs(hash) % 310 + 20) + ' 62% 55%)'; }
  function basename(value) { return String(value || '').replace(/\\/g,'/').split('/').filter(Boolean).pop() || 'Projeto'; }
  function format(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function setStatus(message, kind) { const el = $('status'); el.textContent = message || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }
  function metrics() { $('metric-files').textContent = format(report.files.length); $('metric-folders').textContent = format(report.folders.length); $('metric-modules').textContent = format(report.modules.length); $('metric-edges').textContent = format(report.edges.length); }
  function renderFilters() { const select = $('module-filter'); clear(select); const all = node('option', '', 'Todos os módulos'); all.value = ''; select.appendChild(all); for (const module of report.modules) { const option = node('option', '', module.label || module.id); option.value = module.id; select.appendChild(option); } select.value = moduleFilter; }
  function moduleEdges() { const fileModule = new Map(report.files.map(file => [file.id, file.module])); const moduleIds = new Set(report.modules.map(item => item.id)); const edges = new Map(); for (const edge of report.edges) { const a = moduleIds.has(edge.source) ? edge.source : fileModule.get(edge.source); const b = moduleIds.has(edge.target) ? edge.target : fileModule.get(edge.target); if (!a || !b || a === b) continue; const key = [a,b].sort().join('\\0'); edges.set(key,(edges.get(key) || 0) + (edge.count || 1)); } return [...edges].map(([key,count]) => ({pair:key.split('\\0'),count})); }
  function renderGraph() {
    clear(svg); const empty = $('graph-empty');
    const sorted = [...report.modules].sort((a,b) => b.fileCount - a.fileCount || a.label.localeCompare(b.label));
    const visible = sorted.slice(0,60); const q = query.toLocaleLowerCase();
    empty.hidden = visible.length > 0; empty.textContent = visible.length ? '' : 'Nenhum módulo encontrado. Execute o mapeamento para montar o grafo.';
    $('graph-note').textContent = sorted.length > 60 ? 'Exibindo 60 de ' + format(sorted.length) + ' módulos. Use a busca e a lista de arquivos para explorar o restante.' : 'Grafo resumido por módulo. Clique em um nó para ver os arquivos.';
    if (!visible.length) return;
    const positions = new Map(), count = visible.length;
    const ringSizes = [1,8,14,18,19], radii = [0,80,135,180,215];
    visible.forEach((item,index) => { let ring=0, local=index; while (local >= ringSizes[ring]) { local-=ringSizes[ring]; ring++; } const prior=ringSizes.slice(0,ring).reduce((a,b)=>a+b,0); const inRing=Math.min(ringSizes[ring],count-prior); const angle=-Math.PI/2 + local*Math.PI*2/inRing + ring*.13; positions.set(item.id,{x:480+Math.cos(angle)*radii[ring],y:290+Math.sin(angle)*radii[ring]}); });
    const group = svgNode('g', {id:'graph-transform'}); svg.appendChild(group);
    const edgeGroup = svgNode('g',{}), nodeGroup = svgNode('g',{}); group.append(edgeGroup,nodeGroup);
    for (const edge of moduleEdges().sort((a,b)=>b.count-a.count).slice(0,240)) { const a = positions.get(edge.pair[0]), b = positions.get(edge.pair[1]); if (!a || !b) continue; const line = svgNode('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'edge','stroke-width':Math.min(4,1+Math.log2(edge.count+1)*.5)}); edgeGroup.appendChild(line); }
    for (const item of visible) { const p = positions.get(item.id), match = !q || (item.label || item.id).toLocaleLowerCase().includes(q), filtered = !moduleFilter || item.id === moduleFilter; const groupNode = svgNode('g',{class:'graph-node' + (selected?.type === 'module' && selected.id === item.id ? ' selected' : ''),opacity:match && filtered ? 1 : .22,role:'button',tabindex:'0','aria-label':(item.label || item.id) + ', ' + item.fileCount + ' arquivos'}); const circle = svgNode('circle',{cx:p.x,cy:p.y,r:Math.max(17,Math.min(30,16+Math.sqrt(item.fileCount)*3)),fill:color(item.id)}); const label = svgNode('text',{x:p.x,y:p.y+50,'text-anchor':'middle',class:'graph-label'}); label.textContent = (item.label || item.id).slice(0,25); const countText = svgNode('text',{x:p.x,y:p.y+65,'text-anchor':'middle',class:'graph-count'}); countText.textContent = format(item.fileCount) + ' arquivos'; groupNode.append(circle,label,countText); groupNode.addEventListener('click',() => chooseModule(item.id)); groupNode.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseModule(item.id); } }); nodeGroup.appendChild(groupNode); }
    applyZoom();
  }
  function applyZoom() { const group = $('graph-transform'); if (group) group.setAttribute('transform','translate(480 290) scale(' + zoom + ') translate(-480 -290)'); $('zoom-label').textContent = Math.round(zoom*100) + '%'; }
  function chooseModule(id) { selected = {type:'module',id}; moduleFilter = id; $('module-filter').value = id; folder = ''; shown = 80; renderGraph(); renderBrowser(); renderDetail(); }
  function chooseFile(index) { selected = {type:'file',index}; renderDetail(); }
  function detailRow(label,value) { const row = node('div','detail-row'); row.append(node('span','',label),node('strong','',value)); return row; }
  function renderDetail() {
    const target = $('detail-content'); clear(target);
    if (!selected) { target.append(node('div','detail-kicker','Exploração'),node('h3','detail-title','Seu projeto em camadas'),node('p','detail-meta','Selecione um módulo no grafo ou um arquivo na lista para ver relações, linguagem e localização.')); return; }
    if (selected.type === 'module') { const item = report.modules.find(module => module.id === selected.id); if (!item) { selected = null; return renderDetail(); } const files = report.files.filter(file => file.module === item.id); target.append(node('div','detail-kicker','Módulo'),node('h3','detail-title',item.label || item.id),node('p','detail-meta','Agrupamento de arquivos do projeto.')); target.append(detailRow('Arquivos',format(files.length)),detailRow('Camadas',format(new Set(files.map(file=>file.layer).filter(Boolean)).size)),detailRow('Linguagens',format(new Set(files.map(file=>file.language).filter(Boolean)).size))); const wrap = node('div','detail-actions'); for (const language of [...new Set(files.map(file=>file.language).filter(Boolean))].slice(0,12)) { const pill = node('span','pill'); const dot = node('i','dot'); dot.style.setProperty('--dot',color(language)); pill.append(dot,document.createTextNode(language)); wrap.appendChild(pill); } target.appendChild(wrap); return; }
    const file = report.files[selected.index]; if (!file) { selected = null; return renderDetail(); } target.append(node('div','detail-kicker','Arquivo'),node('h3','detail-title',basename(file.path)),node('p','detail-meta',file.path)); target.append(detailRow('Módulo',report.modules.find(item=>item.id===file.module)?.label || file.module || 'Sem módulo'),detailRow('Camada',file.layer || 'Não identificada'),detailRow('Linguagem',file.language || 'Não identificada'),detailRow('Símbolos',format(file.symbols)),detailRow('Tamanho',format(file.bytes) + ' bytes')); const actions = node('div','detail-actions'); const open = node('button','button primary','Abrir arquivo ↗'); open.addEventListener('click',()=>vscode.postMessage({action:'openFile',index:file.index})); actions.appendChild(open); target.appendChild(actions);
  }
  function folderPath(value) { const clean=String(value || '').replace(/\\/g,'/').replace(/^\/+|\/+$/g,''); return clean==='.'?'':clean; }
  function fileFolder(file) { return folderPath(file.folder || file.path.replace(/\\/g,'/').split('/').slice(0,-1).join('/')); }
  function renderCrumbs() { const crumbs = $('crumbs'); clear(crumbs); let current = ''; const root = node('button','','Projeto'); root.addEventListener('click',()=>{folder='';shown=80;renderBrowser();}); crumbs.appendChild(root); for (const part of folder.split('/').filter(Boolean)) { crumbs.appendChild(node('span','','/')); current += (current ? '/' : '') + part; const destination = current; const button = node('button','',part); button.addEventListener('click',()=>{folder=destination;shown=80;renderBrowser();}); crumbs.appendChild(button); } }
  function makeRow(icon,label,sub,tag,onClick,onOpen) { const row = node('div','row'); row.appendChild(node('span','',icon)); const main = node('button','row-main'); main.append(node('span','row-title',label),node('span','row-sub',sub)); main.addEventListener('click',onClick); row.appendChild(main); row.appendChild(node('span','tag',tag)); const open = node('button','open',onOpen ? '↗' : '›'); open.setAttribute('aria-label',onOpen ? 'Abrir arquivo ' + label : 'Abrir pasta ' + label); open.addEventListener('click',onOpen || onClick); row.appendChild(open); return row; }
  function renderBrowser() {
    renderCrumbs(); const body = $('browser-body'); clear(body);
    const q = query.toLocaleLowerCase(); const searchMode = !!q; const folders = searchMode ? [] : report.folders.filter(item => { const p=folderPath(item.path); return p && folderPath(p.split('/').slice(0,-1).join('/'))===folder; }).sort((a,b)=>a.path.localeCompare(b.path));
    const labels = new Map(report.modules.map(item => [item.id, item.label || item.id]));
    const files = report.files.filter(file => (!moduleFilter || file.module === moduleFilter) && (searchMode ? file.path.toLocaleLowerCase().includes(q) || (labels.get(file.module) || '').toLocaleLowerCase().includes(q) : fileFolder(file) === folder)).sort((a,b)=>a.path.localeCompare(b.path));
    const entries = [...folders.map(item=>({kind:'folder',item})),...files.map(item=>({kind:'file',item}))];
    if (!entries.length) { body.appendChild(node('div','empty',searchMode ? 'Nenhum arquivo corresponde à busca.' : 'Esta pasta não contém arquivos mapeados.')); return; }
    for (const entry of entries.slice(0,shown)) { if (entry.kind === 'folder') { const item=entry.item,p=folderPath(item.path); body.appendChild(makeRow('▣',basename(p),p,'Pasta',()=>{folder=p;shown=80;renderBrowser();})); } else { const file=entry.item; body.appendChild(makeRow('◇',basename(file.path),file.path,file.language || 'Arquivo',()=>chooseFile(file.index),()=>vscode.postMessage({action:'openFile',index:file.index}))); } }
    if (entries.length > shown) { const button=node('button','button show-more','Mostrar mais ' + Math.min(80,entries.length-shown) + ' de ' + format(entries.length)); button.addEventListener('click',()=>{shown+=80;renderBrowser();}); body.appendChild(button); }
    $('browser-count').textContent = format(files.length) + ' arquivos' + (folders.length ? ' · ' + format(folders.length) + ' pastas' : '');
  }
  function render() { if (!report) return; metrics(); renderFilters(); renderGraph(); renderBrowser(); renderDetail(); $('subtitle').textContent = report.root || 'Projeto'; if (report.warnings.length) setStatus(format(report.warnings.length) + ' aviso(s): ' + report.warnings[0], 'warn'); else setStatus('Mapa atualizado em ' + (report.generatedAt || 'agora') + '.'); }
  window.addEventListener('message',event => { const message=event.data; if (!message || typeof message !== 'object') return; if (message.type==='report') { report=message.report; selected=null; folder=''; query=''; moduleFilter=''; shown=80; $('search').value=''; render(); } else if (message.type==='status') setStatus(message.message,message.kind); });
  $('search').addEventListener('input',event=>{query=event.target.value.trim();shown=80;if(report){renderGraph();renderBrowser();}});
  $('module-filter').addEventListener('change',event=>{moduleFilter=event.target.value;selected=moduleFilter?{type:'module',id:moduleFilter}:null;shown=80;if(report){renderGraph();renderBrowser();renderDetail();}});
  $('rescan').addEventListener('click',()=>vscode.postMessage({action:'rescan'})); $('generate').addEventListener('click',()=>vscode.postMessage({action:'generateDocs'}));
  $('zoom-in').addEventListener('click',()=>{zoom=Math.min(2.5,zoom*1.2);applyZoom();}); $('zoom-out').addEventListener('click',()=>{zoom=Math.max(.5,zoom/1.2);applyZoom();}); $('zoom-reset').addEventListener('click',()=>{zoom=1;applyZoom();});
  svg.addEventListener('wheel',event=>{if(!report)return;event.preventDefault();zoom=Math.max(.5,Math.min(2.5,zoom*(event.deltaY>0?.9:1.1)));applyZoom();},{passive:false});
  vscode.postMessage({action:'ready'});
`;

function renderProjectMap(rootName, nonce) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Mapa do projeto</title><style nonce="${nonce}">${STYLE}</style></head><body>
    <main class="page"><header class="top"><div class="title"><div class="eyebrow">Agent Orchestra / Contexto do projeto</div><h1>Mapa do projeto</h1><p class="subtitle" id="subtitle">${escapeHtml(rootName)}</p></div><div class="actions"><button id="rescan" class="button">↻ Atualizar mapa</button><button id="generate" class="button primary">Gerar contexto ↗</button></div></header>
    <section class="metrics" aria-label="Resumo do mapa"><div class="metric"><strong id="metric-files">—</strong><span>Arquivos</span></div><div class="metric"><strong id="metric-folders">—</strong><span>Pastas</span></div><div class="metric"><strong id="metric-modules">—</strong><span>Módulos</span></div><div class="metric"><strong id="metric-edges">—</strong><span>Relações</span></div></section>
    <div class="toolbar"><input id="search" class="search" type="search" placeholder="Buscar arquivos e módulos…" aria-label="Buscar arquivos e módulos"><select id="module-filter" class="select" aria-label="Filtrar módulo"><option value="">Todos os módulos</option></select></div><p id="status" class="status" role="status">Aguardando leitura do projeto…</p>
    <section class="workspace"><div class="card"><div class="card-head"><div><h2>Relações entre módulos</h2><span class="hint">Visão resumida para manter o mapa leve</span></div><div class="graph-tools"><button id="zoom-out" class="button icon" aria-label="Diminuir zoom">−</button><button id="zoom-reset" class="button" aria-label="Restaurar zoom"><span id="zoom-label">100%</span></button><button id="zoom-in" class="button icon" aria-label="Aumentar zoom">+</button></div></div><div class="graph-wrap"><svg id="graph" viewBox="0 0 960 580" role="img" aria-label="Grafo de módulos"></svg><div id="graph-empty" class="graph-empty">Aguardando mapa…</div></div><div id="graph-note" class="graph-note">As relações entre arquivos serão agrupadas por módulo.</div></div><aside class="card detail"><div class="card-head"><h2>Detalhes</h2><span class="hint">Seleção</span></div><div id="detail-content" class="detail-content"><p class="detail-meta">Selecione um módulo ou arquivo.</p></div></aside></section>
    <section class="card browser"><div class="browser-head"><div><h2>Pastas e arquivos</h2><div id="crumbs" class="crumbs"></div></div><span id="browser-count" class="hint"></span></div><div id="browser-body" class="browser-body"><div class="empty">Aguardando mapa…</div></div></section><p class="footer">Os dados do mapa ficam neste projeto. A visualização mostra apenas módulos no grafo e carrega arquivos em lotes.</p></main>
    <script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

function openProjectMap(vscode, context, root, { onRescan, onGenerateDocs } = {}) {
  const rootPath = typeof root === 'string' ? root : root?.path;
  if (!rootPath) throw new Error('Selecione uma pasta local do projeto.');
  const name = typeof root === 'string' ? path.basename(root) : root.name || path.basename(rootPath);
  const panel = vscode.window.createWebviewPanel('agentOrchestra.projectMap', `Mapa: ${name}`, vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
  const nonce = crypto.randomBytes(16).toString('base64');
  let currentReport = null;
  let disposed = false;
  panel.webview.html = renderProjectMap(name, nonce);
  const post = message => { if (!disposed) return panel.webview.postMessage(message); };
  const api = {
    panel,
    update(report) { currentReport = normalizeReport(report); post({ type: 'report', report: currentReport }); },
    loading(message = 'Lendo o projeto…') { post({ type: 'status', message, kind: '' }); },
    error(error) { post({ type: 'status', message: `Erro ao mapear projeto: ${String(error?.message || error)}`, kind: 'error' }); },
    dispose() { panel.dispose(); }
  };
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== 'object') return;
    try {
      if (message.action === 'ready') { if (currentReport) post({ type: 'report', report: currentReport }); return; }
      if (message.action === 'openFile') {
        const index = message.index;
        if (!Number.isSafeInteger(index) || !currentReport?.files[index]) throw new Error('Arquivo não está no mapa atual.');
        const file = safeProjectFile(rootPath, currentReport.files[index].path);
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
      } else if (message.action === 'rescan' && onRescan) {
        api.loading('Atualizando o mapa do projeto…');
        const next = await onRescan();
        if (next?.schemaVersion === 1) api.update(next);
        else post({ type: 'status', message: 'Leitura do projeto concluída.', kind: '' });
      } else if (message.action === 'generateDocs' && onGenerateDocs) {
        api.loading('Gerando contexto do projeto…');
        const next = await onGenerateDocs();
        if (next?.schemaVersion === 1) api.update(next);
        else post({ type: 'status', message: 'Contexto do projeto gerado.', kind: '' });
      }
    } catch (error) {
      api.error(error);
      vscode.window.showErrorMessage(`Agent Orchestra: ${error.message}`);
    }
  });
  panel.onDidDispose(() => { disposed = true; });
  return api;
}

module.exports = { escapeHtml, safeProjectFile, normalizeReport, renderProjectMap, openProjectMap };
