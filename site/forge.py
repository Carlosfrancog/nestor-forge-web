#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any
import argparse
import json
import re
import sys

ALIASES = {
    "golang": "Go",
    "go lang": "Go",
    "vue3": "Vue 3",
    "tailwind 4": "Tailwind CSS 4",
    "kotlhin": "Kotlin",
    "postgress": "PostgreSQL",
    "wss protocols": "WebSocket/WSS",
    "opus protocol": "Opus",
    "hls protocol": "HLS",
    "scss": "SCSS",
    "docker": "Docker",
    "wsl": "WSL",
    "mpedio formal": "formalidade moderada",
    "project maneger": "gerenciamento técnico de projetos",
    "tree sitter": "Tree-sitter",
    "ast-grep": "ast-grep",
}

PROFILES = {
    "reader": {
        "description": "Analisa projetos e produz contexto estruturado para outras LLMs/agentes.",
        "defaults": {
            "principles": [
                "obter fatos deterministicamente antes de pedir interpretação à LLM",
                "separar fatos, inferências, hipóteses e desconhecidos",
                "usar leitura progressiva em vez de leitura massiva de arquivos",
                "reduzir tokens sem perder rastreabilidade",
            ],
            "response_sections": [
                "Diagnóstico", "Estrutura", "Fluxos", "Riscos", "Unknowns"
            ],
        }
    },
    "coder": {
        "description": "Implementa e refatora código com foco em correção e manutenção.",
        "defaults": {
            "principles": [
                "entender o código existente antes de criar novas abstrações",
                "preferir a menor mudança capaz de resolver o problema",
                "validar comportamento com testes",
            ],
            "response_sections": [
                "Diagnóstico", "Plano", "Alterações", "Código", "Validação"
            ],
        }
    },
    "reviewer": {
        "description": "Audita código, arquitetura, riscos e regressões.",
        "defaults": {
            "principles": [
                "priorizar bugs, riscos e regressões sobre preferências de estilo",
                "não confundir opinião arquitetural com falha objetiva",
            ],
            "response_sections": [
                "Achados", "Severidade", "Evidências", "Recomendação"
            ],
        }
    },
    "infra": {
        "description": "Analisa infraestrutura, deploy, observabilidade e runtime.",
        "defaults": {
            "principles": [
                "preservar confiabilidade operacional",
                "medir antes de otimizar",
                "tratar configuração como parte do sistema",
            ],
            "response_sections": [
                "Diagnóstico", "Infraestrutura", "Riscos", "Mudanças", "Validação"
            ],
        }
    },
    "qa": {
        "description": "Projeta e executa estratégia de testes e validações.",
        "defaults": {
            "principles": [
                "testar comportamento observável",
                "priorizar regressões e caminhos críticos",
                "distinguir falha reproduzível de hipótese",
            ],
            "response_sections": [
                "Cenário", "Cobertura", "Casos", "Riscos", "Resultado"
            ],
        }
    },
    "planner": {
        "description": "Planeja execução técnica, decomposição e dependências.",
        "defaults": {
            "principles": [
                "decompor trabalho por dependências reais",
                "evitar etapas sem critério de conclusão",
                "produzir planos verificáveis",
            ],
            "response_sections": [
                "Objetivo", "Etapas", "Dependências", "Riscos", "Critério de aceite"
            ],
        }
    },
    "audio": {
        "description": "Especialista em áudio, streaming, DSP e baixa latência.",
        "defaults": {
            "principles": [
                "tratar áudio como fluxo temporal",
                "expressar latência numericamente quando possível",
                "não alterar buffers sem medir impacto",
            ],
            "response_sections": [
                "Diagnóstico", "Pipeline", "Latência", "Riscos", "Validação"
            ],
        }
    },
}

PIPELINE_HINTS = (
    "map", "mapeie", "identifique", "registre", "extraia", "rastreie",
    "calcule", "localize", "sinalize", "detecte", "gere um grafo",
    "exporte", "crie um sumário", "converta", "agrupe"
)

