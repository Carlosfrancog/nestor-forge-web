'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { main, parseArgs, defaultCacheDir } = require('../scripts/build-index');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-build-index-'));
  const files = {
    'app/Services/BookService.php': '<?php\nnamespace App\\Services;\nclass BookService {\n  public function save() { return true; }\n}\n',
    'resources/js/pages/Books.vue': '<template><p>Livros</p></template>\n<script setup>\nconst title = "Livros";\n</script>\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return { root, cache: fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-build-cache-')) };
}
function collect() {
  let text = '';
  return { write: chunk => { text += chunk; }, get text() { return text; } };
}

test('CLI grava índice e meta e informa as contagens em JSON', async () => {
  const { root, cache } = project();
  try {
    const output = collect();
    assert.equal(await main(['--root', root, '--cache-dir', cache, '--json'], output), 0);
    const result = JSON.parse(output.text);
    const directory = path.join(root, '.agentorchestra', 'context');
    assert.equal(result.indexPath, path.join(directory, 'index.jsonl'));
    assert.ok(fs.existsSync(path.join(directory, 'index-meta.json')));
    assert.ok(result.counts.units > 0);
    assert.equal(result.classification.present, false);
    assert.ok(!fs.existsSync(path.join(directory, 'project-handoff.json')));
    const records = fs.readFileSync(result.indexPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(records.some(record => record.kind === 'unit' && record.path === 'app/Services/BookService.php'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('--handoff também grava o handoff, e a saída em texto resume o resultado', async () => {
  const { root, cache } = project();
  try {
    const output = collect();
    await main(['--root', root, '--cache-dir', cache, '--handoff'], output);
    assert.ok(fs.existsSync(path.join(root, '.agentorchestra', 'context', 'project-handoff.json')));
    assert.match(output.text, /Índice: \.agentorchestra[\\/]context[\\/]index\.jsonl/);
    assert.match(output.text, /Classificação: ausente/);
    assert.match(output.text, /Handoff: /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('argumentos inválidos falham com a forma de uso', async () => {
  assert.throws(() => parseArgs(['--root']), /Falta o valor de --root/);
  assert.throws(() => parseArgs(['--desconhecido']), /Argumento desconhecido/);
  await assert.rejects(main([]), /Uso: node scripts\/build-index\.js/);
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-index.js'), '--root', path.join(os.tmpdir(), 'nao-existe-orchestra')], { encoding: 'utf8' });
  assert.equal(run.status, 1);
});

test('cache padrão fica fora do projeto, com chave estável por raiz', () => {
  const linux = defaultCacheDir('/srv/app', { XDG_CACHE_HOME: '/cache' }, 'linux');
  assert.match(linux, /^[\\/]cache[\\/]agentorchestra[\\/]project-map[\\/][a-f0-9]{24}$/);
  assert.equal(linux, defaultCacheDir('/srv/app', { XDG_CACHE_HOME: '/cache' }, 'linux'));
  assert.notEqual(linux, defaultCacheDir('/srv/outro', { XDG_CACHE_HOME: '/cache' }, 'linux'));
  assert.ok(defaultCacheDir('C:\\app', { LOCALAPPDATA: 'C:\\Local' }, 'win32').startsWith('C:\\Local'));
});
