'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { recipesFor } = require('./recipes');

const STOP = new Set(('a ao aos as o os de da do das dos e em no na nos nas um uma uns umas por para com sem que qual onde como ' +
  'corrigir ajuste ajustar quando sobre esta este isso is the a an of to for with in on at by from and or where how fix change').split(/\s+/));
function normalize(value) {
  return String(value || '').replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase();
}
function terms(value) { return normalize(value).split(/[^a-z0-9]+/).filter(token => token.length > 1 && !STOP.has(token)); }
// Glossário pt → en: as missões chegam em português e o código usa nomes em inglês.
const ALIASES = {
  metadados: 'metadata', metadado: 'metadata', painel: 'panel', busca: 'search', buscar: 'search',
  pesquisa: 'search', vazia: 'empty', vazio: 'empty', aviso: 'warning', pagina: 'page', tela: 'page',
  ficha: 'page', publica: 'site', publico: 'site', notificacao: 'notification', notificacoes: 'notification',
  mail: 'notification', email: 'notification', criar: ['create', 'created'], salvar: 'save', editar: 'edit',
  excluir: 'delete', remover: 'delete', itens: 'item', relacionados: 'related', relacionado: 'related',
  encontrado: 'found', resultados: 'result', resultado: 'result', valores: 'value', valor: 'value',
  mapa: 'map', coluna: 'column', colunas: 'column', guia: 'tab', aba: 'tab', links: 'link',
  coordenadas: 'coordinate', coordenada: 'coordinate', geolocalizacao: ['geo', 'location', 'coordinate'],
  filtros: 'filter', filtro: 'filter', facetas: 'facet', faceta: 'facet', colecao: 'collection',
  colecoes: 'collection', origem: 'source', autoridade: 'authority', autoridades: 'authority',
  tipo: 'type', tipos: 'type', campo: 'field', campos: 'field', opcoes: 'option', opcao: 'option',
  grupo: 'group', grupos: 'group', usuario: 'user', usuarios: 'user', permissao: 'permission',
  permissoes: 'permission', rota: 'route', rotas: 'route', arquivo: 'file', imagem: 'image', midia: 'media',
  comentario: 'comment', comentarios: 'comment', configuracao: 'config', importar: 'import',
  importacao: 'import', bloquear: 'lock', inicial: 'initial', configuravel: 'config',
};
function missionTerms(value) {
  return [...new Set(terms(value).flatMap(token => {
    const alias = ALIASES[token];
    const singular = token.length > 4 && token.endsWith('s') && !token.endsWith('ss') ? [token.slice(0, -1)] : [];
    // Termos do glossário entram também no plural: caminhos usam "pages", "filters"…
    const english = (Array.isArray(alias) ? alias : alias ? [alias] : []).flatMap(word => [word, `${word}s`]);
    return [token, ...singular, ...english];
  }))];
}
/**
 * Divide a missão em cláusulas (";", ":", ",", ". ", quebra de linha) para que cada pedido
 * ganhe sua própria âncora. Cláusulas com menos de dois termos se juntam à anterior.
 */
