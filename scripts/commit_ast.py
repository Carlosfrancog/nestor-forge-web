"""Inspeciona mudanças por estrutura AST e cria commits sem imprimir diffs ou logs."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from typing import Any


MAX_SOURCE_BYTES = 1_000_000
SECRET_PATTERNS = (
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(rb"\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}\b"),
    re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b"),
)
PRIVATE_PARTS = {".agents", ".claude", ".codex", ".aws", ".venv", "dist", "build", "__pycache__"}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".pkl", ".pickle", ".zip"}


def compact(value: dict[str, Any]) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


class GitRepository:
    def __init__(self, location: Path) -> None:
        self.root = Path(os.fsdecode(self.git_at(location, "rev-parse", "--show-toplevel").strip()))
        self._blobs: dict[str, bytes] = {}

    @staticmethod
    def git_at(location: Path, *args: str, check: bool = True) -> bytes:
        result = subprocess.run(["git", "-C", str(location), *args], capture_output=True, check=False)
        if check and result.returncode:
            raise ValueError(result.stderr.decode("utf-8", "replace").strip() or f"git {args[0]} falhou")
        return result.stdout

    def git(self, *args: str, check: bool = True) -> bytes:
        return self.git_at(self.root, *args, check=check)

    def tree(self, revision: str) -> dict[str, str]:
        if not self.git("rev-parse", "--verify", revision, check=False).strip():
            return {}
        entries: dict[str, str] = {}
        for item in self.git("ls-tree", "-r", "-z", revision).split(b"\0"):
            if item:
                metadata, path = item.split(b"\t", 1)
                entries[os.fsdecode(path)] = metadata.split(b" ")[2].decode("ascii")
        return entries

    def head_tree(self) -> dict[str, str]:
        return self.tree("HEAD")

    def index_tree(self) -> dict[str, str]:
        entries: dict[str, str] = {}
        for item in self.git("ls-files", "--stage", "-z").split(b"\0"):
            if item:
                metadata, path = item.split(b"\t", 1)
                _, oid, stage = metadata.split(b" ")
                if stage == b"0":
                    entries[os.fsdecode(path)] = oid.decode("ascii")
        return entries

    def status(self) -> list[dict[str, str]]:
        parts = self.git("status", "--porcelain=v1", "-z", "--untracked-files=all").split(b"\0")
        result: list[dict[str, str]] = []
        index = 0
        while index < len(parts) and parts[index]:
            item = parts[index]
            state = item[:2].decode("ascii")
            entry = {"path": os.fsdecode(item[3:]), "status": state}
            if "R" in state or "C" in state:
                index += 1
                entry["old_path"] = os.fsdecode(parts[index])
            result.append(entry)
            index += 1
        return result

    def blob(self, oid: str | None) -> bytes | None:
        if oid is None:
            return None
        if oid not in self._blobs:
            self._blobs[oid] = self.git("cat-file", "blob", oid)
        return self._blobs[oid]

    def worktree(self, name: str) -> tuple[bytes | None, bool]:
        path = self.root / name
        if path.is_symlink():
            return None, True
        if not path.exists():
            return None, False
        if not path.is_file():
            raise ValueError(f"Caminho não é arquivo: {name}")
        return path.read_bytes(), False


def _fingerprint(node: ast.AST) -> str:
    return hashlib.sha256(ast.dump(node, include_attributes=False).encode("utf-8")).hexdigest()[:12]


def _structure(source: bytes | None) -> tuple[dict[str, str], list[str], str, str | None]:
    if source is None:
        return {}, [], "", None
    try:
        tree = ast.parse(source.decode("utf-8-sig"))
    except (SyntaxError, UnicodeDecodeError) as exc:
        return {}, [], "", type(exc).__name__
    symbols: dict[str, str] = {}
    imports: list[str] = []
    other: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols[f"function:{node.name}"] = _fingerprint(node)
        elif isinstance(node, ast.ClassDef):
            members = []
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    symbols[f"method:{node.name}.{child.name}"] = _fingerprint(child)
                else:
                    members.append(child)
            symbols[f"class:{node.name}"] = hashlib.sha256(
                repr(([_fingerprint(base) for base in node.bases],
                      [_fingerprint(dec) for dec in node.decorator_list],
                      [_fingerprint(child) for child in members])).encode("utf-8")
            ).hexdigest()[:12]
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            imports.append(_fingerprint(node))
        else:
            other.append(_fingerprint(node))
    return symbols, imports, hashlib.sha256(repr(other).encode("utf-8")).hexdigest()[:12], None


def summarize(path: str, before: bytes | None, after: bytes | None) -> dict[str, Any]:
    changed = before != after
    if path.endswith(".py") and max(len(before or b""), len(after or b"")) <= MAX_SOURCE_BYTES:
        old_symbols, old_imports, old_other, old_error = _structure(before)
        new_symbols, new_imports, new_other, new_error = _structure(after)
        if not old_error and not new_error:
            added = sorted(new_symbols.keys() - old_symbols.keys())
            removed = sorted(old_symbols.keys() - new_symbols.keys())
            modified = sorted(key for key in new_symbols.keys() & old_symbols.keys()
                              if new_symbols[key] != old_symbols[key])
            return {"kind": "python-ast", "added": added[:20], "removed": removed[:20],
                    "modified": modified[:20], "imports_changed": old_imports != new_imports,
                    "module_changed": old_other != new_other,
                    "source_changed": changed,
                    "truncated": max(0, len(added) - 20) + max(0, len(removed) - 20) + max(0, len(modified) - 20)}
        return {"kind": "python-unparsed", "error": new_error or old_error, "source_changed": changed}
    kind = "large" if max(len(before or b""), len(after or b"")) > MAX_SOURCE_BYTES else "file"
    return {"kind": kind, "before_bytes": len(before or b""), "after_bytes": len(after or b""),
            "source_changed": changed}


def risks(path: str, content: bytes | None, symlink: bool = False) -> list[str]:
    found: list[str] = []
    parts = PurePosixPath(path.replace("\\", "/")).parts
    if any(part.lower() in PRIVATE_PARTS or part.lower().startswith(".env") for part in parts):
        found.append("diretório local ou configuração privada")
    if PurePosixPath(path).suffix.lower() in PRIVATE_SUFFIXES or PurePosixPath(path).name.lower() in {"id_rsa", "id_ed25519"}:
        found.append("extensão ou nome sensível")
    if symlink:
        found.append("link simbólico")
    if content is not None:
        if len(content) > MAX_SOURCE_BYTES:
            found.append("arquivo grande exige revisão manual")
        if b"\0" in content[:8192]:
            found.append("arquivo binário exige revisão manual")
        if any(pattern.search(content) for pattern in SECRET_PATTERNS):
            found.append("possível credencial no conteúdo")
    return found


def inspect(repo: GitRepository, *, staged_only: bool = False) -> dict[str, Any]:
    head = repo.head_tree()
    index = repo.index_tree()
    files: list[dict[str, Any]] = []
    for entry in repo.status():
        name = entry["path"]
        state = entry["status"]
        old = repo.blob(head.get(entry.get("old_path", name)))
        staged = repo.blob(index.get(name))
        item: dict[str, Any] = {"path": name, "status": state}
        if "old_path" in entry:
            item["old_path"] = entry["old_path"]
        if state[0] not in (" ", "?"):
            item["staged"] = summarize(name, old, staged)
            item["risks"] = risks(name, staged)
        if not staged_only and (state[1] != " " or state == "??"):
            current, symlink = repo.worktree(name)
            item["worktree"] = summarize(name, staged if state[0] != " " else old, current)
            item["worktree_risks"] = risks(name, current, symlink)
        if not staged_only or "staged" in item:
            files.append(item)
    return {"ok": True, "files": files}


def _safe_path(repo: GitRepository, name: str) -> str:
    relative = PurePosixPath(name.replace("\\", "/"))
    if not name or relative.is_absolute() or ".." in relative.parts or ":" in name:
        raise ValueError(f"Caminho inválido: {name}")
    target = (repo.root / Path(*relative.parts)).resolve()
    if not target.is_relative_to(repo.root.resolve()) or (repo.root / Path(*relative.parts)).is_symlink():
        raise ValueError(f"Caminho fora do repositório ou link simbólico: {name}")
    if target.exists() and not target.is_file():
        raise ValueError(f"Use arquivos específicos, não diretórios: {name}")
    return relative.as_posix()


def commit(repo: GitRepository, names: list[str], message: str) -> dict[str, Any]:
    if not message.strip():
        raise ValueError("A mensagem do commit não pode ficar vazia.")
    before = repo.status()
    if any(item["status"][0] not in (" ", "?") for item in before):
        raise ValueError("Já há arquivos staged; preserve-os e resolva a seleção antes de usar commit.")
    selected = [_safe_path(repo, name) for name in names]
    if len(set(selected)) != len(selected):
        raise ValueError("Há caminhos repetidos na seleção.")
    candidates = {item["path"]: item for item in before}
    if any(name not in candidates for name in selected):
        raise ValueError("Todos os caminhos devem aparecer no status como alterações locais.")
    preview = inspect(repo)
    for item in preview["files"]:
        if item["path"] in selected and item.get("worktree_risks"):
            raise ValueError(f"Revisão necessária em {item['path']}: {', '.join(item['worktree_risks'])}")
    repo.git("add", "--", *selected)
    staged = inspect(repo, staged_only=True)
    staged_paths = {item["path"] for item in staged["files"]}
    if staged_paths != set(selected):
        raise ValueError(f"Seleção staged divergiu dos caminhos pedidos: {sorted(staged_paths)}")
    for item in staged["files"]:
        if item.get("risks"):
            raise ValueError(f"Revisão necessária em {item['path']}: {', '.join(item['risks'])}")
    repo.git("commit", "-m", message)
    oid = repo.git("rev-parse", "HEAD").decode("ascii").strip()
    committed_tree = repo.head_tree()
    parent_tree = repo.tree("HEAD^")
    actual_paths = sorted(name for name in committed_tree.keys() | parent_tree.keys()
                          if committed_tree.get(name) != parent_tree.get(name))
    return {"ok": True, "hash": oid, "message": message, "files": sorted(staged_paths),
            "actual_files": actual_paths,
            "unexpected_files": sorted(set(actual_paths) - staged_paths),
            "remaining": len(repo.status())}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resumo estrutural AST e commits Git sem diffs textuais ou logs.")
    parser.add_argument("--repo", type=Path, default=Path("."))
    commands = parser.add_subparsers(dest="command", required=True)
    read = commands.add_parser("inspect", help="Inspeciona alterações e imprime JSON compacto.")
    read.add_argument("--staged-only", action="store_true")
    write = commands.add_parser("commit", help="Prepara arquivos explícitos, revisa e cria um commit.")
    write.add_argument("-m", "--message", required=True)
    write.add_argument("--path", action="append", required=True, dest="paths")
    args = parser.parse_args(argv)
    try:
        repo = GitRepository(args.repo)
        result = inspect(repo, staged_only=args.staged_only) if args.command == "inspect" else commit(repo, args.paths, args.message)
        compact(result)
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        compact({"ok": False, "error": str(exc)})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
