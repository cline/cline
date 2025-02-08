# Contribuir para o Cline

Estamos felizes por você estar interessado em contribuir com o Cline. Seja corrigindo um erro, adicionando uma funcionalidade ou melhorando nossa documentação, cada contribuição torna o Cline mais inteligente! Para manter nossa comunidade viva e acolhedora, todos os membros devem cumprir nosso Código de Conduta [Código de Conduta](CODE_OF_CONDUCT.md).

## Relatar erros ou problemas

Relatar erros ajuda a melhorar o Cline para todos! Antes de criar um novo issue, revise as [issues existentes](https://github.com/cline/cline/issues) para evitar duplicações. Quando estiver pronto para relatar um erro, vá até nossa [página de Issues](https://github.com/cline/cline/issues/new/choose), onde você encontrará um modelo que ajudará a preencher as informações relevantes.

<blockquote class='warning-note'>
    🔐 <b>Importante:</b> Se você descobrir uma vulnerabilidade de segurança, utilize a <a href="https://github.com/cline/cline/security/advisories/new">ferramenta de segurança do GitHub</a> para relatá-la de forma privada.
</blockquote>

## Escolher no que trabalhar

Procurando uma boa primeira contribuição? Consulte os problemas marcados com ["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue) ou ["help wanted"](https://github.com/cline/cline/labels/help%20wanted). Estes foram especialmente selecionados para novos colaboradores e são áreas em que adoraríamos receber ajuda!

Também damos boas-vindas a contribuições para nossa [documentação](https://github.com/cline/cline/tree/main/docs). Seja corrigindo erros de digitação, melhorando guias existentes ou criando novos conteúdos educativos, queremos construir um repositório de recursos gerido pela comunidade que ajude todos a tirar o máximo proveito do Cline. Você pode começar explorando `/docs` e procurando áreas que precisam de melhorias.

Se planeja trabalhar em uma funcionalidade maior, crie primeiro uma [solicitação de funcionalidade](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) para que possamos discutir se ela se alinha à visão do Cline.

## Configurar o ambiente de desenvolvimento

1. **Extensões do VS Code**

    - Ao abrir o projeto, o VS Code solicitará que você instale as extensões recomendadas.
    - Essas extensões são necessárias para o desenvolvimento – aceite todas as solicitações de instalação.
    - Caso tenha rejeitado as solicitações, você pode instalá-las manualmente na seção de extensões.

2. **Desenvolvimento local**
    - Execute `npm run install:all` para instalar as dependências.
    - Execute `npm run test` para rodar os testes localmente.
    - Antes de enviar um PR, execute `npm run format:fix` para formatar seu código.

## Escrever e enviar código

Qualquer pessoa pode contribuir com código para o Cline, mas pedimos que siga estas diretrizes para garantir que suas contribuições sejam integradas sem problemas:

1. **Mantenha os Pull Requests focados**

    - Limite os PRs a uma única funcionalidade ou correção de erro.
    - Divida alterações maiores em PRs menores e coerentes.
    - Divida as alterações em commits lógicos que possam ser revisados independentemente.

2. **Qualidade do código**

    - Execute `npm run lint` para verificar o estilo do código.
    - Execute `npm run format` para formatar automaticamente o código.
    - Todos os PRs devem passar nas verificações do CI, que incluem linting e formatação.
    - Resolva todos os avisos ou erros do ESLint antes de enviar.
    - Siga as melhores práticas para TypeScript e mantenha a segurança dos tipos.

3. **Testes**

    - Adicione testes para novas funcionalidades.
    - Execute `npm test` para garantir que todos os testes passem.
    - Atualize testes existentes caso suas alterações os afetem.
    - Inclua tanto testes unitários quanto de integração onde for apropriado.

4. **Diretrizes de commits**

    - Escreva mensagens de commit claras e descritivas.
    - Use o formato convencional (por exemplo, "feat:", "fix:", "docs:").
    - Faça referência aos issues relevantes nos commits usando #número-do-issue.

5. **Antes de enviar**

    - Faça rebase com sua branch com a última versão da branch principal (main).
    - Certifique-se de que sua branch seja construída corretamente.
    - Verifique se todos os testes passam.
    - Revise suas alterações para remover qualquer código de depuração ou logs desnecessários.

6. **Descrição do Pull Request**
    - Descreva claramente o que suas alterações fazem.
    - Inclua passos para testar as alterações.
    - Liste quaisquer mudanças importantes.
    - Adicione capturas de tela para mudanças na interface do usuário.

## Acordo de contribuição

Ao enviar um Pull Request, você concorda que suas contribuições serão licenciadas sob a mesma licença do projeto ([Apache 2.0](LICENSE)).

Lembre-se: Contribuir com o Cline não é apenas escrever código – é fazer parte de uma comunidade que está moldando o futuro do desenvolvimento assistido por IA. Vamos criar algo incrível juntos! 🚀