function clausesOf(mission) {
  const clauses = [];
  for (const part of String(mission || '').split(/[;:,\n]|\.(?:\s+|$)/)) {
    const query = missionTerms(part);
    if (!query.length) continue;
    if (query.length < 2 && clauses.length) clauses[clauses.length - 1] = [...new Set([...clauses.at(-1), ...query])];
    else clauses.push(query);
  }
  return clauses.slice(0, 4);
}
function estimate(value) { return Math.ceil(Buffer.byteLength(String(value), 'utf8') / 4); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function validPath(value) {
  return typeof value === 'string' && value !== '' && !value.includes('\\') && !value.includes('\0') &&
    !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
function makeContext(index, root, logic, schema) {
  const records = Array.isArray(index) ? index : index.records || [];
  const files = records.filter(item => item.kind === 'file' && validPath(item.path));
  const unitsByFile = new Map();
  for (const unit of records.filter(item => item.kind === 'unit' && validPath(item.path))) {
    if (!unitsByFile.has(unit.path)) unitsByFile.set(unit.path, []);
    unitsByFile.get(unit.path).push(unit);
  }
  const cache = new Map();
  function readLines(relative) {
    if (!root || !validPath(relative)) return null;
    if (cache.has(relative)) return cache.get(relative);
    const absolute = path.resolve(root, ...relative.split('/'));
    if (!absolute.startsWith(path.resolve(root) + path.sep)) return null;
    let lines = null;
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024) {
        lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/);
      }
    } catch { /* Arquivo mudou desde a criação do índice. */ }
    cache.set(relative, lines);
    return lines;
  }
  const pathFrequency = new Map();
  for (const file of files) for (const token of new Set(terms(file.path))) {
    pathFrequency.set(token, (pathFrequency.get(token) || 0) + 1);
  }
  // Termos presentes em muitos caminhos (item, admin, components…) não distinguem arquivos.
  const commonLimit = Math.max(20, files.length * 0.04);
  const common = new Set([...pathFrequency].filter(([, count]) => count > commonLimit).map(([token]) => token));
  return { root, records, files, unitsByFile, readLines, logic, schema, common, docs: null,
    languageByPath: new Map(files.map(file => [file.path, file.language])) };
}
const FIELD_WEIGHTS = { label: 3, calls: 2, summary: 1.5, path: 1, imports: 0.5 };
/** Tokeniza os documentos uma única vez, mesmo quando a missão tem várias cláusulas. */
function documents(ctx) {
  if (ctx.docs) return ctx.docs;
  ctx.docs = ctx.records.filter(record => ['unit', 'file', 'section'].includes(record.kind)).map(record => {
    const fields = [];
    let length = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      if (record.kind === 'section' && !['label', 'summary'].includes(field)) continue;
      const value = Array.isArray(record[field]) ? record[field].join(' ') : record[field] || '';
      const tokens = terms(value);
      length += tokens.length;
      fields.push([tokens, weight]);
    }
    return { record, fields, length };
  });
  return ctx.docs;
}
function lexicalScores(ctx, query) {
  const docs = documents(ctx);
  const wanted = new Set(query);
  const postings = new Map();
  let totalLength = 0;
  docs.forEach(({ fields, length }, index) => {
    const tf = new Map();
    for (const [tokens, weight] of fields) {
      for (const token of tokens) if (wanted.has(token)) tf.set(token, (tf.get(token) || 0) + weight);
    }
    totalLength += length;
    for (const [token, frequency] of tf) {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push({ index, frequency, length });
    }
  });
  const average = totalLength / (docs.length || 1) || 1;
  const scores = new Map();
  for (const token of wanted) {
    const posting = postings.get(token) || [];
    const idf = Math.log(1 + (docs.length - posting.length + 0.5) / (posting.length + 0.5));
    for (const item of posting) {
      const denominator = item.frequency + 1.2 * (1 - 0.75 + 0.75 * item.length / average);
      const increment = idf * item.frequency * 2.2 / denominator;
      const record = docs[item.index].record;
      scores.set(record.id, (scores.get(record.id) || 0) + increment);
    }
  }
  return scores;
}
const SOURCE_LANGUAGES = new Set(['PHP', 'Vue', 'JavaScript', 'TypeScript', 'Python', 'Go', 'CSS/Tailwind', 'PostgreSQL']);
function sourceEvidenceScores(ctx, scores, query) {
  const informative = [...new Set(query.filter(token => token.length >= 4 && !ctx.common.has(token)))];
  if (!informative.length) return;
  const fileScores = new Map();
  const sourceFiles = new Set(ctx.files.filter(file => SOURCE_LANGUAGES.has(file.language)).map(file => file.path));
  for (const record of ctx.records) {
    if (!record.path || !sourceFiles.has(record.path) || !scores.has(record.id) ||
      !['file', 'unit'].includes(record.kind)) continue;
    fileScores.set(record.path, Math.max(fileScores.get(record.path) || 0, scores.get(record.id)));
  }
  const rankedPaths = [...fileScores].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
    .slice(0, 80).map(([relative]) => relative);
  const namedPaths = ctx.files.filter(file => sourceFiles.has(file.path))
    .map(file => ({ path: file.path, overlap: terms(file.path).filter(token => query.includes(token)).length }))
    .filter(item => item.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap || compare(a.path, b.path))
    .slice(0, 40).map(item => item.path);
  const paths = [...new Set([...namedPaths, ...rankedPaths])];
  for (const relative of paths) {
    const lines = ctx.readLines(relative);
    if (!lines) continue;
    const pathOverlap = new Set(terms(relative).filter(token => query.includes(token))).size;
    const pathFactor = pathOverlap >= 2 ? 1 : pathOverlap === 1 ? 0.65 : 0.35;
    for (const unit of ctx.unitsByFile.get(relative) || []) {
      const start = unit.lines?.[0];
      const end = unit.lines?.[1];
      if (!start || !end || end - start > 80 || ['module', 'class'].includes(unit.unitKind)) continue;
      const snippet = lines.slice(Math.max(0, start - 5), end).join(' ');
      const found = new Set(terms(snippet));
      const overlap = informative.filter(token => found.has(token));
      if (!overlap.length) continue;
      const bonus = Math.min(16, overlap.length * 4);
      scores.set(unit.id, (scores.get(unit.id) || 0) + bonus * pathFactor);
    }
  }
}
/** Um passo pelo grafo: as unidades chamadas pelas 5 melhores e as seções da mesma camada. */
function expandByCalls(ctx, scores) {
  const units = ctx.records.filter(record => record.kind === 'unit');
  if (!ctx.nameMap) {
    ctx.nameMap = new Map();
    for (const unit of units) for (const token of terms(unit.label || '')) {
      if (!ctx.nameMap.has(token)) ctx.nameMap.set(token, []);
      ctx.nameMap.get(token).push(unit);
    }
  }
  const top = units.filter(unit => scores.has(unit.id)).sort((a, b) =>
    scores.get(b.id) - scores.get(a.id) || compare(a.id, b.id)).slice(0, 5);
  const boosts = new Map();
  for (const source of top) {
    const boost = scores.get(source.id) * 0.3;
    for (const call of (source.calls || []).slice(0, 40)) {
      const last = terms(call).at(-1);
      for (const target of (ctx.nameMap.get(last) || []).slice(0, 40)) {
        if (target.id !== source.id) boosts.set(target.id, (boosts.get(target.id) || 0) + boost);
      }
    }
    for (const section of ctx.records) if (section.kind === 'section' && source.module === section.module &&
      source.layer === section.layer) boosts.set(section.id, (boosts.get(section.id) || 0) + boost);
  }
  for (const [id, boost] of boosts) scores.set(id, (scores.get(id) || 0) + boost);
}
function queryScores(ctx, query) {
  const scores = lexicalScores(ctx, query);
  sourceEvidenceScores(ctx, scores, query);
  expandByCalls(ctx, scores);
  return scores;
}
function displayLabel(record) {
  const key = String(record.id || '').split('#').at(-1);
  if (record.kind === 'unit' && key.startsWith('method:')) {
    return key.slice(7).replace(/^.*\\/, '').replace(/\.([^.]*)$/, '::$1');
  }
  return record.label || path.posix.basename(record.path || '');
}
/** Candidatos de código de uma cláusula, do mais forte para o mais fraco. */
function lexicalCandidates(ctx, scores, query) {
  const overlap = value => new Set(terms(value).filter(token => query.includes(token))).size;
  const candidates = [];
  for (const record of ctx.records) {
    if (!['unit', 'file'].includes(record.kind) || !validPath(record.path) || !scores.has(record.id)) continue;
    if (ctx.languageByPath.get(record.path) === 'Markdown') continue;
    const lines = record.lines || [1, 1];
    const span = lines[1] - lines[0] + 1;
    const precision = (record.kind === 'file' ? 0.5 : span > 100 ? 0.65 : 1) *
      (/^tests?\//.test(record.path) ? 0.6 : 1);
    const pathBonus = Math.max(0, overlap(record.path) - 1) * 14 *
      (record.kind === 'file' ? 0.5 : ['class', 'module'].includes(record.unitKind) ? 0.6 : 1);
    candidates.push({ path: record.path, lines, label: displayLabel(record), module: record.module,
      layer: record.layer, score: scores.get(record.id) * precision + pathBonus, recipe: false });
  }
  return candidates.sort((a, b) => b.score - a.score || compare(a.path, b.path) || a.lines[0] - b.lines[0]);
}
/**
 * Acertos de receitas. Uma entidade que casa com muitos arquivos não distingue nada: o peso
 * cai na proporção e o acerto deixa de ter prioridade sobre a busca lexical.
 */
function recipeCandidates(ctx, mission, recipeList) {
  const direct = new Map();
  const used = [];
  for (const recipe of recipeList) {
    const entities = [...new Set(recipe.detect(mission, ctx) || [])].slice(0, 30);
    let count = 0;
    for (const entity of entities) {
      const hits = (recipe.resolve(entity, ctx) || []).slice(0, Math.max(0, 200 - count))
        .filter(hit => hit.path && validPath(hit.path));
      count += hits.length;
      const spread = new Set(hits.map(hit => hit.path)).size;
      const discriminative = spread <= 6;
      for (const hit of hits) {
        const record = hit.record || {};
        const lines = hit.lines || record.lines || [1, 1];
        const key = `${hit.path}:${lines[0]}:${lines[1]}`;
        const weight = discriminative ? hit.weight : hit.weight * 6 / spread;
        const current = direct.get(key);
        if (current && current.score >= weight) continue;
        direct.set(key, { path: hit.path, lines, label: displayLabel(record) || hit.evidence, module: record.module,
          layer: record.layer, score: weight, recipe: discriminative, evidence: hit.evidence });
      }
      if (count >= 200) break;
    }
    if (count) used.push(`${recipe.label}${entities.length ? ` ${entities.slice(0, 2).join(', ')}` : ''}`);
  }
  return { hits: [...direct.values()], used };
}
function renderRouteCard(result) {
  const lines = ['## Rota para a missão', `> ${result.mission}`, ''];
  if (result.items.length) {
    lines.push('**Comece por** (ordem sugerida):');
    result.items.forEach((item, index) => lines.push(`${index + 1}. \`${item.path}:${item.lines[0]}-${item.lines[1]}\` — ${item.label}${item.layer ? ` · camada ${item.layer}` : ''}`));
  } else {
    lines.push('**Comece por:** nenhuma rota forte; comece por `graphify-out/vault-modules/CONTEXTO/_Mapa contextual.md`.');
  }
  if (result.notes.length) {
    lines.push('', '**Leia antes** (notas contextuais):');
    for (const note of result.notes) lines.push(`- \`${note.path}\` § ${note.label} (l. ${note.lines[0]}-${note.lines[1]})`);
  }
  if (result.risks.length) {
    lines.push('', '**Riscos já registrados:**');
    for (const risk of result.risks) lines.push(`- ${risk}`);
  }
  if (result.recipesUsed.length) lines.push('', `**Receitas usadas:** ${result.recipesUsed.join(', ')}.`);
  const limits = [`índice da revisão ${result.revision ? String(result.revision).slice(0, 7) : 'desconhecida'}`];
  if (result.classificationStale) limits.push('classificação defasada; rode `bash graphy-refat/run.sh all`');
  else if (result.classificationPresent) limits.push('classificação em dia');
  if (!result.notes.length && result.items.length) limits.push('sem notas contextuais para esta rota');
  limits.push('abra só as faixas citadas; amplie com grep se faltar algo');
  lines.push('', `**Limites:** ${limits.join('; ')}.`);
  return lines.join('\n') + '\n';
}
/**
 * Escolhe os trechos de código alternando entre as listas (receitas fortes primeiro, depois
 * uma por cláusula), para que cada pedido da missão tenha ao menos uma âncora. Trechos a até
 * 10 linhas de distância no mesmo arquivo se fundem; cada arquivo entra no máximo duas vezes.
 * Os acertos de receitas fortes entram antes de qualquer acerto lexical.
 */
function selectItems(pools, maxCode, chosen = []) {
  const cursors = pools.map(() => 0);
  const leads = pools.map(pool => pool[0]?.score || 0);
  let progressed = true;
  while (chosen.length < maxCode && progressed) {
    progressed = false;
    for (let index = 0; index < pools.length && chosen.length < maxCode; index++) {
      const pool = pools[index];
      while (cursors[index] < pool.length) {
        const item = pool[cursors[index]++];
        if (!item.recipe && item.score < leads[index] * 0.45) { cursors[index] = pool.length; break; }
        const neighbor = chosen.find(other => other.path === item.path &&
          item.lines[0] <= other.lines[1] + 10 && item.lines[1] >= other.lines[0] - 10);
        if (neighbor) {
          if (neighbor.recipe && !item.recipe && item.lines[0] <= neighbor.lines[0] &&
            item.lines[1] >= neighbor.lines[1]) continue;
          neighbor.lines = [Math.min(neighbor.lines[0], item.lines[0]), Math.max(neighbor.lines[1], item.lines[1])];
          if (item.recipe && !neighbor.recipe) { neighbor.recipe = true; neighbor.label = item.label; }
          continue;
        }
        if (chosen.filter(other => other.path === item.path).length >= 2) continue;
        chosen.push({ ...item, lines: [...item.lines] });
        progressed = true;
        break;
      }
    }
  }
  return chosen;
}
function route(index, mission, options = {}) {
  const root = options.root || null;
  const meta = Array.isArray(index) ? {} : index.meta || {};
  const ctx = makeContext(index, root, options.logic, options.schema);
  const query = missionTerms(mission);
  const clauses = clausesOf(mission);
  const recipeList = options.recipes || recipesFor(options.classification?.data?.profile ||
    options.classification?.profile || meta.classification?.profile || meta.profile);
  const recipes = recipeCandidates(ctx, mission, recipeList);
  const strongRecipes = recipes.hits.filter(hit => hit.recipe)
    .sort((a, b) => b.score - a.score || compare(a.path, b.path) || a.lines[0] - b.lines[0]);
  const weakRecipes = recipes.hits.filter(hit => !hit.recipe);
  const scores = queryScores(ctx, query);
  const clausePools = (clauses.length > 1 ? clauses : [query]).map(clause => {
    // Cláusula curta perde o assunto da missão ("fechar o modal ao salvar"): uma fração da nota
    // da missão inteira mantém a cláusula no mesmo tema.
    const clauseScores = clauses.length > 1 ? queryScores(ctx, clause) : scores;
    if (clauses.length > 1) {
      for (const [id, value] of clauseScores) clauseScores.set(id, value + 0.35 * (scores.get(id) || 0));
    }
    const pool = lexicalCandidates(ctx, clauseScores, clause);
    for (const hit of weakRecipes) {
      const same = pool.find(item => item.path === hit.path && item.lines[0] === hit.lines[0] && item.lines[1] === hit.lines[1]);
      if (same) same.score += hit.score;
    }
    return pool.sort((a, b) => b.score - a.score || compare(a.path, b.path) || a.lines[0] - b.lines[0]);
  });
  const pools = clausePools.filter(pool => pool.length);
  const limit = Math.max(0, options.limit ?? 8);
  const maxCode = Math.min(limit, 2 * clausePools.length + (strongRecipes.length ? 2 : 1));
  const chosen = selectItems(pools, maxCode, selectItems([strongRecipes], maxCode));

  const sections = ctx.records.filter(record => record.kind === 'section' && validPath(record.path));
  const noteScore = section => (scores.get(section.id) || 0) +
    (chosen.some(item => item.module === section.module && item.layer === section.layer) ? 2 : 0) +
    (chosen.some(item => item.module === section.module) ? 0.5 : 0);
  const rankedSections = sections.filter(section => noteScore(section) > 0)
    .sort((a, b) => noteScore(b) - noteScore(a) || compare(a.id, b.id));
  const selectedSections = [];
  const selectedPaths = new Set();
  const maxNotes = Math.min(4, clausePools.length + 1);
  for (const item of chosen) {
    if (selectedSections.length >= maxNotes) break;
    const section = rankedSections.find(value => value.module === item.module && value.layer === item.layer &&
      !selectedPaths.has(value.path));
    if (!section) continue;
    selectedSections.push(section);
    selectedPaths.add(section.path);
  }
  const notes = selectedSections.map(section => ({ path: section.path, lines: section.lines, label: section.label,
    module: section.module, layer: section.layer }));
  const riskSections = sections.filter(section => notes.some(note => note.path === section.path &&
    note.lines[0] === section.lines[0]) ||
    (/^(riscos e pendencias|pontos de extensao e riscos)$/i.test(normalize(section.label)) &&
      chosen.some(item => item.module === section.module && item.layer === section.layer)));
  const labelTerms = chosen.map(item => new Set(terms(item.label || '')));
  const risks = [...new Set(riskSections.flatMap(section => section.warnings || []))]
    .filter(warning => {
      const tokens = new Set(terms(warning));
      const queryHits = query.filter(token => tokens.has(token)).length;
      return labelTerms.some(label => {
        const labelHits = [...label].filter(token => tokens.has(token)).length;
        return labelHits >= 2 || (labelHits >= 1 && queryHits >= 2);
      });
    }).slice(0, 3);
  const result = { mission: String(mission || '').replace(/\s+/g, ' ').trim(), items: chosen, notes, risks,
    recipesUsed: recipes.used, warnings: [], revision: meta.revision || null,
    classificationPresent: Boolean(meta.classification?.present),
    classificationStale: Boolean(meta.classification?.stale) };
  if (result.classificationStale) result.warnings.push('classification-stale');
  if (!result.items.length) result.warnings.push('no-strong-route');
  const budget = Math.max(100, options.budgetTokens ?? 1200);
  result.card = renderRouteCard(result);
  while (estimate(result.card) > budget) {
    if (result.risks.length) result.risks.pop();
    else if (result.notes.length) result.notes.pop();
    else if (result.items.length) result.items.pop();
    else if (result.recipesUsed.length) result.recipesUsed.pop();
    else if (result.mission.length) result.mission = result.mission.slice(0, Math.max(0, result.mission.length - 50));
    else break;
    result.card = renderRouteCard(result);
  }
  return result;
}

module.exports = { route, renderRouteCard, normalize, terms, estimate, clausesOf };
