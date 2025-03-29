# Guia de Referência das Ferramentas Cline

## O que o Cline pode fazer?

O Cline é seu assistente de IA que pode:

-   Editar e criar arquivos em seu projeto
-   Executar comandos de terminal
-   Pesquisar e analisar seu código
-   Ajudar a depurar e corrigir problemas
-   Automatizar tarefas repetitivas
-   Integrar-se com ferramentas externas

## Primeiros Passos

1. **Iniciar uma Tarefa**

    - Digite sua solicitação no chat
    - Exemplo: "Criar um novo componente React chamado Header"

2. **Fornecer Contexto**

    - Use @ menções para adicionar arquivos, pastas ou URLs
    - Exemplo: "@file:src/components/App.tsx"

3. **Revisar Alterações**
    - O Cline mostrará diffs antes de fazer alterações
    - Você pode editar ou rejeitar as alterações

## Principais Recursos

1. **Edição de Arquivos**

    - Criar novos arquivos
    - Modificar código existente
    - Pesquisar e substituir em arquivos

2. **Comandos de Terminal**

    - Executar comandos npm
    - Iniciar servidores de desenvolvimento
    - Instalar dependências

3. **Análise de Código**

    - Encontrar e corrigir erros
    - Refatorar código
    - Adicionar documentação

4. **Integração com Navegador**
    - Testar páginas web
    - Capturar capturas de tela
    - Inspecionar logs do console

## Ferramentas Disponíveis

Para os detalhes de implementação mais atualizados, você pode visualizar o código-fonte completo no [repositório Cline](https://github.com/cline/cline/blob/main/src/core/Cline.ts).

O Cline tem acesso às seguintes ferramentas para várias tarefas:

1. **Operações de Arquivo**

    - `write_to_file`: Criar ou sobrescrever arquivos
    - `read_file`: Ler conteúdo de arquivos
    - `replace_in_file`: Fazer edições direcionadas em arquivos
    - `search_files`: Pesquisar arquivos usando regex
    - `list_files`: Listar conteúdo do diretório

2. **Operações de Terminal**

    - `execute_command`: Executar comandos CLI
    - `list_code_definition_names`: Listar definições de código

3. **Ferramentas MCP**

    - `use_mcp_tool`: Usar ferramentas dos servidores MCP
    - `access_mcp_resource`: Acessar recursos do servidor MCP
    - Usuários podem criar ferramentas MCP personalizadas que o Cline pode então acessar
    - Exemplo: Criar uma ferramenta de API de clima que o Cline pode usar para buscar previsões

4. **Ferramentas de Interação**
    - `ask_followup_question`: Pedir esclarecimento ao usuário
    - `attempt_completion`: Apresentar resultados finais

Cada ferramenta tem parâmetros e padrões de uso específicos. Aqui estão alguns exemplos:

-   Criar um novo arquivo (write_to_file):

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Código do componente Header
    </content>
    </write_to_file>
    ```

-   Pesquisar por um padrão (search_files):

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   Executar um comando (execute_command):
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## Tarefas Comuns

1. **Criar um Novo Componente**

    - "Criar um novo componente React chamado Footer"

2. **Corrigir um Erro**

    - "Corrigir o erro em src/utils/format.ts"

3. **Refatorar Código**

    - "Refatorar o componente Button para usar TypeScript"

4. **Executar Comandos**
    - "Executar npm install para adicionar axios"

## Obtendo Ajuda

-   [Junte-se à comunidade Discord](https://discord.gg/cline)
-   Verifique a documentação
-   Forneça feedback para melhorar o Cline