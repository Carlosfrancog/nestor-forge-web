# Analisar diff estrutural

Execução manual no Agent Orchestra: **Scripts de skills → Analisar diff estrutural → Executar**. A extensão compara o `HEAD` com o estado atual, incluindo arquivos novos ainda não versionados, e abre um relatório Markdown.

Pelo terminal, dentro da pasta `vscode-extension`:

```powershell
node scripts/diff-ast.js C:\caminho\do\projeto HEAD > relatorio.md
```

O segundo argumento pode ser outro commit ou branch. O terceiro e o quarto argumentos opcionais são os executáveis de Python e Go. O analisador aceita PHP/Laravel, JS, JSX, TS, TSX, Vue, CSS/Tailwind, SQL PostgreSQL, Python, Go e Dockerfile. Python e Go precisam de seus runtimes instalados. Laravel é analisado pela estrutura PHP; Blade pode exigir tratamento adicional.

O cabeçalho mostra a pasta analisada, o total de arquivos alterados e os formatos ignorados pela análise estrutural. Arquivos novos têm apenas prévia da versão atual; arquivos modificados mostram até oito trechos “antes → depois” (até 2.000 caracteres por versão). O relatório separa estruturas adicionadas, removidas e alteradas. Um possível movimento entre arquivos é indicado quando corpos estruturais coincidem ou quando há sobreposição forte de chamadas. Isso **não prova** que a responsabilidade de negócio mudou: o dev deve revisar os dois arquivos. Classes Tailwind estáticas são extraídas de templates Vue; classes dinâmicas não são inferidas. Dockerfile é comparado por instruções, sem AST de linguagem de programação.

O script não executa código do projeto e não altera seus arquivos. Ele lê `git diff` e as versões de arquivo, e escreve o relatório apenas na saída padrão.
