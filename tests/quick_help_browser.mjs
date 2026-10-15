// Smoke test for the static form. Start the site on :8765 and Chrome CDP on :9229 first.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const port = process.env.CODEX_CDP_PORT || '9229';
const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page');
assert.ok(page, 'Nenhuma aba disponível no Chrome headless.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
});
function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await command('Page.enable');
await command('Runtime.enable');
await command('Page.navigate', { url: 'http://127.0.0.1:8765/' });
for (let i = 0; i < 30; i++) {
  if (await evaluate('document.querySelector("#help-toggle") !== null')) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}

await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mobile = await evaluate('({ width: innerWidth, content: document.documentElement.scrollWidth })');
assert.ok(mobile.content <= mobile.width, `Rolagem horizontal no celular: ${JSON.stringify(mobile)}`);
await evaluate('document.querySelector("#help-toggle").click()');
assert.equal(await evaluate('document.querySelector("#quick-help").hidden'), false);
assert.equal(await evaluate('document.querySelectorAll(".preset-card").length'), 4);
const helpWidth = await evaluate('({ width: innerWidth, content: document.documentElement.scrollWidth })');
assert.ok(helpWidth.content <= helpWidth.width, `Ajuda excede a tela: ${JSON.stringify(helpWidth)}`);
await new Promise(resolve => setTimeout(resolve, 300));
const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync('dist/quick-help-mobile.png', Buffer.from(screenshot.data, 'base64'));

await evaluate('document.querySelector("[data-preset=explore]").click(); document.querySelector("#apply-preset").click()');
const initial = await evaluate(`({
  name: document.querySelector('#agent-name').value,
  profile: document.querySelector('#profile').value,
  progress: document.querySelector('#progress-label').textContent,
  write: document.querySelector('[name=write_code]').checked
})`);
assert.deepEqual(initial, { name: 'Leitor de Projeto', profile: 'reader', progress: '3 de 3', write: false });

await evaluate(`(() => {
  document.querySelector('#role').value = 'Meu papel específico';
  document.querySelector('#help-toggle').click();
  document.querySelector('[data-preset=review]').click();
  document.querySelector('#apply-preset').click();
})()`);
assert.equal(await evaluate('document.querySelector("#role").value'), 'Meu papel específico');
assert.equal(await evaluate('document.querySelector("#profile").value'), 'reader');

await evaluate(`(() => {
  document.querySelector('#help-toggle').click();
  document.querySelector('[data-preset=build]').click();
  document.querySelector('#replace-existing').checked = true;
  document.querySelector('#apply-preset').click();
})()`);
const replaced = await evaluate(`({
  name: document.querySelector('#agent-name').value,
  profile: document.querySelector('#profile').value,
  write: document.querySelector('[name=write_code]').checked,
  progress: document.querySelector('#progress-label').textContent
})`);
assert.deepEqual(replaced, { name: 'Implementador', profile: 'coder', write: true, progress: '3 de 3' });
await evaluate('document.querySelector("#json-tab").click()');
assert.equal(await evaluate('JSON.parse(document.querySelector("#json-editor").value).profile'), 'coder');
await evaluate('document.querySelector("#guided-tab").click()');
assert.equal(await evaluate('document.querySelector("[name=write_code]").checked'), true);
await evaluate('document.querySelector("#json-tab").click(); document.querySelector("#help-toggle").click()');
assert.equal(await evaluate('document.querySelector("#guided-panel").hidden'), false);
assert.equal(await evaluate('document.querySelector("#quick-help").hidden'), false);

await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const desktop = await evaluate('({ width: innerWidth, content: document.documentElement.scrollWidth })');
assert.ok(desktop.content <= desktop.width, `Rolagem horizontal no desktop: ${JSON.stringify(desktop)}`);
socket.close();
console.log('Ajuda rápida e layout responsivo: OK');
