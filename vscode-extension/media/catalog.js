(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let catalog = { platform: 'claude', projects: [], agentCount: 0 };
  let query = '';
  let resourcesOpen = false;
  const send = message => vscode.postMessage(message);
  const node = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = value;
    return element;
  };
  const button = (label, className, handler, title) => {
    const element = node('button', className, label);
    element.type = 'button';
    if (title) element.title = title;
    element.addEventListener('click', handler);
    return element;
  };
  const action = (name, id) => send({ type: 'entry', name, id });
  const command = name => send({ type: 'command', name });

  function draw() {
    const previousSearch = document.activeElement?.id === 'catalog-search';
    const selection = previousSearch ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    app.replaceChildren();
    const hero = node('section', 'hero');
    const eyebrow = node('div', 'eyebrow', 'NESTOR FORGE  /  AGENT ORCHESTRA');
    const heading = node('div', 'hero-heading');
    heading.append(node('h1', '', 'Seus agentes'), button('↻', 'icon-button refresh', () => command('refresh'), 'Atualizar catálogo'));
    hero.append(eyebrow, heading, node('p', 'hero-copy', 'Escolha um agente, execute ou leve tudo para outro projeto em um ZIP.'));
    app.append(hero);

    const switchWrap = node('div', 'switch-wrap');
    const switchLabel = node('div', 'section-label', 'PLATAFORMA');
    const switcher = node('div', 'platform-switch');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Mostrar agentes de');
    for (const [value, label] of [['claude', 'Claude'], ['codex', 'Codex']]) {
      const choice = button(label, `switch-option${catalog.platform === value ? ' selected' : ''}`,
        () => send({ type: 'platform', value }));
      choice.setAttribute('aria-pressed', String(catalog.platform === value));
      switcher.append(choice);
    }
    switchWrap.append(switchLabel, switcher);
    app.append(switchWrap);

    const toolbar = node('div', 'toolbar');
    toolbar.append(button('+ Criar agente', 'primary-button', () => command('forgeCreate')),
      button('↓ Importar ZIP', 'secondary-button', () => command('importPackage')));
    app.append(toolbar);

    const searchWrap = node('div', 'search-wrap');
    const search = node('input', 'search');
    search.id = 'catalog-search';
    search.type = 'search';
    search.placeholder = 'Buscar agente ou recurso';
    search.setAttribute('aria-label', 'Buscar agente ou recurso');
    search.value = query;
    search.addEventListener('input', () => { query = search.value; draw(); });
    searchWrap.append(node('span', 'search-icon', '⌕'), search);
    app.append(searchWrap);
    if (previousSearch) { search.focus(); search.setSelectionRange(...selection); }

    const headingRow = node('div', 'list-heading');
    headingRow.append(node('h2', '', 'Agentes'), node('span', 'count', String(catalog.agentCount)));
    app.append(headingRow);
    const term = query.trim().toLocaleLowerCase();
    let visibleCount = 0;
    for (const project of catalog.projects) {
      const agents = project.agents.filter(agent => !term || `${agent.name} ${project.name}`.toLocaleLowerCase().includes(term));
      visibleCount += agents.length;
      if (!agents.length) continue;
      const group = node('section', 'project');
      group.append(node('div', 'project-name', `${project.scope === 'user' ? 'PESSOAL' : 'PROJETO'}  ·  ${project.name}`));
      for (const agent of agents) {
        const card = node('article', 'agent-card');
        const top = node('div', 'card-top');
        const mark = node('span', 'agent-mark', catalog.platform === 'claude' ? 'C' : '◇');
        const identity = node('div', 'agent-identity');
        identity.append(node('h3', '', agent.name), node('span', 'agent-subtitle', `${catalog.platform === 'claude' ? 'Claude' : 'Codex'}${agent.hasCounterpart ? ' · também disponível na outra plataforma' : ''}`));
        const status = ({ running: 'Em execução', starting: 'Iniciando', prepared: 'Instrução preparada', failed: 'Falhou', finished: 'Concluído' })[agent.status];
        if (status) identity.append(node('span', `agent-status ${agent.status}`, `● ${status}`));
        top.append(mark, identity);
        const actions = node('div', 'card-actions');
        actions.append(button('▶ Executar', 'card-primary', () => action('runAgent', agent.id)),
          button('↑ Exportar ZIP', 'card-secondary', () => action('shareAgent', agent.id), 'Inclui agente, skill e arquivos relacionados'));
        const links = node('div', 'card-links');
        links.append(button('Abrir arquivo', 'text-button', () => action('open', agent.id)),
          button('Painel', 'text-button', () => action('dashboard', agent.id)));
        card.append(top, actions, links);
        group.append(card);
      }
      app.append(group);
    }
    if (!visibleCount) {
      const empty = node('div', 'empty');
      empty.append(node('div', 'empty-symbol', '◇'), node('strong', '', term ? 'Nenhum resultado' : `Nenhum agente ${catalog.platform === 'claude' ? 'Claude' : 'Codex'}`),
        node('p', '', term ? 'Tente outro nome.' : 'Crie um agente com a Forja ou importe um pacote ZIP.'));
      app.append(empty);
    }

    const packageNote = node('div', 'package-note');
    packageNote.append(node('span', 'note-icon', '↗'), node('p', '', 'Para usar em outro projeto, exporte o agente. O ZIP inclui a skill, a versão da outra plataforma quando existir e os arquivos relacionados.'));
    app.append(packageNote);

    const resources = catalog.projects.flatMap(project => project.resources.map(item => ({ ...item, project: project.name })))
      .filter(item => !term || `${item.name} ${item.kind} ${item.project}`.toLocaleLowerCase().includes(term));
    if (resources.length) {
      const details = node('details', 'resources');
      details.open = resourcesOpen;
      details.addEventListener('toggle', () => { resourcesOpen = details.open; });
      const summary = node('summary', '', `Recursos técnicos  ·  ${resources.length}`);
      details.append(summary, node('p', 'resources-intro', 'Skills, scripts e especificações dão suporte aos agentes. Para levar um agente a outro projeto, use Exportar ZIP no cartão dele.'));
      for (const item of resources) {
        const row = node('div', 'resource-row');
        const info = node('div', 'resource-info');
        info.append(node('strong', '', item.name), node('small', '', `${item.kind} · ${item.project}`));
        row.append(info);
        const menu = node('div', 'resource-actions');
        if (item.category === 'scripts') {
          menu.append(button('Executar', 'text-button', () => action('runScriptQuick', item.id)),
            button('Instruções', 'text-button', () => action('instructions', item.id)));
        } else if (item.category === 'specs') {
          menu.append(button('Gerar', 'text-button', () => action('forgeBuild', item.id)));
        } else if (item.category === 'agentPreset') {
          menu.append(button('Executar', 'text-button', () => action('runAgent', item.id)));
        } else {
          menu.append(button('Abrir', 'text-button', () => action(item.category === 'skills' || item.category === 'instructions' ? 'preview' : 'open', item.id)));
        }
        row.append(menu);
        details.append(row);
      }
      app.append(details);
    }
    const footer = node('div', 'footer');
    footer.append(button('Mapa do projeto', 'text-button', () => command('projectMap')),
      button('Atualizações', 'text-button', () => command('checkUpdates')));
    app.append(footer);
  }
  window.addEventListener('message', event => {
    if (event.data?.type !== 'catalog' || !event.data.catalog) return;
    catalog = event.data.catalog;
    draw();
  });
  send({ type: 'ready' });
})();
