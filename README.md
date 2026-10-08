# Nestor Forge v0.3

## Interface web

A interface em `site/` executa o mesmo `forge.py` no navegador com Pyodide (Python em WebAssembly). Não há servidor de geração: o usuário preenche o formulário ou importa um `spec.json`, escolhe Claude ou Codex e baixa um ZIP com `spec.json`, `agent.md`, `agent.normalized.json`, `agent.derived.json`, `BUILD_REPORT.md` e o prompt do destino escolhido. O runtime Python é baixado na primeira geração, então é necessária conexão com a internet.

Para testar localmente:

```powershell
Copy-Item forge.py site/forge.py -Force
python -m http.server 8765 --directory site
```

Abra `http://localhost:8765/`. Não abra `site/index.html` diretamente pelo protocolo `file://`, pois o navegador precisa carregar o worker e o compilador por HTTP.

Para publicar no GitHub Pages, crie um repositório com a branch `main`, envie este projeto e selecione **Settings → Pages → Build and deployment → GitHub Actions**. O workflow em `.github/workflows/pages.yml` copia a versão atual de `forge.py` para `site/` e publica apenas essa pasta. O endereço ficará em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

Os testes do compilador podem ser executados com `python -B -m unittest discover -s tests -v`. O teste de navegador em `tests/browser_smoke.mjs` exige Chrome headless com DevTools na porta 9229 e o servidor local na porta 8765.

Agora `python forge.py` funciona sem argumentos e abre um assistente interativo.

## Modo interativo

```bash
python forge.py
```

A Forja:
1. pergunta o perfil;
2. coleta os dados;
3. salva `spec.json`;
4. compila o agente;
5. gera o Build Report.

Saída padrão:

```text
build-agent/
├── spec.json
├── agent.md
├── agent.normalized.json
├── agent.derived.json
└── BUILD_REPORT.md
```

## Modo com JSON existente

```bash
python forge.py meu-agente.json --output ./build/meu-agente
```

## Gerar template de preenchimento

```bash
python forge.py --init --output ./template
```

Isso cria:

```text
template/spec.template.json
```

O template contém um campo `_instructions` explicando como preencher cada propriedade.

## Perfis disponíveis

- reader
- coder
- reviewer
- infra
- qa
- planner
- audio
- custom

Os perfis não prendem o agente. Eles apenas fornecem padrões melhores para perguntas, princípios e saída.

## Ajustes de saída e permissões

`response_sections` recebe nomes curtos de seções, como `Diagnóstico` e `Evidências`. Use `analysis_pipeline` para as etapas de trabalho em ordem.

`output_contract.preferred` define explicitamente `markdown` ou `json`; `required_fields` lista os campos que cada resultado deve conter. A Forja não escolhe JSON só porque a especificação menciona tokens de autenticação.

`code_rules` aparece no agente gerado mesmo quando `write_code` é `false`: nesse caso, são regras de análise, sem permissão para alterar arquivos. `run_active_tests` começa como `false` e separa ferramentas de análise de testes ativos.

## Artefatos

### `agent.md`
Prompt/instrução compilada.

### `agent.normalized.json`
Spec normalizada.

### `agent.derived.json`
Regras e traits inferidos.

### `BUILD_REPORT.md`
Relatório agnóstico de LLM para ChatGPT, Claude, Gemini, Codex ou outro modelo gerar uma versão mais completa ou modular do agente.
