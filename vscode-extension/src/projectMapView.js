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
    framework: text(report.framework, 80),
    generatedAt: text(report.generatedAt, 100),
    folders: list(report.folders).map(folder => ({ id: text(folder.id), path: text(folder.path, 2000), parent: folder.parent == null ? null : text(folder.parent) })),
    files: list(report.files).map((file, index) => ({ index, id: text(file.id), path: text(file.path, 2000), folder: text(file.folder), module: text(file.module), layer: text(file.layer), language: text(file.language), bytes: Number.isFinite(file.bytes) ? file.bytes : 0, symbols: Array.isArray(file.symbols) ? file.symbols.length : Number.isFinite(file.symbols) ? file.symbols : 0 })),
    modules: list(report.modules).map(module => ({ id: text(module.id), label: text(module.label), path: text(module.path), kind: text(module.kind), fileCount: Number.isFinite(module.fileCount) ? module.fileCount : 0 })),
    edges: list(report.edges).map(edge => ({ source: text(edge.source), target: text(edge.target), kind: text(edge.kind), count: Number.isFinite(edge.count) ? edge.count : 1 })),
    warnings: list(report.warnings, 100).map(warning => text(typeof warning === 'string' ? warning : warning?.message || JSON.stringify(warning), 500)),
    stats: report.stats && typeof report.stats === 'object' ? {
      files: Number.isFinite(report.stats.files) ? report.stats.files : undefined,
      folders: Number.isFinite(report.stats.folders) ? report.stats.folders : undefined,
      modules: Number.isFinite(report.stats.modules) ? report.stats.modules : undefined,
      edges: Number.isFinite(report.stats.edges) ? report.stats.edges : undefined,
      cacheEntries: Number.isFinite(report.stats.cacheEntries) ? report.stats.cacheEntries : 0,
      cacheBytes: Number.isFinite(report.stats.cacheBytes) ? report.stats.cacheBytes : 0
    } : {}
  };
}

