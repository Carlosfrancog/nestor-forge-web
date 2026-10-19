# Agent Orchestra para VS Code

Extensão local para explorar agentes e skills, criar agentes com a Nestor Forge, mapear projetos e investigar mudanças.

## O que aparece na barra lateral

O painel **Agentes** tem um switch **Claude / Codex**, busca e cartões com as ações **Executar**, **Exportar ZIP**, **Abrir arquivo** e **Painel**. O switch mostra só os agentes da plataforma escolhida e é lembrado por projeto. Skills, scripts, rotas, especificações e instruções ficam recolhidos em **Recursos técnicos**. Uma skill é a instrução que apoia o agente; para transferir o agente completo, use **Exportar ZIP** no cartão do agente.

Use **+ Criar agente** para abrir a Forja e **Importar ZIP** para instalar um pacote em outro projeto. O painel usa as cores do tema do VS Code e também mostra o estado das execuções iniciadas pela extensão.

## Criar com a Forja

Use **+ Criar agente** no painel ou o comando **Agent Orchestra: Definir agente com a Forja**. Escolha projeto, perfil, nome, papel e missão. A extensão grava uma especificação JSON no projeto para revisão. A ação **Gerar a partir da especificação** cria os artefatos Codex + Claude ou somente Claude. Arquivos existentes não são substituídos pela Forja.

É necessário Python 3.10 ou mais recente. Se `python` não estiver disponível, a extensão baixa Python 3.13 automaticamente para seu armazenamento local na primeira operação que precisar dele. É necessária conexão com a internet nessa primeira vez. Para usar uma instalação própria, ajuste `agentOrchestra.pythonPath`.

## Atividade, grafo e notas

### Mapa e contexto do projeto

Use **Agent Orchestra: Mapear projeto** para abrir a estrutura navegável de pastas e arquivos. A tela permite buscar, filtrar por grupo, ampliar o mapa, ver relações verificadas e abrir arquivos. O mapeador percorre as pastas em blocos, lê Python, Go, JavaScript, TypeScript, Vue, PHP, CSS, SQL, Markdown, HTML, XML, JSON e YAML e reaproveita resultados pelo hash dos arquivos. Na extensão, o cache fica em um JSON por projeto no armazenamento da extensão; chamadas diretas ao mapeador sem diretório de cache não criam arquivos temporários. Esse cache guarda resumos de parser e não é enviado ao agente. Arquivos sem parser continuam no inventário, com a lacuna indicada. O processamento roda em uma thread separada da interface.

Use **Agent Orchestra: Mapear projeto e documentar com agente** para criar o handoff `.agentorchestra/context/project-handoff.json` e o índice `.agentorchestra/context/index.jsonl`. Depois escolha Codex, Claude ou copie a instrução para outro agente. O agente confirma os fluxos no código e escreve guias manuais em `docs/architecture/guides/`. O handoff guarda referências, relações, lacunas e hashes; o índice guarda arquivos, unidades AST e seções de notas com faixas de linhas, sem corpos de código. O comando não cria nem atualiza listas Markdown em `docs/architecture/`. O contexto é atualizado quando a revisão Git muda; a redação de guias pelo agente só inicia por comando do desenvolvedor.

Em projetos com graphy-refat, a classificação vem de `graphify-out/classification.json`; rode `bash graphy-refat/run.sh all` para gerá-la ou atualizá-la. Sem esse arquivo, o mapeador agrupa pelo diretório. Uma classificação de outra revisão ainda é usada, com aviso de defasagem.

Use **Agent Orchestra: Construir índice de contexto** para criar o índice sob demanda. Pelo terminal (sem VS Code, inclusive em CI), rode `node scripts/build-index.js --root <projeto>`; `--handoff` também grava o handoff, `--json` devolve as contagens e `--cache-dir` escolhe o cache (padrão: `~/.cache/agentorchestra` ou `%LOCALAPPDATA%\agentorchestra`). Em projetos com graphy-refat, rode antes `bash graphy-refat/run.sh all` para a classificação estar em dia. Ao executar um agente, a extensão anexa um cartão de rota com arquivos e faixas relevantes, notas contextuais e riscos registrados. O agente pode fazer novas consultas com `node scripts/find.js --root <projeto> "<pergunta>"` (ou `--json`). Se o cartão não bastar, a instrução indica o handoff. Recomenda-se ignorar `.agentorchestra/context/index*.json*` no Git do projeto alvo.

Para ajustar limites, exclusões e agrupamentos, crie `.agentorchestra/documentation.json` no projeto. Por exemplo:

