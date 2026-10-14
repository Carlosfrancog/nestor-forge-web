'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'agentorchestra-activity-hook';
const SETTINGS = {
  claude: ['.claude', 'settings.local.json'],
  codex: ['.codex', 'hooks.json']
};

function quote(value) { return `"${String(value).replace(/"/g, '\\"')}"`; }

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Configuração inválida: ${file}`);
  return value;
}

function changeHooks(settings, command, enable) {
  const result = structuredClone(settings);
  if (!result.hooks) result.hooks = {};
  if (typeof result.hooks !== 'object' || Array.isArray(result.hooks)) throw new Error('A configuração de hooks é inválida.');
  for (const event of ['SubagentStart', 'SubagentStop']) {
    const existing = result.hooks[event] || [];
    if (!Array.isArray(existing)) throw new Error(`A lista ${event} é inválida.`);
    const filtered = existing.map(group => ({ ...group, hooks: (group.hooks || []).filter(hook => !String(hook.command || '').includes(MARKER)) }))
      .filter(group => group.hooks.length > 0);
    if (enable) filtered.push({ hooks: [{ type: 'command', command, timeout: 3 }] });
    if (filtered.length) result.hooks[event] = filtered;
    else delete result.hooks[event];
  }
  if (!Object.keys(result.hooks).length) delete result.hooks;
  return result;
}

function planMonitoring(root, script, logFile, platforms, enable) {
  return platforms.map(platform => {
    if (!SETTINGS[platform]) throw new Error(`Plataforma desconhecida: ${platform}`);
    const file = path.join(root, ...SETTINGS[platform]);
    if (!enable && !fs.existsSync(file)) return null;
    const command = `node ${quote(script)} ${quote(logFile)} ${platform} ${MARKER}`;
    return { file, content: JSON.stringify(changeHooks(readSettings(file), command, enable), null, 2) + '\n' };
  }).filter(Boolean);
}

function saveMonitoring(plan) {
  for (const { file, content } of plan) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.agentorchestra-${process.pid}-${Date.now()}.tmp`;
    fs.writeFileSync(temporary, content, { flag: 'wx', encoding: 'utf8' });
    try { fs.renameSync(temporary, file); }
    catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
  }
}

function agentIdentity(item) {
  if (item.category !== 'claudeAgents' && item.category !== 'codexAgents') return null;
  const platform = item.category === 'claudeAgents' ? 'claude' : 'codex';
  let name = item.label;
  try {
    const text = fs.readFileSync(item.file, 'utf8').slice(0, 8192);
    const match = platform === 'claude' ? text.match(/^name:\s*["']?([^\r\n"']+)/m) : text.match(/^name\s*=\s*["']([^"'\r\n]+)/m);
    if (match) name = match[1].trim();
  } catch (_) {}
  return { platform, name: name.toLowerCase() };
}

function readRecords(logFile) {
  try {
    const size = fs.statSync(logFile).size;
    const offset = Math.max(0, size - 1024 * 1024);
    const descriptor = fs.openSync(logFile, 'r');
    const buffer = Buffer.alloc(size - offset);
    try { fs.readSync(descriptor, buffer, 0, buffer.length, offset); }
    finally { fs.closeSync(descriptor); }
    let lines = buffer.toString('utf8').split(/\r?\n/);
    if (offset) lines = lines.slice(1);
    return lines.flatMap(line => {
      try { return line ? [JSON.parse(line)] : []; } catch (_) { return []; }
    });
  } catch (_) { return []; }
}

function summarize(records, item, root, now = Date.now()) {
  const identity = agentIdentity(item);
  if (!identity) return { state: 'unavailable', starts: 0 };
  const relevant = records.filter(record => {
    if (record.platform !== identity.platform) return false;
    if (String(record.agentType || '').toLowerCase().split(':').pop() !== identity.name) return false;
    if (root.scope === 'user') return true;
    const relative = path.relative(root.path, record.cwd || '');
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  const active = new Map();
  let starts = 0;
  let lastAt = null;
  for (const record of relevant) {
    const stamp = Date.parse(record.at);
    if (!Number.isFinite(stamp)) continue;
    const key = `${record.session}:${record.agentId}`;
    if (record.event === 'SubagentStart') { starts++; active.set(key, stamp); }
    if (record.event === 'SubagentStop') active.delete(key);
    if (!lastAt || stamp > lastAt) lastAt = stamp;
  }
  const newestStart = Math.max(0, ...active.values());
  const state = newestStart && now - newestStart < 10 * 60 * 1000 ? 'observed-active'
    : newestStart ? 'stale' : lastAt ? 'idle' : 'no-data';
  return { state, starts, lastAt, newestStart };
}

module.exports = { MARKER, planMonitoring, saveMonitoring, readRecords, summarize, agentIdentity };
