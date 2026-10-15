"""Monta o site estático com uma cópia gerada do compilador Python."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

if __package__:
    from .build_context_agents import ARCHIVE_NAME, build_context_agents
else:
    from build_context_agents import ARCHIVE_NAME, build_context_agents


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "site"


def build_site(output: Path = OUTPUT) -> Path:
    shutil.copytree(ROOT / "site", output, dirs_exist_ok=True)
    extension = ROOT / "vscode-extension"
    manifest = json.loads((extension / "package.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    icon = output / "assets" / "agentorchestra.png"
    icon.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(extension / "media" / "agents.png", icon)

    vsix_name = f"agentorchestra-{version}.vsix"
    vsix = ROOT / "dist" / vsix_name
    update_manifest = output / "updates" / "agentorchestra.json"
    update_manifest.unlink(missing_ok=True)
    downloads = output / "downloads"
    if downloads.is_dir():
        for previous in downloads.glob("agentorchestra-*.vsix"):
            previous.unlink()
        for previous in downloads.glob("agentes-contexto*.zip"):
            previous.unlink()
    if vsix.is_file():
        with zipfile.ZipFile(vsix) as package:
            packaged = json.loads(package.read("extension/package.json"))
        if (packaged.get("version") != version or packaged.get("name") != manifest["name"]
                or packaged.get("publisher") != manifest["publisher"]):
            raise ValueError(f"O pacote VSIX não corresponde ao manifesto da extensão: {vsix}")
        download = downloads / vsix_name
        download.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(vsix, download)
        updates = output / "updates"
        updates.mkdir(parents=True, exist_ok=True)
        release = {
            "schemaVersion": 1,
            "extensionId": f"{manifest['publisher']}.{manifest['name']}",
            "version": version,
            "url": f"../downloads/{vsix_name}",
            "sha256": hashlib.sha256(vsix.read_bytes()).hexdigest(),
            "size": vsix.stat().st_size,
        }
        update_manifest.write_text(
            json.dumps(release, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        action = (
            f'<a class="extension-download" href="./downloads/{vsix_name}" download>'
            'Baixar VSIX <span aria-hidden="true">↓</span></a>'
        )
    else:
        action = (
            '<p class="extension-unavailable">O pacote VSIX não foi incluído nesta compilação. '
            'Gere o pacote da extensão para habilitar o download.</p>'
        )
    index = output / "index.html"
    html = index.read_text(encoding="utf-8")
    html = html.replace("__AGENTORCHESTRA_VERSION__", version)
    html = html.replace("__AGENTORCHESTRA_DOWNLOAD__", action)
    index.write_text(html, encoding="utf-8")

    build_context_agents(downloads / ARCHIVE_NAME)

    package_output = output / "nestor_forge"
    package_output.mkdir(parents=True, exist_ok=True)
    for name in ("__init__.py", "compiler.py", "domain.py", "renderers.py", "targets.py"):
        source = ROOT / "nestor_forge" / name
        shutil.copy2(source, package_output / source.name)
    return output


if __name__ == "__main__":
    print(build_site())
