'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PRESETS = Object.freeze([
  { id: 'mission', label: 'Executar missão', detail: 'Tarefa livre para o agente selecionado', needsTask: true,
    instruction: 'Execute a missão descrita pelo desenvolvedor. Confirme o resultado com evidências e indique limites.' },
  { id: 'diff', label: 'Revisar alterações', detail: 'Analisa o diff atual e prioriza problemas reais',
    instruction: 'Revise o diff atual em relação a HEAD, incluindo arquivos ainda não rastreados. Identifique problemas verificáveis, cite arquivo e linha e ordene por impacto. Não altere arquivos sem pedido explícito.' },
  { id: 'bug', label: 'Investigar e corrigir bug', detail: 'Reproduz, corrige e valida o defeito', needsTask: true,
    instruction: 'Reproduza o problema descrito, identifique a causa, aplique a menor correção coerente e valide com testes relevantes.' },
  { id: 'tests', label: 'Criar testes', detail: 'Cobre o comportamento alterado',
    instruction: 'Inspecione as mudanças atuais e crie testes que cubram comportamentos relevantes e riscos reais. Execute os testes afetados e reporte o resultado.' },
  { id: 'docs', label: 'Documentar mudanças', detail: 'Atualiza instruções e exemplos de uso',
    instruction: 'Inspecione as mudanças atuais, atualize a documentação de uso afetada e verifique que exemplos e comandos correspondem ao código.' },
  { id: 'security', label: 'Auditar segurança', detail: 'Análise passiva com evidências',
    instruction: 'Faça uma análise de segurança passiva do escopo indicado. Não execute testes ativos nem acesse serviços externos sem autorização. Relate evidências, impacto e incertezas.' }
]);

function platformFor(category) {
  if (category === 'claudeAgents') return 'claude';
  if (category === 'codexAgents') return 'codex';
  throw new Error('Selecione um agente Claude ou Codex.');
}

function agentName(item) {
  const fallback = path.parse(item.file).name;
  const source = fs.readFileSync(item.file, 'utf8');
  let match;
  if (item.category === 'claudeAgents' && source.startsWith('---')) {
    const frontmatter = source.split('---', 3)[1] || '';
    match = frontmatter.match(/^name:\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
  } else if (item.category === 'codexAgents') {
    match = source.match(/^name\s*=\s*["']([^"'\r\n]+)["']/m);
  }
  const name = (match?.[1] || fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)) throw new Error(`Nome de agente inválido: ${name}`);
  return name;
}

function buildPrompt(platform, name, preset, task) {
  const detail = String(task || '').trim();
  if (preset.needsTask && !detail) throw new Error('Descreva a tarefa antes de iniciar o agente.');
  const delegation = platform === 'codex'
    ? `Use o subagente personalizado "${name}" deste projeto para executar esta tarefa. Aguarde o resultado e apresente as evidências.`
    : `Execute esta tarefa como o agente "${name}" selecionado para a sessão.`;
  return [delegation, preset.instruction, detail && `Contexto do desenvolvedor: ${detail}`].filter(Boolean).join('\n\n');
}

function cliArgs(platform, name, prompt, cwd) {
  return platform === 'claude' ? ['--agent', name, prompt] : ['--cd', cwd, prompt];
}

module.exports = { PRESETS, platformFor, agentName, buildPrompt, cliArgs };
