"""Interface de terminal para compilar agentes."""
from __future__ import annotations

from contextlib import nullcontext
from importlib.resources import files
from pathlib import Path
from typing import Any
import argparse
import json
import sys

from .compiler import FileSystemArtifactWriter, ForgeCompiler
from .domain import PROFILES
from .questions import questions
from .targets import ClaudePluginRenderer, ClaudeProjectRenderer, UnifiedProjectRenderer

try:
    from rich.console import Console
    from rich.markup import escape
    from rich.live import Live
    from rich.panel import Panel
    from rich.prompt import Confirm, Prompt
    from rich.table import Table
    from rich.text import Text
except ImportError:  # O compilador também funciona sem a dependência visual.
    Console = None

try:
    import readchar
except ImportError:  # A seleção por setas requer instalação do pacote de CLI.
    readchar = None


class ForgeCli:
    """Controla o assistente e a apresentação, sem lógica de compilação."""

    def __init__(self) -> None:
        self.console = Console() if Console is not None else None
        self.json_report = False

    def show(self, message: str) -> None:
        if self.console is not None:
            self.console.print(message)
        else:
            print(message)

    def input(self, prompt: str) -> str:
        if self.console is not None:
            return self.console.input(prompt)
        return input(prompt)

    def select_menu(
        self, label: str, choices: list[tuple[str, Any, str]],
        default: Any = None, column_name: str = "Opção",
    ) -> Any | None:
        """Move uma seta em uma tabela Rich sem substituir a tabela por outro menu."""
        if self.console is None or readchar is None or not sys.stdin.isatty() or not sys.stdout.isatty():
            return None

        index = next((i for i, (_, value, _) in enumerate(choices) if value == default), 0)
        has_description = any(description for _, _, description in choices)

        def render() -> Table:
            table = Table(
                title=label, caption="↑/↓ mover · Enter selecionar",
                header_style="bold cyan", border_style="cyan", show_header=True,
            )
            table.add_column("", width=2, no_wrap=True, style="bold cyan")
            table.add_column("#", width=2, justify="right", style="cyan")
            table.add_column(column_name, style="bold")
            if has_description:
                table.add_column("Descrição")
            for i, (name, _, description) in enumerate(choices):
                active = i == index
                cells = ["❯" if active else "", str(i + 1), Text(name, style="bold cyan" if active else "")]
                if has_description:
                    cells.append(Text(description, style="cyan" if active else ""))
                table.add_row(*cells)
            return table

        with Live(render(), console=self.console, auto_refresh=False, transient=False) as live:
            live.refresh()
            while True:
                pressed = readchar.readkey()
                if pressed == readchar.key.UP:
                    index = (index - 1) % len(choices)
                elif pressed == readchar.key.DOWN:
                    index = (index + 1) % len(choices)
                elif pressed in (readchar.key.ENTER, "\r", "\n"):
                    return choices[index][1]
                else:
                    continue
                live.update(render(), refresh=True)

    def banner(self) -> None:
        if self.console is not None:
            self.console.print(Panel.fit(
                "[bold]NESTOR FORGE[/bold]\n[dim]Compilador de agentes · v0.3[/dim]",
                border_style="cyan", padding=(1, 3),
            ))
        else:
            print("\n=== Nestor Forge v0.3 ===")
            print("Assistente para criação de especificações de agentes.\n")

    def ask(self, label: str, default: str = "") -> str:
        if self.console is not None:
            value = Prompt.ask(label, default=default or None, console=self.console).strip()
        else:
            suffix = f" [{default}]" if default else ""
            value = self.input(f"{label}{suffix}\n> ").strip()
        return value or default

    def ask_yes_no(self, label: str, default: bool = True) -> bool:
        selected = self.select_menu(
            label, [("Sim", True, ""), ("Não", False, "")], default=default,
        )
        if selected is not None:
            return selected
        if self.console is not None:
            return Confirm.ask(label, default=default, console=self.console)
        answer = self.input(f"{label} [{'S/n' if default else 's/N'}]\n> ").strip().lower()
        return default if not answer else answer in ("s", "sim", "y", "yes")

    def ask_output_format(self) -> str:
        selected = self.select_menu(
            "Formato de saída", [("Markdown", "markdown", ""), ("JSON", "json", "")], default="markdown",
        )
        if selected is not None:
            return selected
        if self.console is not None:
            return Prompt.ask(
                "Formato de saída", choices=["markdown", "json"],
                default="markdown", console=self.console,
            )
        while True:
            value = self.ask("Formato de saída preferido (markdown/json)", "markdown").lower()
            if value in ("markdown", "json"):
                return value
            self.show("Escolha markdown ou json.")

    def ask_list(self, label: str, defaults: list[str] | None = None) -> list[str]:
        defaults = defaults or []
        self.show(f"\n[bold]{escape(label)}[/bold]" if self.console is not None else f"\n{label}")
        if defaults:
            self.show("[dim]Padrões sugeridos:[/dim]" if self.console is not None else "Padrões sugeridos:")
            for item in defaults:
                self.show(f"  • {escape(item)}" if self.console is not None else f"  - {item}")
            self.show("Enter vazio sem adicionar nada mantém os padrões.")
        self.show("Digite um item por linha. Enter vazio encerra.")
        items = []
        while True:
            value = self.input("[cyan]>[/cyan] " if self.console is not None else "> ").strip()
            if not value:
                break
            items.append(value)
        return items or defaults

    def choose_profile(self) -> str:
        keys = list(PROFILES)
        selected = self.select_menu(
            "Perfis disponíveis",
            [(key, key, PROFILES[key]["description"]) for key in keys]
            + [("custom", "custom", "Sem perfil predefinido")],
            default=keys[0],
            column_name="Perfil",
        )
        if selected is not None:
            return selected
        if self.console is not None:
            table = Table(title="Perfis disponíveis", show_header=True, header_style="bold cyan")
            table.add_column("#", justify="right", style="cyan")
            table.add_column("Perfil", style="bold")
            table.add_column("Descrição")
            for index, key in enumerate(keys, 1):
                table.add_row(str(index), key, PROFILES[key]["description"])
            table.add_row(str(len(keys) + 1), "custom", "Sem perfil predefinido")
            self.console.print(table)
        else:
            self.show("\nPerfis disponíveis:")
            for index, key in enumerate(keys, 1):
                self.show(f"{index}. {key:<9} - {PROFILES[key]['description']}")
            self.show(f"{len(keys) + 1}. custom    - Sem perfil predefinido")
        while True:
            answer = self.input("[bold cyan]Perfil[/bold cyan] > " if self.console is not None else "> ").strip().lower()
            if answer.isdigit() and 1 <= int(answer) <= len(keys) + 1:
                return (keys + ["custom"])[int(answer) - 1]
            if answer in PROFILES or answer == "custom":
                return answer
            self.show("[red]Escolha inválida.[/red]" if self.console is not None else "Escolha inválida.")

    def interactive_spec(self) -> dict[str, Any]:
        self.banner()
        profile = self.choose_profile()
        spec: dict[str, Any] = {"profile": profile, "permissions": {"read_code": True}, "output_contract": {}}
        for question in questions(profile)[1:]:
            if question.kind == "list":
                answer = self.ask_list(question.label, question.default)
            elif question.kind == "bool":
                answer = self.ask_yes_no(question.label, question.default)
            elif question.key == "output_contract.preferred":
                answer = self.ask_output_format()
            else:
                answer = self.ask(question.label, question.default)
            section, separator, field = question.key.partition(".")
            if separator:
                spec[section][field] = answer
            else:
                spec[section] = answer
        return spec

    def error(self, message: str) -> int:
        if self.json_report:
            print(json.dumps({"ok": False, "error": message}, ensure_ascii=False, separators=(",", ":")))
            return 2
        if self.console is not None:
            self.console.print(Panel(escape(message), title="Erro", border_style="red"))
        else:
            print(f"Erro: {message}")
        return 2

    def complete(self, output: Path, names: list[str]) -> None:
        if self.console is not None:
            table = Table(title="Pacote pronto", header_style="bold cyan")
            table.add_column("Arquivo")
            for name in names:
                table.add_row(escape(name))
            self.console.print(table)
            self.console.print(f"[green]OK[/green] Salvo em {escape(str(output))}")
        else:
            print(f"Agente compilado em: {output}")

    def help(self) -> None:
        if self.console is None:
            print("Uso: python forge.py [spec.json] [--target generic|claude-plugin|claude-project|unified-project] [--component skill|agent|both] [--output DIR] [--init] [--force]")
            return
        self.console.print(Panel.fit(
            "[bold]NESTOR FORGE[/bold]\n[dim]Compile especificações de agentes[/dim]",
            border_style="cyan", padding=(1, 3),
        ))
        table = Table(title="Comandos", header_style="bold cyan")
        table.add_column("Comando", style="bold")
        table.add_column("Resultado")
        table.add_row("nestor-forge", "Abre o assistente interativo")
        table.add_row("nestor-forge spec.json", "Compila uma especificação existente")
        table.add_row("nestor-forge --init", "Cria um template de especificação")
        table.add_row("--output DIR", "Define a pasta de saída")
        table.add_row("--target claude-plugin", "Cria um plugin para Claude Cowork/Code")
        table.add_row("--target claude-project", "Instala skill/agente na pasta .claude do projeto")
        table.add_row("--target unified-project", "Instala skill central, Claude e Codex no projeto")
        table.add_row("--component skill|agent|both", "Escolhe os componentes do plugin Claude")
        table.add_row("--force", "Substitui arquivos existentes do projeto")
        table.add_row("spec '-' --json-report", "Lê JSON de stdin e devolve relatório JSON compacto")
        self.console.print(table)

    def run(self, argv: list[str] | None = None) -> int:
        parser = argparse.ArgumentParser(description="Nestor Forge v0.3", add_help=False)
        parser.add_argument("-h", "--help", action="store_true", help="Mostra esta ajuda.")
        parser.add_argument("spec", nargs="?", help="Arquivo JSON de especificação, ou '-' para ler JSON da entrada padrão.")
        parser.add_argument("--output")
        parser.add_argument("--target", choices=("generic", "claude-plugin", "claude-project", "unified-project"), default="generic")
        parser.add_argument("--component", choices=ClaudePluginRenderer.COMPONENTS, default="both")
        parser.add_argument("--force", action="store_true")
        parser.add_argument("--init", action="store_true", help="Gera um template de spec.json para preenchimento manual.")
        parser.add_argument("--json-report", action="store_true", help="Emite resultado compacto em JSON, sem interface Rich.")
        args = parser.parse_args(argv)
        self.json_report = args.json_report
        if args.help:
            self.help()
            return 0
        project_target = args.target in ("claude-project", "unified-project")
        output = Path(args.output or ("." if project_target else "./build-agent"))

        if project_target and not args.spec and not args.init:
            return self.error("Para instalar no projeto, informe um spec.json existente.")
        if args.target == "unified-project" and args.component != "both":
            return self.error("O destino unificado requer --component both.")

        if args.init:
            template = files("nestor_forge").joinpath("templates/spec.template.json")
            output.mkdir(parents=True, exist_ok=True)
            target = output / "spec.template.json"
            target.write_text(template.read_text(encoding="utf-8"), encoding="utf-8")
            self.complete(output, [target.name])
            return 0

        if args.spec:
            spec_path = Path(args.spec).expanduser() if args.spec != "-" else None
            if spec_path is not None and not spec_path.is_file():
                return self.error(f"Arquivo de especificação não encontrado: {spec_path.resolve()}")
            try:
                raw = json.loads(sys.stdin.read() if spec_path is None else spec_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                return self.error(f"JSON inválido em {spec_path or 'stdin'}: linha {exc.lineno}, coluna {exc.colno}: {exc.msg}")
        else:
            raw = self.interactive_spec()
            output.mkdir(parents=True, exist_ok=True)
            (output / "spec.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

        try:
            status = self.console.status("Compilando agente…", spinner="dots") if self.console is not None and not self.json_report else nullcontext()
            with status:
                renderer = (
                    ClaudePluginRenderer(args.component) if args.target == "claude-plugin"
                    else ClaudeProjectRenderer(args.component) if args.target == "claude-project"
                    else UnifiedProjectRenderer() if args.target == "unified-project"
                    else None
                )
                artifacts = ForgeCompiler(renderer).compile(raw)
                paths = FileSystemArtifactWriter().write(
                    artifacts, output, overwrite=not project_target or args.force,
                )
        except (TypeError, ValueError) as exc:
            return self.error(f"Especificação inválida: {exc}")
        names = (["spec.json"] if not args.spec else []) + [path.relative_to(output).as_posix() for path in paths]
        if self.json_report:
            report = {
                "ok": True,
                "target": args.target,
                "output": str(output.resolve()),
                "files": names,
            }
            if "BUILD_REPORT.md" in names:
                report["build_report"] = str((output / "BUILD_REPORT.md").resolve())
            print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        else:
            self.complete(output, names)
        return 0


def save_interactive_spec(output_dir: Path) -> Path:
    spec = ForgeCli().interactive_spec()
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "spec.json"
    path.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    cli = ForgeCli()
    try:
        return cli.run(argv)
    except (KeyboardInterrupt, EOFError):
        cli.show("\n[dim]Operação cancelada.[/dim]" if cli.console is not None else "\nOperação cancelada.")
        return 130
