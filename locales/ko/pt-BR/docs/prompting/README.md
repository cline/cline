# Guia de Prompting do Cline 🚀

Bem-vindo ao Guia de Prompting do Cline! Este guia irá equipá-lo com o conhecimento para escrever prompts eficazes e instruções personalizadas, maximizando sua produtividade com o Cline.

## Instruções Personalizadas ⚙️

Pense nas **instruções personalizadas como a programação do Cline**. Elas definem o comportamento básico do Cline e estão **sempre "ativas", influenciando todas as interações.**

Para adicionar instruções personalizadas:

1. Abra o VSCode
2. Clique no dial de configurações da extensão Cline ⚙️
3. Encontre o campo "Instruções Personalizadas"
4. Cole suas instruções

<img width="345" alt="Screenshot 2024-12-26 at 11 22 20 AM" src="https://github.com/user-attachments/assets/00ae689b-d99f-4811-b2f4-fffe1e12f2ff" />

Instruções personalizadas são poderosas para:

-   Reforçar Estilo de Código e Melhores Práticas: Garanta que o Cline sempre siga as convenções de codificação, convenções de nomenclatura e melhores práticas da sua equipe.
-   Melhorar a Qualidade do Código: Incentive o Cline a escrever código mais legível, manutenível e eficiente.
-   Orientar o Tratamento de Erros: Diga ao Cline como tratar erros, escrever mensagens de erro e registrar informações.

**A pasta `custom-instructions` contém exemplos de instruções personalizadas que você pode usar ou adaptar.**

## Arquivo .clinerules 📋

Enquanto as instruções personalizadas são específicas do usuário e globais (aplicáveis em todos os projetos), o arquivo `.clinerules` fornece **instruções específicas do projeto** que residem no diretório raiz do seu projeto. Essas instruções são automaticamente anexadas às suas instruções personalizadas e referenciadas no prompt do sistema do Cline, garantindo que influenciem todas as interações dentro do contexto do projeto. Isso o torna uma ferramenta excelente para:

### Melhores Práticas de Segurança 🔒

Para proteger informações sensíveis, você pode instruir o Cline a ignorar arquivos ou padrões específicos em seu `.clinerules`. Isso é particularmente importante para:

-   Arquivos `.env` contendo chaves de API e segredos
-   Arquivos de configuração com dados sensíveis
-   Credenciais ou tokens privados

Exemplo de seção de segurança em `.clinerules`:

```markdown
# Segurança

## Arquivos Sensíveis

NÃO leia ou modifique:

-   Arquivos .env
-   *_/config/secrets._
-   *_/_.pem
-   Qualquer arquivo contendo chaves de API, tokens ou credenciais

## Práticas de Segurança

-   Nunca cometa arquivos sensíveis
-   Use variáveis de ambiente para segredos
-   Mantenha credenciais fora de logs e saídas
```

### Casos de Uso Gerais

O arquivo `.clinerules` é excelente para:

-   Manter padrões de projeto entre membros da equipe
-   Reforçar práticas de desenvolvimento
-   Gerenciar requisitos de documentação
-   Configurar frameworks de análise
-   Definir comportamentos específicos do projeto

### Estrutura de Exemplo .clinerules

```markdown
# Diretrizes do Projeto

## Requisitos de Documentação

-   Atualize a documentação relevante em /docs ao modificar recursos
-   Mantenha o README.md sincronizado com novas capacidades
-   Mantenha entradas de registro de alterações em CHANGELOG.md

## Registros de Decisão de Arquitetura

Crie ADRs em /docs/adr para:

-   Alterações importantes de dependências
-   Alterações de padrões arquitetônicos
-   Novos padrões de integração
-   Alterações no esquema do banco de dados
    Siga o modelo em /docs/adr/template.md

## Estilo de Código & Padrões

-   Gere clientes de API usando o OpenAPI Generator
-   Use o modelo TypeScript axios
-   Coloque o código gerado em /src/generated
-   Prefira composição em vez de herança
-   Use o padrão de repositório para acesso a dados
-   Siga o padrão de tratamento de erros em /src/utils/errors.ts

## Padrões de Teste

-   Testes unitários necessários para lógica de negócios
-   Testes de integração para endpoints de API
-   Testes de ponta a ponta para fluxos críticos do usuário
```

