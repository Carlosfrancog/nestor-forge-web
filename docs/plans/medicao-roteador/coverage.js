'use strict';
// Uso: WORK=/tmp/medicao PROJECT=<projeto> node coverage.js  (cartão × arquivos do commit, sem agente)
const { execFileSync } = require('node:child_process'); const fs = require('node:fs');
const HERE = __dirname; const S = process.env.WORK; const find = require('node:path').join(HERE, '../../../vscode-extension/scripts/find.js');
const missions = JSON.parse(fs.readFileSync(HERE + '/missions.json', 'utf8'));
const relevant = p => /^(app|resources|routes|database|config)\//.test(p);
for (const [commit, mission] of Object.entries(missions)) {
  const gold = fs.readFileSync(`${S}/gold-${commit}.txt`, 'utf8').split('\n').filter(relevant);
  for (const [label, root] of [['antes', `${S}/pre-${commit}`], ['HEAD', process.env.PROJECT]]) {
    const r = JSON.parse(execFileSync('node', [find, '--root', root, '--json', mission], { encoding: 'utf8' }));
    const files = [...new Set(r.items.map(i => i.path))];
    const hit = files.filter(f => gold.includes(f));
    console.log(JSON.stringify({ commit, estado: label, gold: gold.length, itens: r.items.length, arquivos: files.length,
      acertos: hit.length, precisao: files.length ? +(hit.length / files.length).toFixed(2) : 0,
      cobertura: +(hit.length / gold.length).toFixed(2), tokens: Math.ceil(Buffer.byteLength(r.card) / 4),
      notas: r.notes.length, riscos: r.risks.length, files }));
  }
}
