"""Monta o site estático com uma cópia gerada do compilador Python."""
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "site"


def build_site(output: Path = OUTPUT) -> Path:
    shutil.copytree(ROOT / "site", output, dirs_exist_ok=True)
    package_output = output / "nestor_forge"
    package_output.mkdir(parents=True, exist_ok=True)
    for name in ("__init__.py", "compiler.py", "domain.py", "renderers.py", "targets.py"):
        source = ROOT / "nestor_forge" / name
        shutil.copy2(source, package_output / source.name)
    return output


if __name__ == "__main__":
    print(build_site())