```json
{
  "maxFileBytes": 1048576,
  "exclude": ["storage", "generated"],
  "modules": [{ "id": "billing", "label": "Faturamento", "paths": ["src/payments"] }],
  "outputDir": "docs/architecture",
  "linkStyle": "obsidian"
}
```

`linkStyle` pode ser omitido para links Markdown comuns. As notas podem ser copiadas para uma vault Obsidian pelo fluxo de sincronização do projeto; a extensão não monta drives de rede nem executa `rsync` automaticamente.

`taxonomy` foi descontinuada; use `graphy.toml`. `modules` continua disponível para agrupamentos explícitos no modo genérico.

### Painel do agente

No menu de contexto de um agente, abra **Painel do agente**. O painel mostra a atividade observada, a especificação vinculada, um grafo das prioridades e etapas declaradas nela e notas do projeto. Você pode vincular um JSON de especificação e editar as notas Markdown pelo próprio painel. O grafo descreve o plano do agente; ele não reconstrói decisões reais de uma execução.

Para coletar atividade, execute **Agent Orchestra: Ativar monitoramento local** e escolha Claude, Codex ou ambos. A extensão acrescenta hooks `SubagentStart` e `SubagentStop` em `.claude/settings.local.json` e/ou `.codex/hooks.json`. Os eventos ficam em um arquivo JSONL no armazenamento local da extensão, com horário, pasta, tipo e identificadores do agente. Nenhum prompt ou resposta é registrado. O Codex pode pedir confiança nesses hooks antes de ativá-los. O indicador **uso observado** significa que há início sem parada nos últimos 10 minutos; ele não confirma que o processo ainda está vivo. **Desativar monitoramento local** remove apenas os hooks do Agent Orchestra.

O monitoramento depende de `node` disponível no `PATH` das ferramentas que executam os hooks. Para o analisador integrado e scripts JavaScript, ajuste `agentOrchestra.nodePath` se o executável não for `node`.

## Compartilhar agentes entre projetos

Clique em **Exportar ZIP** no cartão do agente. Esse único arquivo inclui a entrada Claude ou Codex selecionada, a entrada da outra plataforma quando existir, as skills e os arquivos relacionados. Para usar o agente em outro projeto, clique em **Importar ZIP**, escolha o projeto de destino e selecione o arquivo. Você não precisa exportar a skill separadamente.

O pacote inclui um manifesto com hashes, os arquivos do agente e um `install.sh` para instalação manual com `sh install.sh /caminho/do/projeto` após extrair o ZIP. A extensão valida o manifesto e instala os arquivos diretamente; ela não executa scripts recebidos. A estrutura relativa de `.agents`, `.claude`, `.codex` e da especificação da Forja é preservada, mantendo as referências locais geradas pela Forja. Scripts e arquivos internos das skills acompanham o pacote.

Também é possível importar ZIPs antigos que contenham `AGENT.md` ou `agent.md` na pasta principal, como pacotes da Forja. Antes de instalar, a extensão mostra os arquivos de destino; ela cria a skill central e as entradas de agente para Claude e Codex, mantendo os arquivos e links internos do ZIP. Outros formatos precisam ser convertidos ou exportados pelo Agent Orchestra.

O ZIP **Agentes de contexto** disponível na página de instalação usa o formato nativo do Agent Orchestra e instala três agentes no mesmo projeto. Selecione esse ZIP no comando de importação; não é necessário extraí-lo antes.

Arquivos existentes no destino bloqueiam a importação, sem sobrescrita. Referências relativas para arquivos fora dessas pastas e referências absolutas ao projeto de origem exigem ajuste antes da exportação. Sem Python instalado, a extensão baixa uma cópia local antes de analisar ou importar o ZIP.

## Executar agentes com roteiros prontos

Clique em **Executar** no cartão de um agente Claude ou Codex, ou use o comando **Agent Orchestra: Executar agente**. Você também pode abrir **Recursos técnicos → Roteiros prontos** e escolher uma missão. Há missão livre, revisão de alterações, investigação de bug, criação de testes, documentação e auditoria passiva de segurança. Informe o foco da tarefa e escolha o destino.

No **terminal integrado**, a extensão inicia uma sessão interativa do CLI no projeto e abre o painel do agente. O Claude recebe o agente pelo parâmetro `--agent`; o Codex recebe uma instrução para delegar a tarefa ao subagente personalizado. A conversa, ferramentas e aprovações ficam no terminal, enquanto o painel e os cartões acompanham o processo e seu código de saída. O painel não confunde esse estado com os sinais opcionais dos hooks.

