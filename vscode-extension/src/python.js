'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
const UV_VERSION = '0.12.19';
const PYTHON_VERSION = '3.13';
const ASSETS = {
  'win32-x64': ['uv-x86_64-pc-windows-msvc.zip', '6dbb02d79e419522f1c500f0adb1cddcff0cda7d59b0d66ea7f5e3b4a1b2f5f0'],
  'win32-arm64': ['uv-aarch64-pc-windows-msvc.zip', '115b54cb823bc48260670f5782001add6067ac8d98d18c8263a833704e287de9'],
  'linux-x64': ['uv-x86_64-unknown-linux-gnu.tar.gz', '23bf5552d220e0842b65c862097b2ebaeba0064b74eda5e565e77fd25969d8c8'],
  'linux-arm64': ['uv-aarch64-unknown-linux-gnu.tar.gz', '0804e9b164c64b6914182d5920c08551958a095986f10a3731056df701126436'],
  'darwin-x64': ['uv-x86_64-apple-darwin.tar.gz', 'cb5fa57bafe68fc0fb94b17f06bee0b0b9a7feb94ccbd110445afa0696e39273'],
  'darwin-arm64': ['uv-aarch64-apple-darwin.tar.gz', 'a9a8df1eedeb192f2e47e40e2faabfb387db4b850209118786d42f89dde3e0ba']
};
const MAX_DOWNLOAD = 70 * 1024 * 1024;
let pending;

function assetFor(platform = process.platform, arch = process.arch) {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) throw new Error(`Instalação automática de Python indisponível para ${platform}/${arch}. Configure agentOrchestra.pythonPath.`);
  return asset;
}

async function probe(command) {
  try {
    const { stdout } = await run(command, ['-I', '-B', '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 });
    const match = /^(\d+)\.(\d+)\s*$/.exec(stdout);
    return !!match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 10));
  } catch (_) { return false; }
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const address = new URL(url);
    if (address.protocol !== 'https:' || !['releases.astral.sh', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(address.hostname)) {
      return reject(new Error('Origem inválida para o instalador de Python.'));
    }
    const request = https.get(address, { headers: { 'User-Agent': 'AgentOrchestra-python-bootstrap' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 5 || !response.headers.location) return reject(new Error('Redirecionamentos demais no download do Python.'));
        return download(new URL(response.headers.location, address).href, redirects + 1).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download do instalador de Python retornou HTTP ${response.statusCode}.`));
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_DOWNLOAD) response.destroy(new Error('Instalador de Python excede o tamanho permitido.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(60000, () => request.destroy(new Error('Tempo esgotado ao baixar o instalador de Python.')));
    request.on('error', reject);
  });
}

async function findBinary(root, name) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) return path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = path.join(root, entry.name, name);
      try { if ((await fs.stat(nested)).isFile()) return nested; } catch (_) {}
    }
  }
  throw new Error(`O arquivo ${name} não existe no instalador de Python.`);
}

async function bootstrap(storage) {
  const [asset, expectedHash] = assetFor();
  const toolsDir = path.join(storage, 'python-tools', UV_VERSION);
  const executable = path.join(toolsDir, process.platform === 'win32' ? 'uv.exe' : 'uv');
  const pythonDir = path.join(storage, 'python');
  const cached = path.join(storage, 'python-path.txt');
  try {
    const installed = (await fs.readFile(cached, 'utf8')).trim();
    if (await probe(installed)) return installed;
  } catch (_) {}
  if (!await fs.stat(executable).then(value => value.isFile(), () => false)) {
    const url = `https://releases.astral.sh/github/uv/releases/download/${UV_VERSION}/${asset}`;
    const contents = await download(url);
    if (crypto.createHash('sha256').update(contents).digest('hex') !== expectedHash) {
      throw new Error('O instalador de Python não corresponde ao SHA-256 publicado.');
    }
    await fs.mkdir(toolsDir, { recursive: true });
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentorchestra-uv-'));
    try {
      const archive = path.join(temp, asset);
      const unpacked = path.join(temp, 'unpacked');
      await fs.mkdir(unpacked);
      await fs.writeFile(archive, contents);
      await run('tar', ['-xf', archive, '-C', unpacked], { windowsHide: true, timeout: 60000 });
      await fs.copyFile(await findBinary(unpacked, path.basename(executable)), executable);
      if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  }
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: pythonDir, UV_CACHE_DIR: path.join(storage, 'python-cache') };
  await run(executable, ['python', 'install', PYTHON_VERSION, '--install-dir', pythonDir, '--no-config'],
    { env, windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 });
  const { stdout } = await run(executable, ['python', 'find', PYTHON_VERSION, '--managed-python', '--no-config'],
    { env, windowsHide: true, timeout: 30000, maxBuffer: 4096 });
  const installed = stdout.trim();
  if (!path.isAbsolute(installed) || !await probe(installed)) throw new Error('O Python baixado não passou na verificação de execução.');
  await fs.writeFile(cached, installed + '\n');
  return installed;
}

async function resolvePython(context, vscode, { probePython = probe, installPython = bootstrap } = {}) {
  const configured = vscode.workspace.getConfiguration('agentOrchestra').get('pythonPath') || 'python';
  if (await probePython(configured)) return configured;
  if (configured !== 'python') throw new Error(`Python configurado em agentOrchestra.pythonPath não está disponível: ${configured}`);
  if (!pending) {
    pending = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
      title: 'AgentOrchestra: baixando Python para uso local…' }, () => installPython(context.globalStorageUri.fsPath))
      .catch(error => { throw new Error(`Não foi possível instalar Python automaticamente: ${error.message}`); })
      .finally(() => { pending = undefined; });
  }
  return pending;
}

module.exports = { assetFor, probe, bootstrap, resolvePython };
