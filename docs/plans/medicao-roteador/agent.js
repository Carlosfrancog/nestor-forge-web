'use strict';
// Uso: WORK=/tmp/medicao CODEX_JS=<codex.js> node agent.js <commit> <com|sem>
const { spawn, execFileSync } = require('node:child_process'); const fs = require('node:fs');
const HERE = __dirname; const S = process.env.WORK; const [commit, mode] = process.argv.slice(2);
const node = process.env.CODEX_NODE || process.execPath;
const codex = process.env.CODEX_JS;
const find = require('node:path').join(HERE, '../../../vscode-extension/scripts/find.js');
const mission = JSON.parse(fs.readFileSync(HERE + '/missions.json', 'utf8'))[commit];
const root = `${S}/${mode === 'com' ? 'pre' : 'nocard'}-${commit}`;
let prompt = 'Atue como o mesmo agente desenvolvedor em uma medição de localização de código. Apenas leia; não altere arquivos. ' +
  'Identifique os arquivos que você abriria para implementar a missão abaixo. Use ferramentas de leitura para verificar os candidatos, ' +
  'mas pare antes de editar ou executar testes. No fim, responda somente JSON com "filesOpened" (caminhos relativos de arquivos ' +
  'realmente lidos) e "rationale" breve.\n\nMissão: ' + mission;
let card = '';
if (mode === 'com') { card = execFileSync('node', [find, '--root', root, mission], { encoding: 'utf8' }); prompt += '\n\n' + card; }
const started = Date.now();
const child = spawn(node, [codex, '--ask-for-approval', 'never', 'exec', '--json', '--ephemeral', '--skip-git-repo-check',
  '--sandbox', 'read-only', '-C', root, prompt], { stdio: ['ignore', 'pipe', 'ignore'] });
let raw = ''; child.stdout.on('data', chunk => { raw += chunk; });
child.on('close', code => {
  const events = raw.split('\n').filter(line => line.startsWith('{')).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const usage = events.filter(e => e.type === 'turn.completed').at(-1)?.usage || {};
  const done = events.filter(e => e.type === 'item.completed');
  const tools = done.filter(e => ['command_execution', 'tool_call', 'mcp_tool_call'].includes(e.item?.type));
  const text = done.filter(e => e.item?.type === 'agent_message').at(-1)?.item?.text || '';
  let files = [];
  try { files = JSON.parse(text.replace(/^[\s\S]*?```(?:json)?\s*/, '').replace(/\s*```[\s\S]*$/, '')).filesOpened || []; } catch {}
  const gold = fs.readFileSync(`${S}/gold-${commit}.txt`, 'utf8').split('\n').filter(p => /^(app|resources|routes|database|config)\//.test(p));
  const norm = files.map(f => String(f).replace(/^\.\//, '').replace(root + '/', ''));
  const hit = [...new Set(norm.filter(f => gold.includes(f)))];
  const out = { commit, mode, exit: code, seconds: Math.round((Date.now() - started) / 1000), inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens, outputTokens: usage.output_tokens, toolCalls: tools.length,
    filesOpened: norm.length, goldHits: hit.length, gold: gold.length, cardTokens: Math.ceil(Buffer.byteLength(card) / 4), files: norm, hit };
  fs.writeFileSync(`${S}/run-${commit}-${mode}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
});
