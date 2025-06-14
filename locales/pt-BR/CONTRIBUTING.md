<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • <b>Português (BR)</b> • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuindo para o Roo Code

O Roo Code é um projeto impulsionado pela comunidade e valorizamos muito cada contribuição. Para simplificar a colaboração, operamos com uma abordagem [Issue-First](#abordagem-issue-first), o que significa que todos os [Pull Requests (PRs)](#enviando-um-pull-request) devem primeiro estar vinculados a uma Issue do GitHub. Por favor, leia este guia com atenção.

## Índice

- [Antes de Contribuir](#antes-de-contribuir)
- [Encontrando & Planejando sua Contribuição](#encontrando--planejando-sua-contribuição)
- [Processo de Desenvolvimento & Submissão](#processo-de-desenvolvimento--submissão)
- [Legal](#legal)

## Antes de Contribuir

### 1. Código de Conduta

Todos os colaboradores devem seguir nosso [Código de Conduta](./CODE_OF_CONDUCT.md).

### 2. Roadmap do Projeto

Nosso roadmap orienta a direção do projeto. Alinhe suas contribuições com estes objetivos principais:

### Confiabilidade em Primeiro Lugar

- Garantir que a edição de diferenças e a execução de comandos sejam consistentemente confiáveis
- Reduzir pontos de atrito que desencorajam o uso regular
- Garantir operação suave em todos os idiomas e plataformas
- Expandir o suporte robusto para uma ampla variedade de provedores e modelos de IA

### Experiência de Usuário Aprimorada

- Simplificar a interface do usuário para maior clareza e intuitividade
- Melhorar continuamente o fluxo de trabalho para atender às altas expectativas dos desenvolvedores

### Liderança em Desempenho de Agentes

- Estabelecer benchmarks de avaliação abrangentes (evals) para medir a produtividade no mundo real
- Facilitar para que todos possam executar e interpretar essas avaliações
- Fornecer melhorias que demonstrem aumentos claros nas pontuações de avaliação

Mencione o alinhamento com estas áreas em seus PRs.

### 3. Junte-se à Comunidade Roo Code

- **Principal:** Junte-se ao nosso [Discord](https://discord.gg/roocode) e envie um DM para **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Colaboradores experientes podem participar diretamente via [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1).

## Encontrando & Planejando sua Contribuição

### Tipos de Contribuição

- **Correção de bugs:** Corrigir problemas no código.
- **Novos recursos:** Adicionar novas funcionalidades.
- **Documentação:** Melhorar guias e clareza.

### Abordagem Issue-First

Todas as contribuições devem começar com uma Issue do GitHub.

- **Verificar issues existentes:** Procure em [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
- **Criar uma issue:** Use os templates apropriados:
    - **Bugs:** Template "Bug Report".
    - **Recursos:** Template "Detailed Feature Proposal". Aprovação necessária antes de começar.
- **Reivindicar issues:** Comente e aguarde atribuição oficial.

**PRs sem issues aprovadas podem ser fechados.**

### Decidindo no que Trabalhar

- Confira o [Projeto GitHub](https://github.com/orgs/RooCodeInc/projects/1) para "Good First Issues" não atribuídas.
- Para documentação, visite [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Relatando Bugs

- Verifique primeiro se já existem relatórios.
- Crie novos relatórios de bugs usando o [template "Bug Report"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose).
- **Vulnerabilidades de segurança:** Relate de forma privada via [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Processo de Desenvolvimento & Submissão

### Configuração de Desenvolvimento

1. **Fork & Clone:**

```
git clone https://github.com/SEU_USUÁRIO/Roo-Code.git
```

2. **Instalar dependências:**

```
npm run install:all
```

3. **Depuração:** Abra com VS Code (`F5`).

### Diretrizes para Escrever Código

- Um PR focado por recurso ou correção.
- Siga as melhores práticas de ESLint e TypeScript.
- Escreva commits claros e descritivos referenciando issues (ex: `Fixes #123`).
- Forneça testes completos (`npm test`).
- Rebase na branch `main` mais recente antes do envio.

### Enviando um Pull Request

- Comece como **PR em rascunho** se buscar feedback antecipado.
- Descreva claramente suas alterações seguindo o Template de Pull Request.
- Forneça capturas de tela/vídeos para alterações de UI.
- Indique se atualizações de documentação são necessárias.

### Política de Pull Request

- Deve referenciar issues pré-aprovadas e atribuídas.
- PRs que não seguem a política podem ser fechados.
- PRs devem passar nos testes de CI, alinhar-se ao roadmap e ter documentação clara.

### Processo de Revisão

- **Triagem diária:** Verificações rápidas pelos mantenedores.
- **Revisão semanal detalhada:** Avaliação abrangente.
- **Itere rapidamente** com base no feedback.

## Legal

Ao enviar um pull request, você concorda que suas contribuições serão licenciadas sob a Licença Apache 2.0, consistente com o licenciamento do Roo Code.
