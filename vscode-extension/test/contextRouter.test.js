'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { route, estimate } = require('../src/contextRouter');
const { laravelInertia } = require('../src/recipes/laravelInertia');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-router-'));
  const source = {
    'app/Jobs/Item/ItemNotificationJob.php': `<?php\nclass ItemNotificationJob {\n  public function handle() {\n    // enviar email ao criar item\n    Mail::to('x')->send();\n  }\n}\n`,
    'app/Http/Controllers/ItemController.php': `<?php\nclass ItemController {\n  public function update() {\n    return app(ItemService::class)->save();\n  }\n}\n`,
    'app/Services/ItemService.php': `<?php\nclass ItemService {\n  public function save() {\n    return true;\n  }\n}\n`,
    'routes/web.php': `<?php\nRoute::put('/items/{item}', [ItemController::class, 'update'])->name('admin.items.update')->middleware('can:items_edit');\n`,
    'resources/js/pages/admin/items/Edit.vue': `<template>\n<button v-if="usePermissions().can('items_edit')">Salvar</button>\n</template>\n`,
  };
  const panel = 'resources/js/components/011/metadata/ItemPanel.vue';
  const panelLines = Array(179).fill('');
  panelLines.push('/** Texto da última busca sem resultado, por metadado. */',
    'const emptySearch = reactive({});', '',
    'const searchRelated = async (field: Field) => {',
    '  const query = search[field.id].trim();',
    '  const response = await relatedRequest.get(route("admin.items.metadata.related"));',
    '  relatedResults[field.id] = response.data;',
    '  emptySearch[field.id] = relatedResults[field.id].length === 0 ? query : null;',
    '};', '', '', '', '', '', '', '', '');
  source[panel] = panelLines.join('\n');
  for (const [relative, content] of Object.entries(source)) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const notePath = 'graphify-out/vault-modules/CONTEXTO/BACKEND/Item/Notificacoes.md';
  const frontNotePath = 'graphify-out/vault-modules/CONTEXTO/FRONTEND/Metadata/Componentes.md';
  const mapPath = 'graphify-out/vault-modules/CONTEXTO/_Mapa contextual.md';
  for (const relative of [notePath, frontNotePath, mapPath]) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, '# Mapa\n');
  }
  const records = [];
  function file(relative, module, layer, summary = '') {
    const record = { id: `file:${relative}`, kind: 'file', path: relative, label: path.posix.basename(relative),
      module, layer, summary, imports: [], tokens: 100 };
    records.push(record); return record;
  }
  function unit(relative, key, label, lines, module, layer, summary, calls = []) {
    const record = { id: `unit:${relative}#${key}`, kind: 'unit', path: relative, label, lines,
      module, layer, summary, calls, tokens: 30 };
    records.push(record); return record;
  }
  const job = 'app/Jobs/Item/ItemNotificationJob.php';
  file(job, 'BACKEND:Item', 'Notificações e Jobs');
  unit(job, 'method:ItemNotificationJob.handle', 'ItemNotificationJob.handle', [3, 6], 'BACKEND:Item',
    'Notificações e Jobs', 'Enviar e-mail de notificação ao criar item.');
  const controller = 'app/Http/Controllers/ItemController.php';
  file(controller, 'BACKEND:Item', 'Controllers');
  const controllerClass = unit(controller, 'class:ItemController', 'ItemController', [2, 6], 'BACKEND:Item',
    'Controllers', 'class ItemController');
  controllerClass.unitKind = 'class';
  unit(controller, 'method:ItemController.update', 'ItemController.update', [3, 5], 'BACKEND:Item',
    'Controllers', 'Atualizar item.', ['ItemService.save']);
  const service = 'app/Services/ItemService.php';
  file(service, 'BACKEND:Item', 'Services');
  unit(service, 'method:ItemService.save', 'ItemService.save', [3, 5], 'BACKEND:Item', 'Services', 'Salvar item.');
  file('routes/web.php', 'routes', 'route');
  file('resources/js/pages/admin/items/Edit.vue', 'frontend:Item', 'Páginas');
  const panelFile = file(panel, 'frontend:Metadata', 'Componentes');
  panelFile.language = 'Vue';
  unit(panel, 'setup:function:picksItems', 'picksItems', [103, 103], 'frontend:Metadata',
    'Componentes', 'O valor é escolhido entre itens, com busca.');
  const searchRelated = unit(panel, 'setup:function:searchRelated', 'searchRelated', [183, 197],
    'frontend:Metadata', 'Componentes', 'const searchRelated = async (field: Field) => {');
  searchRelated.unitKind = 'function';
  records.push({ id: `section:${notePath}#Riscos e pendências`, kind: 'section', path: notePath,
    label: 'Riscos e pendências', lines: [1, 5], module: 'BACKEND:Item', layer: 'Notificações e Jobs',
    summary: 'O e-mail não é enviado quando o item é criado.', warnings: ['O job recebe argumentos que não chegam ao handle.'] });
  records.push({ id: `section:${mapPath}#Visão geral`, kind: 'section', path: mapPath,
    label: 'Visão geral', lines: [1, 2], summary: 'Mapa contextual do projeto.' });
  records.push({ id: `section:${frontNotePath}#Organização da pasta`, kind: 'section', path: frontNotePath,
    label: 'Organização da pasta', lines: [27, 30], module: 'frontend:Metadata', layer: 'Componentes',
    summary: 'O ItemPanel transforma a busca de itens relacionados em interação e aviso.' });
  const index = { records, meta: { schemaVersion: 1, revision: '41e25bbe22f0838f75ef689b6b87ffa0207e6caf',
    classification: { present: true, stale: false, profile: 'laravel-inertia' } } };
  const logic = { nodes: {
    r1: { id: 'r1', kind: 'route', route_name: 'admin.items.update', source_file: 'routes/web.php', line: 2 },
    c1: { id: 'c1', kind: 'method', source_file: controller, line: 3, label: 'ItemController::update' },
    s1: { id: 's1', kind: 'method', source_file: service, line: 3, label: 'ItemService::save' },
  }, edges: [{ relation: 'route_handler', source: 'r1', target: 'c1' },
    { relation: 'calls', source: 'c1', target: 's1' }] };
  return { root, index, logic, notePath, frontNotePath };
}
function withFixture(callback) {
  const data = fixture();
  try { callback(data); }
  finally { fs.rmSync(data.root, { recursive: true, force: true }); }
}