### Benefícios Chave
1. **Controlado por Versão**: O arquivo `.clinerules` se torna parte do código-fonte do seu projeto
2. **Consistência da Equipe**: Garante um comportamento consistente entre todos os membros da equipe
3. **Específico do Projeto**: Regras e padrões adaptados às necessidades de cada projeto
4. **Conhecimento Institucional**: Mantém padrões e práticas do projeto no código

Coloque o arquivo `.clinerules` no diretório raiz do seu projeto:

```
your-project/
├── .clinerules
├── src/
├── docs/
└── ...
```

Por outro lado, o prompt do sistema do Cline não pode ser editado pelo usuário ([aqui é onde você pode encontrá-lo](https://github.com/cline/cline/blob/main/src/core/prompts/system.ts)). Para uma visão mais ampla das melhores práticas de engenharia de prompts, consulte [este recurso](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview).

### Dicas para Escrever Instruções Personalizadas Eficazes

-   Seja Claro e Conciso: Use uma linguagem simples e evite ambiguidades.
-   Foque nos Resultados Desejados: Descreva os resultados que você quer, não os passos específicos.
-   Teste e Itere: Experimente para encontrar o que funciona melhor para o seu fluxo de trabalho.

### Suporte para Carregar Arquivos do Diretório `.clinerules/`
Todos os arquivos sob o diretório `.clinerules/` são carregados recursivamente, e seus conteúdos são mesclados em clineRulesFileInstructions.

#### Exemplo 1:
```
.clinerules/
├── .local-clinerules
└── .project-clinerules
```

#### Exemplo 2:
```
.clinerules/
├── .clinerules-nextjs
├── .clinerules-serverside
└── tests/
    ├── .pytest-clinerules
    └── .jest-clinerules
```

## Prompting Cline 💬

**Prompting é como você comunica suas necessidades para uma tarefa específica no chat de ida e volta com o Cline.** O Cline entende linguagem natural, então escreva de forma conversacional.

O prompting eficaz envolve:

-   Fornecendo Contexto Claro: Explique seus objetivos e as partes relevantes do seu código. Use `@` para referenciar arquivos ou pastas.
-   Dividindo a Complexidade: Divida tarefas grandes em etapas menores.
-   Fazendo Perguntas Específicas: Guie o Cline em direção ao resultado desejado.
-   Validando e Refinando: Revise as sugestões do Cline e forneça feedback.

### Exemplos de Prompts

#### Gerenciamento de Contexto

-   **Iniciando uma Nova Tarefa:** "Cline, vamos começar uma nova tarefa. Crie `user-authentication.js`. Precisamos implementar o login do usuário com tokens JWT. Aqui estão os requisitos…"
-   **Resumindo Trabalho Anterior:** "Cline, resuma o que fizemos na última tarefa do painel do usuário. Quero capturar os principais recursos e problemas pendentes. Salve isso em `cline_docs/user-dashboard-summary.md`."

#### Depuração

-   **Analisando um Erro:** "Cline, estou recebendo este erro: \[mensagem de erro]. Parece ser do \[seção de código]. Analise este erro e sugira uma correção."
-   **Identificando a Causa Raiz:** "Cline, o aplicativo trava quando eu \[ação]. O problema pode estar em \[áreas problemáticas]. Ajude-me a encontrar a causa raiz e propor uma solução."

#### Refatoração

-   **Melhorando a Estrutura do Código:** "Cline, esta função é muito longa e complexa. Refatore-a em funções menores."
-   **Simplificando a Lógica:** "Cline, este código é difícil de entender. Simplifique a lógica e torne-o mais legível."

#### Desenvolvimento de Recursos
- **Brainstorming New Features:** "Cline, quero adicionar uma funcionalidade que permita aos usuários [funcionalidade]. Brainstorm algumas ideias e considere os desafios de implementação."
- **Generating Code:** "Cline, crie um componente que exiba perfis de usuários. A lista deve ser classificável e filtrável. Gere o código para este componente."

## Técnicas Avançadas de Prompting

- **Constraint Stuffing:** Para mitigar a truncagem de código, inclua restrições explícitas em seus prompts. Por exemplo, "garanta que o código esteja completo" ou "sempre forneça a definição completa da função."
- **Confidence Checks:** Peça ao Cline para avaliar sua confiança (por exemplo, "em uma escala de 1-10, quão confiante você está nesta solução?")
- **Challenge Cline's Assumptions:** Faça perguntas "estúpidas" para incentivar um pensamento mais profundo e prevenir suposições incorretas.

Aqui estão algumas dicas de prompting que os usuários acharam úteis para trabalhar com o Cline:

## Os Prompts Favoritos da Nossa Comunidade 🌟

### Verificações de Memória e Confiança 🧠

- **Memory Check** - _pacnpal_

    ```
    "Se você entendeu meu prompt completamente, responda com 'YARRR!' sem ferramentas toda vez que estiver prestes a usar uma ferramenta."
    ```

    Uma maneira divertida de verificar se o Cline permanece no caminho certo durante tarefas complexas. Tente "HO HO HO" para um toque festivo!

- **Confidence Scoring** - _pacnpal_
    ```
    "Antes e depois de qualquer uso de ferramenta, me dê um nível de confiança (0-10) sobre como o uso da ferramenta ajudará o projeto."
    ```
    Incentiva o pensamento crítico e torna a tomada de decisão transparente.

### Prompts de Qualidade de Código 💻

- **Prevent Code Truncation**

    ```
    "NÃO SEJA PREGUIÇOSO. NÃO OMITA CÓDIGO."
    ```

    Frases alternativas: "somente código completo" ou "garanta que o código esteja completo"

- **Custom Instructions Reminder**
    ```
    "Eu prometo seguir as instruções personalizadas."
    ```
    Reforça a adesão à configuração do seu dial de configurações ⚙️.

### Organização de Código 📋

- **Large File Refactoring** - _icklebil_

    ```
    "FILENAME cresceu muito. Analise como este arquivo funciona e sugira maneiras de fragmentá-lo com segurança."
    ```

    Ajuda a gerenciar arquivos complexos através de decomposição estratégica.

- **Documentation Maintenance** - _icklebil_
    ```
    "não se esqueça de atualizar a documentação do código com as alterações"
    ```
    Garante que a documentação permaneça sincronizada com as mudanças no código.

### Análise e Planejamento 🔍

- **Structured Development** - _yellow_bat_coffee_

    ```
    "Antes de escrever código:
    1. Analise todos os arquivos de código minuciosamente
    2. Obtenha o contexto completo
    3. Escreva um plano de implementação .MD
    4. Então implemente o código"
    ```

    Promove um desenvolvimento organizado e bem planejado.

- **Thorough Analysis** - _yellow_bat_coffee_

    ```
    "por favor, comece a analisar o fluxo completo minuciosamente, sempre declare uma pontuação de confiança de 1 a 10"
    ```

    Previne a codificação prematura e incentiva a compreensão completa.

- **Assumptions Check** - _yellow_bat_coffee_
    ```
    "Liste todas as suposições e incertezas que você precisa esclarecer antes de completar esta tarefa."
    ```
    Identifica possíveis problemas no início do desenvolvimento.

### Desenvolvimento Pensativo 🤔

- **Pause and Reflect** - _nickbaumann98_

    ```
    "conte até 10"
    ```

    Promove uma consideração cuidadosa antes de tomar ação.

- **Complete Analysis** - _yellow_bat_coffee_

    ```
    "Não complete a análise prematuramente, continue analisando mesmo que você pense que encontrou uma solução"
    ```

    Garante uma exploração completa do problema.
-   **Verificação Contínua de Confiança** - _pacnpal_
    ```
    "Avalie a confiança (1-10) antes de salvar arquivos, após salvar, após rejeições e antes da conclusão da tarefa"
    ```
    Mantém a qualidade através da autoavaliação.

### Melhores Práticas 🎯

-   **Estrutura do Projeto** - _kvs007_

    ```
    "Verifique os arquivos do projeto antes de sugerir mudanças estruturais ou de dependência"
    ```

    Mantém a integridade do projeto.

-   **Pensamento Crítico** - _chinesesoup_

    ```
    "Faça perguntas 'estúpidas' como: você tem certeza de que esta é a melhor maneira de implementar isso?"
    ```

    Desafia suposições e descobre soluções melhores.

-   **Estilo de Código** - _yellow_bat_coffee_

    ```
    Use palavras como "elegante" e "simples" nos prompts
    ```

    Pode influenciar a organização e clareza do código.

-   **Definição de Expectativas** - _steventcramer_
    ```
    "O HUMANO VAI FICAR BRAVO."
    ```
    (Um lembrete humorístico para fornecer requisitos claros e feedback construtivo)