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

const form = document.querySelector('#forge-form');
const advancedFields = document.querySelector('#advanced-fields');
const permissionContainer = document.querySelector('#permission-fields');
const jsonEditor = document.querySelector('#json-editor');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const generateButton = document.querySelector('#generate-button');
const promptPreview = document.querySelector('#prompt-preview');
const downloadZip = document.querySelector('#download-zip');
let spec = blankSpec();
let currentMode = 'guided';
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
  document.querySelector('#guided-panel').hidden = mode !== 'guided';
  document.querySelector('#json-panel').hidden = mode !== 'json';
  for (const target of ['guided', 'json']) {
    const tab = document.querySelector(`#${target}-tab`);
    tab.classList.toggle('active', mode === target);
    tab.setAttribute('aria-selected', String(mode === target));
  }
  setStatus('Pronto para compilar.');
}
function slugify(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'agente';
}
function createPrompt(target, name) {
  const first = `Você recebeu o ZIP gerado pelo Nestor Forge para o agente "${name}". Extraia-o e leia spec.json, agent.md, agent.normalized.json, agent.derived.json e BUILD_REPORT.md antes de criar qualquer arquivo. Trate esses arquivos como fonte da especificação. Preserve missão, foco, limites, permissões e contrato de saída. Não invente capacidades. Não altere os arquivos originais do ZIP; coloque adaptações em arquivos novos. Ao final, mostre a árvore dos arquivos, explique como ativar o agente e confira se as regras de permissão permanecem consistentes.`;
  if (target === 'codex') {
    return `${first}\n\nCrie uma skill de projeto para Codex em .agents/skills/${slugify(name)}/SKILL.md, com metadados name e description, instruções de uso e referências aos arquivos originais. Crie também .codex/agents/${slugify(name)}.toml com name, description e developer_instructions, apontando para a skill. Se a especificação proibir alterações, configure o agente como read-only. Não modifique AGENTS.md global ou configurações fora do projeto. Valide os arquivos criados e apresente um exemplo de pedido para usar a skill e outro para delegar ao subagente.`;
  }
  return `${first}\n\nCrie um agente de projeto para Claude Code usando o formato de agentes suportado no ambiente atual. Organize as instruções em um arquivo de agente e referências modulares quando isso ajudar, sem perder nenhuma regra do ZIP. Use ferramentas e permissões compatíveis com a especificação, mantendo análise passiva por padrão se for o caso. Valide os arquivos criados e apresente um exemplo de pedido para acionar o agente no Claude Code. Se estiver apenas no chat do Claude, entregue a árvore e o conteúdo integral dos arquivos para salvar no projeto.`;
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
document.querySelector('#guided-tab').addEventListener('click', () => switchMode('guided'));
document.querySelector('#json-tab').addEventListener('click', () => switchMode('json'));
document.querySelector('#reset-json').addEventListener('click', () => {
  spec = blankSpec();
  jsonEditor.value = JSON.stringify(spec, null, 2);
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