test('e-mail de item prioriza job e apresenta o risco registrado', () => withFixture(({ root, index }) => {
  const result = route(index, 'corrigir o e-mail ao criar item', { root });
  assert.match(result.items[0].path, /ItemNotificationJob\.php$/);
  assert.ok(result.notes.some(note => note.label === 'Riscos e pendências'));
  assert.match(result.card, /O job recebe argumentos/);
}));

test('busca vazia no painel aponta searchRelated e a nota da camada frontend', () => withFixture(({ root, index, frontNotePath }) => {
  const result = route(index, 'corrigir o aviso de busca vazia no painel de metadados do item', { root });
  assert.equal(result.items[0].path, 'resources/js/components/011/metadata/ItemPanel.vue');
  assert.deepEqual(result.items[0].lines, [183, 197]);
  assert.ok(result.notes.some(note => note.path === frontNotePath));
}));

test('receita route segue route_handler até controller e chamada ao service', () => withFixture(({ root, index, logic }) => {
  const result = route(index, 'a rota admin.items.update', { root, logic });
  assert.ok(result.items[0].path.endsWith('ItemController.php'));
  assert.deepEqual(result.items[0].lines, [3, 5]);
  assert.ok(result.items.some(item => item.path.endsWith('ItemController.php')));
  assert.ok(result.items.some(item => item.path.endsWith('ItemService.php')));
  assert.match(result.recipesUsed.join(' '), /rota/);
}));

