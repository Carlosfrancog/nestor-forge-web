# Nestor Forge v0.3

Guias de arquitetura verificados no código: [docs/architecture/guides/README.md](docs/architecture/guides/README.md).

**Agent Orchestra**, extensão experimental para visualizar e organizar agentes e skills no VS Code: [vscode-extension/README.md](vscode-extension/README.md).

Plano de integrações com Claude Cowork, plugins e CLI: [docs/INTEGRACOES.md](docs/INTEGRACOES.md).

Para outro agente consultar as perguntas, responder por JSON e receber um relatório compacto sem abrir o assistente, use [o executor para agentes](docs/AGENT_RUNNER.md).

Para inspecionar mudanças de código Python por AST e criar commits com caminhos explícitos sem enviar diffs ou logs ao agente:

```powershell
python -B scripts/commit_ast.py inspect
python -B scripts/commit_ast.py commit -m "feat: descrever mudança" --path caminho/arquivo.py
```

O comando `inspect` retorna JSON compacto com funções, métodos e classes alterados. O comando `commit` recusa arquivos staged preexistentes e candidatos com alertas de privacidade. Arquivos não Python recebem apenas metadados; revise seu conteúdo antes de incluí-los. O script não faz push.

## Arquitetura Python

O projeto usa um núcleo de compilação com adaptadores de entrada e saída:

- `nestor_forge/domain.py`: normalização e inferências da especificação;
- `nestor_forge/renderers.py`: formato genérico dos artefatos;
- `nestor_forge/compiler.py`: `ForgeCompiler`, contrato `ArtifactRenderer`, `BuildArtifacts` e escrita em disco;
- `nestor_forge/targets.py`: saídas Claude e pacote unificado para Claude Code/Codex;
- `nestor_forge/cli.py`: assistente de terminal com Rich, isolado do núcleo;
- `forge.py`: ponto de entrada antigo e fachada da API anterior.

Um novo destino implementa `ArtifactRenderer` e pode ser usado pelo CLI ou pelo site sem repetir as regras de domínio.
`spec.json` é a fonte de dados; `pathlib` cria diretórios e grava os arquivos `.md`/`.json` que as plataformas reconhecem. `pickle` não é usado para os pacotes distribuídos, pois é binário, específico do Python e inadequado para carregar dados recebidos de terceiros.

## Interface web

A interface em `site/` executa o mesmo pacote Python do CLI no navegador com Pyodide (Python em WebAssembly). Não há servidor de geração: o usuário preenche o formulário ou importa um `spec.json` e baixa um ZIP. O destino Claude produz um plugin com skill e subagente; o destino Codex mantém o pacote genérico com um prompt de adaptação. O runtime Python é baixado na primeira geração, então é necessária conexão com a internet.

Para montar e testar o site localmente:

```powershell
python scripts/build_site.py
python -m http.server 8765 --directory dist/site
```

O build também gera `dist/site/downloads/agentes-contexto-importavel.zip` a partir das três especificações em `examples/context-agents/`, usando `scripts/agent_run.py`. O ZIP aparece na seção de instalação do Agent Orchestra e contém agentes de leitura de projeto, histórico Git e stack para Claude Code e Codex. Use **Agent Orchestra: Importar pacote de agente** para instalar os três no projeto; para instalação manual, extraia o ZIP e execute `sh install.sh /caminho/do/projeto`. Ele não é um VSIX.

Abra `http://localhost:8765/`. Não abra `site/index.html` diretamente pelo protocolo `file://`, pois o navegador precisa carregar o worker e o compilador por HTTP.


Os testes do compilador podem ser executados com `python -B -m unittest discover -s tests -v`. O teste de navegador em `tests/browser_smoke.mjs` exige Chrome headless com DevTools na porta 9229 e o servidor local na porta 8765.

Instale o CLI com Rich e Readchar usando `python -m pip install -e .`. Depois execute `nestor-forge` para abrir o assistente interativo. Nas escolhas fechadas (perfil, formato e permissões), use **↑/↓** para mover a seta na tabela e **Enter** para confirmar. `python forge.py` continua disponível e apresenta uma versão simples do terminal caso as dependências visuais não estejam instaladas.

No Windows, se `python` apontar para `C:\msys64\mingw64\bin\python.exe` e responder `No module named pip`, use `uv` para criar um ambiente Windows separado:

```powershell
$env:UV_CACHE_DIR = Join-Path (Get-Location) 'dist/uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path (Get-Location) 'dist/uv-python'
$env:UV_PROJECT_ENVIRONMENT = Join-Path (Get-Location) 'dist/venv-windows'
uv run --managed-python --python 3.13 nestor-forge --help
```

Depois da primeira instalação, execute diretamente `./dist/venv-windows/Scripts/nestor-forge.exe`. O diretório `dist/` fica fora do Git.

## Modo interativo

```bash
nestor-forge
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
nestor-forge meu-agente.json --output ./build/meu-agente
```

## Gerar template de preenchimento

```bash
nestor-forge --init --output ./template
```

Isso cria:

```text
template/spec.template.json
```

O template contém um campo `_instructions` explicando como preencher cada propriedade.

## Claude Cowork e Claude Code

Crie um plugin para enviar pelo menu **Customize > Plugins** do Claude Cowork ou testar no Claude Code:

```bash
nestor-forge meu-agente.json --target claude-plugin --output ./build/meu-plugin
claude plugin validate ./build/meu-plugin
claude --plugin-dir ./build/meu-plugin
```

O plugin contém `.claude-plugin/plugin.json`, `skills/<nome>/SKILL.md` e `agents/<nome>.md`. Use `--component skill` ou `--component agent` quando quiser apenas um deles. Com ambos, o subagente carrega a skill sem repetir as instruções.

Para instalar no projeto atual, criando `.claude/skills` e `.claude/agents`:

```bash
nestor-forge meu-agente.json --target claude-project --output .
```

Arquivos existentes não são substituídos nessa instalação. Use `--force` somente após revisá-los. As permissões da especificação são instruções para o agente; não configuram uma barreira técnica de acesso a ferramentas.

## Projeto unificado: Claude Code + Codex

```bash
nestor-forge meu-agente.json --target unified-project --output ./meu-projeto
```

Esse destino gera:

```text
.agents/skills/<nome>/SKILL.md     # instrução central lida pelo Codex
.agents/routes/<nome>.toml          # mapa de caminhos usado pela Forja
.claude/skills/<nome>/SKILL.md      # entrada da skill no Claude Code
.claude/agents/<nome>.md            # subagente Claude
.codex/agents/<nome>.toml           # subagente Codex
```

O TOML em `.agents/routes` descreve o roteamento da Forja; os clientes usam seus próprios arquivos de descoberta. O adaptador da skill Claude e os subagentes apontam para a instrução central, evitando repetir o conteúdo. O site também oferece **Claude + Codex** como ZIP para extrair na raiz de um projeto. A instalação recusa arquivos existentes; `--force` permite a substituição explícita.

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
