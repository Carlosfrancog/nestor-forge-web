"""Orquestração da compilação e escrita dos artefatos."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Protocol
import json

from .domain import derive, normalize_spec
from .renderers import build_report, render_agent


@dataclass(frozen=True)
class BuildArtifacts:
    """Resultado em memória, compartilhado pelo CLI e pelo navegador."""

    normalized_spec: dict[str, Any]
    derived_spec: dict[str, Any]
    files: Mapping[str, str]


class ArtifactRenderer(Protocol):
    """Porta para novos formatos, como plugins Claude e skills Codex."""

    def render(self, spec: dict[str, Any], derived: dict[str, Any]) -> Mapping[str, str]: ...


class GenericArtifactRenderer:
    """Mantém o formato de saída da Forja v0.3."""

    def render(self, spec: dict[str, Any], derived: dict[str, Any]) -> Mapping[str, str]:
        return {
            "agent.md": render_agent(spec, derived),
            "agent.normalized.json": json.dumps(spec, ensure_ascii=False, indent=2),
            "agent.derived.json": json.dumps(derived, ensure_ascii=False, indent=2),
            "BUILD_REPORT.md": build_report(spec, derived),
        }


class ForgeCompiler:
    """Caso de uso: normalizar, inferir e renderizar uma especificação."""

    def __init__(self, renderer: ArtifactRenderer | None = None) -> None:
        self.renderer = renderer if renderer is not None else GenericArtifactRenderer()

    def compile(self, raw_spec: dict[str, Any]) -> BuildArtifacts:
        spec = normalize_spec(raw_spec)
        derived = derive(spec)
        files = dict(self.renderer.render(spec, derived))
        return BuildArtifacts(spec, derived, files)


class FileSystemArtifactWriter:
    """Adaptador de armazenamento para o CLI e o filesystem do Pyodide."""

    def write(self, artifacts: BuildArtifacts, output_dir: Path, *, overwrite: bool = True) -> list[Path]:
        names = []
        for name in artifacts.files:
            relative = PurePosixPath(name)
            if (not name or name == "." or "\\" in name or ":" in name or relative.is_absolute()
                    or Path(name).is_absolute() or ".." in relative.parts
                    or relative.as_posix() != name):
                raise ValueError(f"Nome de artefato inválido: {name}")
            names.append(relative)
        root = output_dir.resolve()
        for relative in names:
            destination = output_dir.joinpath(*relative.parts).resolve()
            if not destination.is_relative_to(root):
                raise ValueError(f"Artefato fora da pasta de saída: {relative}")
        if not overwrite:
            existing = [output_dir.joinpath(*name.parts) for name in names
                        if output_dir.joinpath(*name.parts).exists()]
            if existing:
                raise ValueError(f"Arquivo já existe: {existing[0]}. Use --force para substituir.")
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for relative in names:
            path = output_dir.joinpath(*relative.parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            content = artifacts.files[relative.as_posix()]
            path.write_text(content, encoding="utf-8")
            paths.append(path)
        return paths
