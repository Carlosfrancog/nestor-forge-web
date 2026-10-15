const listFields = {
  focus: 'Focos', analysis_pipeline: 'Etapas de análise', technologies: 'Tecnologias',
  behavior: 'Comportamento', principles: 'Princípios', context_rules: 'Regras de contexto',
  decision_order: 'Ordem de decisão', domain_rules: 'Regras do domínio', tools: 'Ferramentas',
  code_rules: 'Regras sobre código', validation_rules: 'Validação',
  response_sections: 'Seções da resposta', final_rules: 'Regras finais'
};
const detailFields = [
  'analysis_pipeline', 'principles', 'context_rules', 'decision_order', 'domain_rules',
  'tools', 'code_rules', 'validation_rules', 'final_rules'
];
const permissionFields = {
  read_code: 'Ler código', run_analysis_tools: 'Executar ferramentas de análise',
  run_active_tests: 'Executar testes ativos no escopo autorizado',
  write_code: 'Gerar ou alterar código', modify_business_rules: 'Alterar regras de negócio',
  modify_database: 'Alterar banco ou schema'
};
const blankSpec = () => ({
  profile: 'reader', name: '', role: '', mission: '',
  ...Object.fromEntries(Object.keys(listFields).map(key => [key, []])),
  output_contract: { preferred: 'markdown', required_fields: [] },
  permissions: {
    read_code: true, run_analysis_tools: true, run_active_tests: false,
    write_code: false, modify_business_rules: false, modify_database: false
  }
});

const quickPresets = {
  explore: {
    profile: 'reader', name: 'Leitor de Projeto',
    role: 'analisar a estrutura e os fluxos de um projeto de software',
    mission: 'entregar um mapa verificável do projeto para orientar as próximas tarefas',
    focus: ['Identificar pontos de entrada', 'Mapear módulos e fluxos relevantes', 'Apontar lacunas de contexto'],
    behavior: ['Direto', 'Baseado em evidências'],
    analysis_pipeline: ['Ler documentação e estrutura', 'Seguir fluxos relevantes', 'Citar arquivos e símbolos'],
    response_sections: ['Resumo', 'Mapa do projeto', 'Evidências', 'Próximas leituras']
  },
  review: {
    profile: 'reviewer', name: 'Revisor de Código',
    role: 'revisar alterações de código com foco em correção e riscos',
    mission: 'identificar problemas concretos e explicar seu impacto com evidências',
    focus: ['Verificar comportamento alterado', 'Identificar regressões', 'Priorizar achados'],
    behavior: ['Objetivo', 'Baseado em evidências'],
    analysis_pipeline: ['Delimitar as mudanças', 'Rastrear os fluxos afetados', 'Validar cada achado'],
    response_sections: ['Achados', 'Evidências', 'Riscos', 'Lacunas']
  },
  build: {
    profile: 'coder', name: 'Implementador',
    role: 'implementar mudanças de código com atenção à manutenção',
    mission: 'entregar uma mudança funcional e verificar seu comportamento no escopo autorizado',
    focus: ['Entender a tarefa', 'Implementar a menor mudança coerente', 'Validar o resultado'],
    behavior: ['Prático', 'Cuidadoso', 'Claro'],
    analysis_pipeline: ['Ler o fluxo atual', 'Implementar a mudança', 'Executar validações proporcionais'],
    response_sections: ['Mudanças', 'Validação', 'Limitações'],
    permissions: { write_code: true }
  },
  plan: {
    profile: 'planner', name: 'Planejador Técnico',
    role: 'organizar trabalho técnico em etapas executáveis',
    mission: 'produzir um plano com dependências, riscos e critérios de conclusão',
    focus: ['Definir escopo', 'Ordenar dependências', 'Antecipar riscos'],
    behavior: ['Claro', 'Baseado em evidências'],
    analysis_pipeline: ['Confirmar objetivo e restrições', 'Identificar dependências', 'Definir etapas e validação'],
    response_sections: ['Objetivo', 'Etapas', 'Dependências', 'Riscos', 'Critérios de conclusão']
  }
};

