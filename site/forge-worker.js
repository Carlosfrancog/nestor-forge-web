// Keep the Python compiler unchanged: Pyodide runs forge.py in a browser worker.
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
let compilerPromise;

async function loadCompiler() {
  if (!compilerPromise) {
    compilerPromise = (async () => {
      self.postMessage({ type: 'status', message: 'Baixando o runtime Python para o navegador…' });
      const { loadPyodide } = await import(`${PYODIDE_BASE}pyodide.mjs`);
      const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
      self.postMessage({ type: 'status', message: 'Carregando a Forja…' });
      const response = await fetch('./forge.py');
      if (!response.ok) throw new Error(`forge.py não encontrado (${response.status}).`);
      pyodide.FS.writeFile('/home/pyodide/forge.py', await response.text());
      await pyodide.runPythonAsync('import importlib; importlib.invalidate_caches(); import forge');
      return pyodide;
    })().catch(error => {
      compilerPromise = null;
      throw error;
    });
  }
  return compilerPromise;
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'generate') return;
  try {
    const pyodide = await loadCompiler();
    self.postMessage({ type: 'status', message: 'Compilando a especificação e criando o ZIP…' });
    pyodide.globals.set('input_spec_json', JSON.stringify(data.spec));
    pyodide.globals.set('instruction_prompt', data.prompt);
    pyodide.globals.set('target_name', data.target);
    pyodide.globals.set('agent_slug', data.slug);
    await pyodide.runPythonAsync(`
from pathlib import Path
import shutil
import zipfile
import forge

workspace = Path('/tmp/nestor-forge-web')
if workspace.exists():
    shutil.rmtree(workspace)
workspace.mkdir()
spec_file = workspace / 'spec.json'
spec_file.write_text(input_spec_json, encoding='utf-8')
output = workspace / 'package'
forge.compile_spec(spec_file, output)
(output / 'spec.json').write_text(input_spec_json, encoding='utf-8')
(output / ('PROMPT_' + target_name.upper() + '.txt')).write_text(instruction_prompt, encoding='utf-8')
archive = workspace / 'agent.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
    for source in sorted(output.iterdir()):
        bundle.write(source, arcname=agent_slug + '/' + source.name)
`);
    const bytes = pyodide.FS.readFile('/tmp/nestor-forge-web/agent.zip');
    self.postMessage({ type: 'done', bytes, prompt: data.prompt, name: data.spec.name }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: `Falha na geração: ${error.message || String(error)}` });
  }
};
