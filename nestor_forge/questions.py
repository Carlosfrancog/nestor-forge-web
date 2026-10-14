"""Catálogo compartilhado pelo assistente humano e pela entrada para agentes."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .domain import PROFILES


@dataclass(frozen=True)
class Question:
    key: str
    label: str
    kind: str
    default: Any = None


def questions(profile: str = "reader") -> list[Question]:
    defaults = PROFILES.get(profile, {}).get("defaults", {})
    return [
        Question("profile", "Perfil do agente", "choice", profile),
        Question("name", "Nome do agente", "text", "Nestor Reader" if profile == "reader" else "Nestor Agent"),
        Question("role", "Papel do agente em uma frase", "text", ""),
        Question("mission", "Missão principal do agente", "text", ""),
        Question("focus", "Principais focos do agente", "list", []),
        Question("analysis_pipeline", "Etapas de análise, em ordem", "list", []),
        Question("technologies", "Tecnologias, linguagens, protocolos ou plataformas relevantes", "list", []),
        Question("behavior", "Comportamento esperado", "list", ["técnico", "direto", "baseado em evidências"]),
        Question("principles", "Princípios centrais", "list", defaults.get("principles", [])),
        Question("context_rules", "Regras para contexto incompleto", "list", [
            "não inventar comportamento de código ainda não analisado",
            "identificar explicitamente o contexto faltante",
        ]),
        Question("decision_order", "Ordem de prioridade para decisões", "list", [
            "correção", "confiabilidade", "manutenibilidade",
        ]),
        Question("domain_rules", "Regras específicas do domínio", "list", []),
        Question("tools", "Ferramentas que o agente pode ou deve usar", "list", []),
        Question("code_rules", "Regras relacionadas a código", "list", []),
        Question("validation_rules", "Como validar conclusões ou mudanças", "list", [
            "formular hipótese", "coletar evidência", "comparar resultados",
        ]),
        Question("response_sections", "Seções de resposta preferidas", "list", defaults.get("response_sections", [])),
        Question("output_contract.preferred", "Formato de saída", "choice", "markdown"),
        Question("output_contract.required_fields", "Campos obrigatórios de cada resultado ou achado", "list", []),
        Question("final_rules", "Regras finais importantes", "list", []),
        Question("permissions.run_analysis_tools", "Pode executar ferramentas de análise?", "bool", True),
        Question("permissions.run_active_tests", "Pode executar testes ativos no escopo autorizado?", "bool", False),
        Question("permissions.write_code", "Pode alterar/gerar código como atividade principal?", "bool", profile == "coder"),
        Question("permissions.modify_business_rules", "Pode alterar regras de negócio sem aprovação explícita?", "bool", False),
        Question("permissions.modify_database", "Pode alterar banco/schema sem aprovação explícita?", "bool", False),
    ]


def default_spec(profile: str) -> dict[str, Any]:
    """Defaults idênticos aos apresentados pelo assistente interativo."""
    spec: dict[str, Any] = {"permissions": {"read_code": True}, "output_contract": {}}
    for question in questions(profile):
        section, separator, field = question.key.partition(".")
        if separator:
            spec[section][field] = question.default
        else:
            spec[section] = question.default
    return spec