const STYLE = `
  :root {color-scheme:light dark; --canvas:var(--vscode-editor-background); --surface:var(--vscode-sideBar-background,var(--vscode-editorWidget-background)); --line:var(--vscode-panel-border,var(--vscode-widget-border)); --ink:var(--vscode-foreground); --muted:var(--vscode-descriptionForeground); --accent:var(--vscode-focusBorder,#33b5ad); --blue:var(--vscode-charts-blue,#52a9f0); --green:var(--vscode-charts-green,#54ba87); --orange:var(--vscode-charts-orange,#d99850)}
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--canvas);color:var(--ink);font:13px/1.5 var(--vscode-font-family,system-ui)}button,input,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .page{max-width:1600px;margin:auto;padding:25px clamp(16px,3vw,44px) 50px}.eyebrow{text-transform:uppercase;letter-spacing:.19em;font-size:10px;font-weight:800;color:var(--accent)}.top{display:flex;justify-content:space-between;gap:18px;align-items:start}.title h1{margin:5px 0 4px;font-size:clamp(25px,3vw,38px);letter-spacing:-.045em;line-height:1.12}.subtitle{color:var(--muted);margin:0;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.button{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:8px 12px;transition:transform .16s,border-color .16s,background .16s}.button:hover{transform:translateY(-1px);border-color:var(--accent);background:var(--vscode-list-hoverBackground,var(--surface))}.button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}.button.primary:hover{background:var(--vscode-button-hoverBackground)}.button.icon{min-width:33px;padding:5px 9px;font-size:18px;line-height:20px}
  .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:24px 0 14px}.metric{padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface);min-width:0}.metric strong{display:block;font-size:24px;line-height:1.1;letter-spacing:-.04em}.metric span{display:block;color:var(--muted);font-size:11px;margin-top:5px;text-transform:uppercase;letter-spacing:.1em}
  .toolbar{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:14px}.search,.select{background:var(--vscode-input-background,var(--surface));color:var(--vscode-input-foreground,var(--ink));border:1px solid var(--vscode-input-border,var(--line));border-radius:8px;padding:8px 11px}.search{min-width:240px;flex:1}.select{min-width:160px;max-width:230px}.status{min-height:20px;margin:4px 0 14px;color:var(--muted);font-size:12px}.status.error{color:var(--vscode-errorForeground,#d55)}.status.warn{color:var(--orange)}
  .warnings{margin:-8px 0 14px;font-size:12px}.warnings summary{cursor:pointer;color:var(--orange)}.warnings pre{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--surface)}.warnings[hidden]{display:none}
  .workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,330px);gap:12px}.card{border:1px solid var(--line);background:var(--surface);border-radius:14px;overflow:hidden;min-width:0}.card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 17px;border-bottom:1px solid var(--line)}.card-head h2{font-size:13px;letter-spacing:.015em;margin:0}.hint{font-size:11px;color:var(--muted)}.graph-tools{display:flex;gap:5px;align-items:center}.graph-wrap{height:min(68vh,660px);min-height:420px;position:relative;overflow:auto;background:var(--canvas)}svg{display:block;width:760px;max-width:none;margin:0 auto}.edge{stroke:var(--vscode-descriptionForeground);stroke-opacity:.55;fill:none;stroke-width:2}.graph-node{cursor:pointer}.graph-card{fill:var(--surface);stroke:var(--line);stroke-width:1.5;transition:stroke .16s,filter .16s}.graph-node:hover .graph-card,.graph-node.selected .graph-card{stroke:var(--accent);stroke-width:2.5;filter:drop-shadow(0 2px 10px rgba(0,0,0,.2))}.graph-label{fill:var(--ink);font-size:15px;font-weight:700;pointer-events:none}.graph-count{fill:var(--muted);font-size:12px;pointer-events:none}.graph-empty{position:absolute;inset:0;display:grid;place-items:center;padding:30px;color:var(--muted);text-align:center}.graph-note{padding:9px 16px;color:var(--muted);border-top:1px solid var(--line);font-size:11px}.graph-tools .button{white-space:nowrap}
  .graph-empty[hidden]{display:none}.detail{min-height:520px}.detail-content{padding:20px}.detail-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.17em;color:var(--accent);font-weight:800}.detail-title{font-size:20px;line-height:1.25;letter-spacing:-.025em;margin:8px 0;overflow-wrap:anywhere}.detail-meta{color:var(--muted);overflow-wrap:anywhere}.detail-row{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding:10px 0;gap:10px}.detail-row strong{font-weight:600;text-align:right}.detail-actions{margin-top:16px}.pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:3px 8px;font-size:11px;margin:3px 4px 3px 0}.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px;background:var(--dot)}
  .relation-edge{fill:none;stroke:var(--orange);stroke-width:3;stroke-opacity:.85}.relation-title{font-size:12px;margin:18px 0 7px}.relation-button{display:block;width:100%;text-align:left;margin:5px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .browser{margin-top:12px}.browser-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:15px 17px;border-bottom:1px solid var(--line)}.browser-head h2{font-size:13px;margin:0}.crumbs{display:flex;gap:5px;flex-wrap:wrap;align-items:center}.crumbs button{border:0;background:none;color:var(--accent);padding:0}.browser-body{min-height:120px}.row{display:grid;grid-template-columns:25px minmax(0,1fr) minmax(50px,auto) 28px;align-items:center;gap:9px;padding:9px 16px;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}.row:hover{background:var(--vscode-list-hoverBackground)}.row-main{min-width:0}.row-title{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-sub{display:block;color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row button{background:none;border:0;color:inherit;text-align:left;padding:0;min-width:0}.row .open{font-size:17px;text-align:center;color:var(--accent)}.row .tag{color:var(--muted);font-size:11px;text-align:right;white-space:nowrap}.show-more{display:block;margin:13px auto}.empty{padding:32px;text-align:center;color:var(--muted)}.footer{color:var(--muted);font-size:11px;margin-top:11px}
  @media(max-width:1150px){.workspace{grid-template-columns:1fr}.detail{min-height:0}.graph-wrap{height:min(65vh,620px)}}@media(max-width:600px){.top{flex-direction:column}.actions{justify-content:flex-start}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.graph-wrap{height:420px}.search,.select{min-width:100%;max-width:none}.card-head{flex-wrap:wrap}}
  @media(prefers-reduced-motion:reduce){.button,.graph-node circle{transition:none}}
`;

