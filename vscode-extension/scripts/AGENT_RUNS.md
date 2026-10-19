# Roteiros prontos para agentes

Selecione um agente Claude ou Codex na árvore do Agent Orchestra e clique em **Executar agente**. Escolha um roteiro, acrescente a tarefa quando necessário e escolha onde abrir a sessão.

Quando o projeto tem `.agentorchestra/context/index.jsonl` (comando **Construir índice de contexto** ou `node <caminho-da-extensão>/scripts/build-index.js --root .`), a instrução inclui um cartão de rota com arquivos e faixas de linhas, notas e riscos relacionados à tarefa. O cartão aparece tanto no terminal quanto na instrução copiada para a extensão oficial. Para aprofundar uma pergunta, execute `node <caminho-da-extensão>/scripts/find.js --root . "<pergunta>"`; acrescente `--json` para saída estruturada. Se o cartão não bastar, consulte `.agentorchestra/context/project-handoff.json`.

| Roteiro | Uso |
| --- | --- |
| Executar missão | Enviar uma tarefa livre ao agente. |
| Revisar alterações | Inspecionar o diff atual e arquivos não rastreados. |
| Investigar e corrigir bug | Reproduzir, corrigir e validar um problema descrito. |
| Criar testes | Cobrir comportamentos alterados com testes relevantes. |
| Documentar mudanças | Atualizar instruções e exemplos afetados. |
| Auditar segurança | Fazer análise passiva com evidências. |

**Terminal integrado:** o Agent Orchestra inicia o CLI interativo no projeto e abre o painel do agente. O terminal mostra mensagens, comandos e pedidos de aprovação; o painel acompanha início e término do processo. Para Claude, a extensão passa `--agent <nome>` ao CLI. Para Codex, inicia uma sessão que solicita a delegação ao subagente personalizado. O Codex decide a execução do subagente dentro da sessão; confira a conversa no terminal.

**Extensão oficial:** abre o painel do Claude Code ou do Codex e copia a instrução. Cole e envie na conversa. As extensões oficiais não expõem uma API pública estável para enviar automaticamente esse texto a partir do Agent Orchestra. O painel marca a tarefa como **preparada**, sem afirmar que ela começou.

Configure `agentOrchestra.claudePath` ou `agentOrchestra.codexPath` se os executáveis não estiverem no `PATH`. A execução exige um projeto confiável. O Agent Orchestra não ignora permissões dos CLIs e não registra o conteúdo da conversa.
