# AgentOrchestra para VS Code

Extensão local para explorar agentes e skills, criar agentes com a Nestor Forge e investigar mudanças do projeto.

## O que aparece na barra lateral

- Agentes Codex (`.codex/agents/*.toml`) e Claude (`.claude/agents/*.md`).
- Skills em `.agents`, `.codex` e `.claude`, rotas da Forja e instruções `AGENTS.md`/`CLAUDE.md`.
- Especificações da Forja em `.agentorchestra/specs/*.json`.
- **Scripts de skills** em `skills/<nome>/scripts` e o analisador integrado **Analisar diff estrutural**.

Clique em um Markdown para abrir sua prévia em modo de leitura. No menu de contexto há ações para editar, abrir o painel, ler instruções ou executar um script manualmente.

## Criar com a Forja

Use o botão com ícone de brilho na barra da árvore ou o comando **AgentOrchestra: Criar com a Forja**. Escolha projeto, perfil, nome, papel e missão. A extensão grava uma especificação JSON no projeto para revisão. A ação **Gerar a partir da especificação** cria os artefatos Codex + Claude ou somente Claude. Arquivos existentes não são substituídos pela Forja.

É necessário Python 3.10 ou mais recente para essa função. Ajuste `agentOrchestra.pythonPath` se o executável não for `python`.

## Atividade, grafo e notas

No menu de contexto de um agente, abra **Painel do agente**. O painel mostra a atividade observada, a especificação vinculada, um grafo das prioridades e etapas declaradas nela e notas do projeto. Você pode vincular um JSON de especificação e editar as notas Markdown pelo próprio painel. O grafo descreve o plano do agente; ele não reconstrói decisões reais de uma execução.

Para coletar atividade, execute **AgentOrchestra: Ativar monitoramento local** e escolha Claude, Codex ou ambos. A extensão acrescenta hooks `SubagentStart` e `SubagentStop` em `.claude/settings.local.json` e/ou `.codex/hooks.json`. Os eventos ficam em um arquivo JSONL no armazenamento local da extensão, com horário, pasta, tipo e identificadores do agente. Nenhum prompt ou resposta é registrado. O Codex pode pedir confiança nesses hooks antes de ativá-los. O indicador **uso observado** significa que há início sem parada nos últimos 10 minutos; ele não confirma que o processo ainda está vivo. **Desativar monitoramento local** remove apenas os hooks do AgentOrchestra.

O monitoramento depende de `node` disponível no `PATH` das ferramentas que executam os hooks. Para o analisador integrado e scripts JavaScript, ajuste `agentOrchestra.nodePath` se o executável não for `node`.

## Compartilhar agentes entre projetos

Passe o mouse sobre um agente ou skill na árvore e clique no ícone **Compartilhar agente**. Escolha **Instalar em outro projeto aberto** para copiar seus arquivos relacionados diretamente, ou **Exportar pacote ZIP** para enviar o arquivo a outra pessoa. Para receber um ZIP, use **AgentOrchestra: Importar pacote de agente** na barra da árvore ou na paleta de comandos, escolha o projeto de destino e o arquivo.

O pacote inclui um manifesto com hashes, os arquivos do agente e um `install.sh` para instalação manual com `sh install.sh /caminho/do/projeto` após extrair o ZIP. A extensão valida o manifesto e instala os arquivos diretamente; ela não executa scripts recebidos. A estrutura relativa de `.agents`, `.claude`, `.codex` e da especificação da Forja é preservada, mantendo as referências locais geradas pela Forja. Scripts e arquivos internos das skills acompanham o pacote.

Arquivos existentes no destino bloqueiam a importação, sem sobrescrita. Referências relativas para arquivos fora dessas pastas e referências absolutas ao projeto de origem exigem ajuste antes da exportação. A operação depende do Python configurado em `agentOrchestra.pythonPath`.

## Scripts de skills e análise de diff

Scripts `.py`, `.js`, `.mjs`, `.cjs`, `.go`, `.sh` e `.ps1` são descobertos sob `scripts/` de cada skill. Clique no script para ler o `SKILL.md`. A opção **Executar script manualmente** solicita argumentos em uma lista JSON e abre uma tarefa do VS Code. A execução exige um projeto confiável e é iniciada pelo desenvolvedor.

O analisador integrado compara uma referência Git (por padrão `HEAD`) com a árvore atual. O cabeçalho identifica o projeto, quantos arquivos mudaram, quais formatos têm parser e quais ficaram fora da análise estrutural. Arquivos novos são identificados sem fingir que há uma versão anterior. Para arquivos modificados, o Markdown traz trechos antes/depois e estruturas adicionadas, removidas ou alteradas. As instruções detalhadas ficam em `scripts/DIFF_AST.md` e aparecem ao clicar no script. A cobertura inclui PHP/Laravel, JS/TS, Vue, CSS/Tailwind, Python, Go, PostgreSQL SQL e Dockerfile. Python e Go precisam dos respectivos executáveis para a análise dessas linguagens. Templates Blade, classes Tailwind dinâmicas e SQL não aceito pelo parser podem exigir inspeção manual.

## Desenvolver e instalar

```powershell
cd vscode-extension
npm ci
npm test
npm run check
npm run vscode:prepublish
npx @vscode/vsce package --out ../dist/agentorchestra-0.3.0.vsix
```

Para testar em uma janela de desenvolvimento, abra `vscode-extension` no VS Code e pressione **F5**. Para instalar o pacote, abra **Extensões → … → Instalar do VSIX…** e selecione `dist/agentorchestra-0.3.0.vsix`; pelo terminal, use `code --install-extension dist/agentorchestra-0.3.0.vsix` na raiz do repositório.

Se você instalou a extensão anterior **Nestor Agents**, remova-a para não manter dois ícones. O identificador atual é `nestor-forge.agentorchestra`.
