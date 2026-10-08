import { writeFileSync } from 'node:fs';

const port = process.env.CODEX_CDP_PORT || '9229';
const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page');
if (!page) throw new Error('Nenhuma aba disponível no Chrome headless.');
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
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

await command('Page.enable');
await command('Runtime.enable');
await command('Page.navigate', { url: 'http://127.0.0.1:8765/' });
await pause(1000);
const title = await evaluate('document.title');
if (!title.includes('Nestor Forge')) throw new Error(`Página incorreta: ${title}`);

await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync('tests/forge-ui.png', Buffer.from(screenshot.data, 'base64'));
await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mobile = await evaluate(`({ viewport: window.innerWidth, content: document.documentElement.scrollWidth })`);
if (mobile.content > mobile.viewport) throw new Error(`Layout móvel com rolagem horizontal: ${JSON.stringify(mobile)}`);
await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await evaluate(`(() => {
  document.querySelector('#agent-name').value = 'Nestor Browser Test';
  document.querySelector('#role').value = 'auditor de código';
  document.querySelector('#mission').value = 'identificar riscos com evidências';
  document.querySelector('[name=focus]').value = 'Mapear fluxos\\nApontar riscos';
  document.querySelector('#generate-button').click();
})()`);

let state;
for (let attempt = 0; attempt < 120; attempt++) {
  await pause(1000);
  state = await evaluate(`({ status: document.querySelector('#status').textContent, ready: !document.querySelector('#result').hidden })`);
  if (state.ready || /Falha|Não foi possível|Verifique/.test(state.status)) break;
}
if (!state.ready) throw new Error(`Geração falhou: ${state.status}`);
const result = await evaluate(`(async () => {
  const href = document.querySelector('#download-zip').href;
  const bytes = new Uint8Array(await fetch(href).then(response => response.arrayBuffer()));
  return { name: document.querySelector('#download-zip').download, size: bytes.length,
    magic: Array.from(bytes.slice(0, 4)), prompt: document.querySelector('#prompt-preview').value,
    base64: btoa(String.fromCharCode(...bytes)) };
})()`);
if (result.magic.join(',') !== '80,75,3,4') throw new Error('O download não é um ZIP válido.');
if (!result.prompt.includes('.agents/skills/')) throw new Error('Prompt Codex ausente.');
writeFileSync('tests/forge-browser-output.zip', Buffer.from(result.base64, 'base64'));
await evaluate(`(() => {
  document.querySelector('input[name=target][value=claude]').click();
  document.querySelector('#generate-button').click();
})()`);
let claude;
for (let attempt = 0; attempt < 30; attempt++) {
  await pause(500);
  claude = await evaluate(`({ status: document.querySelector('#status').textContent,
    ready: !document.querySelector('#result').hidden,
    prompt: document.querySelector('#prompt-preview').value })`);
  if (claude.ready || /Falha|Não foi possível|Verifique/.test(claude.status)) break;
}
if (!claude.ready || !claude.prompt.includes('Claude Code')) throw new Error(`Prompt Claude ausente: ${claude.status}`);
console.log(JSON.stringify({ title, mobile, state, zipName: result.name, zipBytes: result.size, prompts: ['codex', 'claude'] }, null, 2));
socket.close();
