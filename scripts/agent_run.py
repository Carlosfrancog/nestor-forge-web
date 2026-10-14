"""Protocolo JSON para agentes executarem o CLI sem responder ao terminal."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from nestor_forge.domain import PROFILES  # noqa: E402
from nestor_forge.questions import default_spec, questions  # noqa: E402


def emit(value: dict[str, Any]) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def read_answers(source: str) -> dict[str, Any]:
    text = sys.stdin.read() if source == "-" else Path(source).read_text(encoding="utf-8")
    raw = json.loads(text)
    if not isinstance(raw, dict):
        raise ValueError("As respostas devem ser um objeto JSON.")
    raw.pop("_instructions", None)
    if "answers" in raw and len(raw) == 1:
        raw = raw["answers"]
        if not isinstance(raw, dict):
            raise ValueError("answers deve ser um objeto JSON.")
    return raw


def make_spec(answers: dict[str, Any]) -> dict[str, Any]:
    profile = answers.get("profile", "reader")
    if profile not in (*PROFILES, "custom"):
        raise ValueError(f"Perfil inválido: {profile!r}.")
    spec = default_spec(profile)
    allowed = set(spec) | {"token_economy"}
    unknown = set(answers) - allowed
    if unknown:
        raise ValueError(f"Campos desconhecidos: {', '.join(sorted(unknown))}.")
    for key, value in answers.items():
        if key in ("permissions", "output_contract"):
            if not isinstance(value, dict):
                raise ValueError(f"{key} deve ser um objeto JSON.")
            spec[key].update(value)
        else:
            spec[key] = value
    permissions = spec["permissions"]
    extra_permissions = set(permissions) - {"read_code", "run_analysis_tools", "run_active_tests", "write_code", "modify_business_rules", "modify_database"}
    if extra_permissions:
        raise ValueError(f"Permissões desconhecidas: {', '.join(sorted(extra_permissions))}.")
    if any(not isinstance(value, bool) for value in permissions.values()):
        raise ValueError("Todas as permissões devem ser true ou false.")
    contract = spec["output_contract"]
    extra_contract = set(contract) - {"preferred", "required_fields", "machine_readable", "fact_labels", "progressive_levels"}
    if extra_contract:
        raise ValueError(f"Campos de output_contract desconhecidos: {', '.join(sorted(extra_contract))}.")
    if "machine_readable" in contract and not isinstance(contract["machine_readable"], bool):
        raise ValueError("output_contract.machine_readable deve ser true ou false.")
    for key in ("fact_labels", "progressive_levels"):
        if key in contract and (not isinstance(contract[key], list) or any(not isinstance(item, str) for item in contract[key])):
            raise ValueError(f"output_contract.{key} deve ser uma lista de textos.")
    if "token_economy" in spec and not isinstance(spec["token_economy"], bool):
        raise ValueError("token_economy deve ser true ou false.")
    for key in ("name", "role", "mission"):
        if not isinstance(spec[key], str) or not spec[key].strip():
            raise ValueError(f"{key} precisa ser texto não vazio.")
    for question in questions(profile):
        section, separator, field = question.key.partition(".")
        value = spec[section][field] if separator else spec[section]
        if question.kind == "list" and (not isinstance(value, list) or any(not isinstance(item, str) for item in value)):
            raise ValueError(f"{question.key} deve ser uma lista de textos.")
        if question.kind == "bool" and not isinstance(value, bool):
            raise ValueError(f"{question.key} deve ser true ou false.")
    if spec["output_contract"]["preferred"] not in ("markdown", "json"):
        raise ValueError("output_contract.preferred deve ser markdown ou json.")
    return spec


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Execute a Forja por JSON e receba um relatório JSON compacto.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    ask = subparsers.add_parser("questions", help="Lista perguntas, tipos e valores padrão em JSON.")
    ask.add_argument("--profile", choices=(*PROFILES, "custom"), default="reader")
    run = subparsers.add_parser("run", help="Compila respostas JSON sem interação.")
    run.add_argument("--answers", required=True, help="Caminho de JSON ou '-' para stdin.")
    run.add_argument("--output", required=True, help="Pasta de saída ou raiz do projeto.")
    run.add_argument("--target", choices=("generic", "claude-plugin", "claude-project", "unified-project"), default="generic")
    run.add_argument("--component", choices=("skill", "agent", "both"), default="both")
    run.add_argument("--force", action="store_true")
    run.add_argument("--cli", help="Caminho do executável nestor-forge; padrão: forge.py com o Python atual.")
    args = parser.parse_args(argv)

    if args.command == "questions":
        emit({
            "version": 1,
            "profiles": [*PROFILES, "custom"],
            "choices": {"output_contract.preferred": ["markdown", "json"]},
            "questions": [[q.key, q.label, q.kind, q.default] for q in questions(args.profile)],
            "required": ["role", "mission"],
        })
        return 0

    try:
        spec = make_spec(read_answers(args.answers))
        command = ([args.cli] if args.cli else [sys.executable, "-B", str(ROOT / "forge.py")])
        command += ["-", "--json-report", "--target", args.target, "--component", args.component,
                    "--output", args.output]
        if args.force:
            command.append("--force")
        environment = dict(os.environ, PYTHONIOENCODING="utf-8")
        completed = subprocess.run(
            command, input=json.dumps(spec, ensure_ascii=False),
            capture_output=True, text=True, encoding="utf-8", env=environment, check=False,
        )
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise ValueError(f"O CLI não retornou JSON válido: {completed.stderr.strip() or completed.stdout.strip()}") from exc
        emit(report)
        return completed.returncode
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        emit({"ok": False, "error": str(exc)})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
