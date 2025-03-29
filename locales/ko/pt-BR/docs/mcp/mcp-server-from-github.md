# Construindo Servidores MCP a partir de Repositórios do GitHub

Este guia fornece um passo a passo de como usar o Cline para construir um servidor MCP existente a partir de um repositório do GitHub.

## **Encontrando um Servidor MCP**

Existem vários lugares online para encontrar servidores MCP:

-   **O Cline pode adicionar automaticamente servidores MCP à sua lista, que você pode então editar.** O Cline pode clonar repositórios diretamente do GitHub e construir os servidores para você.
-   **GitHub:** Dois dos lugares mais comuns para encontrar servidores MCP no GitHub incluem:
    -   [Repositório oficial de servidores MCP](https://github.com/modelcontextprotocol/servers)
    -   [Repositório Awesome-MCP servers](https://github.com/punkpeye/awesome-mcp-servers)
-   **Diretórios online:** Vários sites listam servidores MCP, incluindo:

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    Esses diretórios permitem que os usuários classifiquem os servidores por vários critérios, como downloads, data, estrelas e caso de uso. Cada entrada fornece informações como recursos, ferramentas e instruções de configuração.

-   **PulseMCP:** Este site tem um post no blog discutindo como a IA poderia usar servidores MCP para tornar os sites obsoletos. O PulseMCP também inclui uma seção de perguntas frequentes sobre servidores MCP: [https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **Construindo com Cline**

1.  **Iniciar o Processo:** Forneça ao Cline as seguintes informações:
    -   **URL do Repositório GitHub:** A URL do repositório do servidor.
    -   **Conteúdo do README.md:** Isso é opcional, mas útil para o Cline entender o propósito e a configuração do servidor. Você pode copiar o arquivo README.md do repositório do GitHub.
2.  **Exemplo de Interação com o Cline:**

    ```
    User: "Cline, quero adicionar o servidor MCP para controle do navegador Brave. Aqui está o link do GitHub: https://github.com/modelcontextprotocol/servers/tree/main/src/brave Você pode adicioná-lo?"

    Cline: "OK. Clonando o repositório para o diretório MCP. Ele precisa ser construído porque tem um arquivo 'package.json'. Devo executar 'npm run build'?"

    User: "Sim, construa-o."

    Cline: "Construção completa. Este servidor precisa de um caminho do navegador. Onde está o executável do Brave?"

    User: "Está em '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'."

    Cline: "OK. Atualizei a configuração do servidor com esse caminho e adicionei ao 'cline_mcp_settings.json'. Mais alguma coisa?"

    User: "Não, isso é tudo. Vamos testá-lo."

    Cline: "Ótimo! Iniciando o Inspetor MCP para testar a conexão do servidor. Depois disso, podemos tentar controlar o navegador a partir do Cline."
    ```
3. **Ações do Cline:** Com base em suas instruções, o Cline realizará o seguinte:
    - **Clonagem do Repositório:** O Cline clonará o repositório para sua máquina local, geralmente no diretório especificado em sua configuração.
    - **Ajustes:** Você pode orientar o Cline a modificar a configuração do servidor. Por exemplo:
        - **Usuário:** "Este servidor requer uma chave de API. Você pode encontrar onde ela deve ser adicionada?"
        - O Cline pode atualizar automaticamente o arquivo `cline_mcp_settings.json` ou outros arquivos relevantes com base em suas instruções.
    - **Construção do Servidor:** O Cline executará o comando de construção apropriado para o servidor, que geralmente é `npm run build`.
    - **Adição do Servidor às Configurações:** O Cline adicionará a configuração do servidor ao arquivo `cline_mcp_settings.json`.

## **Teste e Solução de Problemas**

1. **Teste o Servidor:** Uma vez que o Cline finalize o processo de construção, teste o servidor para garantir que ele funcione conforme esperado. O Cline pode ajudá-lo se você encontrar algum problema.
2. **Inspetor MCP:** Você pode usar o Inspetor MCP para testar a conexão e a funcionalidade do servidor.

## **Melhores Práticas**

- **Entenda o Básico:** Embora o Cline simplifique o processo, é benéfico ter um entendimento básico do código do servidor, do protocolo MCP () e de como configurar o servidor. Isso permite uma solução de problemas e personalização mais eficazes.
- **Instruções Claras:** Forneça instruções claras e específicas ao Cline durante todo o processo.
- **Teste:** Teste o servidor minuciosamente após a instalação e configuração para garantir que ele funcione corretamente.
- **Controle de Versão:** Use um sistema de controle de versão (como Git) para rastrear mudanças no código do servidor.
- **Mantenha-se Atualizado:** Mantenha seus servidores MCP atualizados para se beneficiar das últimas funcionalidades e patches de segurança.