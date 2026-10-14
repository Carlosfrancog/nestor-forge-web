'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = [
  { id: 'codexAgents', label: 'Agentes Codex', entries: [['.codex', 'agents']], extension: '.toml' },
  { id: 'claudeAgents', label: 'Agentes Claude', entries: [['.claude', 'agents']], extension: '.md' },
  { id: 'skills', label: 'Skills', entries: [['.agents', 'skills'], ['.codex', 'skills'], ['.claude', 'skills']], skill: true },
  { id: 'scripts', label: 'Scripts de skills', entries: [['.agents', 'skills'], ['.codex', 'skills'], ['.claude', 'skills']], scripts: true },
  { id: 'routes', label: 'Rotas da Forja', entries: [['.agents', 'routes']], extension: '.toml' },
  { id: 'specs', label: 'Especificações da Forja', entries: [['.agentorchestra', 'specs']], extension: '.json' },
  { id: 'instructions', label: 'Instruções', files: ['AGENTS.md', 'CLAUDE.md'] }
];

function safeEntries(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') return [];
    throw error;
  }
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') return false;
    throw error;
  }
}

function collect(root, category) {
  const files = [];
  if (category.files) {
    for (const name of category.files) {
      const file = path.join(root, name);
      if (isFile(file)) files.push({ file, label: name, category: category.id });
    }
    return files;
  }
  for (const parts of category.entries) {
    const directory = path.join(root, ...parts);
    for (const entry of safeEntries(directory)) {
      if (category.scripts) {
        if (!entry.isDirectory()) continue;
        const skillRoot = path.join(directory, entry.name);
        const documentation = path.join(skillRoot, 'SKILL.md');
        for (const script of safeEntries(path.join(skillRoot, 'scripts'))) {
          if (!script.isFile() || !/\.(py|js|mjs|cjs|sh|ps1|go)$/i.test(script.name)) continue;
          files.push({ file: path.join(skillRoot, 'scripts', script.name), label: `${entry.name} / ${script.name}`, category: category.id,
            documentation: isFile(documentation) ? documentation : null });
        }
      } else if (category.skill) {
        if (!entry.isDirectory()) continue;
        const file = path.join(directory, entry.name, 'SKILL.md');
        if (isFile(file)) files.push({ file, label: entry.name, category: category.id });
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(category.extension)) {
        files.push({ file: path.join(directory, entry.name), label: path.parse(entry.name).name, category: category.id });
      }
    }
  }
  return files.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR') || a.file.localeCompare(b.file));
}

function discover(workspaces, home, includeUser = true, builtIn = null) {
  const roots = workspaces.map(({ name, path: root }) => ({ name, path: root, scope: 'workspace' }));
  if (includeUser && home) roots.push({ name: 'Instalação do usuário', path: home, scope: 'user' });
  return roots.map(root => ({
    ...root,
    groups: CATEGORIES.map(category => ({
      id: category.id,
      label: category.label,
      items: category.id === 'scripts' && root.scope === 'workspace' && builtIn
        ? [...collect(root.path, category), { file: builtIn.file, label: 'Analisar diff estrutural', category: 'scripts', documentation: builtIn.documentation, builtIn: true }]
        : collect(root.path, category)
    })).filter(group => group.items.length > 0)
  })).filter(root => root.groups.length > 0);
}

const TEMPLATES = {
  claudeAgent: { label: 'Agente Claude (.claude/agents)', parts: ['.claude', 'agents'], file: name => `${name}.md`, body: name => `---\nname: ${name}\ndescription: Descreva quando usar este agente.\n---\n\n# ${name}\n\nDescreva a missão e as instruções do agente.\n` },
  codexAgent: { label: 'Agente Codex (.codex/agents)', parts: ['.codex', 'agents'], file: name => `${name}.toml`, body: name => `name = "${name}"\ndescription = "Descreva quando usar este agente."\ndeveloper_instructions = "Descreva a missão e as instruções do agente."\n` },
  sharedSkill: { label: 'Skill compartilhada (.agents/skills)', parts: ['.agents', 'skills'], file: name => path.join(name, 'SKILL.md'), body: name => `---\nname: ${name}\ndescription: Descreva quando usar esta skill.\n---\n\n# ${name}\n\nDescreva o procedimento desta skill.\n` }
};

function createFile(root, kind, name) {
  if (!Object.hasOwn(TEMPLATES, kind)) throw new Error('Tipo de artefato desconhecido.');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Use letras minúsculas, números e hífens; comece com uma letra.');
  const template = TEMPLATES[kind];
  const file = path.join(root, ...template.parts, template.file(name));
  let parent = root;
  for (const part of [...template.parts, ...path.dirname(template.file(name)).split(path.sep).filter(value => value !== '.')]) {
    parent = path.join(parent, part);
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('O caminho contém um link simbólico.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, template.body(name), { flag: 'wx', encoding: 'utf8' });
  return file;
}

module.exports = { CATEGORIES, TEMPLATES, discover, createFile };
