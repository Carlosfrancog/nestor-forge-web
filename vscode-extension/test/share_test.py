"""Integração e validação de pacotes portáteis de agentes."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from share import export_package, import_package, inspect_package, read_package  # noqa: E402


class SharePackageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="agentorchestra-share-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.source = self.base / "source"
        self.target = self.base / "target"
        self.source.mkdir()
        self.target.mkdir()

    def write(self, relative: str, content: str) -> Path:
        file = self.source / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding="utf-8")
        return file

    def example(self) -> Path:
        self.write(".agents/skills/orders/SKILL.md", "# Orders\nLeia [o guia](references/guide.md).\n")
        self.write(".agents/skills/orders/references/guide.md", "# Guia\n")
        self.write(".agents/skills/orders/scripts/analyze.py", "print('orders')\n")
        self.write(".claude/skills/orders/SKILL.md", "# Orders\n[a instrução](../../../.agents/skills/orders/SKILL.md)\n")
        agent = self.write(".claude/agents/orders.md", "---\nname: orders\nskills:\n  - orders\n---\n\nLeia .agents/skills/orders/SKILL.md.\n")
        self.write(".codex/agents/orders.toml", 'name = "orders"\ndeveloper_instructions = "Leia .agents/skills/orders/SKILL.md"\n')
        self.write(".agents/routes/orders.toml", 'skill = ".agents/skills/orders/SKILL.md"\n[claude]\nagent = ".claude/agents/orders.md"\n')
        self.write(".agentorchestra/specs/orders.json", '{"name":"orders"}\n')
        return agent

    def test_export_and_import_keep_related_files_and_paths(self) -> None:
        agent = self.example()
        archive = self.base / "orders.zip"
        result = export_package(self.source, agent, archive)
        self.assertEqual(len(result["files"]), 8)
        with zipfile.ZipFile(archive) as package:
            self.assertIn("install.sh", package.namelist())
            self.assertIn("files/.agents/skills/orders/scripts/analyze.py", package.namelist())
        preview = inspect_package(archive, self.target)
        self.assertEqual(preview["conflicts"], [])
        imported = import_package(archive, self.target)
        self.assertEqual(imported["files"], result["files"])
        self.assertEqual((self.target / ".claude/skills/orders/SKILL.md").read_text(encoding="utf-8"),
                         (self.source / ".claude/skills/orders/SKILL.md").read_text(encoding="utf-8"))
        self.assertTrue((self.target / ".agents/skills/orders/scripts/analyze.py").is_file())

    def test_conflict_prevents_any_file_from_being_installed(self) -> None:
        archive = self.base / "orders.zip"
        export_package(self.source, self.example(), archive)
        existing = self.target / ".codex/agents/orders.toml"
        existing.parent.mkdir(parents=True)
        existing.write_text("keep me", encoding="utf-8")
        self.assertEqual(inspect_package(archive, self.target)["conflicts"], [".codex/agents/orders.toml"])
        with self.assertRaisesRegex(ValueError, "Arquivos existentes"):
            import_package(archive, self.target)
        self.assertEqual(existing.read_text(encoding="utf-8"), "keep me")
        self.assertFalse((self.target / ".claude/agents/orders.md").exists())

    def test_codex_selection_includes_skills_required_by_related_claude_agent(self) -> None:
        self.example()
        self.write(".claude/agents/orders.md", "---\nname: orders\nskills: [orders, helper]\n---\n\n# Orders\n")
        self.write(".claude/skills/helper/SKILL.md", "# Helper\n")
        archive = self.base / "orders.zip"
        export_package(self.source, self.source / ".codex/agents/orders.toml", archive)
        _, payload = read_package(archive)
        self.assertIn(".claude/skills/helper/SKILL.md", payload)

    def test_codex_skill_can_be_shared_from_tree(self) -> None:
        skill = self.write(".codex/skills/review_checks/SKILL.md", "# Review checks\n")
        self.write(".codex/skills/review_checks/scripts/analyze.py", "print('ok')\n")
        archive = self.base / "review_checks.zip"
        export_package(self.source, skill, archive)
        import_package(archive, self.target)
        self.assertTrue((self.target / ".codex/skills/review_checks/scripts/analyze.py").is_file())

    def test_export_does_not_remove_an_existing_archive(self) -> None:
        archive = self.base / "orders.zip"
        archive.write_bytes(b"original")
        with self.assertRaises(FileExistsError):
            export_package(self.source, self.example(), archive)
        self.assertEqual(archive.read_bytes(), b"original")

    def test_rejects_path_traversal_and_tampered_payload(self) -> None:
        archive = self.base / "bad.zip"
        data = b"hello"
        manifest = {"schemaVersion": 1, "entrypoint": "../escape.md",
                    "files": [{"path": "../escape.md", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}]}
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("agentorchestra-package.json", json.dumps(manifest))
            package.writestr("install.sh", "exit 0\n")
            package.writestr("files/../escape.md", data)
        with self.assertRaisesRegex(ValueError, "Caminho inválido"):
            read_package(archive)
        self.assertFalse((self.base / "escape.md").exists())

        valid = self.base / "valid.zip"
        export_package(self.source, self.example(), valid)
        with zipfile.ZipFile(valid) as package:
            manifest = json.loads(package.read("agentorchestra-package.json"))
            files = {name: package.read(name) for name in package.namelist() if name.startswith("files/")}
            installer = package.read("install.sh")
        manifest["files"][0]["sha256"] = "0" * 64
        tampered = self.base / "tampered.zip"
        with zipfile.ZipFile(tampered, "w") as package:
            package.writestr("agentorchestra-package.json", json.dumps(manifest))
            package.writestr("install.sh", installer)
            for name, content in files.items():
                package.writestr(name, content)
        with self.assertRaisesRegex(ValueError, "Conteúdo inválido"):
            read_package(tampered)

        changed_installer = self.base / "changed-installer.zip"
        manifest["files"][0]["sha256"] = hashlib.sha256(files[f"files/{manifest['files'][0]['path']}"]).hexdigest()
        with zipfile.ZipFile(changed_installer, "w") as package:
            package.writestr("agentorchestra-package.json", json.dumps(manifest))
            package.writestr("install.sh", "echo unexpected\n")
            for name, content in files.items():
                package.writestr(name, content)
        with self.assertRaisesRegex(ValueError, "instalador"):
            read_package(changed_installer)

    def test_rejects_broken_internal_reference(self) -> None:
        agent = self.write(".claude/agents/reviewer.md", "---\nname: reviewer\n---\n\n[guia](../../../README.md)\n")
        with self.assertRaisesRegex(ValueError, "Caminho inválido"):
            export_package(self.source, agent, self.base / "reviewer.zip")

    @unittest.skipUnless(os.name != "nt" and shutil.which("sh"), "Requer shell POSIX")
    def test_manual_shell_installer_uses_project_relative_paths(self) -> None:
        archive = self.base / "orders.zip"
        export_package(self.source, self.example(), archive)
        unpacked = self.base / "unpacked"
        with zipfile.ZipFile(archive) as package:
            package.extractall(unpacked)
        subprocess.run(["sh", str(unpacked / "install.sh"), str(self.target)], check=True, capture_output=True)
        self.assertTrue((self.target / ".agents/skills/orders/SKILL.md").is_file())
        self.assertTrue((self.target / ".claude/agents/orders.md").is_file())

    @unittest.skipUnless(os.name != "nt" and shutil.which("sh"), "Requer shell POSIX")
    def test_manual_shell_installer_rejects_symlinked_destination(self) -> None:
        archive = self.base / "orders.zip"
        export_package(self.source, self.example(), archive)
        unpacked = self.base / "unpacked"
        with zipfile.ZipFile(archive) as package:
            package.extractall(unpacked)
        outside = self.base / "outside"
        outside.mkdir()
        (self.target / ".agents").symlink_to(outside, target_is_directory=True)
        result = subprocess.run(["sh", str(unpacked / "install.sh"), str(self.target)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list(outside.iterdir()))


if __name__ == "__main__":
    unittest.main()
