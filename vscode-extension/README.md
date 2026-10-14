# AgentOrchestra para VS Code

Extensão local para explorar agentes e skills, criar agentes com a Nestor Forge e investigar mudanças do projeto.

## O que aparece na barra lateral

- Agentes Codex (`.codex/agents/*.toml`) e Claude (`.claude/agents/*.md`).
- Skills em `.agents`, `.codex` e `.claude`, rotas da Forja e instruções `AGENTS.md`/`CLAUDE.md`.
- Especificações da Forja em `.agentorchestra/specs/*.json`.
- **Scripts de skills** em `skills/<nome>/scripts`, o analisador integrado **Analisar diff estrutural** e uma seção **Roteiros prontos** para iniciar agentes.

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

Também é possível importar ZIPs antigos que contenham `AGENT.md` ou `agent.md` na pasta principal, como pacotes da Forja. Antes de instalar, a extensão mostra os arquivos de destino; ela cria a skill central e as entradas de agente para Claude e Codex, mantendo os arquivos e links internos do ZIP. Outros formatos precisam ser convertidos ou exportados pelo AgentOrchestra.

Arquivos existentes no destino bloqueiam a importação, sem sobrescrita. Referências relativas para arquivos fora dessas pastas e referências absolutas ao projeto de origem exigem ajuste antes da exportação. A operação depende do Python configurado em `agentOrchestra.pythonPath`.

## Executar agentes com roteiros prontos

Clique em **Executar agente** na linha de um agente Claude ou Codex, no painel do agente ou na barra da árvore. Você também pode clicar diretamente em um item da seção **Roteiros prontos** e escolher o agente. Há missão livre, revisão de alterações, investigação de bug, criação de testes, documentação e auditoria passiva de segurança. Informe o foco da tarefa e escolha o destino.

No **terminal integrado**, a extensão inicia uma sessão interativa do CLI no projeto e abre o painel do agente. O Claude recebe o agente pelo parâmetro `--agent`; o Codex recebe uma instrução para delegar a tarefa ao subagente personalizado. A conversa, ferramentas e aprovações ficam no terminal, enquanto o painel e a árvore acompanham o processo e seu código de saída. O painel não confunde esse estado com os sinais opcionais dos hooks.

Na opção **extensão oficial**, o AgentOrchestra abre Claude Code ou Codex no VS Code e copia a instrução para colar e enviar. Como não há uma API pública estável para enviar a mensagem às extensões, essa opção é uma preparação manual e aparece assim no painel. Para executar imediatamente, escolha o terminal. Leia os detalhes em `scripts/AGENT_RUNS.md`. Os executáveis podem ser definidos em `agentOrchestra.claudePath` e `agentOrchestra.codexPath`.

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
npx @vscode/vsce package --out ../dist/agentorchestra-0.4.1.vsix
```

Para testar em uma janela de desenvolvimento, abra `vscode-extension` no VS Code e pressione **F5**. Para instalar o pacote, abra **Extensões → … → Instalar do VSIX…** e selecione `dist/agentorchestra-0.4.1.vsix`; pelo terminal, use `code --install-extension dist/agentorchestra-0.4.1.vsix` na raiz do repositório.

## Atualizações pelo site

O build do GitHub Pages publica `updates/agentorchestra.json` junto do VSIX. O manifesto informa versão, URL, tamanho e SHA-256. A extensão consulta esse endpoint ao iniciar e depois a cada seis horas. O comando **AgentOrchestra: Verificar atualizações** faz a consulta imediatamente. O padrão é avisar e oferecer **Atualizar agora**; defina `agentOrchestra.updateMode` como `auto` para baixar e instalar sem confirmação, ou `off` para desativar as verificações periódicas. O pacote é instalado pela CLI do VS Code após validar tamanho e hash, e uma recarga da janela ativa a versão nova. Caso a CLI não esteja disponível, defina `agentOrchestra.vscodeCliPath` com o caminho do executável.

O VS Code não atualiza automaticamente extensões instaladas por VSIX; esse fluxo é próprio do AgentOrchestra e só funciona a partir da versão 0.4.1. O endpoint padrão é `https://carlosfrancog.github.io/nestor-forge-web/updates/agentorchestra.json` e pode ser alterado em `agentOrchestra.updateManifestUrl` se o site mudar de endereço. O manifesto só é publicado quando o VSIX da mesma versão foi gerado.

Se você instalou a extensão anterior **Nestor Agents**, remova-a para não manter dois ícones. O identificador atual é `nestor-forge.agentorchestra`.
