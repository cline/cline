<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • <b>Português (BR)</b> • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuindo para o Roo Code

O Roo Code é um projeto impulsionado pela comunidade, e valorizamos profundamente cada contribuição. Para agilizar a colaboração, operamos com base em uma [abordagem de "primeiro a issue"](#abordagem-de-primeiro-a-issue), o que significa que todas as [Pull Requests (PRs)](#enviando-uma-pull-request) devem primeiro estar vinculadas a uma Issue do GitHub. Por favor, revise este guia com atenção.

## Índice

- [Antes de contribuir](#antes-de-contribuir)
- [Encontrando e planejando sua contribuição](#encontrando-e-planejando-sua-contribuição)
- [Processo de desenvolvimento e envio](#processo-de-desenvolvimento-e-envio)
- [Legal](#legal)

## Antes de contribuir

### 1. Código de Conduta

Todos os contribuidores devem aderir ao nosso [Código de Conduta](./CODE_OF_CONDUCT.md).

### 2. Roteiro do projeto

Nosso roteiro guia a direção do projeto. Alinhe suas contribuições com estes objetivos principais:

### Confiabilidade em primeiro lugar

- Garanta que a edição de diff e a execução de comandos sejam consistentemente confiáveis.
- Reduza os pontos de atrito que desencorajam o uso regular.
- Garanta uma operação tranquila em todas as localidades e plataformas.
- Expanda o suporte robusto para uma ampla variedade de provedores e modelos de IA.

### Experiência do usuário aprimorada

- Simplifique a UI/UX para clareza e intuitividade.
- Melhore continuamente o fluxo de trabalho para atender às altas expectativas que os desenvolvedores têm das ferramentas de uso diário.

### Liderando no desempenho do agente

- Estabeleça benchmarks de avaliação abrangentes (evals) para medir a produtividade do mundo real.
- Facilite para que todos possam executar e interpretar facilmente essas avaliações.
- Envie melhorias que demonstrem aumentos claros nas pontuações de avaliação.

Mencione o alinhamento com essas áreas em seus PRs.

### 3. Junte-se à comunidade Roo Code

- **Principal:** Junte-se ao nosso [Discord](https://discord.gg/roocode) e envie uma DM para **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Contribuidores experientes могут se envolver diretamente através dos [Projetos do GitHub](https://github.com/orgs/RooCodeInc/projects/1).

## Encontrando e planejando sua contribuição

### Tipos de contribuições

- **Correções de bugs:** abordando problemas de código.
- **Novos recursos:** adicionando funcionalidade.
- **Documentação:** melhorando guias e clareza.

### Abordagem de primeiro a issue

Todas as contribuições começam com uma Issue do GitHub usando nossos modelos simplificados.

- **Verifique as issues existentes**: Pesquise nas [Issues do GitHub](https://github.com/RooCodeInc/Roo-Code/issues).
- **Crie uma issue** usando:
    - **Melhorias:** modelo "Solicitação de melhoria" (linguagem simples focada no benefício do usuário).
    - **Bugs:** modelo "Relatório de bug" (reprodução mínima + esperado vs. real + versão).
- **Quer trabalhar nisso?** Comente "Reivindicando" na issue e envie uma DM para **Hannes Rudolph (`hrudolph`)** no [Discord](https://discord.gg/roocode) para ser atribuído. A atribuição será confirmada no tópico.
- **Os PRs devem ser vinculados à issue.** PRs não vinculados podem ser fechados.

### Decidindo no que trabalhar

- Verifique o [Projeto do GitHub](https://github.com/orgs/RooCodeInc/projects/1) para issues "Issue [Não atribuída]".
- Para documentação, visite [Documentação do Roo Code](https://github.com/RooCodeInc/Roo-Code-Docs).

### Relatando bugs

- Verifique primeiro os relatórios existentes.
- Crie um novo bug usando o [modelo "Relatório de bug"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) com:
    - Passos de reprodução claros e numerados
    - Resultado esperado vs. real
    - Versão do Roo Code (obrigatório); provedor/modelo de IA, se relevante
- **Problemas de segurança**: Relate em particular através de [avisos de segurança](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Processo de desenvolvimento e envio

### Configuração de desenvolvimento

1. **Fork e Clone:**

```
git clone https://github.com/SEU_NOME_DE_USUARIO/Roo-Code.git
```

2. **Instale as dependências:**

```
pnpm install
```

3. **Depuração:** Abra com o VS Code (`F5`).

### Diretrizes para escrever código

- Um PR focado por recurso ou correção.
- Siga as melhores práticas do ESLint e TypeScript.
- Escreva commits claros e descritivos referenciando issues (por exemplo, `Corrige #123`).
- Forneça testes completos (`npm test`).
- Faça o rebase para o branch `main` mais recente antes do envio.

### Enviando uma Pull Request

- Comece como um **PR de rascunho** se estiver buscando feedback inicial.
- Descreva claramente suas alterações seguindo o Modelo de Pull Request.
- Vincule a issue na descrição/título do PR (por exemplo, "Corrige #123").
- Forneça capturas de tela/vídeos para alterações na interface do usuário.
- Indique se as atualizações da documentação são necessárias.

### Política de Pull Request

- Deve fazer referência a uma Issue do GitHub atribuída. Para ser atribuído: comente "Reivindicando" na issue e envie uma DM para **Hannes Rudolph (`hrudolph`)** no [Discord](https://discord.gg/roocode). A atribuição será confirmada no tópico.
- PRs não vinculados podem ser fechados.
- Os PRs devem passar nos testes de CI, estar alinhados com o roteiro e ter documentação clara.

### Processo de revisão

- **Triagem diária:** verificações rápidas pelos mantenedores.
- **Revisão aprofundada semanal:** avaliação abrangente.
- **Itere prontamente** com base no feedback.

## Legal

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a Licença Apache 2.0, consistente com o licenciamento do Roo Code.
