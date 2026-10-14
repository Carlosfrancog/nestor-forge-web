# Execução da Forja por outro agente

O agente consulta as perguntas uma vez e envia um objeto JSON com as respostas. Não precisa controlar o menu, simular teclas nem reenviar os 24 campos quando os valores padrão servem.

```powershell
python -B scripts/agent_run.py questions --profile reader
```

A resposta é JSON compacto. Cada item em `questions` tem `[chave, pergunta, tipo, padrão]`. As chaves com ponto representam objetos aninhados, como `permissions.write_code`. `role` e `mission` precisam ser preenchidos; `name` e os demais campos recebem padrões do perfil.

Exemplo de entrada: [agent-answers.json](../examples/agent-answers.json).

```powershell
python -B scripts/agent_run.py run --answers examples/agent-answers.json --output dist/agent-example
```

O script envia o spec por stdin para o CLI e devolve uma única linha JSON com `ok`, `target`, `output`, `files` e, no destino genérico, `build_report`. A saída detalhada do compilador fica em `BUILD_REPORT.md`. Em caso de erro, retorna `{"ok":false,"error":"..."}` e código diferente de zero. Para usar o executável do ambiente Windows, acrescente:

```powershell
python -B scripts/agent_run.py run --answers examples/agent-answers.json --output dist/agent-example --cli .\dist\venv-windows\Scripts\nestor-forge.exe
```

Também é possível enviar respostas diretamente pela entrada padrão com `--answers -`. Para instalar no projeto, use `--target unified-project --output caminho/do/projeto`; arquivos existentes são preservados, e `--force` exige escolha explícita.

JSON é suficiente para esse contrato: as respostas são campos e listas, não uma linguagem de código. Uma AST acrescentaria nós e regras de parsing sem reduzir o trabalho ou o tamanho da entrada. A saída compacta mantém o relatório legível por máquinas e economiza tokens na troca entre agentes.
