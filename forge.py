#!/usr/bin/env python3
"""CLI entry point and compatibility facade for the compiler."""
from __future__ import annotations

from pathlib import Path
from typing import Any
import json

from nestor_forge.compiler import FileSystemArtifactWriter, ForgeCompiler
from nestor_forge.domain import (
    ALIASES, PIPELINE_HINTS, PROFILES, classify_final_rules, dedupe, derive,
    norm_text, normalize_spec,
)
from nestor_forge.renderers import build_report, bullets, numbered, render_agent, sentence


def compile_spec(spec_path: Path, output_dir: Path) -> None:
    """Compila uma especificação JSON e grava seus artefatos."""
    raw = json.loads(spec_path.read_text(encoding="utf-8"))
    artifacts = ForgeCompiler().compile(raw)
    FileSystemArtifactWriter().write(artifacts, output_dir)

def interactive_spec() -> dict[str, Any]:
    from nestor_forge.cli import ForgeCli
    return ForgeCli().interactive_spec()


def save_interactive_spec(output_dir: Path) -> Path:
    from nestor_forge.cli import save_interactive_spec as save
    return save(output_dir)


def main(argv: list[str] | None = None) -> int:
    from nestor_forge.cli import main as cli_main
    return cli_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
