"""Gera um pacote de agentes de contexto usando o executor da Forja."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPECS = ROOT / "examples" / "context-agents"
NAMES = ("leitura-de-projeto", "historico-git", "contexto-de-stack")
README = """# Agentes de contexto

Este pacote contém três agentes de leitura para Claude Code e Codex:

- **Leitura de Projeto:** estrutura, pontos de entrada e fluxos.
- **Histórico Git:** evolução e decisões rastreadas em commits.
- **Contexto de Stack:** tecnologias, versões e comandos declarados.

Extraia o ZIP na raiz do repositório em que deseja usar os agentes, preservando
as pastas `.agents`, `.claude`, `.codex` e `.agentorchestra`. Revise os caminhos
de destino antes de extrair; arquivos existentes com o mesmo nome exigem sua
decisão. Reinicie a janela do VS Code para atualizar o catálogo do AgentOrchestra.

As especificações de origem ficam em `.agentorchestra/specs/`; as instruções
centrais geradas ficam em `.agents/skills/`. Os três agentes fazem leitura e
análise, sem executar testes ativos ou alterar código. Este ZIP é um pacote de
projeto para extração manual, não um arquivo VSIX nem um pacote individual de
importação do AgentOrchestra.
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
        files["AGENTES-CONTEXTO.md"] = README.encode("utf-8")

        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                archive.writestr(name, data)
    return output


if __name__ == "__main__":
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "site" / "downloads" / "agentes-contexto.zip"
    print(build_context_agents(destination))