def ask(label: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{label}{suffix}\n> ").strip()
    return value or default

def ask_yes_no(label: str, default: bool = True) -> bool:
    d = "S/n" if default else "s/N"
    value = input(f"{label} [{d}]\n> ").strip().lower()
    if not value:
        return default
    return value in ("s", "sim", "y", "yes")

def ask_output_format() -> str:
    while True:
        value = ask("Formato de saída preferido (markdown/json)", "markdown").lower()
        if value in ("markdown", "json"):
            return value
        print("Escolha markdown ou json.")

def ask_list(label: str, defaults: list[str] | None = None) -> list[str]:
    defaults = defaults or []
    print(f"\n{label}")
    if defaults:
        print("Padrões sugeridos:")
        for x in defaults:
            print(f"  - {x}")
        print("Enter vazio sem adicionar nada mantém os padrões.")
    print("Digite um item por linha. Enter vazio encerra.")
    out = []
    while True:
        value = input("> ").strip()
        if not value:
            break
        out.append(value)
    return out or defaults

def choose_profile() -> str:
    print("\nPerfis disponíveis:")
    keys = list(PROFILES.keys())
    for i, key in enumerate(keys, 1):
        print(f"{i}. {key:<9} - {PROFILES[key]['description']}")
    print(f"{len(keys)+1}. custom    - Sem perfil predefinido")
    while True:
        raw = input("> ").strip().lower()
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(keys):
                return keys[idx-1]
            if idx == len(keys)+1:
                return "custom"
        if raw in PROFILES or raw == "custom":
            return raw
        print("Escolha inválida.")

def norm_text(value: str) -> str:
    v = " ".join(value.strip().split())
    v = re.sub(r"^(?:(?:[•*-]|\d+[.)])\s*)+", "", v)
    return ALIASES.get(v.lower(), v)

def dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for item in items:
        v = norm_text(str(item))
        if v and v.lower() not in seen:
            seen.add(v.lower())
            out.append(v)
    return out

def interactive_spec() -> dict[str, Any]:
    print("\n=== Nestor Forge v0.3 ===")
    print("Assistente para criação de especificações de agentes.\n")

    profile = choose_profile()
    defaults = PROFILES.get(profile, {}).get("defaults", {})

    name = ask("Nome do agente", "Nestor Reader" if profile == "reader" else "Nestor Agent")
    role = ask("Papel do agente em uma frase")
    mission = ask("Missão principal do agente")

    spec = {
        "profile": profile,
        "name": name,
        "role": role,
        "mission": mission,
        "focus": ask_list("Principais focos do agente"),
        "analysis_pipeline": ask_list("Etapas de análise, em ordem"),
        "technologies": ask_list("Tecnologias, linguagens, protocolos ou plataformas relevantes"),
        "behavior": ask_list(
            "Comportamento esperado",
            ["técnico", "direto", "baseado em evidências"]
        ),
        "principles": ask_list(
            "Princípios centrais",
            defaults.get("principles", [])
        ),
        "context_rules": ask_list(
            "Regras para contexto incompleto",
            [
                "não inventar comportamento de código ainda não analisado",
                "identificar explicitamente o contexto faltante",
            ]
        ),
        "decision_order": ask_list(
            "Ordem de prioridade para decisões",
            ["correção", "confiabilidade", "manutenibilidade"]
        ),
        "domain_rules": ask_list("Regras específicas do domínio"),
        "tools": ask_list("Ferramentas que o agente pode ou deve usar"),
        "code_rules": ask_list("Regras relacionadas a código"),
        "validation_rules": ask_list(
            "Como validar conclusões ou mudanças",
            ["formular hipótese", "coletar evidência", "comparar resultados"]
        ),
        "response_sections": ask_list(
            "Seções de resposta preferidas",
            defaults.get("response_sections", [])
        ),
        "output_contract": {
            "preferred": ask_output_format(),
            "required_fields": ask_list("Campos obrigatórios de cada resultado ou achado"),
        },
        "final_rules": ask_list("Regras finais importantes"),
        "permissions": {
            "read_code": True,
            "run_analysis_tools": ask_yes_no("Pode executar ferramentas de análise?", True),
            "run_active_tests": ask_yes_no("Pode executar testes ativos no escopo autorizado?", False),
            "write_code": ask_yes_no("Pode alterar/gerar código como atividade principal?", profile in ("coder",)),
            "modify_business_rules": ask_yes_no("Pode alterar regras de negócio sem aprovação explícita?", False),
            "modify_database": ask_yes_no("Pode alterar banco/schema sem aprovação explícita?", False),
        }
    }
    return spec

def normalize_spec(raw: dict[str, Any]) -> dict[str, Any]:
    s = dict(raw)
    for key in (
        "focus","analysis_pipeline","technologies","behavior","principles","context_rules",
        "decision_order","domain_rules","tools","code_rules",
        "validation_rules","response_sections","final_rules"
    ):
        s[key] = dedupe(list(s.get(key, [])))
    for key in ("name","role","mission","profile"):
        s[key] = norm_text(str(s.get(key, "")))
    if "output_contract" in s:
        contract = dict(s["output_contract"])
        contract["preferred"] = norm_text(str(contract.get("preferred", "markdown"))).lower()
        contract["required_fields"] = dedupe(list(contract.get("required_fields", [])))
        s["output_contract"] = contract
    return s

def classify_final_rules(rules: list[str]) -> tuple[list[str], list[str]]:
    finals, pipeline = [], []
    for rule in rules:
        low = rule.lower()
        if any(h in low for h in PIPELINE_HINTS):
            pipeline.append(rule)
        else:
            finals.append(rule)
    return finals, pipeline

def derive(spec: dict[str, Any]) -> dict[str, Any]:
    blob = " ".join(
        [spec.get("role",""), spec.get("mission","")]
        + spec.get("focus", []) + spec.get("domain_rules", [])
        + spec.get("code_rules", [])
    ).lower()

    final_rules, inferred_pipeline = classify_final_rules(spec.get("final_rules", []))
    pipeline = dedupe(spec.get("analysis_pipeline", []) + inferred_pipeline)

    analysis_first = any(x in blob for x in (
        "analisar", "analysis", "ast", "contextual", "investigar", "relatório", "relatorio"
    ))
    token_economy = spec.get("token_economy")
    if token_economy is None:
        principles_text = " ".join(spec.get("principles", [])).lower()
        token_economy = any(x in principles_text for x in (
            "economia de tokens", "reduzir tokens", "reduzir uso de tokens",
            "otimizar o consumo de tokens", "economia de contexto"
        ))
    database_aware = any(x in blob for x in (
        "banco", "database", "tabela", "migration", "relacional", "postgres"
    ))

    requested_permissions = spec.get("permissions", {})
    permissions = {
        "read_code": requested_permissions.get("read_code", True),
        "run_analysis_tools": requested_permissions.get("run_analysis_tools", True),
        "run_active_tests": requested_permissions.get("run_active_tests", False),
        "write_code": requested_permissions.get("write_code", False),
        "modify_business_rules": requested_permissions.get("modify_business_rules", False),
        "modify_database": requested_permissions.get("modify_database", False),
    }

    principles = list(spec.get("principles", []))
    if not principles:
        if analysis_first:
            principles += [
                "obter fatos deterministicamente antes de pedir interpretação à LLM",
                "separar fatos extraídos de inferências e hipóteses",
                "usar leitura progressiva: metadados, estrutura, símbolos, fluxo e somente então código bruto",
            ]
        if token_economy:
            principles += [
                "reduzir uso de tokens sem sacrificar rastreabilidade",
                "preferir representações estruturadas e compactas a saída textual volumosa",
            ]
        principles += ["não inventar informações ausentes"]

    requested_output = spec.get("output_contract", {})
    preferred = requested_output.get("preferred", "markdown").lower()
    if preferred not in ("markdown", "json"):
        raise ValueError("output_contract.preferred deve ser 'markdown' ou 'json'")
    output_contract = {
        "preferred": preferred,
        "machine_readable": requested_output.get("machine_readable", preferred == "json"),
        "required_fields": dedupe(requested_output.get("required_fields", [])),
        "fact_labels": requested_output.get(
            "fact_labels", ["FACT", "INFERENCE", "HYPOTHESIS", "UNKNOWN"] if analysis_first else []
        ),
        "progressive_levels": requested_output.get(
            "progressive_levels", ["PROJECT", "MODULE", "SYMBOL", "FLOW", "SOURCE"] if analysis_first and preferred == "json" else []
        ),
    }

    return {
        "principles": dedupe(principles),
        "analysis_pipeline": dedupe(pipeline),
        "final_rules": dedupe(final_rules),
        "permissions": permissions,
        "output_contract": output_contract,
        "traits": {
            "analysis_first": analysis_first,
            "token_economy": token_economy,
            "database_aware": database_aware,
            "profile": spec.get("profile", "custom")
        }
    }

def bullets(items):
    return "\n".join(f"- {x}" for x in items) if items else "- Nenhum item definido."

def numbered(items):
    return "\n".join(f"{i}. {x}" for i, x in enumerate(items, 1)) if items else "1. Nenhum item definido."

def sentence(value: str) -> str:
    return value if value.endswith((".", "!", "?")) else value + "."

def render_agent(spec: dict[str, Any], derived: dict[str, Any]) -> str:
    p = derived["permissions"]
    o = derived["output_contract"]
    parts = []

    parts.append(f"""# {spec['name']}

## IDENTIDADE

Você é o **{spec['name']}**, {sentence(spec['role'])}

Sua missão principal é **{sentence(spec['mission'])}**

Seu foco inclui:

{bullets(spec['focus'])}

Seu comportamento deve refletir:

{bullets(spec['behavior'])}
""")

    parts.append(f"""# PRINCÍPIOS CENTRAIS

{bullets(derived['principles'])}

Sempre que houver uma investigação ou mudança relevante:

OBSERVAR
→ FORMULAR HIPÓTESE
→ COLETAR EVIDÊNCIA
→ VALIDAR
→ DECIDIR

Nunca apresente hipótese como fato.
""")

    parts.append(f"""# ESCOPO TECNOLÓGICO

{bullets(spec['technologies'])}

Versões e tecnologias encontradas em manifests e arquivos do projeto prevalecem sobre pressupostos.
""")

    parts.append(f"""# POLÍTICA DE CONTEXTO

{bullets(spec['context_rules'])}

Nunca invente funções, classes, tabelas, APIs, fluxos, serviços ou regras de negócio não analisados.
""")

    parts.append(f"""# HIERARQUIA DE DECISÃO

{numbered(spec['decision_order'])}

Quando objetivos conflitarem, explicite o trade-off.
""")

    parts.append(f"""# PERMISSÕES E LIMITES

- Ler código: {"permitido" if p["read_code"] else "não permitido"}
- Executar ferramentas de análise: {"permitido" if p["run_analysis_tools"] else "não permitido"}
- Executar testes ativos: {"permitido somente no escopo e ambiente autorizados" if p["run_active_tests"] else "exige autorização específica para escopo e ambiente"}
- Alterar/gerar código como atividade principal: {"permitido" if p["write_code"] else "não permitido por padrão"}
- Alterar regras de negócio sem aprovação: {"permitido" if p["modify_business_rules"] else "não permitido"}
- Alterar banco/schema sem aprovação: {"permitido" if p["modify_database"] else "não permitido"}
""")

    if derived["traits"]["token_economy"]:
        parts.append("""# ECONOMIA DE CONTEXTO

Prefira fatos extraídos deterministicamente.

Ordem preferencial:

METADADOS
→ MANIFESTS
→ ESTRUTURA
→ SÍMBOLOS
→ RELAÇÕES
→ FLUXOS
→ TRECHOS RELEVANTES
→ ARQUIVO COMPLETO

Não carregue código bruto inteiro quando uma representação estrutural responder à pergunta.
""")

    if derived["analysis_pipeline"]:
        parts.append(f"""# PIPELINE DE ANÁLISE

{numbered(derived['analysis_pipeline'])}

Aplique progressivamente e somente até o nível necessário.
""")

    parts.append(f"""# REGRAS DO DOMÍNIO

{bullets(spec['domain_rules'])}
""")

    parts.append(f"""# FERRAMENTAS

{bullets(spec['tools'])}

Escolha a ferramenta pela informação necessária, não por preferência.
Use apenas ferramentas disponíveis no ambiente e dentro das permissões definidas acima.
""")

    if not p["write_code"]:
        parts.append("""# POLÍTICA DE CÓDIGO

Este agente é prioritariamente de análise.
Pode propor correções e exemplos mínimos, mas não deve alterar arquivos sem autorização.
""")
    if spec["code_rules"]:
        parts.append(f"""# REGRAS PARA ANÁLISE DE CÓDIGO

{bullets(spec['code_rules'])}
""")

    parts.append(f"""# VALIDAÇÃO

{numbered(spec['validation_rules'])}

Quando houver investigação técnica, diferencie:
- FACT
- INFERENCE
- HYPOTHESIS
- UNKNOWN
""")

    if o["preferred"] == "json":
        contract_text = "Formato preferencial: **JSON**."
    else:
        contract_text = "Formato preferencial: **Markdown**."
    if o["required_fields"]:
        contract_text += f"\n\nCada resultado ou achado deve conter:\n\n{bullets(o['required_fields'])}"
    if o["fact_labels"]:
        contract_text += f"\n\nDistinga: {', '.join(o['fact_labels'])}."
    if o["progressive_levels"]:
        contract_text += f"\n\nNíveis de contexto:\n\n{bullets(o['progressive_levels'])}"
    if o["machine_readable"]:
        contract_text += "\n\nProduza uma estrutura válida e estável para consumo por máquina."
    parts.append(f"# CONTRATO DE SAÍDA\n\n{contract_text}")

    if o["machine_readable"] and not o["required_fields"]:
        parts.append(f"""# EXEMPLO DE SAÍDA JSON

```json
{{
  "schema": "nestor.agent.context.v1",
  "facts": [],
  "inferences": [],
  "unknowns": [],
  "risks": [],
  "next_reads": []
}}
```
""")

    parts.append(f"""# FORMATO DE RESPOSTA

Use apenas as seções necessárias entre:

{bullets(spec['response_sections'])}
""")

    parts.append(f"""# REGRA FINAL

{bullets(derived['final_rules'])}

Se houver dados suficientes, conclua.
Se não houver, identifique exatamente o que impede a conclusão.
""")

    return "\n---\n\n".join(x.strip() for x in parts if x.strip()) + "\n"

def build_report(spec: dict[str, Any], derived: dict[str, Any]) -> str:
    return f"""# Nestor Forge — Agent Build Report

## Finalidade

Este relatório é uma especificação agnóstica de LLM.

Ele pode ser entregue a ChatGPT, Claude, Gemini, Codex ou outra LLM para gerar uma versão mais completa do agente em um único prompt ou em múltiplos arquivos.

Ele NÃO substitui o agente final.

## Identidade

- Nome: {spec['name']}
- Perfil: {spec.get('profile','custom')}
- Papel: {spec['role']}
- Missão: {spec['mission']}

## Traits interpretados

```json
{json.dumps(derived['traits'], ensure_ascii=False, indent=2)}
```

## Permissões

```json
{json.dumps(derived['permissions'], ensure_ascii=False, indent=2)}
```

## Contrato de saída

```json
{json.dumps(derived['output_contract'], ensure_ascii=False, indent=2)}
```

## Princípios consolidados

{bullets(derived['principles'])}

## Pipeline de análise

{bullets(derived['analysis_pipeline'])}

## Focos

{bullets(spec['focus'])}

## Comportamento

{bullets(spec['behavior'])}

## Ordem de decisão

{numbered(spec['decision_order'])}

## Tecnologias

{bullets(spec['technologies'])}

## Regras de domínio

{bullets(spec['domain_rules'])}

## Ferramentas

{bullets(spec['tools'])}

## Regras de contexto

{bullets(spec['context_rules'])}

## Regras para análise de código

{bullets(spec['code_rules'])}

## Validação

{numbered(spec['validation_rules'])}

## Seções de resposta

{bullets(spec['response_sections'])}

## Regras finais

{bullets(derived['final_rules'])}

## Como outra LLM deve aprofundar

1. preservar missão e limites;
2. não inventar capacidades;
3. reorganizar requisitos por responsabilidade;
4. transformar conhecimento reutilizável em skills;
5. transformar procedimentos recorrentes em runbooks;
6. criar schemas de saída quando houver comunicação máquina-máquina;
7. criar adapters específicos apenas quando a integração exigir;
8. evitar duplicação de instruções;
9. explicitar fatos, inferências, hipóteses e desconhecidos;
10. produzir exemplos apenas quando aumentarem precisão.

## Formas possíveis de empacotamento

### A. Single Prompt

```text
AGENT.md
```

### B. Pacote modular

```text
agent/
├── AGENT.md
├── identity.md
├── principles.md
├── capabilities.md
├── policies/
├── skills/
├── runbooks/
├── schemas/
└── examples/
```

### C. Agente + ferramenta determinística

Ideal quando extração por AST, Git, manifests, métricas ou parsers deve acontecer fora da LLM.

## Prompt para outra LLM

Você recebeu um Agent Build Report produzido pelo Nestor Forge.

Transforme esta especificação em um agente de produção completo.

Preserve intenção, missão, limites e permissões. Melhore estrutura, clareza, cobertura e operacionalidade.

Não invente capacidades sem justificativa.

Quando fizer sentido, separe o agente em identidade, políticas, skills, runbooks, schemas e adapters.

O resultado deve funcionar como instrução para LLM textual e, quando aplicável, para agentes de código como Codex ou Claude Code.

Entregue todos os arquivos necessários.
"""

def compile_spec(spec_path: Path, output_dir: Path):
    raw = json.loads(spec_path.read_text(encoding="utf-8"))
    spec = normalize_spec(raw)
    derived = derive(spec)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "agent.md").write_text(render_agent(spec, derived), encoding="utf-8")
    (output_dir / "agent.normalized.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "agent.derived.json").write_text(json.dumps(derived, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "BUILD_REPORT.md").write_text(build_report(spec, derived), encoding="utf-8")

def save_interactive_spec(output_dir: Path) -> Path:
    spec = interactive_spec()
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "spec.json"
    path.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    return path

def main():
    parser = argparse.ArgumentParser(description="Nestor Forge v0.3")
    parser.add_argument("spec", nargs="?", help="Arquivo JSON de especificação. Se omitido, abre modo interativo.")
    parser.add_argument("--output", default="./build-agent")
    parser.add_argument("--init", action="store_true", help="Gera um template de spec.json para preenchimento manual.")
    args = parser.parse_args()

    output = Path(args.output)

    if args.init:
        template = Path(__file__).with_name("templates") / "spec.template.json"
        target = output / "spec.template.json"
        output.mkdir(parents=True, exist_ok=True)
        target.write_text(template.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Template criado em: {target}")
        return

    if args.spec:
        spec_path = Path(args.spec).expanduser()
        if not spec_path.is_file():
            parser.error(
                f"Arquivo de especificação não encontrado: {spec_path.resolve()}. "
                "Coloque o JSON nesse caminho ou informe o caminho completo do arquivo."
            )
        try:
            compile_spec(spec_path, output)
        except json.JSONDecodeError as exc:
            parser.error(
                f"JSON inválido em {spec_path}: linha {exc.lineno}, "
                f"coluna {exc.colno}: {exc.msg}"
            )
        except ValueError as exc:
            parser.error(f"Especificação inválida em {spec_path}: {exc}")
        print(f"Agente compilado em: {output}")
        return

    spec_path = save_interactive_spec(output)
    compile_spec(spec_path, output)
    print(f"\nSpec salva em: {spec_path}")
    print(f"Agente compilado em: {output}")

if __name__ == "__main__":
    main()
