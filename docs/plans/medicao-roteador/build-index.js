'use strict';
// Constrói o índice de contexto de um diretório (sem a extensão do VS Code).
const os = require('node:os'); const path = require('node:path');
const ext = process.env.EXT;
const { scanProject } = require(path.join(ext, 'src/projectMap'));
const { readClassification } = require(path.join(ext, 'src/graphyClassification'));
const { buildContextIndex, writeContextIndex } = require(path.join(ext, 'src/contextIndex'));
(async () => {
  const root = path.resolve(process.argv[2]);
  const report = await scanProject(root, { cacheDir: path.join(os.tmpdir(), 'agentorchestra-measure-cache') });
  const index = await buildContextIndex(root, report, { classification: await readClassification(root) });
  await writeContextIndex(root, index);
  console.log(root, JSON.stringify(index.meta.counts));
})().catch(error => { console.error(error); process.exitCode = 1; });
