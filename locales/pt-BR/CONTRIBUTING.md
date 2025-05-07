[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • <b>Português (BR)</b> • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Contribuindo para o Roo Code

O Roo Code é um projeto impulsionado pela comunidade e valorizamos muito cada contribuição. Para garantir um processo tranquilo e eficaz para todos, **operamos com uma abordagem "[Issue-First](#2-princípio-chave-abordagem-issue-first)".** Isso significa que todo o trabalho deve estar vinculado a uma Issue do GitHub _antes_ de enviar um Pull Request (veja nossa [Política de PR](#política-de-pull-request-pr) para detalhes). Leia este guia com atenção para entender como contribuir.
Este guia explica como contribuir para o Roo Code, seja corrigindo bugs, adicionando recursos ou melhorando a documentação.

## Índice

- [I. Antes de Contribuir](#i-antes-de-contribuir)
    - [1. Código de Conduta](#1-código-de-conduta)
    - [2. Entenda o Roadmap do Projeto](#2-entenda-o-roadmap-do-projeto)
        - [Suporte a Provedores](#suporte-a-provedores)
        - [Suporte a Modelos](#suporte-a-modelos)
        - [Suporte a Sistemas](#suporte-a-sistemas)
        - [Documentação](#documentação)
        - [Estabilidade](#estabilidade)
        - [Internacionalização](#internacionalização)
    - [3. Junte-se à Comunidade Roo Code](#3-junte-se-à-comunidade-roo-code)
- [II. Encontrando & Planejando sua Contribuição](#ii-encontrando--planejando-sua-contribuição)
    - [1. Tipos de Contribuição](#1-tipos-de-contribuição)
    - [2. Princípio-chave: Abordagem Issue-First](#2-princípio-chave-abordagem-issue-first)
    - [3. Decidindo no que Trabalhar](#3-decidindo-no-que-trabalhar)
    - [4. Relatando Bugs ou Problemas](#4-relatando-bugs-ou-problemas)
- [III. Processo de Desenvolvimento & Submissão](#iii-processo-de-desenvolvimento--submissão)
    - [1. Configuração de Desenvolvimento](#1-configuração-de-desenvolvimento)
    - [2. Diretrizes para Escrever Código](#2-diretrizes-para-escrever-código)
    - [3. Enviando Código: Processo de Pull Request (PR)](#3-enviando-código-processo-de-pull-request-pr)
        - [Pull Requests em Rascunho](#pull-requests-em-rascunho)
        - [Descrição do Pull Request](#descrição-do-pull-request)
        - [Política de Pull Request (PR)](#política-de-pull-request-pr)
            - [Objetivo](#objetivo)
            - [Abordagem Issue-First](#abordagem-issue-first)
            - [Condições para PRs Abertos](#condições-para-prs-abertos)
            - [Procedimento](#procedimento)
            - [Responsabilidades](#responsabilidades)
- [IV. Legal](#iv-legal)
    - [Acordo de Contribuição](#acordo-de-contribuição)

## I. Antes de Contribuir

Primeiro, familiarize-se com nossos padrões de comunidade e a direção do projeto.

### 1. Código de Conduta

Todos os colaboradores devem seguir nosso [Código de Conduta](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md). Por favor, leia antes de contribuir.

### 2. Entenda o Roadmap do Projeto

O Roo Code possui um roadmap de desenvolvimento claro que orienta nossas prioridades e direção futura. Entender o roadmap pode te ajudar a:

- Alinhar suas contribuições com os objetivos do projeto
- Identificar áreas onde sua experiência será mais valiosa
- Compreender o contexto por trás de certas decisões de design
- Se inspirar para novos recursos que apoiem nossa visão

Nosso roadmap atual foca em seis pilares principais:

#### Suporte a Provedores

Queremos dar suporte ao maior número possível de provedores:

- Mais suporte "Compatível com OpenAI"
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Suporte aprimorado para Ollama e LM Studio

#### Suporte a Modelos

Queremos que o Roo funcione com o maior número possível de modelos, incluindo modelos locais:

- Suporte a modelos locais por meio de prompts de sistema personalizados e fluxos de trabalho
- Benchmarks, avaliações e casos de teste

#### Suporte a Sistemas

Queremos que o Roo funcione bem em qualquer computador:

- Integração de terminal multiplataforma
- Suporte forte e consistente para Mac, Windows e Linux

#### Documentação

Queremos documentação abrangente e acessível para todos os usuários e colaboradores:

- Guias e tutoriais expandidos
- Documentação clara da API
- Melhor orientação para colaboradores
- Recursos de documentação multilíngue
- Exemplos interativos e trechos de código

#### Estabilidade

Queremos reduzir significativamente o número de bugs e aumentar os testes automatizados:

- Chave de ativação de logs de depuração
- Botão "Copiar informações da máquina/tarefa" para solicitações de bug/suporte

#### Internacionalização

Queremos que o Roo fale a língua de todos:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

Contribuições que avançam os objetivos do nosso roadmap são especialmente bem-vindas. Se você estiver trabalhando em algo alinhado com esses pilares, mencione isso na descrição do seu PR.

### 3. Junte-se à Comunidade Roo Code

Conectar-se com a comunidade Roo Code é uma ótima maneira de começar:

- **Método principal**:
    1.  Junte-se à [comunidade Roo Code no Discord](https://discord.gg/roocode).
    2.  Depois, envie uma mensagem direta (DM) para **Hannes Rudolph** (Discord: `hrudolph`) para discutir seu interesse e receber orientações.
- **Alternativa para colaboradores experientes**: Se você está confortável com a abordagem issue-first, pode participar diretamente pelo GitHub acompanhando o [quadro Kanban](https://github.com/orgs/RooVetGit/projects/1) e se comunicando via issues e pull requests.

## II. Encontrando & Planejando sua Contribuição

Identifique no que gostaria de trabalhar e como abordar.

### 1. Tipos de Contribuição

Aceitamos vários tipos de contribuição:

- **Correção de bugs**: Corrigir problemas no código existente.
- **Novos recursos**: Adicionar novas funcionalidades.
- **Documentação**: Melhorar guias, exemplos ou corrigir erros de digitação.

### 2. Princípio-chave: Abordagem Issue-First

**Todas as contribuições devem começar com uma Issue do GitHub.** Este é um passo fundamental para garantir alinhamento e evitar esforços desperdiçados.

- **Encontrar ou criar uma Issue**:
    - Antes de começar, procure em [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) se já existe uma issue para sua contribuição.
    - Se existir e não estiver atribuída, comente na issue para expressar seu interesse. Um mantenedor irá atribuí-la a você.
    - Se não existir, crie uma nova usando o template apropriado em nossa [página de issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose):
        - Para bugs, use o template "Bug Report".
        - Para novos recursos, use o template "Detailed Feature Proposal". Aguarde a aprovação de um mantenedor (especialmente @hannesrudolph) antes de começar a implementar.
        - **Nota**: Ideias gerais ou discussões preliminares sobre recursos podem começar em [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests). Quando a ideia estiver mais concreta, uma issue "Detailed Feature Proposal" deve ser criada.
- **Reivindicação e atribuição**:
    - Indique claramente sua intenção de trabalhar em uma issue comentando nela.
    - Aguarde um mantenedor atribuí-la oficialmente a você no GitHub. Isso evita que várias pessoas trabalhem na mesma coisa.
- **Consequências de não seguir**:
    - Pull Requests (PRs) enviados sem uma issue correspondente, pré-aprovada e atribuída podem ser fechados sem revisão completa. Esta política existe para garantir que as contribuições estejam alinhadas com as prioridades do projeto e para respeitar o tempo de todos.

Essa abordagem nos ajuda a rastrear o trabalho, garantir que as mudanças sejam desejadas e coordenar esforços de forma eficaz.

### 3. Decidindo no que Trabalhar

- **Good First Issues**: Confira a seção "Issue [Unassigned]" do nosso [Projeto Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) no GitHub.
- **Documentação**: Embora este `CONTRIBUTING.md` seja o guia principal para contribuições de código, se você quiser contribuir para outra documentação (como guias de usuário ou API), confira o [repositório Roo Code Docs](https://github.com/RooVetGit/Roo-Code-Docs) ou pergunte na comunidade do Discord.
- **Propondo novos recursos**:
    1.  **Ideia/discussão inicial**: Para ideias gerais ou iniciais, inicie uma conversa em [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests).
    2.  **Proposta formal**: Para propostas específicas e prontas para consideração, crie uma issue "Detailed Feature Proposal" usando o template em nossa [página de issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose). Isso é fundamental em nossa **abordagem Issue-First**.

### 4. Relatando Bugs ou Problemas

Se encontrar um bug:

1.  **Procure issues existentes**: Verifique [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) para ver se já foi relatado.
2.  **Crie uma nova issue**: Se for único, use o template "Bug Report" em nossa [página de issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose).

> 🔐 **Vulnerabilidades de segurança**: Se você descobrir uma vulnerabilidade de segurança, relate-a de forma privada usando a [ferramenta de avisos de segurança do GitHub](https://github.com/RooVetGit/Roo-Code/security/advisories/new). Não crie uma issue pública para vulnerabilidades de segurança.

## III. Processo de Desenvolvimento & Submissão

Siga estes passos para programar e enviar seu trabalho.

### 1. Configuração de Desenvolvimento

1.  **Fork & Clone**:
    - Faça um fork do repositório no GitHub.
    - Clone seu fork localmente: `git clone https://github.com/SEU_USUÁRIO/Roo-Code.git`
2.  **Instale as dependências**: `npm run install:all`
3.  **Execute o Webview (modo dev)**: `npm run dev` (para o app Vite/React com HMR)
4.  **Debugue a extensão**: Pressione `F5` no VS Code (ou **Run** → **Start Debugging**) para abrir uma nova janela Extension Development Host com o Roo Code carregado.

As alterações no webview (`webview-ui`) aparecerão imediatamente graças ao Hot Module Replacement. Alterações na extensão principal (`src`) exigirão reiniciar o Extension Development Host.

Alternativamente, para construir e instalar um pacote `.vsix`:

```sh
npm run build
code --install-extension bin/roo-cline-<versão>.vsix
```

(Substitua `<versão>` pelo número real da versão do arquivo gerado).

### 2. Diretrizes para Escrever Código

- **PRs focados**: Um recurso/correção por PR.
- **Qualidade do código**:
    - Passar nos checks de CI (lint, formatação)
    - Corrigir avisos ou erros do ESLint (`npm run lint`)
    - Responder ao feedback de ferramentas automáticas de revisão de código
    - Seguir boas práticas de TypeScript e manter a segurança de tipos
- **Testes**:
    - Adicionar testes para novos recursos
    - Executar `npm test` para garantir que tudo passa
    - Atualizar testes existentes se suas alterações os afetarem
- **Mensagens de commit**:
    - Escrever mensagens claras e descritivas
    - Referenciar issues relevantes usando `#número-issue` (ex: `Fixes #123`)
- **Checklist antes de enviar PR**:
    - Rebasear sua branch no último `main` do upstream
    - Garantir que o código compila (`npm run build`)
    - Todos os testes devem passar (`npm test`)
    - Remover qualquer código de depuração ou `console.log`

### 3. Enviando Código: Processo de Pull Request (PR)

#### Pull Requests em Rascunho

Use PRs em rascunho para trabalhos que ainda não estão prontos para revisão completa, mas para os quais você deseja:

- Rodar checks automáticos (CI)
- Receber feedback antecipado de mantenedores ou outros colaboradores
- Sinalizar que o trabalho está em andamento

Marque um PR como "Pronto para Revisão" apenas quando todos os checks passarem e você acreditar que ele atende aos critérios de "Diretrizes para Escrever Código" e "Descrição do Pull Request".

#### Descrição do Pull Request

A descrição do seu PR deve ser completa e seguir a estrutura do nosso [Template de Pull Request](.github/pull_request_template.md). Pontos principais:

- Um link para a Issue do GitHub aprovada que ele resolve
- Descrição clara das alterações feitas e seu propósito
- Passos detalhados para testar as alterações
- Lista de quaisquer breaking changes
- **Para mudanças de UI, forneça capturas de tela ou vídeos de antes e depois**
- **Indique se seu PR exige atualização da documentação do usuário e quais documentos/seções são afetados**

#### Política de Pull Request (PR)

##### Objetivo

Manter um backlog de PRs limpo, focado e gerenciável.

##### Abordagem Issue-First

- **Obrigatório**: Antes de começar, deve existir uma Issue do GitHub aprovada e atribuída (seja "Bug Report" ou "Detailed Feature Proposal").
- **Aprovação**: Issues, especialmente para mudanças grandes, devem ser revisadas e aprovadas por mantenedores (especialmente @hannesrudolph) _antes_ de começar a programar.
- **Referência**: PRs devem referenciar explicitamente essas issues pré-aprovadas na descrição.
- **Consequências**: Não seguir esse processo pode resultar no fechamento do PR sem revisão completa.

##### Condições para PRs Abertos

- **Pronto para merge**: Passa todos os testes de CI, está alinhado com o roadmap (se aplicável), está vinculado a uma Issue aprovada e atribuída, tem documentação/comentários claros, inclui imagens/vídeos de antes e depois para mudanças de UI
- **Para fechar**: Falha nos testes de CI, grandes conflitos de merge, desalinhamento com os objetivos do projeto ou inatividade prolongada (>30 dias sem atualizações após feedback)

##### Procedimento

1.  **Qualificação & atribuição de Issues**: @hannesrudolph (ou outros mantenedores) revisam e atribuem novas e existentes Issues.
2.  **Triagem inicial de PRs (diária)**: Mantenedores fazem uma revisão rápida dos PRs recebidos para filtrar urgências ou problemas críticos.
3.  **Revisão detalhada de PRs (semanal)**: Mantenedores revisam a fundo os PRs para avaliar prontidão, alinhamento com a Issue aprovada e qualidade geral.
4.  **Feedback detalhado & iteração**: Com base na revisão, mantenedores fornecem feedback (Aprovar, Solicitar Mudanças, Rejeitar). Espera-se que os colaboradores respondam e melhorem conforme necessário.
5.  **Fase de decisão**: PRs aprovados são mesclados. PRs com problemas insolúveis ou desalinhados podem ser fechados com explicação clara.
6.  **Follow-up**: Autores de PRs fechados podem abordar o feedback e abrir novos se os problemas forem resolvidos ou a direção do projeto mudar.

##### Responsabilidades

- **Qualificação de Issues & cumprimento do processo (@hannesrudolph & mantenedores)**: Garantir que todas as contribuições sigam a abordagem Issue-First. Orientar colaboradores no processo.
- **Mantenedores (Dev Team)**: Revisar PRs, fornecer feedback técnico, tomar decisões de aprovação/rejeição, mesclar PRs.
- **Colaboradores**: Garantir que os PRs estejam vinculados a uma Issue aprovada e atribuída, sigam as diretrizes de qualidade e respondam rapidamente ao feedback.

Esta política garante clareza e integração eficiente.

## IV. Legal

### Acordo de Contribuição

Ao enviar um pull request, você concorda que suas contribuições serão licenciadas sob a [Licença Apache 2.0](LICENSE) (ou a licença atual do projeto), assim como o projeto.
