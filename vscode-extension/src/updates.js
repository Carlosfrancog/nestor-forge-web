'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_MANIFEST = 64 * 1024;
const MAX_VSIX = 50 * 1024 * 1024;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Versão inválida no manifesto de atualização.');
  return value.split('.').map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

function validateRelease(value, manifestUrl, extensionId) {
  if (!value || value.schemaVersion !== 1 || value.extensionId !== extensionId) throw new Error('Manifesto de atualização incompatível com esta extensão.');
  versionParts(value.version);
  if (!/^[a-f0-9]{64}$/i.test(value.sha256 || '') || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_VSIX) {
    throw new Error('Hash ou tamanho do VSIX inválido no manifesto.');
  }
  const url = new URL(value.url, manifestUrl);
  if (url.protocol !== 'https:' || url.origin !== new URL(manifestUrl).origin) throw new Error('O VSIX deve ser servido por HTTPS no mesmo site do manifesto.');
  return { ...value, url: url.href };
}

function readHttps(url, limit, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return reject(new Error('A atualização exige HTTPS.'));
    const request = https.get(parsed, { headers: { 'User-Agent': 'AgentOrchestra-updater', 'Accept': 'application/json, application/octet-stream' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 3 || !response.headers.location) return reject(new Error('Redirecionamentos demais no download.'));
        const next = new URL(response.headers.location, parsed);
        if (next.protocol !== 'https:' || next.origin !== parsed.origin) return reject(new Error('Redirecionamento fora do site de atualização.'));
        return readHttps(next.href, limit, redirects + 1).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Servidor de atualizações retornou HTTP ${response.statusCode}.`));
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit) {
          response.destroy(new Error('Arquivo de atualização excede o tamanho permitido.'));
        } else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(15000, () => request.destroy(new Error('Tempo esgotado ao consultar atualizações.')));
    request.on('error', reject);
  });
}

async function fetchRelease(manifestUrl, extensionId) {
  const url = new URL(manifestUrl);
  if (url.protocol !== 'https:') throw new Error('O manifesto de atualização exige HTTPS.');
  const contents = await readHttps(url.href, MAX_MANIFEST);
  let value;
  try { value = JSON.parse(contents.toString('utf8')); }
  catch { throw new Error('O manifesto de atualização não contém JSON válido.'); }
  return validateRelease(value, url.href, extensionId);
}

function verifyPackage(contents, release) {
  const hash = crypto.createHash('sha256').update(contents).digest('hex');
  if (contents.length !== release.size || hash.toLowerCase() !== release.sha256.toLowerCase()) {
    throw new Error('O VSIX baixado não corresponde ao tamanho e hash publicados.');
  }
}

async function installRelease(release, cliPath) {
  const contents = await readHttps(release.url, MAX_VSIX);
  verifyPackage(contents, release);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-update-'));
  const file = path.join(temp, `agentorchestra-${release.version}.vsix`);
  try {
    await fs.writeFile(file, contents);
    await execFileAsync(cliPath, ['--install-extension', file, '--force'], { timeout: 120000, windowsHide: true });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

function start(context, vscode) {
  const settings = () => vscode.workspace.getConfiguration('agentOrchestra');
  const current = context.extension.packageJSON.version;
  const extensionId = `${context.extension.packageJSON.publisher}.${context.extension.packageJSON.name}`;
  let busy = false;

  async function check(manual = false) {
    if (busy || (!manual && settings().get('updateMode') === 'off')) return;
    busy = true;
    try {
      const release = await fetchRelease(settings().get('updateManifestUrl'), extensionId);
      if (compareVersions(release.version, current) <= 0) {
        if (manual) vscode.window.showInformationMessage(`AgentOrchestra ${current} já está atualizado.`);
        return;
      }
      const mode = settings().get('updateMode');
      if (!manual && context.globalState.get('updateInstalledVersion') === release.version) return;
      if (!manual && mode === 'notify') {
        const notified = context.globalState.get('updateNotifiedVersion');
        if (notified === release.version) return;
        await context.globalState.update('updateNotifiedVersion', release.version);
      }
      if (!manual && mode === 'auto') {
        await install(release);
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        `AgentOrchestra ${release.version} disponível (instalada: ${current}).`,
        'Atualizar agora', 'Abrir página'
      );
      if (choice === 'Atualizar agora') await install(release);
      else if (choice === 'Abrir página') await vscode.env.openExternal(vscode.Uri.parse(new URL('../', settings().get('updateManifestUrl')).href));
    } catch (error) {
      if (manual) vscode.window.showErrorMessage(`AgentOrchestra: ${error.message}`);
    } finally { busy = false; }
  }

  async function install(release) {
    try {
      const configuredCli = settings().get('vscodeCliPath');
      const cliPath = configuredCli === 'auto'
        ? (process.platform === 'win32' ? process.execPath : (process.env.VSCODE_CLI || process.execPath))
        : configuredCli;
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Instalando AgentOrchestra ${release.version}…` },
        () => installRelease(release, cliPath));
      await context.globalState.update('updateInstalledVersion', release.version);
      const choice = await vscode.window.showInformationMessage(`AgentOrchestra ${release.version} instalado. Recarregue o VS Code para ativá-lo.`, 'Recarregar janela');
      if (choice === 'Recarregar janela') await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (error) {
      const choice = await vscode.window.showErrorMessage(`AgentOrchestra: não foi possível instalar a atualização: ${error.message}`, 'Baixar VSIX');
      if (choice === 'Baixar VSIX') await vscode.env.openExternal(vscode.Uri.parse(release.url));
    }
  }

  context.subscriptions.push(vscode.commands.registerCommand('agentOrchestra.checkUpdates', () => check(true)));
  const startup = setTimeout(() => check(), 30000);
  const interval = setInterval(() => check(), CHECK_INTERVAL);
  context.subscriptions.push({ dispose: () => { clearTimeout(startup); clearInterval(interval); } });
}

module.exports = { compareVersions, validateRelease, verifyPackage, fetchRelease, installRelease, start };
