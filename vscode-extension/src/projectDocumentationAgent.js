'use strict';

function documentationPrompt({ handoff = '.agentorchestra/context/project-handoff.json', docs = 'docs/architecture', framework = '' } = {}) {
  const laravel = framework === 'Laravel'
    ? 'Neste projeto Laravel, app/Http, app/Models, routes e database são camadas técnicas. Só trate uma área como módulo de negócio após confirmar a responsabilidade e os vínculos no código.'
    : 'Os grupos do mapa são hipóteses de navegação. Confirme no código quais representam módulos de negócio, pacotes ou apenas camadas técnicas.';
  return [
    'Você é o agente principal de documentação deste projeto.',
    `Leia primeiro ${handoff}. Use arquivos-chave, relações e lacunas para escolher blocos pequenos de código a verificar. Não carregue o repositório inteiro nem copie o cache do parser para o contexto.`,
    laravel,
    `Escreva a documentação validada em ${docs}/guides/README.md e, se houver áreas de negócio confirmadas, em notas específicas sob ${docs}/guides/. Explique responsabilidades, entradas, fluxos e dependências com referências a arquivos e linhas. Marque inferências e pontos não verificados.`,
    `Preserve ${docs}/index.md, ${docs}/modules/ e o manifesto de geração: são saídas automáticas que podem ser atualizadas após um pull. Preserve também notas manuais existentes.`,
    'Ao terminar, resuma os guias criados e as dúvidas que ainda exigem leitura humana.'
  ].join('\n\n');
}

module.exports = { documentationPrompt };