const SCRIPT = String.raw`
  'use strict';
  const vscode = acquireVsCodeApi();
  const ns = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  let report = null, folder = '', query = '', moduleFilter = '', shown = 80, selected = null, zoom = 1, graphHeight = 420;
  const svg = $('graph');
  function node(tag, className, content) { const element = document.createElement(tag); if (className) element.className = className; if (content != null) element.textContent = String(content); return element; }
  function clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
  function svgNode(tag, attrs) { const element = document.createElementNS(ns, tag); for (const [key,value] of Object.entries(attrs)) element.setAttribute(key, String(value)); return element; }
  function color(id) { let hash = 2166136261; for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return 'hsl(' + (Math.abs(hash) % 310 + 20) + ' 62% 55%)'; }
  function basename(value) { return String(value || '').replace(/\\/g,'/').split('/').filter(Boolean).pop() || 'Projeto'; }
  function format(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function setStatus(message, kind) { const el = $('status'); el.textContent = message || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }
  function metrics() { $('metric-files').textContent = format(report.files.length); $('metric-folders').textContent = format(report.folders.length); $('metric-modules').textContent = format(report.modules.length); $('metric-edges').textContent = format(report.edges.length); $('cache-info').textContent=report.stats.cacheEntries?format(report.stats.cacheEntries)+' resumos · '+format(Math.ceil(report.stats.cacheBytes/1024))+' KB no armazenamento da extensão.':'Sem cache persistente nesta leitura.'; }
  function renderFilters() { const select = $('module-filter'); clear(select); const all = node('option', '', 'Todos os grupos'); all.value = ''; select.appendChild(all); for (const module of report.modules) { const option = node('option', '', (module.kind === 'domain' ? '◆ ' : module.kind === 'layer' ? '▤ ' : '') + (module.label || module.id)); option.value = module.id; select.appendChild(option); } select.value = moduleFilter; }
  function graphCard(x,y,label,sub,tint,onClick,isSelected) {
    const item = svgNode('g',{class:'graph-node' + (isSelected ? ' selected' : ''),role:'button',tabindex:'0','aria-label':label + ', ' + sub});
    item.append(svgNode('rect',{x,y,width:320,height:68,rx:12,class:'graph-card'}),svgNode('rect',{x,y,width:7,height:68,rx:3,fill:tint}));
    const title = svgNode('text',{x:x+20,y:y+28,class:'graph-label'}); title.textContent = label.length > 35 ? label.slice(0,34) + '…' : label;
    const caption = svgNode('text',{x:x+20,y:y+49,class:'graph-count'}); caption.textContent = sub.length > 43 ? sub.slice(0,42) + '…' : sub;
    item.append(title,caption); item.addEventListener('click',onClick);
    item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onClick();}});
    return item;
  }
  function renderGraph() {
    clear(svg); const q=query.toLocaleLowerCase(); const prefix=folder ? folder+'/' : '';
    const eligible=report.files.filter(file=>!moduleFilter||file.module===moduleFilter);
    const match=file=>!q||file.path.toLocaleLowerCase().includes(q)||basename(file.path).toLocaleLowerCase().includes(q);
    const relevant=eligible.filter(match);
    const folders=report.folders.filter(item=>{const p=folderPath(item.path);return p&&folderPath(p.split('/').slice(0,-1).join('/'))===folder&&(!q||relevant.some(file=>file.path.startsWith(p+'/'))||p.toLocaleLowerCase().includes(q));});
    const files=relevant.filter(file=>fileFolder(file)===folder);
    const entries=[...folders.map(item=>({type:'folder',item})),...files.map(item=>({type:'file',item}))].sort((a,b)=>a.type===b.type?basename(a.item.path).localeCompare(basename(b.item.path)):a.type==='folder'?-1:1);
    const visible=entries.slice(0,64), rows=Math.ceil(visible.length/2);
    graphHeight=Math.max(420,150+rows*92); svg.setAttribute('viewBox','0 0 760 '+graphHeight); applyZoom();
    $('graph-up').disabled=!folder; const empty=$('graph-empty'); empty.hidden=visible.length>0; empty.textContent=visible.length?'':q?'Nenhum resultado nesta pasta. Use a lista abaixo para encontrar arquivos em outras pastas.':'Esta pasta não contém arquivos mapeados.';
    $('graph-note').textContent=(folder||'Projeto')+' · '+format(folders.length)+' pastas · '+format(files.length)+' arquivos'+(entries.length>64?' · exibindo 64 itens; abra uma pasta para explorar mais':'');
    const root=graphCard(220,20,folder?basename(folder):basename(report.root),'Pasta atual · '+format(eligible.filter(file=>!folder||file.path.startsWith(prefix)).length)+' arquivos','var(--accent)',()=>{selected={type:'folder',path:folder};renderDetail();},selected?.type==='folder'&&selected.path===folder); svg.appendChild(root);
    if(!visible.length)return;
    const spineY=rows?150+(rows-1)*92+34:90;
    svg.appendChild(svgNode('path',{d:'M 380 88 V '+spineY,class:'edge'}));
    const visiblePositions=new Map(visible.filter(entry=>entry.type==='file').map((entry,index)=>{const position=visible.indexOf(entry),col=position%2,row=Math.floor(position/2);return [entry.item.id,{x:col?410:30,y:150+row*92}];}));
    if(selected?.type==='file'){const file=report.files[selected.index]; for(const edge of report.edges.filter(edge=>edge.source===file?.id||edge.target===file?.id)){const a=visiblePositions.get(edge.source),b=visiblePositions.get(edge.target);if(a&&b)svg.appendChild(svgNode('path',{d:'M '+(a.x+160)+' '+(a.y+68)+' Q 380 '+(Math.max(a.y,b.y)+90)+' '+(b.x+160)+' '+(b.y+68),class:'relation-edge'}));}}
    visible.forEach((entry,index)=>{const col=index%2,row=Math.floor(index/2),x=col?410:30,y=150+row*92,p=folderPath(entry.item.path),isFolder=entry.type==='folder';
      svg.appendChild(svgNode('path',{d:'M 380 '+(y+34)+' H '+(col?410:350),class:'edge'}));
      const count=isFolder?eligible.filter(file=>file.path.startsWith(p+'/')).length:0;
      const caption=isFolder?format(count)+' arquivos · abrir pasta':(entry.item.language||'Arquivo')+' · '+(entry.item.module||'sem módulo');
      const click=isFolder?()=>setGraphFolder(p):()=>chooseFile(entry.item.index);
      svg.appendChild(graphCard(x,y,basename(p),caption,isFolder?'#4aa3ff':color(entry.item.module||'file'),click,selected?.type==='file'&&selected.index===entry.item.index));
    });
  }
  function applyZoom() { svg.style.width=Math.round(760*zoom)+'px'; svg.style.height=Math.round(graphHeight*zoom)+'px'; $('zoom-label').textContent=Math.round(zoom*100)+'%'; }
  function setGraphFolder(path) { folder=path; selected={type:'folder',path}; shown=80; renderGraph(); renderBrowser(); renderDetail(); $('graph-wrap').scrollTop=0; }
  function chooseFile(index) { const file=report.files[index]; if(!file)return; selected={type:'file',index}; folder=fileFolder(file); query=''; moduleFilter=''; $('search').value=''; $('module-filter').value=''; shown=80; renderGraph(); renderBrowser(); renderDetail(); }
  function detailRow(label,value) { const row = node('div','detail-row'); row.append(node('span','',label),node('strong','',value)); return row; }
  function renderDetail() {
    const target = $('detail-content'); clear(target);
    if (!selected) { target.append(node('div','detail-kicker','Exploração'),node('h3','detail-title','Pastas e arquivos'),node('p','detail-meta','Clique numa pasta para abrir seus arquivos. Selecione um arquivo para ver linguagem, módulo e relações.')); return; }
    if (selected.type === 'folder') { const files=report.files.filter(file=>!selected.path||file.path.startsWith(selected.path+'/')); const languages=new Map(); for(const file of files)languages.set(file.language||'Outro',(languages.get(file.language||'Outro')||0)+1); target.append(node('div','detail-kicker','Pasta'),node('h3','detail-title',selected.path?basename(selected.path):basename(report.root)),node('p','detail-meta',selected.path||'Raiz do projeto')); target.append(detailRow('Arquivos',format(files.length)),detailRow('Linguagens',format(languages.size)),detailRow('Módulos',format(new Set(files.map(file=>file.module).filter(Boolean)).size))); const wrap=node('div','detail-actions'); for(const [language,count] of [...languages].sort((a,b)=>b[1]-a[1]).slice(0,10)){const pill=node('span','pill');const dot=node('i','dot');dot.style.setProperty('--dot',color(language));pill.append(dot,document.createTextNode(language+' · '+format(count)));wrap.appendChild(pill);} target.appendChild(wrap); return; }
    if (selected.type === 'module') { const item = report.modules.find(module => module.id === selected.id); if (!item) { selected = null; return renderDetail(); } const files = report.files.filter(file => file.module === item.id); const kind=({domain:'Módulo de domínio',configured:'Módulo configurado',package:'Pacote',layer:'Camada técnica',directory:'Diretório',support:'Suporte'})[item.kind]||'Grupo'; target.append(node('div','detail-kicker',kind),node('h3','detail-title',item.label || item.id),node('p','detail-meta',item.path||'Agrupamento de arquivos do projeto.')); target.append(detailRow('Arquivos',format(files.length)),detailRow('Camadas',format(new Set(files.map(file=>file.layer).filter(Boolean)).size)),detailRow('Linguagens',format(new Set(files.map(file=>file.language).filter(Boolean)).size))); const wrap = node('div','detail-actions'); for (const language of [...new Set(files.map(file=>file.language).filter(Boolean))].slice(0,12)) { const pill = node('span','pill'); const dot = node('i','dot'); dot.style.setProperty('--dot',color(language)); pill.append(dot,document.createTextNode(language)); wrap.appendChild(pill); } target.appendChild(wrap); return; }
    const file = report.files[selected.index]; if (!file) { selected = null; return renderDetail(); } target.append(node('div','detail-kicker','Arquivo'),node('h3','detail-title',basename(file.path)),node('p','detail-meta',file.path)); target.append(detailRow('Módulo',report.modules.find(item=>item.id===file.module)?.label || file.module || 'Sem módulo'),detailRow('Camada',file.layer || 'Não identificada'),detailRow('Linguagem',file.language || 'Não identificada'),detailRow('Símbolos',format(file.symbols)),detailRow('Tamanho',format(file.bytes) + ' bytes')); const actions = node('div','detail-actions'); const open = node('button','button primary','Abrir arquivo ↗'); open.addEventListener('click',()=>vscode.postMessage({action:'openFile',index:file.index})); actions.appendChild(open); target.appendChild(actions); const relations=report.edges.filter(edge=>edge.source===file.id||edge.target===file.id); target.appendChild(detailRow('Relações',format(relations.length))); if(relations.length){target.appendChild(node('h4','relation-title','Arquivos relacionados')); for(const edge of relations.slice(0,12)){const other=report.files.find(item=>item.id===(edge.source===file.id?edge.target:edge.source)); if(!other)continue;const label=(edge.source===file.id?'Importa ':'Importado por ')+other.path;const button=node('button','button relation-button',label);button.addEventListener('click',()=>chooseFile(other.index));target.appendChild(button);}}
  }
  function folderPath(value) { const clean=String(value || '').replace(/\\/g,'/').replace(/^\/+|\/+$/g,''); return clean==='.'?'':clean; }
  function fileFolder(file) { return folderPath(file.folder || file.path.replace(/\\/g,'/').split('/').slice(0,-1).join('/')); }
  function renderCrumbs() { const crumbs = $('crumbs'); clear(crumbs); let current = ''; const root = node('button','','Projeto'); root.addEventListener('click',()=>setGraphFolder('')); crumbs.appendChild(root); for (const part of folder.split('/').filter(Boolean)) { crumbs.appendChild(node('span','','/')); current += (current ? '/' : '') + part; const destination = current; const button = node('button','',part); button.addEventListener('click',()=>setGraphFolder(destination)); crumbs.appendChild(button); } }
  function makeRow(icon,label,sub,tag,onClick,onOpen) { const row = node('div','row'); row.appendChild(node('span','',icon)); const main = node('button','row-main'); main.append(node('span','row-title',label),node('span','row-sub',sub)); main.addEventListener('click',onClick); row.appendChild(main); row.appendChild(node('span','tag',tag)); const open = node('button','open',onOpen ? '↗' : '›'); open.setAttribute('aria-label',onOpen ? 'Abrir arquivo ' + label : 'Abrir pasta ' + label); open.addEventListener('click',onOpen || onClick); row.appendChild(open); return row; }
  function renderBrowser() {
    renderCrumbs(); const body = $('browser-body'); clear(body);
    const q = query.toLocaleLowerCase(); const searchMode = !!q; const folders = searchMode ? [] : report.folders.filter(item => { const p=folderPath(item.path); return p && folderPath(p.split('/').slice(0,-1).join('/'))===folder; }).sort((a,b)=>a.path.localeCompare(b.path));
    const labels = new Map(report.modules.map(item => [item.id, item.label || item.id]));
    const files = report.files.filter(file => (!moduleFilter || file.module === moduleFilter) && (searchMode ? file.path.toLocaleLowerCase().includes(q) || (labels.get(file.module) || '').toLocaleLowerCase().includes(q) : fileFolder(file) === folder)).sort((a,b)=>a.path.localeCompare(b.path));
    const entries = [...folders.map(item=>({kind:'folder',item})),...files.map(item=>({kind:'file',item}))];
    if (!entries.length) { body.appendChild(node('div','empty',searchMode ? 'Nenhum arquivo corresponde à busca.' : 'Esta pasta não contém arquivos mapeados.')); return; }
    for (const entry of entries.slice(0,shown)) { if (entry.kind === 'folder') { const item=entry.item,p=folderPath(item.path); body.appendChild(makeRow('▣',basename(p),p,'Pasta',()=>setGraphFolder(p))); } else { const file=entry.item; body.appendChild(makeRow('◇',basename(file.path),file.path,file.language || 'Arquivo',()=>chooseFile(file.index),()=>vscode.postMessage({action:'openFile',index:file.index}))); } }
    if (entries.length > shown) { const button=node('button','button show-more','Mostrar mais ' + Math.min(80,entries.length-shown) + ' de ' + format(entries.length)); button.addEventListener('click',()=>{shown+=80;renderBrowser();}); body.appendChild(button); }
    $('browser-count').textContent = format(files.length) + ' arquivos' + (folders.length ? ' · ' + format(folders.length) + ' pastas' : '');
  }
  function render() { if (!report) return; metrics(); renderFilters(); renderGraph(); renderBrowser(); renderDetail(); $('subtitle').textContent = report.root || 'Projeto'; $('warning-details').hidden=!report.warnings.length; $('warning-list').textContent=report.warnings.join('\n\n'); if (report.warnings.length) setStatus(format(report.warnings.length) + ' aviso(s) no mapeamento.', 'warn'); else setStatus('Mapa atualizado em ' + (report.generatedAt || 'agora') + '.'); }
  window.addEventListener('message',event => { const message=event.data; if (!message || typeof message !== 'object') return; if (message.type==='report') { report=message.report; selected=null; folder=''; query=''; moduleFilter=''; shown=80; $('search').value=''; render(); } else if (message.type==='status') setStatus(message.message,message.kind); });
  $('search').addEventListener('input',event=>{query=event.target.value.trim();shown=80;if(report){renderGraph();renderBrowser();}});
  $('module-filter').addEventListener('change',event=>{moduleFilter=event.target.value;selected=moduleFilter?{type:'module',id:moduleFilter}:null;folder='';shown=80;if(report){renderGraph();renderBrowser();renderDetail();}});
  $('graph-up').addEventListener('click',()=>setGraphFolder(folder.split('/').slice(0,-1).join('/')));
  $('rescan').addEventListener('click',()=>vscode.postMessage({action:'rescan'})); $('generate').addEventListener('click',()=>vscode.postMessage({action:'generateDocs'}));
  $('zoom-in').addEventListener('click',()=>{zoom=Math.min(2.5,zoom*1.2);applyZoom();}); $('zoom-out').addEventListener('click',()=>{zoom=Math.max(.5,zoom/1.2);applyZoom();}); $('zoom-reset').addEventListener('click',()=>{zoom=1;applyZoom();});
  svg.addEventListener('wheel',event=>{if(!report)return;event.preventDefault();zoom=Math.max(.5,Math.min(2.5,zoom*(event.deltaY>0?.9:1.1)));applyZoom();},{passive:false});
  vscode.postMessage({action:'ready'});
`;