const form = document.querySelector('#forge-form');
const advancedFields = document.querySelector('#advanced-fields');
const permissionContainer = document.querySelector('#permission-fields');
const jsonEditor = document.querySelector('#json-editor');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const generateButton = document.querySelector('#generate-button');
const promptPreview = document.querySelector('#prompt-preview');
const downloadZip = document.querySelector('#download-zip');
const helpToggle = document.querySelector('#help-toggle');
const quickHelp = document.querySelector('#quick-help');
const applyPresetButton = document.querySelector('#apply-preset');
let spec = blankSpec();
let currentMode = 'guided';
let selectedPreset = null;
let objectUrl = null;
let worker = null;

function buildForm() {
  for (const key of detailFields) {
    const label = document.createElement('label');
    label.className = 'field';
    label.innerHTML = `<span>${listFields[key]} <small>um por linha</small></span><textarea name="${key}" rows="3"></textarea>`;
    advancedFields.append(label);
  }
  for (const [key, title] of Object.entries(permissionFields)) {
    const label = document.createElement('label');
    label.className = 'switch';
    label.innerHTML = `<input type="checkbox" name="${key}"><span>${title}</span>`;
    permissionContainer.append(label);
  }
}

function lines(value) {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}
function putForm(data) {
  for (const key of ['profile', 'name', 'role', 'mission']) form.elements[key].value = data[key] ?? '';
  for (const key of Object.keys(listFields)) {
    const value = data[key];
    form.elements[key].value = Array.isArray(value) ? value.join('\n') : '';
  }
  form.elements.output_format.value = data.output_contract?.preferred || 'markdown';
  form.elements.required_fields.value = (data.output_contract?.required_fields || []).join('\n');
  for (const key of Object.keys(permissionFields)) {
    form.elements[key].checked = Boolean(data.permissions?.[key]);
  }
}
function getForm() {
  const next = structuredClone(spec);
  for (const key of ['profile', 'name', 'role', 'mission']) next[key] = form.elements[key].value.trim();
  for (const key of Object.keys(listFields)) next[key] = lines(form.elements[key].value);
  next.output_contract = {
    ...(next.output_contract || {}), preferred: form.elements.output_format.value,
    required_fields: lines(form.elements.required_fields.value)
  };
  next.permissions = { ...(next.permissions || {}) };
  for (const key of Object.keys(permissionFields)) next.permissions[key] = form.elements[key].checked;
  return next;
}
function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}
function setHelp(open) {
  quickHelp.hidden = !open;
  helpToggle.setAttribute('aria-expanded', String(open));
  helpToggle.classList.toggle('active', open);
}
function updateProgress() {
  let draft;
  try { draft = currentMode === 'guided' ? getForm() : JSON.parse(jsonEditor.value); }
  catch { draft = {}; }
  const count = ['name', 'role', 'mission'].filter(key => typeof draft?.[key] === 'string' && draft[key].trim()).length;
  document.querySelector('#progress-label').textContent = `${count} de 3`;
  document.querySelector('#progress-fill').style.width = `${count / 3 * 100}%`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow', String(count));
}
function applyQuickPreset() {
  if (!selectedPreset) return;
  const current = getForm();
  const template = quickPresets[selectedPreset];
  const preset = { ...blankSpec(), ...structuredClone(template), permissions: { ...blankSpec().permissions, ...template.permissions } };
  const untouched = ['name', 'role', 'mission', ...Object.keys(listFields)].every(key =>
    Array.isArray(current[key]) ? current[key].length === 0 : !current[key]);
  const replace = document.querySelector('#replace-existing').checked || untouched;
  if (replace) {
    spec = preset;
  } else {
    spec = current;
    for (const key of ['name', 'role', 'mission', ...Object.keys(listFields)]) {
      if (Array.isArray(spec[key]) ? spec[key].length === 0 : !spec[key]) spec[key] = structuredClone(preset[key]);
    }
  }
  putForm(spec);
  result.hidden = true;
  updateProgress();
  setHelp(false);
  document.querySelector('#help-feedback').textContent = replace ? 'Modelo aplicado ao formulário.' : 'Campos vazios preenchidos; perfil e permissões mantidos.';
  setStatus('Modelo aplicado. Revise os campos e compile o pacote.');
  form.elements.name.focus();
}
function switchMode(mode) {
  if (mode === currentMode) return;
  if (currentMode === 'guided') {
    spec = getForm();
    jsonEditor.value = JSON.stringify(spec, null, 2);
  } else {
    try {
      const parsed = JSON.parse(jsonEditor.value);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('A raiz deve ser um objeto JSON.');
      spec = parsed;
      putForm(spec);
    } catch (error) {
      setStatus(`Corrija o JSON antes de voltar: ${error.message}`, true);
      jsonEditor.focus();
      return;
    }
  }
  currentMode = mode;
  if (mode === 'json') setHelp(false);
  document.querySelector('#guided-panel').hidden = mode !== 'guided';
  document.querySelector('#json-panel').hidden = mode !== 'json';
  for (const target of ['guided', 'json']) {
    const tab = document.querySelector(`#${target}-tab`);
    tab.classList.toggle('active', mode === target);
    tab.setAttribute('aria-selected', String(mode === target));
  }
  setStatus('Pronto para compilar.');
  updateProgress();
}
function slugify(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'agente';
}
function createPrompt(target, name) {
  if (target === 'codex') {
    const first = `Você recebeu o ZIP gerado pelo Nestor Forge para o agente "${name}". Extraia-o e leia spec.json, agent.md, agent.normalized.json, agent.derived.json e BUILD_REPORT.md antes de criar qualquer arquivo. Trate esses arquivos como fonte da especificação. Preserve missão, foco, limites, permissões e contrato de saída. Não invente capacidades. Não altere os arquivos originais do ZIP; coloque adaptações em arquivos novos. Ao final, mostre a árvore dos arquivos, explique como ativar o agente e confira se as regras de permissão permanecem consistentes.`;
    return `${first}\n\nCrie uma skill de projeto para Codex em .agents/skills/${slugify(name)}/SKILL.md, com metadados name e description, instruções de uso e referências aos arquivos originais. Crie também .codex/agents/${slugify(name)}.toml com name, description e developer_instructions, apontando para a skill. Se a especificação proibir alterações, configure o agente como read-only. Não modifique AGENTS.md global ou configurações fora do projeto. Valide os arquivos criados e apresente um exemplo de pedido para usar a skill e outro para delegar ao subagente.`;
  }
  if (target === 'unified') {
    const slug = slugify(name);
    return `O ZIP contém um pacote de projeto para Claude Code e Codex. Extraia o conteúdo na raiz do repositório, preservando as pastas .agents, .claude e .codex. A instrução central está em .agents/skills/${slug}/SKILL.md; .agents/routes/${slug}.toml registra os caminhos gerados pela Forja. O Codex descobre a skill em .agents/skills e o agente em .codex/agents; o Claude Code usa os adaptadores em .claude/skills e .claude/agents. Revise esses arquivos antes de usar e preserve as permissões descritas na instrução central.`;
  }
  const slug = slugify(name);
  return `O ZIP do Nestor Forge já contém um plugin Claude para "${name}", com manifesto, skill e subagente. Extraia e revise os arquivos antes de instalar. No Claude Cowork, use Customize > Plugins para enviar o ZIP. No Claude Code, valide com \`claude plugin validate ./caminho/${slug}\` e teste com \`claude --plugin-dir ./caminho/${slug}\`. A skill pode ser chamada com \`/${slug}:${slug}\`; o subagente pode ser acionado com \`@agent-${slug}:${slug}\`. Preserve as permissões descritas nas instruções.`;
}
function validate(data) {
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('A especificação deve ser um objeto JSON.');
  for (const key of ['name', 'role', 'mission']) {
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`Preencha ${key === 'name' ? 'o nome' : key === 'role' ? 'o papel' : 'a missão'} do agente.`);
  }
  for (const key of Object.keys(listFields)) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(value => typeof value !== 'string'))) {
      throw new Error(`O campo ${key} deve ser uma lista de textos.`);
    }
  }
  if (data.output_contract?.preferred && !['markdown', 'json'].includes(data.output_contract.preferred)) {
    throw new Error('O formato de saída deve ser markdown ou json.');
  }
}
function showResult(bytes, prompt, name) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  downloadZip.href = objectUrl;
  downloadZip.download = `nestor-forge-${slugify(name)}.zip`;
  promptPreview.value = prompt;
  document.querySelector('#result-size').textContent = `${Math.max(1, Math.ceil(bytes.byteLength / 1024))} KB`;
  result.hidden = false;
  setStatus('Compilação concluída. Baixe o ZIP e copie o prompt.');
}
function startWorker() {
  if (worker) return worker;
  worker = new Worker('./forge-worker.js', { type: 'module' });
  worker.onerror = event => {
    setStatus(`Não foi possível iniciar o compilador: ${event.message || 'erro desconhecido'}`, true);
    generateButton.disabled = false;
    worker.terminate(); worker = null;
  };
  worker.onmessage = ({ data }) => {
    if (data.type === 'status') setStatus(data.message);
    if (data.type === 'done') {
      showResult(data.bytes, data.prompt, data.name);
      generateButton.disabled = false;
    }
    if (data.type === 'error') {
      setStatus(data.message, true);
      generateButton.disabled = false;
    }
  };
  return worker;
}

