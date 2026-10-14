"""Copia o núcleo Python da Forja para o pacote da extensão VS Code."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "nestor_forge"
DESTINATION = ROOT / "vscode-extension" / "vendor" / "nestor_forge"
MODULES = (
    "__init__.py", "cli.py", "compiler.py", "domain.py", "questions.py",
    "renderers.py", "targets.py",
)


def main() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name in MODULES:
        shutil.copyfile(SOURCE / name, DESTINATION / name)
    template = DESTINATION / "templates" / "spec.template.json"
    template.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE / "templates" / "spec.template.json", template)
    print(f"Núcleo da Forja incluído em {DESTINATION}")


if __name__ == "__main__":
    main()