function renderProjectMap(rootName, nonce) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Mapa do projeto</title><style nonce="${nonce}">${STYLE}</style></head><body>
    <main class="page"><header class="top"><div class="title"><div class="eyebrow">Agent Orchestra / Contexto do projeto</div><h1>Mapa do projeto</h1><p class="subtitle" id="subtitle">${escapeHtml(rootName)}</p></div><div class="actions"><button id="rescan" class="button">↻ Atualizar mapa</button><button id="generate" class="button primary">Documentar com agente ↗</button></div></header>
    <section class="metrics" aria-label="Resumo do mapa"><div class="metric"><strong id="metric-files">—</strong><span>Arquivos</span></div><div class="metric"><strong id="metric-folders">—</strong><span>Pastas</span></div><div class="metric"><strong id="metric-modules">—</strong><span>Grupos</span></div><div class="metric"><strong id="metric-edges">—</strong><span>Relações</span></div></section>
    <div class="toolbar"><input id="search" class="search" type="search" placeholder="Buscar arquivos e grupos…" aria-label="Buscar arquivos e grupos"><select id="module-filter" class="select" aria-label="Filtrar grupo"><option value="">Todos os grupos</option></select></div><p id="status" class="status" role="status">Aguardando leitura do projeto…</p><details id="warning-details" class="warnings" hidden><summary>Ver avisos do mapeamento</summary><pre id="warning-list"></pre></details>
    <section class="workspace"><div class="card"><div class="card-head"><div><h2>Estrutura do projeto</h2><span class="hint">Abra pastas e selecione arquivos no mapa</span></div><div class="graph-tools"><button id="graph-up" class="button" aria-label="Voltar para a pasta anterior">↑ Pasta</button><button id="zoom-out" class="button icon" aria-label="Diminuir zoom">−</button><button id="zoom-reset" class="button" aria-label="Restaurar zoom"><span id="zoom-label">100%</span></button><button id="zoom-in" class="button icon" aria-label="Aumentar zoom">+</button></div></div><div id="graph-wrap" class="graph-wrap"><svg id="graph" viewBox="0 0 760 420" role="img" aria-label="Mapa navegável de pastas e arquivos"></svg><div id="graph-empty" class="graph-empty">Aguardando mapa…</div></div><div id="graph-note" class="graph-note">Pastas e arquivos do projeto.</div></div><aside class="card detail"><div class="card-head"><h2>Detalhes</h2><span class="hint">Seleção</span></div><div id="detail-content" class="detail-content"><p class="detail-meta">Selecione uma pasta ou arquivo.</p></div></aside></section>
    <section class="card browser"><div class="browser-head"><div><h2>Pastas e arquivos</h2><div id="crumbs" class="crumbs"></div></div><span id="browser-count" class="hint"></span></div><div id="browser-body" class="browser-body"><div class="empty">Aguardando mapa…</div></div></section><p class="footer">O mapa mostra até 64 itens por pasta. <span id="cache-info"></span> O contexto para agentes fica no projeto.</p></main>
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
