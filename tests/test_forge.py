import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
import json
from io import StringIO
import subprocess
import sys
import zipfile
from types import SimpleNamespace
from unittest.mock import patch
try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 continua suportado pelo pacote.
    tomllib = None

from forge import build_report, derive, normalize_spec, render_agent
from nestor_forge.cli import Console, ForgeCli, readchar
from nestor_forge.compiler import BuildArtifacts, FileSystemArtifactWriter, ForgeCompiler
from nestor_forge.targets import ClaudePluginRenderer, UnifiedProjectRenderer
from scripts.build_site import build_site


def base_spec():
    return {
        "profile": "reader",
        "name": "Auditor",
        "role": "um auditor de código",
        "mission": "verificar tokens de autenticação",
        "code_rules": ["Verificar autenticação por rota"],
        "analysis_pipeline": ["Mapear rotas", "Validar evidências"],
        "permissions": {
            "read_code": True,
            "run_analysis_tools": False,
            "run_active_tests": False,
            "write_code": False,
        },
    }


class ForgeOutputTests(unittest.TestCase):
    def test_agent_runner_lists_same_24_questions_with_profile_defaults(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [sys.executable, "-B", str(root / "scripts/agent_run.py"), "questions", "--profile", "coder"],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        questionnaire = json.loads(result.stdout)
        self.assertEqual(len(questionnaire["questions"]), 24)
        defaults = {row[0]: row[3] for row in questionnaire["questions"]}
        self.assertTrue(defaults["permissions.write_code"])
        self.assertEqual(questionnaire["required"], ["role", "mission"])

    def test_agent_runner_compiles_answers_and_reports_files(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            output = Path(directory) / "agent"
            result = subprocess.run(
                [sys.executable, "-B", str(root / "scripts/agent_run.py"), "run",
                 "--answers", str(root / "examples/agent-answers.json"), "--output", str(output)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report["ok"])
            self.assertIn("BUILD_REPORT.md", report["files"])
            self.assertEqual(report["build_report"], str((output / "BUILD_REPORT.md").resolve()))
            self.assertIn("autenticação", (output / "agent.md").read_text(encoding="utf-8"))

    def test_agent_runner_rejects_wrong_answer_type(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, "-B", str(root / "scripts/agent_run.py"), "run",
                 "--answers", "-", "--output", directory],
                input=json.dumps({"role": "Auditor", "mission": "Verificar código", "focus": "uma string"}),
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("focus deve ser uma lista", json.loads(result.stdout)["error"])
            self.assertEqual(list(Path(directory).iterdir()), [])

    @unittest.skipIf(Console is None or readchar is None, "Menu Rich indisponível")
    def test_rich_menu_moves_selection_with_down_arrow(self):
        output = StringIO()
        cli = ForgeCli()
        cli.console = Console(file=output, force_terminal=False)
        fake_sys = SimpleNamespace(
            stdin=SimpleNamespace(isatty=lambda: True),
            stdout=SimpleNamespace(isatty=lambda: True),
        )
        with patch("nestor_forge.cli.sys", fake_sys), patch(
            "nestor_forge.cli.readchar.readkey",
            side_effect=[readchar.key.DOWN, readchar.key.ENTER],
        ):
            selected = cli.select_menu(
                "Perfis disponíveis",
                [("reader", "reader", "Leitura"), ("coder", "coder", "Código")],
                default="reader", column_name="Perfil",
            )
        self.assertEqual(selected, "coder")
        self.assertIn("Perfis disponíveis", output.getvalue())

    def test_cli_exits_cleanly_when_interactive_input_ends(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [sys.executable, "-B", str(root / "forge.py")],
            input="", capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 130)
        self.assertIn("Operação cancelada", result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def test_cli_builds_from_existing_json(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            spec_path = Path(directory) / "spec.json"
            output_dir = Path(directory) / "output"
            spec_path.write_text(json.dumps(base_spec()), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-B", str(root / "forge.py"), str(spec_path),
                 "--output", str(output_dir)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((output_dir / "agent.md").is_file())
            self.assertTrue((output_dir / "BUILD_REPORT.md").is_file())

    def test_cli_init_writes_packaged_template(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, "-B", str(root / "forge.py"), "--init", "--output", directory],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            template = json.loads((Path(directory) / "spec.template.json").read_text(encoding="utf-8"))
            self.assertIn("_instructions", template)

    def test_site_build_generates_python_assets_outside_source_site(self):
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(list((root / "site").rglob("*.py")), [])
        with TemporaryDirectory() as directory:
            output = build_site(Path(directory) / "site")
            self.assertTrue((output / "forge-worker.js").is_file())
            self.assertEqual(
                {path.name for path in (output / "nestor_forge").glob("*.py")},
                {"__init__.py", "compiler.py", "domain.py", "renderers.py", "targets.py"},
            )
            self.assertIn('href="./downloads/agentes-contexto-importavel.zip"', (output / "index.html").read_text(encoding="utf-8"))
            archive = output / "downloads" / "agentes-contexto-importavel.zip"
            with zipfile.ZipFile(archive) as agents:
                names = set(agents.namelist())
                self.assertEqual(len(names), 21)
                self.assertIn("agentorchestra-package.json", names)
                self.assertIn("install.sh", names)
                self.assertIn("files/.agents/skills/leitura-de-projeto/AGENTES-CONTEXTO.md", names)
                manifest = json.loads(agents.read("agentorchestra-package.json"))
                self.assertEqual(len(manifest["entrypoints"]), 3)
                for slug in ("leitura-de-projeto", "historico-git", "contexto-de-stack"):
                    self.assertIn(f"files/.agentorchestra/specs/{slug}.json", names)
                    self.assertIn(f"files/.agents/skills/{slug}/SKILL.md", names)
                    self.assertIn(f"files/.claude/agents/{slug}.md", names)
                    self.assertIn(f"files/.codex/agents/{slug}.toml", names)
                    spec = json.loads(agents.read(f"files/.agentorchestra/specs/{slug}.json"))
                    self.assertFalse(spec["permissions"]["write_code"])
                    self.assertFalse(spec["permissions"]["run_active_tests"])
            target = Path(directory) / "project"
            target.mkdir()
            for command in ("inspect", "import"):
                result = subprocess.run(
                    [sys.executable, "-B", str(root / "vscode-extension" / "backend" / "share.py"),
                     command, "--archive", str(archive), "--target", str(target)],
                    capture_output=True, text=True, check=False, encoding="utf-8",
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                report = json.loads(result.stdout)
                self.assertTrue(report["ok"])
                self.assertEqual(len(report["files"]), 19)
            for slug in ("leitura-de-projeto", "historico-git", "contexto-de-stack"):
                self.assertTrue((target / ".codex" / "agents" / f"{slug}.toml").is_file())
                self.assertTrue((target / ".claude" / "agents" / f"{slug}.md").is_file())
            update_manifest = output / "updates" / "agentorchestra.json"
            version = json.loads((root / "vscode-extension" / "package.json").read_text(encoding="utf-8"))["version"]
            package = root / "dist" / f"agentorchestra-{version}.vsix"
            if package.is_file():
                import hashlib
                release = json.loads(update_manifest.read_text(encoding="utf-8"))
                self.assertEqual(release["version"], version)
                self.assertEqual(release["extensionId"], "CarlosEFranco.nestor-forge-agent-orchestra")
                self.assertEqual(release["url"], f"../downloads/agentorchestra-{version}.vsix")
                self.assertEqual(release["sha256"], hashlib.sha256(package.read_bytes()).hexdigest())
                self.assertEqual(release["size"], package.stat().st_size)
            else:
                self.assertFalse(update_manifest.exists())

    def test_compiler_and_writer_preserve_existing_output(self):
        artifacts = ForgeCompiler().compile(base_spec())
        self.assertEqual(artifacts.files["agent.md"], render_agent(artifacts.normalized_spec, artifacts.derived_spec))
        self.assertEqual(artifacts.files["BUILD_REPORT.md"], build_report(artifacts.normalized_spec, artifacts.derived_spec))
        with TemporaryDirectory() as directory:
            paths = FileSystemArtifactWriter().write(artifacts, Path(directory))
            self.assertEqual(set(path.name for path in paths), set(artifacts.files))
            for path in paths:
                self.assertEqual(path.read_text(encoding="utf-8"), artifacts.files[path.name])

    def test_writer_rejects_paths_outside_output_directory(self):
        artifacts = BuildArtifacts({}, {}, {"../outside.md": "conteúdo"})
        with TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                FileSystemArtifactWriter().write(artifacts, Path(directory))

    def test_custom_renderer_can_write_nested_target_artifacts(self):
        class PluginRenderer:
            def render(self, spec, derived):
                return {"skills/auditor/SKILL.md": f"# {spec['name']}"}

        artifacts = ForgeCompiler(PluginRenderer()).compile(base_spec())
        with TemporaryDirectory() as directory:
            paths = FileSystemArtifactWriter().write(artifacts, Path(directory))
            self.assertEqual(paths[0].read_text(encoding="utf-8"), "# Auditor")

    def test_claude_plugin_has_one_instruction_source(self):
        artifacts = ForgeCompiler(ClaudePluginRenderer()).compile(base_spec())
        with TemporaryDirectory() as directory:
            output = Path(directory)
            FileSystemArtifactWriter().write(artifacts, output)
            manifest = json.loads((output / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))
            skill = (output / "skills/auditor/SKILL.md").read_text(encoding="utf-8")
            agent = (output / "agents/auditor.md").read_text(encoding="utf-8")
            self.assertEqual(manifest["name"], "auditor")
            self.assertIn("verificar tokens de autenticação", skill)
            self.assertIn("skills:\n  - auditor", agent)
            self.assertNotIn("# PRINCÍPIOS CENTRAIS", agent)

    def test_claude_agent_only_is_self_contained(self):
        artifacts = ForgeCompiler(ClaudePluginRenderer("agent")).compile(base_spec())
        self.assertNotIn("skills/auditor/SKILL.md", artifacts.files)
        self.assertIn("Verificar autenticação por rota", artifacts.files["agents/auditor.md"])

    def test_cli_writes_claude_plugin(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            spec_path = Path(directory) / "spec.json"
            output = Path(directory) / "plugin"
            spec_path.write_text(json.dumps(base_spec()), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-B", str(root / "forge.py"), str(spec_path),
                 "--target", "claude-plugin", "--output", str(output)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((output / ".claude-plugin/plugin.json").is_file())
            self.assertTrue((output / "skills/auditor/SKILL.md").is_file())

    def test_project_install_preserves_existing_files(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            project = Path(directory) / "project"
            project.mkdir()
            spec_path = Path(directory) / "spec.json"
            spec_path.write_text(json.dumps(base_spec()), encoding="utf-8")
            command = [sys.executable, "-B", str(root / "forge.py"), str(spec_path),
                       "--target", "claude-project", "--output", str(project)]
            first = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)
            skill = project / ".claude/skills/auditor/SKILL.md"
            agent = project / ".claude/agents/auditor.md"
            self.assertTrue(skill.is_file())
            self.assertTrue(agent.is_file())
            skill.write_text("alteração manual", encoding="utf-8")
            second = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(second.returncode, 2)
            self.assertEqual(skill.read_text(encoding="utf-8"), "alteração manual")
            forced = subprocess.run(command + ["--force"], capture_output=True, text=True, check=False)
            self.assertEqual(forced.returncode, 0, forced.stderr)
            self.assertIn("verificar tokens", skill.read_text(encoding="utf-8"))

    def test_unified_project_routes_to_one_canonical_skill(self):
        artifacts = ForgeCompiler(UnifiedProjectRenderer()).compile(base_spec())
        files = artifacts.files
        canonical = ".agents/skills/auditor/SKILL.md"
        self.assertIn("Verificar autenticação por rota", files[canonical])
        self.assertNotIn("Verificar autenticação por rota", files[".claude/skills/auditor/SKILL.md"])
        self.assertIn("../../../.agents/skills/auditor/SKILL.md", files[".claude/skills/auditor/SKILL.md"])
        if tomllib is not None:
            route = tomllib.loads(files[".agents/routes/auditor.toml"])
            codex = tomllib.loads(files[".codex/agents/auditor.toml"])
            self.assertEqual(route["skill"], canonical)
            self.assertEqual(route["claude"]["agent"], ".claude/agents/auditor.md")
            self.assertEqual(route["codex"]["agent"], ".codex/agents/auditor.toml")
            self.assertIn(canonical, codex["developer_instructions"])

    def test_cli_installs_unified_project_without_overwriting(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            project = Path(directory) / "project"
            project.mkdir()
            spec_path = Path(directory) / "spec.json"
            spec_path.write_text(json.dumps(base_spec()), encoding="utf-8")
            command = [sys.executable, "-B", str(root / "forge.py"), str(spec_path),
                       "--target", "unified-project", "--output", str(project)]
            first = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertTrue((project / ".agents/routes/auditor.toml").is_file())
            self.assertTrue((project / ".codex/agents/auditor.toml").is_file())
            self.assertTrue((project / ".claude/agents/auditor.md").is_file())
            second = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(second.returncode, 2)

    def test_read_only_auditor_keeps_code_checks_and_permissions(self):
        spec = normalize_spec(base_spec())
        derived = derive(spec)
        agent = render_agent(spec, derived)
        report = build_report(spec, derived)

        self.assertIn("Verificar autenticação por rota", agent)
        self.assertIn("não deve alterar arquivos", agent)
        self.assertIn("Executar ferramentas de análise: não permitido", agent)
        self.assertIn("Executar testes ativos: exige autorização", agent)
        self.assertEqual(derived["analysis_pipeline"], ["Mapear rotas", "Validar evidências"])
        self.assertIn("Verificar autenticação por rota", report)
        self.assertIn("Validar evidências", report)

    def test_authentication_tokens_do_not_force_json(self):
        spec = normalize_spec(base_spec())
        derived = derive(spec)

        self.assertFalse(derived["traits"]["token_economy"])
        self.assertEqual(derived["output_contract"]["preferred"], "markdown")

    def test_explicit_output_contract_and_list_cleanup(self):
        raw = base_spec()
        raw["output_contract"] = {
            "preferred": "json",
            "machine_readable": True,
            "required_fields": ["• Evidências", "2. Impacto"],
        }
        spec = normalize_spec(raw)
        derived = derive(spec)
        agent = render_agent(spec, derived)

        self.assertEqual(derived["output_contract"]["required_fields"], ["Evidências", "Impacto"])
        self.assertIn("Formato preferencial: **JSON**", agent)
        self.assertIn("- Evidências", agent)
        self.assertIn("- Impacto", agent)


if __name__ == "__main__":
    unittest.main()
