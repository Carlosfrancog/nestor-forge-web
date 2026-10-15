"""Gera um pacote de agentes de contexto usando o executor da Forja."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "vscode-extension" / "backend"))
from share import export_bundle  # noqa: E402

SPECS = ROOT / "examples" / "context-agents"
NAMES = ("leitura-de-projeto", "historico-git", "contexto-de-stack")
ARCHIVE_NAME = "agentes-contexto-importavel.zip"
README = """# Agentes de contexto

Este pacote contém três agentes de leitura para Claude Code e Codex:

- **Leitura de Projeto:** estrutura, pontos de entrada e fluxos.
- **Histórico Git:** evolução e decisões rastreadas em commits.
- **Contexto de Stack:** tecnologias, versões e comandos declarados.

No VS Code, execute **AgentOrchestra: Importar pacote de agente**, selecione
este ZIP e o projeto de destino. A prévia lista os arquivos dos três agentes
e sinaliza conflitos antes da instalação. Reinicie a janela se o catálogo não
for atualizado imediatamente.

As especificações de origem ficam em `.agentorchestra/specs/`; as instruções
centrais geradas ficam em `.agents/skills/`. Os três agentes fazem leitura e
análise, sem executar testes ativos ou alterar código. Para instalar sem a
extensão, extraia o ZIP e execute `sh install.sh /caminho/do/projeto` em um
ambiente com shell POSIX. Este ZIP não é um VSIX.
"""


def build_context_agents(output: Path) -> Path:
    """Compila as três specs e escreve um ZIP pronto para extrair no projeto."""
    with TemporaryDirectory() as temporary:
        project = Path(temporary) / "project"
        for name in NAMES:
            spec = SPECS / f"{name}.json"
            result = subprocess.run(
                [sys.executable, "-B", str(ROOT / "scripts" / "agent_run.py"),
                 "run", "--answers", str(spec), "--target", "unified-project",
                 "--output", str(project)],
                cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False,
            )
            if result.returncode:
                raise RuntimeError(f"Falha ao gerar {name}: {result.stdout.strip() or result.stderr.strip()}")
            report = json.loads(result.stdout)
            if not report.get("ok"):
                raise RuntimeError(f"Falha ao gerar {name}: {report.get('error', 'erro desconhecido')}")

        files = {path.relative_to(project).as_posix(): path.read_bytes()
                 for path in project.rglob("*") if path.is_file()}
        if len(files) != 5 * len(NAMES):
            raise RuntimeError(f"Número inesperado de artefatos: {len(files)}")
        for name in NAMES:
            files[f".agentorchestra/specs/{name}.json"] = (SPECS / f"{name}.json").read_bytes()
        files[".agents/skills/leitura-de-projeto/AGENTES-CONTEXTO.md"] = README.encode("utf-8")
        for relative, data in files.items():
            destination = project.joinpath(*relative.split("/"))
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)

        archive = Path(temporary) / "agentes-contexto.zip"
        export_bundle(project, [project / ".claude" / "agents" / f"{name}.md" for name in NAMES], archive)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(archive, output)
    return output


if __name__ == "__main__":
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "site" / "downloads" / ARCHIVE_NAME
    print(build_context_agents(destination))