buildForm();
putForm(spec);
updateProgress();
document.querySelector('#guided-tab').addEventListener('click', () => switchMode('guided'));
document.querySelector('#json-tab').addEventListener('click', () => switchMode('json'));
helpToggle.addEventListener('click', () => {
  if (currentMode === 'json') switchMode('guided');
  if (currentMode !== 'guided') return;
  setHelp(quickHelp.hidden);
  if (!quickHelp.hidden) quickHelp.querySelector('.preset-card').focus();
});
document.querySelector('#help-close').addEventListener('click', () => { setHelp(false); helpToggle.focus(); });
for (const card of quickHelp.querySelectorAll('.preset-card')) {
  card.addEventListener('click', () => {
    selectedPreset = card.dataset.preset;
    quickHelp.querySelectorAll('.preset-card').forEach(item => {
      const selected = item === card;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    applyPresetButton.disabled = false;
  });
}
applyPresetButton.addEventListener('click', applyQuickPreset);
form.addEventListener('input', () => { result.hidden = true; updateProgress(); });
form.addEventListener('change', () => { result.hidden = true; updateProgress(); });
jsonEditor.addEventListener('input', () => { result.hidden = true; updateProgress(); });
document.querySelector('#reset-json').addEventListener('click', () => {
  spec = blankSpec();
  jsonEditor.value = JSON.stringify(spec, null, 2);
  result.hidden = true;
  updateProgress();
  setStatus('Especificação limpa.');
});
document.querySelector('#json-upload').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    validate(parsed);
    spec = parsed;
    jsonEditor.value = JSON.stringify(spec, null, 2);
    result.hidden = true;
    updateProgress();
    setStatus(`Arquivo ${file.name} importado.`);
  } catch (error) { setStatus(`Não foi possível importar: ${error.message}`, true); }
  event.target.value = '';
});
for (const option of document.querySelectorAll('.destination-option')) {
  option.addEventListener('change', () => {
    document.querySelectorAll('.destination-option').forEach(node => node.classList.toggle('selected', node.querySelector('input').checked));
    result.hidden = true;
    setStatus('Destino atualizado. Gere um novo pacote.');
  });
}
generateButton.addEventListener('click', () => {
  try {
    const data = currentMode === 'guided' ? getForm() : JSON.parse(jsonEditor.value);
    validate(data);
    spec = data;
    result.hidden = true;
    generateButton.disabled = true;
    setStatus('Preparando o compilador Python…');
    const target = document.querySelector('input[name="target"]:checked').value;
    startWorker().postMessage({ type: 'generate', spec: data, prompt: createPrompt(target, data.name), target, slug: slugify(data.name) });
  } catch (error) {
    setStatus(`Verifique a especificação: ${error.message}`, true);
  }
});
document.querySelector('#copy-prompt').addEventListener('click', async event => {
  try {
    await navigator.clipboard.writeText(promptPreview.value);
    event.target.textContent = 'Copiado ✓';
    setTimeout(() => { event.target.textContent = 'Copiar'; }, 2000);
  } catch { promptPreview.select(); setStatus('Selecione e copie o prompt.'); }
});
