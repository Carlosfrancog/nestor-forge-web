# Integrações da Nestor Forge

## Decisão proposta

Usar `spec.json` como fonte única e gerar artefatos executáveis para cada destino. O primeiro destino novo deve ser um **plugin Claude** com skill e, quando fizer sentido, subagente. Um CLI fino deve compilar, verificar e instalar os artefatos locais. O site deve oferecer o mesmo plugin em ZIP, pronto para upload no Claude/Cowork.

Isso elimina a etapa atual em que a Forja entrega apenas um prompt e depende de outro agente para transformar o pacote em arquivos utilizáveis.

## Situação atual

- `nestor_forge/domain.py` normaliza a especificação e deriva regras; `nestor_forge/renderers.py` gera o pacote genérico.
- `ForgeCompiler` orquestra essas etapas e entrega artefatos em memória para o CLI e o navegador.
- O site usa esse mesmo compilador via Pyodide. Para Claude, entrega um plugin pronto; para Codex, acrescenta um prompt ao pacote genérico.
- O CLI (`python forge.py` ou `nestor-forge`) cria plugins e instala skills/agentes na pasta `.claude` de um projeto.
- As permissões da especificação viram instruções em texto. Elas não constituem uma política técnica de acesso a ferramentas.

## Arquitetura

```text
spec.json (versionado)
    -> normalização e validação
    -> modelo intermediário da Forja
    -> adaptadores de destino
         -> pacote Claude: plugin.json + SKILL.md + agents/*.md
         -> projeto Claude Code: .claude/skills + .claude/agents
         -> pacote Codex: skill + agente de projeto
         -> projeto unificado: .agents/skills + .agents/routes/*.toml
                              + adaptadores .claude e .codex
    -> relatório de compatibilidade + manifesto de arquivos
```

O compilador deve ser puro: receber a especificação e devolver um mapa de caminhos e conteúdo. CLI e navegador apenas gravam arquivos ou ZIP. Assim, não surgem dois geradores com regras diferentes.

O destino `unified-project` mantém as instruções completas em `.agents/skills/<slug>/SKILL.md`. Codex descobre essa skill diretamente. Claude Code descobre uma skill curta em `.claude/skills` que aponta para o arquivo central. Os subagentes ficam nos formatos próprios: `.claude/agents/<slug>.md` e `.codex/agents/<slug>.toml`. O arquivo `.agents/routes/<slug>.toml` é o mapa da Forja, não uma configuração carregada automaticamente pelos dois clientes.

## Entrega 1: plugin Claude utilizável

Gerar diretamente:

```text
<slug>/
  .claude-plugin/plugin.json
  skills/<slug>/SKILL.md
  agents/<slug>.md                 # padrão; removível com --component skill
```

O manifesto define nome, descrição e versão. A skill contém missão, processo e contrato de saída. O subagente é opcional e, quando acompanha a skill, carrega as instruções dela sem duplicá-las. O ZIP do site inclui também a `spec.json` e instruções de ativação.

**Aceite:** o ZIP abre com essa estrutura; `claude plugin validate <diretório>` passa quando o Claude Code está disponível; `claude --plugin-dir <diretório>` carrega o plugin para teste; a skill aparece pelo nome esperado. No Cowork, o usuário faz upload do arquivo de plugin em **Customize > Plugins**.

## Entrega 2: CLI de instalação local

Interface sugerida:

```text
nestor build spec.json --target claude-plugin --output dist/
nestor install spec.json --target claude-code --scope project --project ./meu-projeto
nestor doctor --project ./meu-projeto
nestor uninstall <slug> --target claude-code --project ./meu-projeto
```

O CLI atual já oferece `--target claude-project --output <projeto>` para instalar na pasta `.claude` do projeto e recusa sobrescrever arquivos existentes sem `--force`. Um comando `doctor` e um manifesto local com hashes ainda são próximos passos para atualização e desinstalação sem apagar trabalho manual. Instalação global requer escolha explícita em uma versão futura.

Para testar um plugin sem instalação permanente, o CLI pode imprimir `claude --plugin-dir <caminho>`. Para distribuição recorrente no Claude Code, publicar um marketplace é mais adequado que editar configurações internas do Claude diretamente.

## Entrega 3: distribuição Cowork e equipe

- **Uso individual:** baixar o ZIP do site e enviar o plugin pelo menu do Claude. O upload é uma ação da conta; o CLI local não deve prometer instalar na conta automaticamente.
- **Equipe:** versionar plugins e um catálogo/marketplace. Claude Code pode instalar de marketplace; a distribuição no Cowork segue os controles da conta/organização.
- **Enterprise, depois:** avaliar a Plugins API para publicação e administração automatizadas. Essa API é beta e restrita a organizações Claude Enterprise, portanto não deve ser requisito do MVP.
- **MCP, quando houver ferramentas reais:** empacotar um servidor local para operações no computador ou oferecer um conector remoto para serviços acessíveis pela internet. Não gerar um MCP apenas para transportar instruções.

## Cuidados de produto

1. **Permissões verificáveis.** Diferenciar regra textual (`não alterar arquivos`) de restrição técnica de ferramentas. Exibir essa diferença no relatório e não prometer modo somente leitura sem proteção efetiva.
2. **Portabilidade.** Manter a especificação neutra; recursos exclusivos de uma plataforma entram nos adaptadores ou em opções específicas do destino.
3. **Atualização segura.** Guardar versão do esquema e hashes dos arquivos instalados. Preservar mudanças do usuário.
4. **Saída enxuta.** Evitar gerar subagente, hook ou MCP quando uma skill resolve o caso. Cada componente adiciona custo de contexto ou execução.
5. **Validação por destino.** Testar estrutura, nomes, frontmatter, caminhos, colisões e consistência das permissões antes de criar o ZIP ou instalar.

## Ordem de implementação

1. **Concluído:** extrair o núcleo do `forge.py`, compilar a partir de `dict` e manter `compile_spec` como fachada para arquivos.
2. **Concluído:** criar o adaptador `claude-plugin` e testes para o pacote.
3. **Concluído:** fazer o site oferecer o ZIP do plugin gerado pelo mesmo Python.
4. **Parcial:** instalação local segura disponível por `--target claude-project`; adicionar `doctor`, `uninstall`, prévia e manifesto de propriedade.
5. **Concluído:** saída `unified-project` para Claude Code e Codex com mapa TOML por agente e skill central.
6. Publicar um pequeno catálogo de plugins quando houver mais de um pacote estável.

## Fontes consultadas em 14/10/2026

- [Plugins no Claude e no Cowork](https://support.claude.com/en/articles/13837440-use-plugins-in-claude)
- [Estrutura e desenvolvimento de plugin Claude](https://code.claude.com/docs/en/plugins/create)
- [Instalação e escopos no Claude Code](https://code.claude.com/docs/en/plugins/install)
- [Componentes de plugin](https://code.claude.com/docs/en/plugins/components)
- [Plugins API para organizações](https://platform.claude.com/docs/en/manage-claude/plugins-api)
- [Skills locais no Codex](https://learn.chatgpt.com/docs/build-skills)
- [Subagentes TOML no Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Skills de projeto no Claude Code](https://code.claude.com/docs/en/skills)
