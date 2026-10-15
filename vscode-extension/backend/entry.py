"""Ponte JSON entre Agent Orchestra e o compilador Nestor Forge."""
from __future__ import annotations

from pathlib import Path
import argparse
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vendor"))

from nestor_forge.cli import main as forge_main  # noqa: E402
from nestor_forge.domain import PROFILES  # noqa: E402
from nestor_forge.questions import default_spec  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    template = commands.add_parser("template")
    template.add_argument("--profile", choices=(*PROFILES, "custom"), required=True)
    template.add_argument("--name", required=True)
    template.add_argument("--role", required=True)
    template.add_argument("--mission", required=True)
    build = commands.add_parser("build")
    build.add_argument("--spec", required=True)
    build.add_argument("--target", choices=("unified-project", "claude-project", "generic", "claude-plugin"), required=True)
    build.add_argument("--output", required=True)
    args = parser.parse_args()

    if args.command == "template":
        spec = default_spec(args.profile)
        spec.update(name=args.name, role=args.role, mission=args.mission)
        print(json.dumps(spec, ensure_ascii=False))
        return 0
    return forge_main([
        args.spec, "--json-report", "--target", args.target,
        "--output", args.output,
    ])


if __name__ == "__main__":
    raise SystemExit(main())
