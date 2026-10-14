"""Formatos de saída instaláveis para plataformas de agentes."""
from __future__ import annotations

from typing import Any, Mapping
import json
import re
import unicodedata

from .renderers import render_agent


def slugify(value: str) -> str:
    """Converte o nome exibido em um identificador seguro para arquivos e plugins."""
    ascii_name = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return slug[:60].rstrip("-") or "agente"


def _description(spec: dict[str, Any]) -> str:
    detail = spec["mission"] or spec["role"]
    return f"{spec['name']}: {detail}"[:240]


class ClaudePluginRenderer:
    """Gera um plugin aceito por Claude Code e Claude Cowork."""

    COMPONENTS = ("skill", "agent", "both")

    def __init__(self, component: str = "both") -> None:
        if component not in self.COMPONENTS:
            raise ValueError(f"Componente Claude inválido: {component}")
        self.component = component

    def render(self, spec: dict[str, Any], derived: dict[str, Any]) -> Mapping[str, str]:
        for field in ("name", "role", "mission"):
            if not spec.get(field):
                raise ValueError(f"O destino Claude exige o campo '{field}'.")

        slug = slugify(spec["name"])
        description = _description(spec)
        instructions = render_agent(spec, derived)
        files = {
            ".claude-plugin/plugin.json": json.dumps(
                {"name": slug, "description": description, "version": "0.1.0"},
                ensure_ascii=False, indent=2,
            ) + "\n",
        }

        if self.component in ("skill", "both"):
            files[f"skills/{slug}/SKILL.md"] = (
                "---\n"
                f"name: {slug}\n"
                f"description: {json.dumps(description, ensure_ascii=False)}\n"
                "---\n\n"
                + instructions
            )

        if self.component in ("agent", "both"):
            frontmatter = (
                "---\n"
                f"name: {slug}\n"
                f"description: {json.dumps(description, ensure_ascii=False)}\n"
            )
            if self.component == "both":
                # Claude carrega a skill no contexto do subagente, sem repetir o texto.
                frontmatter += f"skills:\n  - {slug}\n"
                body = (
                    f"# {spec['name']}\n\n"
                    f"Sua missão: {spec['mission']}\n\n"
                    "Siga as instruções da skill carregada para este agente.\n"
                )
            else:
                body = instructions
            files[f"agents/{slug}.md"] = frontmatter + "---\n\n" + body

        return files


class ClaudeProjectRenderer:
    """Instala componentes diretamente na pasta .claude de um projeto."""

    def __init__(self, component: str = "both") -> None:
        self.plugin_renderer = ClaudePluginRenderer(component)

    def render(self, spec: dict[str, Any], derived: dict[str, Any]) -> Mapping[str, str]:
        plugin_files = self.plugin_renderer.render(spec, derived)
        return {
            f".claude/{path}": content
            for path, content in plugin_files.items()
            if not path.startswith(".claude-plugin/")
        }


class UnifiedProjectRenderer:
    """Mantém uma skill central e gera os pontos de entrada nativos dos dois CLIs."""

    def render(self, spec: dict[str, Any], derived: dict[str, Any]) -> Mapping[str, str]:
        slug = slugify(spec["name"])
        description = _description(spec)
        skill = ClaudePluginRenderer("skill").render(spec, derived)[f"skills/{slug}/SKILL.md"]
        canonical = f".agents/skills/{slug}/SKILL.md"
        claude_skill = f".claude/skills/{slug}/SKILL.md"
        claude_agent = f".claude/agents/{slug}.md"
        codex_agent = f".codex/agents/{slug}.toml"
        route = f".agents/routes/{slug}.toml"

        claude_wrapper = (
            "---\n"
            f"name: {slug}\n"
            f"description: {json.dumps(description, ensure_ascii=False)}\n"
            "---\n\n"
            f"# {spec['name']}\n\n"
            f"Antes de executar a tarefa, leia [a instrução central](../../../{canonical}) "
            "e siga integralmente suas regras de escopo, permissões e saída.\n"
        )
        claude_worker = (
            "---\n"
            f"name: {slug}\n"
            f"description: {json.dumps(description, ensure_ascii=False)}\n"
            f"skills:\n  - {slug}\n"
            "---\n\n"
            f"Execute a missão de {spec['name']} seguindo a skill carregada. "
            f"Leia também a instrução central em {canonical} antes de agir.\n"
        )
        codex_instructions = (
            f"Antes de agir, leia {canonical} na raiz do repositório e siga "
            "integralmente as instruções, inclusive limites e formato de saída. "
            "Se não encontrar o arquivo, informe o problema sem improvisar regras."
        )
        codex_worker = (
            f"name = {json.dumps(slug, ensure_ascii=False)}\n"
            f"description = {json.dumps(description, ensure_ascii=False)}\n"
            f"developer_instructions = {json.dumps(codex_instructions, ensure_ascii=False)}\n"
        )
        # Metadados da Forja. Claude e Codex usam os adaptadores acima, não este TOML.
        route_content = (
            "schema_version = 1\n"
            f"name = {json.dumps(spec['name'], ensure_ascii=False)}\n"
            f"slug = {json.dumps(slug)}\n"
            f"skill = {json.dumps(canonical)}\n\n"
            "[claude]\n"
            f"skill = {json.dumps(claude_skill)}\n"
            f"agent = {json.dumps(claude_agent)}\n\n"
            "[codex]\n"
            f"agent = {json.dumps(codex_agent)}\n"
        )
        return {
            canonical: skill,
            claude_skill: claude_wrapper,
            claude_agent: claude_worker,
            codex_agent: codex_worker,
            route: route_content,
        }
