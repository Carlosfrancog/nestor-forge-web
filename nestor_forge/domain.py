"""Normalização e inferências independentes do destino."""
from __future__ import annotations

from typing import Any
import re

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

PIPELINE_HINTS = (
    "map", "mapeie", "identifique", "registre", "extraia", "rastreie",
    "calcule", "localize", "sinalize", "detecte", "gere um grafo",
    "exporte", "crie um sumário", "converta", "agrupe"
)

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
