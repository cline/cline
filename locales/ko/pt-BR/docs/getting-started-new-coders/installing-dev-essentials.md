# Instalando Ferramentas Essenciais de Desenvolvimento com Cline | Novos Programadores

Quando você começa a programar, você precisará de algumas ferramentas essenciais de desenvolvimento instaladas no seu computador. O Cline pode ajudá-lo a instalar tudo o que você precisa de uma maneira segura e guiada.

## As Ferramentas Essenciais

Aqui estão as ferramentas principais que você precisará para o desenvolvimento:

-   **Homebrew**: Um gerenciador de pacotes para macOS que facilita a instalação de outras ferramentas
-   **Node.js & npm**: Necessário para desenvolvimento em JavaScript e web
-   **Git**: Para rastrear mudanças no seu código e colaborar com outros
-   **Python**: Uma linguagem de programação usada por muitas ferramentas de desenvolvimento
-   **Utilitários adicionais**: Ferramentas como wget e jq que ajudam no download de arquivos e processamento de dados

## Deixe o Cline Instalar Tudo

Copie este prompt e cole no Cline:

```bash
Olá Cline! Preciso de ajuda para configurar meu Mac para desenvolvimento de software. Poderia me ajudar a instalar as ferramentas essenciais de desenvolvimento como Homebrew, Node.js, Git, Python e quaisquer outros utilitários que são comumente necessários para programação? Gostaria que você me guiasse pelo processo passo a passo, explicando o que cada ferramenta faz e garantindo que tudo seja instalado corretamente.
```

## O Que Vai Acontecer

1. O Cline primeiro instalará o Homebrew, que é como uma "loja de aplicativos" para ferramentas de desenvolvimento
2. Usando o Homebrew, o Cline então instalará outras ferramentas essenciais como Node.js e Git
3. Para cada etapa de instalação:
    - O Cline mostrará o comando exato que deseja executar
    - Você precisará aprovar cada comando antes que ele seja executado
    - O Cline verificará se cada instalação foi bem-sucedida

## Por Que Essas Ferramentas São Importantes

-   **Homebrew**: Facilita a instalação e atualização de ferramentas de desenvolvimento no seu Mac
-   **Node.js & npm**: Necessário para:
    -   Construir sites com React ou Next.js
    -   Executar código JavaScript
    -   Instalar pacotes JavaScript
-   **Git**: Ajuda você a:
    -   Salvar diferentes versões do seu código
    -   Colaborar com outros desenvolvedores
    -   Fazer backup do seu trabalho
-   **Python**: Usado para:
    -   Executar scripts de desenvolvimento
    -   Processamento de dados
    -   Projetos de aprendizado de máquina

## Notas

-   O processo de instalação é interativo - o Cline guiará você em cada etapa
-   Você pode precisar inserir a senha do seu computador para algumas instalações. Quando solicitado, você não verá nenhum caractere sendo digitado na tela. Isso é normal e é uma medida de segurança para proteger sua senha. Apenas digite sua senha e pressione Enter.

**Exemplo:**

```bash
$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
Senha:
```

_Digite sua senha aqui, mesmo que nada apareça na tela. Pressione Enter quando terminar._

-   Todos os comandos serão mostrados para você aprovar antes de serem executados
-   Se você encontrar algum problema, o Cline ajudará a solucioná-los

## Dicas Adicionais para Novos Programadores

### Entendendo o Terminal

O **Terminal** é um aplicativo onde você pode digitar comandos para interagir com seu computador. No macOS, você pode abri-lo pesquisando por "Terminal" no Spotlight.

**Exemplo:**

```bash
$ open -a Terminal
```

### Entendendo Recursos do VS Code

#### Terminal no VS Code

O **Terminal** no VS Code permite que você execute comandos diretamente do editor. Você pode abri-lo indo em `Visualizar > Terminal` ou pressionando `` Ctrl + ` ``.

**Exemplo:**

```bash
$ node -v
v16.14.0
```

#### Visualização de Documentos
A **Visualização de Documento** é onde você edita seus arquivos de código. Você pode abrir arquivos clicando neles no painel **Explorador** no lado esquerdo da tela.

#### Seção de Problemas

A seção **Problemas** no VS Code mostra quaisquer erros ou avisos em seu código. Você pode acessá-la clicando no ícone de lâmpada ou indo para `View > Problems`.

### Funcionalidades Comuns

-   **Interface de Linha de Comando (CLI)**: Esta é uma interface baseada em texto onde você digita comandos para interagir com seu computador. Pode parecer intimidador no início, mas é uma ferramenta poderosa para desenvolvedores.
-   **Permissões**: Às vezes, você precisará dar permissões a certos aplicativos ou comandos. Esta é uma medida de segurança para garantir que apenas aplicativos confiáveis possam fazer alterações em seu sistema.

## Próximos Passos

Após instalar essas ferramentas, você estará pronto para começar a programar! Volte ao guia [Começando com Cline para Novos Programadores](../getting-started-new-coders/README.md) para continuar sua jornada.