test('receita permission encontra rota e componente Vue', () => withFixture(({ root, index }) => {
  const result = route(index, 'onde items_edit é exigida', { root });
  assert.ok(result.items.some(item => item.path === 'routes/web.php'));
  assert.ok(result.items.some(item => item.path.endsWith('Edit.vue')));
}));

test('cartão respeita orçamento e é determinístico', () => withFixture(({ root, index }) => {
  for (let number = 0; number < 200; number++) index.records.push({ id: `unit:app/Noise${number}.php#method:Noise.call`,
    kind: 'unit', path: `app/Noise${number}.php`, label: `ItemNotification${number}.call`,
    lines: [1, 10], summary: 'corrigir email ao criar item', module: 'BACKEND:Item', layer: 'Services' });
  const first = route(index, 'corrigir o e-mail ao criar item', { root, budgetTokens: 1200 });
  const second = route(index, 'corrigir o e-mail ao criar item', { root, budgetTokens: 1200 });
  assert.equal(first.card, second.card);
  assert.ok(estimate(first.card) <= 1200);
  assert.ok(first.items.length <= 8);
}));

test('missão com várias cláusulas ganha uma âncora por pedido', () => withFixture(({ root, index }) => {
  const result = route(index, 'mostrar o aviso de busca vazia no painel de metadados do item; enviar o e-mail ao criar item', { root });
  assert.ok(result.items.some(item => item.path.endsWith('ItemPanel.vue')));
  assert.ok(result.items.some(item => item.path.endsWith('ItemNotificationJob.php')));
}));

test('receita de coluna ignora palavra acentuada e só aceita nomes do schema', () => {
  const tableColumn = laravelInertia.find(recipe => recipe.id === 'table-column');
  assert.deepEqual(tableColumn.detect('fazer o mapa ocupar uma coluna só', { schema: null }), []);
  assert.deepEqual(tableColumn.detect('a coluna initial_zoom', { schema: null }), ['initial_zoom']);
  assert.deepEqual(tableColumn.detect('ajustar initial_zoom', { schema: null }), []);
  const schema = { tables: [{ table: 'metadata', columns: [{ column: 'initial_zoom' }] }] };
  assert.deepEqual(tableColumn.detect('a coluna initial_zoom da tabela metadata', { schema }), ['initial_zoom', 'metadata']);
});

test('entidade de receita espalhada por muitos arquivos não passa à frente da busca', () => withFixture(({ root, index }) => {
  const noisy = { id: 'noisy', label: 'ruído', detect: () => ['x'],
    resolve: () => Array.from({ length: 20 }, (_, number) => ({ path: `app/Models/M${number}.php`, lines: [1, 5], weight: 30 })) };
  const result = route(index, 'corrigir o e-mail ao criar item', { root, recipes: [noisy] });
  assert.match(result.items[0].path, /ItemNotificationJob\.php$/);
}));

test('missão sem acerto sugere mapa contextual', () => withFixture(({ root, index }) => {
  const result = route(index, 'xylophonium quasarzzz', { root });
  assert.equal(result.items.length, 0);
  assert.match(result.card, /_Mapa contextual\.md/);
}));

test('CLI lê índice em disco e emite JSON equivalente', () => withFixture(({ root, index, logic }) => {
  const directory = path.join(root, '.agentorchestra', 'context');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index-meta.json'), JSON.stringify(index.meta));
  fs.writeFileSync(path.join(directory, 'index.jsonl'), index.records.map(record => JSON.stringify(record)).join('\n') + '\n');
  fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'graphify-out', 'classification.json'), JSON.stringify({ schemaVersion: 1,
    format: 'graphy-refat.classification.v1', profile: 'laravel-inertia' }));
  fs.writeFileSync(path.join(root, 'graphify-out', 'logic.json'), JSON.stringify(logic));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'find.js'), '--root', root, '--json', 'a rota admin.items.update'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.ok(result.items.some(item => item.path.endsWith('ItemController.php')));
  assert.equal(result.card, route(index, 'a rota admin.items.update', { root, logic }).card);
}));
