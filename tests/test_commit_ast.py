import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/commit_ast.py"


class CommitAstTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Forge Test")
        self.git("config", "user.email", "forge@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        (self.repo / "calc.py").write_text("def total(x):\n    return x + 1\n", encoding="utf-8")
        self.git("add", "--", "calc.py")
        self.git("commit", "-q", "-m", "initial")

    def git(self, *arguments):
        return subprocess.run(
            ["git", "-C", str(self.repo), *arguments],
            capture_output=True, text=True, check=True,
        ).stdout.strip()

    def invoke(self, *arguments):
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--repo", str(self.repo), *arguments],
            capture_output=True, text=True, encoding="utf-8", check=False,
        )
        return result.returncode, json.loads(result.stdout)

    def test_inspect_and_commit_python_function_without_text_diff(self):
        (self.repo / "calc.py").write_text("def total(x):\n    return x + 2\n", encoding="utf-8")
        code, report = self.invoke("inspect")
        self.assertEqual(code, 0)
        self.assertEqual(report["files"][0]["worktree"]["modified"], ["function:total"])
        code, committed = self.invoke("commit", "-m", "fix: ajustar total", "--path", "calc.py")
        self.assertEqual(code, 0, committed)
        self.assertEqual(committed["hash"], self.git("rev-parse", "HEAD"))
        self.assertEqual(committed["files"], ["calc.py"])
        self.assertEqual(committed["actual_files"], ["calc.py"])
        self.assertEqual(committed["unexpected_files"], [])
        self.assertEqual(committed["remaining"], 0)

    def test_private_file_and_credential_are_rejected_before_staging(self):
        (self.repo / ".env").write_text("EXAMPLE=local\n", encoding="utf-8")
        code, report = self.invoke("commit", "-m", "add config", "--path", ".env")
        self.assertEqual(code, 2)
        self.assertIn("Revisão necessária", report["error"])
        (self.repo / "public.txt").write_text("github_pat_" + "x" * 24, encoding="utf-8")
        code, report = self.invoke("commit", "-m", "add text", "--path", "public.txt")
        self.assertEqual(code, 2)
        self.assertIn("possível credencial", report["error"])
        self.assertEqual(self.git("ls-files", "--stage", "--", ".env", "public.txt"), "")

    def test_existing_staged_selection_is_preserved(self):
        (self.repo / "other.py").write_text("def other():\n    pass\n", encoding="utf-8")
        self.git("add", "--", "other.py")
        (self.repo / "calc.py").write_text("def total(x):\n    return x + 3\n", encoding="utf-8")
        code, report = self.invoke("commit", "-m", "fix: ajustar total", "--path", "calc.py")
        self.assertEqual(code, 2)
        self.assertIn("Já há arquivos staged", report["error"])
        self.assertIn("other.py", self.git("ls-files", "--stage", "--", "other.py"))


if __name__ == "__main__":
    unittest.main()
