"""Pacotes portáteis de agentes para projetos locais e arquivos ZIP."""
from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import unquote
import argparse
import hashlib
import json
import os
import re
import shlex
import stat
import sys
import zipfile


MANIFEST = "agentorchestra-package.json"
SCHEMA = 1
MAX_FILES = 200
MAX_TOTAL = 10 * 1024 * 1024
MAX_ARCHIVE = 12 * 1024 * 1024
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
BAD_SEGMENT = re.compile(r"[<>:\"\\|?*\x00-\x1f]")
WINDOWS_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.I)
LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
SKILL_LINE = re.compile(r"^skills:\s*$", re.M)


def valid_path(value: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        raise ValueError(f"Caminho inválido no pacote: {value!r}")
    parts = value.split("/")
    if any(not part or part in (".", "..") or part.endswith((" ", "."))
           or BAD_SEGMENT.search(part) or WINDOWS_RESERVED.match(part) for part in parts):
        raise ValueError(f"Caminho inválido no pacote: {value!r}")
    if len(value) > 300:
        raise ValueError("Caminho muito longo no pacote.")
    allowed = (
        len(parts) >= 4 and parts[:2] in ([".agents", "skills"], [".claude", "skills"], [".codex", "skills"])
        and SLUG.fullmatch(parts[2])
    ) or (
        len(parts) == 3 and parts[:2] in ([".agents", "routes"], [".claude", "agents"],
                                        [".codex", "agents"], [".agentorchestra", "specs"])
        and SLUG.fullmatch(PurePosixPath(parts[2]).stem)
        and parts[2].lower().endswith({"routes": ".toml", "agents": ".md" if parts[0] == ".claude" else ".toml",
                                         "specs": ".json"}[parts[1]])
    )
    if not allowed:
        raise ValueError(f"Arquivo fora das pastas de agentes e skills: {value}")
    return value


def within(root: Path, file: Path) -> str:
    try:
        relative = file.relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError("O arquivo selecionado está fora do projeto de origem.") from error
    return valid_path(relative)


def add_file(root: Path, relative: str, files: set[str]) -> None:
    valid_path(relative)
    file = root.joinpath(*relative.split("/"))
    if file.is_symlink() or any(part.is_symlink() for part in file.parents if part != root and root in part.parents):
        raise ValueError(f"Link simbólico não pode entrar no pacote: {relative}")
    if not file.is_file():
        raise ValueError(f"Dependência ausente: {relative}")
    files.add(relative)


def add_tree(root: Path, relative: str, files: set[str]) -> None:
    directory = root.joinpath(*relative.split("/"))
    if not directory.exists():
        return
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError(f"Pasta inválida: {relative}")
    for current, dirs, names in os.walk(directory, followlinks=False):
        for name in dirs + names:
            child = Path(current) / name
            if child.is_symlink():
                raise ValueError(f"Link simbólico não pode entrar no pacote: {child}")
        for name in names:
            add_file(root, within(root, Path(current) / name), files)


def skill_names(agent_text: str) -> set[str]:
    frontmatter = agent_text.split("---", 2)
    if len(frontmatter) < 3 or frontmatter[0].strip():
        return set()
    lines = frontmatter[1].splitlines()
    names: set[str] = set()
    active = False
    for line in lines:
        inline = re.match(r"^skills:\s*\[([^]]*)\]\s*$", line.strip())
        if inline:
            for value in inline.group(1).split(","):
                name = value.strip().strip("\"'")
                if name:
                    if not SLUG.fullmatch(name):
                        raise ValueError(f"Nome de skill inválido: {name}")
                    names.add(name)
            active = False
            continue
        if SKILL_LINE.fullmatch(line.strip()):
            active = True
            continue
        if active and re.match(r"^\s+-\s+", line):
            name = re.sub(r"^\s+-\s+", "", line).strip().strip("\"'")
            if not SLUG.fullmatch(name):
                raise ValueError(f"Nome de skill inválido: {name}")
            names.add(name)
        elif active and line.strip() and not line.startswith((" ", "\t")):
            active = False
    return names


def local_references(relative: str, content: str) -> set[str]:
    references: set[str] = set()
    for raw in LINK.findall(content):
        link = unquote(raw.strip().strip("<>"))
        link = link.split("#", 1)[0].split("?", 1)[0]
        if not link or re.match(r"^[a-z][a-z0-9+.-]*:", link, re.I) or link.startswith("/"):
            continue
        target = str(PurePosixPath(relative).parent.joinpath(link))
        normalized = os.path.normpath(target.replace("/", os.sep)).replace(os.sep, "/")
        references.add(valid_path(normalized))
    if relative.startswith(".agents/routes/"):
        for match in re.finditer(r"(?m)^\s*(?:skill|agent)\s*=\s*[\"']([^\"']+)[\"']", content):
            references.add(valid_path(match.group(1)))
    if relative.startswith(".codex/agents/") or relative.startswith(".claude/agents/"):
        for match in re.finditer(r"\.agents/skills/[A-Za-z0-9][A-Za-z0-9_.-]*/SKILL\.md", content):
            references.add(valid_path(match.group(0)))
    return references


def collect(root: Path, entry: Path) -> tuple[str, dict[str, bytes]]:
    root = root.resolve()
    selected = within(root, entry.resolve())
    if not (selected.startswith((".claude/agents/", ".codex/agents/"))
            or selected.endswith("/SKILL.md") and selected.startswith((".agents/skills/", ".claude/skills/", ".codex/skills/"))):
        raise ValueError("Selecione um agente ou o SKILL.md de uma skill.")
    slug = PurePosixPath(selected).parent.name if selected.endswith("/SKILL.md") else PurePosixPath(selected).stem
    if not SLUG.fullmatch(slug):
        raise ValueError(f"Nome de agente inválido para o pacote: {slug}")
    files: set[str] = set()
    skills = {slug}
    required_skills: set[str] = set()
    if selected.startswith(".claude/agents/"):
        required_skills = skill_names((root / selected).read_text(encoding="utf-8"))
        skills.update(required_skills)
    for name in skills:
        add_tree(root, f".agents/skills/{name}", files)
        add_tree(root, f".claude/skills/{name}", files)
        add_tree(root, f".codex/skills/{name}", files)
        if name in required_skills and not any(value in files for value in
                                           (f".agents/skills/{name}/SKILL.md", f".claude/skills/{name}/SKILL.md",
                                            f".codex/skills/{name}/SKILL.md")):
            raise ValueError(f"Skill exigida pelo agente não encontrada: {name}")
    for relative in (f".claude/agents/{slug}.md", f".codex/agents/{slug}.toml",
                     f".agents/routes/{slug}.toml", f".agentorchestra/specs/{slug}.json"):
        if (root / relative).is_file():
            add_file(root, relative, files)
    add_file(root, selected, files)

    for relative in list(files):
        if relative.startswith(".claude/agents/"):
            for name in skill_names((root / relative).read_text(encoding="utf-8")):
                add_tree(root, f".agents/skills/{name}", files)
                add_tree(root, f".claude/skills/{name}", files)
                add_tree(root, f".codex/skills/{name}", files)
                if not any(value in files for value in
                            (f".agents/skills/{name}/SKILL.md", f".claude/skills/{name}/SKILL.md",
                             f".codex/skills/{name}/SKILL.md")):
                    raise ValueError(f"Skill exigida pelo agente não encontrada: {name}")

    pending = list(files)
    while pending:
        relative = pending.pop()
        if not relative.endswith((".md", ".toml")):
            continue
        content = (root / relative).read_text(encoding="utf-8")
        if str(root) in content:
            raise ValueError(f"Referência absoluta ao projeto de origem em {relative}; use caminhos relativos antes de compartilhar.")
        for reference in local_references(relative, content):
            if reference not in files:
                add_file(root, reference, files)
                pending.append(reference)

    if len(files) > MAX_FILES:
        raise ValueError(f"O agente excede o limite de {MAX_FILES} arquivos.")
    payload = {relative: (root / relative).read_bytes() for relative in sorted(files)}
    if sum(map(len, payload.values())) > MAX_TOTAL:
        raise ValueError("O agente excede o limite de 10 MiB.")
    return selected, payload


def shell_installer(paths: list[str]) -> str:
    entries = " ".join(shlex.quote(value) for value in paths)
    return ("#!/bin/sh\nset -eu\n"
            "BASE=$(CDPATH= cd \"$(dirname \"$0\")\" && pwd)\n"
            "TARGET=${1:?Uso: sh install.sh /caminho/do/projeto}\n"
            "[ -d \"$TARGET\" ] && [ ! -L \"$TARGET\" ] || { echo 'Projeto de destino ausente ou simbólico' >&2; exit 2; }\n"
            f"for REL in {entries}; do\n"
            "  [ ! -e \"$TARGET/$REL\" ] && [ ! -L \"$TARGET/$REL\" ] || { echo \"Arquivo existente: $REL\" >&2; exit 2; }\n"
            "  PARENT=$(dirname \"$REL\")\n"
            "  while [ \"$PARENT\" != . ]; do\n"
            "    [ ! -L \"$TARGET/$PARENT\" ] && { [ ! -e \"$TARGET/$PARENT\" ] || [ -d \"$TARGET/$PARENT\" ]; } || { echo \"Pasta inválida: $PARENT\" >&2; exit 2; }\n"
            "    PARENT=$(dirname \"$PARENT\")\n"
            "  done\n"
            "done\n"
            f"for REL in {entries}; do\n"
            "  mkdir -p \"$(dirname \"$TARGET/$REL\")\"\n"
            "  cp \"$BASE/files/$REL\" \"$TARGET/$REL\"\n"
            "done\n"
            "echo 'Agente instalado.'\n")


def export_package(root: Path, entry: Path, output: Path) -> dict:
    selected, payload = collect(root, entry)
    manifest = {"schemaVersion": SCHEMA, "entrypoint": selected,
                "files": [{"path": relative, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
                          for relative, data in payload.items()]}
    output.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with output.open("xb") as stream:
            created = True
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
                archive.writestr("install.sh", shell_installer(list(payload)))
                for relative, data in payload.items():
                    archive.writestr(f"files/{relative}", data)
    except Exception:
        if created:
            output.unlink(missing_ok=True)
        raise
    return {"ok": True, "entrypoint": selected, "files": list(payload), "archive": str(output)}


def read_package(archive_file: Path) -> tuple[dict, dict[str, bytes]]:
    if not archive_file.is_file() or archive_file.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Pacote ausente ou acima do limite de 12 MiB.")
    with zipfile.ZipFile(archive_file) as archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if len(names) != len(set(name.casefold() for name in names)):
            raise ValueError("O ZIP contém caminhos duplicados.")
        if MANIFEST not in names or "install.sh" not in names:
            raise ValueError("Este ZIP não é um pacote AgentOrchestra.")
        if any(item.is_dir() or stat.S_ISLNK(item.external_attr >> 16) for item in infos):
            raise ValueError("Diretórios e links simbólicos não são aceitos no ZIP.")
        if sum(item.file_size for item in infos) > MAX_TOTAL + 128 * 1024 or len(infos) > MAX_FILES + 2:
            raise ValueError("Pacote excede os limites de tamanho ou arquivos.")
        manifest = json.loads(archive.read(MANIFEST))
        if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SCHEMA or not isinstance(manifest.get("files"), list):
            raise ValueError("Versão de manifesto incompatível.")
        entries = manifest["files"]
        if not entries or len(entries) > MAX_FILES:
            raise ValueError("Manifesto vazio ou grande demais.")
        if any(not isinstance(item, dict) for item in entries):
            raise ValueError("Entrada inválida no manifesto.")
        paths = [valid_path(item.get("path")) for item in entries]
        if len(paths) != len(set(value.casefold() for value in paths)):
            raise ValueError("O manifesto contém arquivos duplicados.")
        if set(names) != {MANIFEST, "install.sh", *(f"files/{value}" for value in paths)}:
            raise ValueError("O ZIP contém arquivos fora do manifesto.")
        if archive.read("install.sh").decode("utf-8") != shell_installer(paths):
            raise ValueError("O instalador do pacote não corresponde ao manifesto.")
        entrypoint = valid_path(manifest.get("entrypoint"))
        if entrypoint not in paths or not (entrypoint.startswith((".claude/agents/", ".codex/agents/"))
                                           or entrypoint.endswith("/SKILL.md") and entrypoint.startswith((".agents/skills/", ".claude/skills/", ".codex/skills/"))):
            raise ValueError("O agente principal não está no pacote.")
        payload: dict[str, bytes] = {}
        for item, relative in zip(entries, paths):
            data = archive.read(f"files/{relative}")
            if len(data) != item.get("bytes") or hashlib.sha256(data).hexdigest() != item.get("sha256"):
                raise ValueError(f"Conteúdo inválido: {relative}")
            payload[relative] = data
    for relative, data in payload.items():
        if relative.endswith((".md", ".toml")):
            if relative.startswith(".claude/agents/"):
                for name in skill_names(data.decode("utf-8")):
                    if not any(value in payload for value in
                               (f".agents/skills/{name}/SKILL.md", f".claude/skills/{name}/SKILL.md",
                                f".codex/skills/{name}/SKILL.md")):
                        raise ValueError(f"Skill exigida pelo agente não incluída: {name}")
            for reference in local_references(relative, data.decode("utf-8")):
                if reference not in payload:
                    raise ValueError(f"Referência não incluída no pacote: {relative} → {reference}")
    return manifest, payload


def destination(root: Path, relative: str) -> Path:
    target = root.joinpath(*relative.split("/"))
    for candidate in (root, *target.parents):
        if candidate == root.parent:
            break
        if candidate.is_symlink():
            raise ValueError(f"Link simbólico no caminho de destino: {candidate}")
    if not target.resolve(strict=False).is_relative_to(root.resolve()):
        raise ValueError(f"Caminho fora do projeto: {relative}")
    return target


def inspect_package(archive_file: Path, root: Path) -> dict:
    manifest, payload = read_package(archive_file)
    if not root.is_dir():
        raise ValueError("Abra uma pasta de projeto válida para receber o agente.")
    conflicts = [relative for relative in payload if destination(root, relative).exists()]
    return {"ok": True, "entrypoint": manifest["entrypoint"], "files": list(payload), "conflicts": conflicts}


def import_package(archive_file: Path, root: Path) -> dict:
    manifest, payload = read_package(archive_file)
    if not root.is_dir():
        raise ValueError("Abra uma pasta de projeto válida para receber o agente.")
    targets = [(relative, destination(root, relative)) for relative in payload]
    conflicts = [relative for relative, target in targets if target.exists()]
    if conflicts:
        raise ValueError("Arquivos existentes no destino: " + ", ".join(conflicts[:8]))
    created: list[Path] = []
    try:
        for relative, target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                created.append(target)
                stream.write(payload[relative])
    except Exception:
        for file in reversed(created):
            file.unlink(missing_ok=True)
        raise
    return {"ok": True, "entrypoint": manifest["entrypoint"], "files": list(payload), "project": str(root)}


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    exporting = commands.add_parser("export")
    exporting.add_argument("--source", type=Path, required=True)
    exporting.add_argument("--entry", type=Path, required=True)
    exporting.add_argument("--output", type=Path, required=True)
    for name in ("inspect", "import"):
        command = commands.add_parser(name)
        command.add_argument("--archive", type=Path, required=True)
        command.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "export":
            result = export_package(args.source, args.entry, args.output)
        elif args.command == "inspect":
            result = inspect_package(args.archive, args.target)
        else:
            result = import_package(args.archive, args.target)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile, UnicodeError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