Na opção **extensão oficial**, o Agent Orchestra abre Claude Code ou Codex no VS Code e copia a instrução para colar e enviar. Como não há uma API pública estável para enviar a mensagem às extensões, essa opção é uma preparação manual e aparece assim no painel. Para executar imediatamente, escolha o terminal. Leia os detalhes em `scripts/AGENT_RUNS.md`. Os executáveis podem ser definidos em `agentOrchestra.claudePath` e `agentOrchestra.codexPath`.

## Scripts de skills e análise de diff

Scripts `.py`, `.js`, `.mjs`, `.cjs`, `.go`, `.sh` e `.ps1` são descobertos sob `scripts/` de cada skill. Em **Recursos técnicos**, use **Instruções** para ler o `SKILL.md` ou **Executar** para iniciar o script sem argumentos. O comando **Agent Orchestra: Executar script com argumentos** continua disponível na paleta. A execução exige um projeto confiável e é iniciada pelo desenvolvedor.

O analisador integrado compara uma referência Git (por padrão `HEAD`) com a árvore atual. O cabeçalho identifica o projeto, quantos arquivos mudaram, quais formatos têm parser e quais ficaram fora da análise estrutural. Arquivos novos são identificados sem fingir que há uma versão anterior. Para arquivos modificados, o Markdown traz trechos antes/depois e estruturas adicionadas, removidas ou alteradas. As instruções detalhadas ficam em `scripts/DIFF_AST.md` e aparecem ao clicar no script. A cobertura inclui PHP/Laravel, JS/TS, Vue, CSS/Tailwind, Python, Go, PostgreSQL SQL e Dockerfile. Python e Go precisam dos respectivos executáveis para a análise dessas linguagens. Templates Blade, classes Tailwind dinâmicas e SQL não aceito pelo parser podem exigir inspeção manual.

## Desenvolver e instalar

```powershell
cd vscode-extension
npm ci
npm test
npm run check
npm run vscode:prepublish
npx @vscode/vsce package --out ../dist/agentorchestra-0.5.11.vsix
```

Para testar em uma janela de desenvolvimento, abra `vscode-extension` no VS Code e pressione **F5**. Para instalar o pacote, abra **Extensões → … → Instalar do VSIX…** e selecione `dist/agentorchestra-0.5.11.vsix`; pelo terminal, use `code --install-extension dist/agentorchestra-0.5.11.vsix` na raiz do repositório.

## Atualizações pelo site

O build do GitHub Pages publica `updates/agentorchestra.json` junto do VSIX. O manifesto informa versão, URL, tamanho e SHA-256. A extensão consulta esse endpoint ao iniciar e depois a cada seis horas. O comando **Agent Orchestra: Verificar atualizações** faz a consulta imediatamente. O padrão é avisar e oferecer **Atualizar agora**; defina `agentOrchestra.updateMode` como `auto` para baixar e instalar sem confirmação, ou `off` para desativar as verificações periódicas. O pacote é instalado pela CLI do VS Code após validar tamanho e hash, e uma recarga da janela ativa a versão nova. Caso a CLI não esteja disponível, defina `agentOrchestra.vscodeCliPath` com o caminho do executável.

No WSL2, a extensão usa a CLI `code` do host remoto para instalar o VSIX no Ubuntu. Se ela não estiver no `PATH` da extensão, configure `agentOrchestra.vscodeCliPath` com o caminho Linux da CLI remota do VS Code, não com `Code.exe` do Windows.

O VS Code não atualiza automaticamente extensões instaladas por VSIX; esse fluxo é próprio do Agent Orchestra e só funciona a partir da versão 0.4.1. O endpoint padrão é `https://carlosfrancog.github.io/nestor-forge-web/updates/agentorchestra.json` e pode ser alterado em `agentOrchestra.updateManifestUrl` se o site mudar de endereço. O manifesto só é publicado quando o VSIX da mesma versão foi gerado.

O identificador para publicar na conta CarlosEFranco é `CarlosEFranco.nestor-forge-agent-orchestra`. O nome interno `agentorchestra` foi usado em uma publicação removida e permanece reservado pelo Marketplace. Se você instalou `CarlosEFranco.agentorchestra`, `nestor-forge.agentorchestra`, `CarlosFranco.agentorchestra` ou a extensão anterior **Nestor Agents**, remova-a após instalar esta versão para não manter dois ícones. A troca de identificador cria uma extensão diferente no VS Code, então a instalação antiga não recebe esta versão como atualização automática.
