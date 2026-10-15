'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { escapeHtml, safeProjectFile, normalizeReport, renderProjectMap, openProjectMap } = require('../src/projectMapView');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentorchestra-map-view-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function report(root, files = []) {
  return { schemaVersion: 1, root, generatedAt: '2026-10-15T12:00:00Z', folders: [], files, modules: [], edges: [], warnings: [], stats: {} };
}

test('webview escapes its title, uses nonce CSP and contains valid client script', () => {
  const html = renderProjectMap('<script>alert(1)</script>', 'abc123');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /default-src 'none'; style-src 'nonce-abc123'; script-src 'nonce-abc123'/);
  const script = html.match(/<script nonce="abc123">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.equal(escapeHtml('"&<>\''), '&quot;&amp;&lt;&gt;&#39;');
});

test('normalizes parser symbol arrays and warning messages for the view', () => {
  const mapped = normalizeReport({ ...report('project', [{ id: 'src/a.js', path: 'src/a.js', folder: 'src', symbols: [{ key: 'a' }, { key: 'b' }] }]), warnings: [{ kind: 'parse', message: 'Falha no parser' }] });
  assert.equal(mapped.files[0].symbols, 2);
  assert.deepEqual(mapped.warnings, ['Falha no parser']);
});

test('file navigation blocks absolute paths, traversal, and links outside the project', t => {
  const root = temporary(t);
  const inside = path.join(root, 'src', 'index.js');
  fs.mkdirSync(path.dirname(inside));
  fs.writeFileSync(inside, 'ok');
  assert.equal(safeProjectFile(root, 'src/index.js'), fs.realpathSync(inside));
  for (const invalid of ['../outside.js', '/etc/passwd', 'C:\\Windows\\win.ini', 'src/../index.js', 'src//index.js', '.', '']) {
    assert.throws(() => safeProjectFile(root, invalid), invalid);
  }
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.js`);
  fs.writeFileSync(outside, 'outside');
  t.after(() => fs.rmSync(outside, { force: true }));
  try {
    fs.symlinkSync(outside, path.join(root, 'link.js'));
    assert.throws(() => safeProjectFile(root, 'link.js'), /fora do projeto/);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
  }
});

test('webview resolves file indexes from current report and calls actions', async t => {
  const root = temporary(t);
  const file = path.join(root, 'main.js');
  fs.writeFileSync(file, 'hello');
  let receive;
  const opened = [], posted = [], errors = [];
  const panel = {
    webview: {
      html: '',
      postMessage(message) { posted.push(message); },
      onDidReceiveMessage(handler) { receive = handler; }
    },
    onDidDispose() {},
    dispose() {}
  };
  const vscode = {
    ViewColumn: { One: 1 },
    Uri: { file: value => ({ fsPath: value }) },
    window: {
      createWebviewPanel() { return panel; },
      async showTextDocument(uri) { opened.push(uri.fsPath); },
      showErrorMessage(message) { errors.push(message); }
    }
  };
  let rescans = 0, docs = 0;
  const view = openProjectMap(vscode, {}, root, { onRescan: async () => { rescans++; return report(root, [{ id: '2', path: 'main.js' }]); }, onGenerateDocs: async () => { docs++; } });
  assert.equal(view.panel, panel);
  view.update(report(root, [{ id: '1', path: 'main.js' }]));
  assert.equal(posted.at(-1).type, 'report');
  await receive({ action: 'openFile', index: 0 });
  assert.deepEqual(opened, [fs.realpathSync(file)]);
  await receive({ action: 'openFile', index: 99 });
  await receive({ action: 'openFile', index: '../outside.js' });
  assert.equal(opened.length, 1);
  assert.equal(errors.length, 2);
  await receive({ action: 'rescan' });
  await receive({ action: 'generateDocs' });
  assert.equal(rescans, 1);
  assert.equal(docs, 1);
});
