"""Renderização do pacote genérico de agente."""
from __future__ import annotations

from typing import Any
import json

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
