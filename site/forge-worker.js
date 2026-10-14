// Pyodide runs the same Python package used by the CLI.
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
let compilerPromise;

async function loadCompiler() {
  if (!compilerPromise) {
    compilerPromise = (async () => {
      self.postMessage({ type: 'status', message: 'Baixando o runtime Python para o navegador…' });
      const { loadPyodide } = await import(`${PYODIDE_BASE}pyodide.mjs`);
      const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
      self.postMessage({ type: 'status', message: 'Carregando a Forja…' });
      pyodide.FS.mkdirTree('/home/pyodide/nestor_forge');
      for (const path of ['nestor_forge/__init__.py', 'nestor_forge/domain.py', 'nestor_forge/renderers.py', 'nestor_forge/compiler.py', 'nestor_forge/targets.py']) {
        const response = await fetch(`./${path}`);
        if (!response.ok) throw new Error(`${path} não encontrado (${response.status}).`);
        pyodide.FS.writeFile(`/home/pyodide/${path}`, await response.text());
      }
      await pyodide.runPythonAsync('import importlib; importlib.invalidate_caches(); import nestor_forge');
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
import json
from nestor_forge import FileSystemArtifactWriter, ForgeCompiler
from nestor_forge.targets import ClaudePluginRenderer, UnifiedProjectRenderer

workspace = Path('/tmp/nestor-forge-web')
if workspace.exists():
    shutil.rmtree(workspace)
workspace.mkdir()
spec_file = workspace / 'spec.json'
spec_file.write_text(input_spec_json, encoding='utf-8')
output = workspace / 'package'
renderer = (ClaudePluginRenderer() if target_name == 'claude'
            else UnifiedProjectRenderer() if target_name == 'unified'
            else None)
artifacts = ForgeCompiler(renderer).compile(json.loads(input_spec_json))
FileSystemArtifactWriter().write(artifacts, output)
(output / 'spec.json').write_text(input_spec_json, encoding='utf-8')
(output / ('PROMPT_' + target_name.upper() + '.txt')).write_text(instruction_prompt, encoding='utf-8')
archive = workspace / 'agent.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
    for source in sorted(path for path in output.rglob('*') if path.is_file()):
        bundle.write(source, arcname=agent_slug + '/' + source.relative_to(output).as_posix())
`);
    const bytes = pyodide.FS.readFile('/tmp/nestor-forge-web/agent.zip');
    self.postMessage({ type: 'done', bytes, prompt: data.prompt, name: data.spec.name }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: `Falha na geração: ${error.message || String(error)}` });
  }
};
