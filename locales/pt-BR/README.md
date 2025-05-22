# Cline

<p align="center">
        <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Baixar no VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Solicitação de Funcionalidades</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>Estamos Contratando!</strong></a>
</td>
</tbody>
</table>
</div>

Conheça o Cline: um assistente de IA que pode usar seu **CLI** e **Editor**.

Graças às [habilidades avançadas do Claude 4 Sonnet](https://www.anthropic.com/claude/sonnet), o Cline pode lidar com tarefas complexas de desenvolvimento de software passo a passo. Com ferramentas que permitem criar e editar arquivos, explorar grandes projetos, usar o navegador e executar comandos no terminal (com sua aprovação), ele pode ajudar você de maneiras que vão além da inclusão de código ou suporte técnico. O Cline pode é capaz inclusive de usar o Model Context Protocol (MCP) para criar novas ferramentas e expandir seus próprios recursos. Embora os scripts de IA autônomas tradicionalmente sejam executados em ambientes isolados, esta extensão oferece uma GUI com um humano no circuito para aprovar cada alteração de arquivo e comando de terminal, fornecendo uma maneira segura e acessível de explorar todo o potencial da IA.

1. Insira sua tarefa e adicione imagens para transformar mockups em aplicativos funcionais ou corrigir erros através de capturas de tela.

2. O Cline começará analisando a estrutura do seu arquivo e os ASTs do código-fonte, fazendo pesquisas com Regex e lendo arquivos relevantes para se orientar em projetos existentes. Ao gerenciar cuidadosamente as informações agregadas, o Cline pode fornecer assistência valiosa mesmo em projetos grandes e complexos, sem sobrecarregar a janela de contexto.
3. Assim que ele tiver as informações necessárias, o Cline poderá:
                - Criar e editar arquivos + monitorar erros de Linter/Compilador, para que você possa corrigir proativamente problemas como importações ausentes e erros de sintaxe.
                - Executar comandos diretamente no terminal e monitorar o resultado, para que você possa responder a problemas do servidor de desenvolvimento após editar um arquivo.
                - Para tarefas de desenvolvimento web, o Cline pode iniciar o site em um navegador headless, clicar, digitar, fazer scroll e capturar capturas de tela + registros de console, para que você possa corrigir erros em tempo de execução e erros visuais.

> [!TIP]
> Use o atalho de teclado `CMD/CTRL + Shift + P` para abrir a lista de comandos possiveis e digite "Cline: Abrir em nova aba" para abrir a extensão como uma aba no seu editor. Dessa forma, você pode usar o Cline junto com seu explorador de arquivos e ver mais claramente como seu espaço de trabalho muda.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Use qualquer API ou modelo

O Cline oferece suporte a provedores de API como OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure e GCP Vertex. Você também pode configurar qualquer API compatível com OpenAI ou usar um modelo local via LM Studio/Ollama. Se você usar o OpenRouter, a extensão recuperará sua lista de modelos mais recentes, para que você possa usar os modelos mais novos assim que estiverem disponíveis.

A extensão também rastreia o uso total de tokens e os custos da API para todo o ciclo de tarefas e solicitações individuais, para que você seja informado sobre as despesas em cada etapa.

<!-- Pixel transparente para criar uma quebra de linha após a imagem flutuante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Executar comandos no terminal

Graças às novas [atualizações de integração do Shell no VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), o Cline pode executar comandos diretamente no seu terminal e receber o resultado. Isso permite que você execute uma variedade de tarefas, desde instalar pacotes e executar build scripts para fazer deploy de aplicações, gerenciar bancos de dados e executar testes, adaptando-se ao seu ambiente de desenvolvimento e ferramentas para fazer o trabalho corretamente.

Para processos de longa duração, como servidores de desenvolvimento, use o botão "Continuar durante a execução" para permitir que o Cline continue a tarefa enquanto o comando é executado em segundo plano. Enquanto Cline trabalha, você será notificado sobre novas saídas do terminal, para que possa responder a problemas que possam surgir, como erros de compilação ao editar arquivos.

<!-- Pixel transparente para criar uma quebra de linha após a imagem flutuante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### Criar e editar arquivos

Cline pode criar e editar arquivos diretamente no seu editor, apresentando um diff com as alterações. Você pode editar ou reverter as alterações do Cline diretamente no editor de diff ou fornecer feedback no chat até ficar satisfeito com o resultado. Cline também monitora erros de linter/compilador (importações ausentes, erros de sintaxe, etc.) para que possa corrigir problemas que surgem ao longo do caminho por conta própria.

Todas as alterações feitas pelo Cline são registradas na Linha do tempo do arquivo, fornecendo uma maneira fácil de rastrear e reverter modificações, caso seja necessário.

<!-- Pixel transparente para criar uma quebra de linha após a imagem flutuante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### Uso do navegador

Com a nova habilidade de [uso de computador](https://www.anthropic.com/news/3-5-models-and-computer-use) do Claude Sonnet 4, Cline pode abrir um navegador, clicar em elementos, digitar texto e rolar, capturando a tela e logs de console. Isso permite depurar de maneira interativa, testes end-to-end e até mesmo uso geral da web. Isso lhe dá autonomia para solucionar erros visuais e problemas em tempo de execução sem precisar copiar e colar logs dos erros.

Tente pedir a Cline para "testar o aplicativo" e observe enquanto o Cline executa um comando como `npm run dev`, inicia seu servidor de desenvolvimento local em um navegador e executa uma série de testes para confirmar se tudo funciona. [Veja uma demonstração aqui.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "adicione uma ferramenta que..."

Graças ao [Model Context Protocol](https://github.com/modelcontextprotocol), o Cline pode expandir seus recursos por meio de ferramentas personalizadas. Embora você possa usar [servidores criados pela comunidade](https://github.com/modelcontextprotocol/servers), Cline pode criar e instalar ferramentas especificamente para seu fluxo de trabalho. Basta pedir ao Cline para "adicionar uma ferramenta" e ele cuidará de tudo, desde a criação de um novo servidor MCP até a instalação na extensão. Essas ferramentas personalizadas se tornam parte do conjunto de ferramentas da Cline e estão prontas para serem usadas em tarefas futuras.

- "adicione uma ferramenta que recupere tickets do Jira": Recupere ACs de tickets e coloque Cline para trabalhar
- "adicione uma ferramenta que gerencie AWS EC2s": verifique as métricas do servidor e aumente ou diminua as instâncias
- "adicione uma ferramenta para recuperar os últimos incidentes do PagerDuty": Recupere detalhes e peça ao Cline para corrigir erros

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### Adicione contexto

**`@url`:** Insira uma URL para a extensão recuperar e converter para Markdown, que é útil quando você deseja fornecer ao Cline documentos mais recentes

**`@problems`:** Adicionar erros e avisos do espaço de trabalho (painel 'Problemas') que o Cline deve corrigir

**`@file`:** Adicione o conteúdo de um arquivo para que você não precise desperdiçar solicitações de API para aprovar a leitura do arquivo (+ para pesquisar arquivos)

**`@folder`:** Adicione arquivos de uma pasta por vez para acelerar ainda mais seu fluxo de trabalho

<!-- Pixel transparente para criar uma quebra de linha após a imagem flutuante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### Checkpoints: Comparar e Restaurar

Enquanto Cline trabalha em uma tarefa, a extensão cria um instantâneo de seu espaço de trabalho em cada etapa. Você pode usar o botão "Comparar" para ver a diferença entre o instantâneo e seu espaço de trabalho atual, e o botão "Restaurar" para retornar a esse ponto.

Por exemplo, se estiver trabalhando com um servidor web local, você pode usar 'Restaurar somente o espaço de trabalho' para testar rapidamente diferentes versões do seu aplicativo e, em seguida, 'Restaurar tarefa e espaço de trabalho' quando encontrar a versão na qual deseja continuar trabalhando. Isso permite que você explore diferentes abordagens com segurança sem perder o progresso.

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Contribuições

Para contribuir com o projeto, comece com nosso [Guia de Contribuição](CONTRIBUTING.md) para aprender o básico. Você também pode entrar no nosso [Discord](https://discord.gg/cline) para bater papo com outros colaboradores no canal `#contributors`. Se você está procurando um emprego de período integral, confira nossas vagas em aberto na nossa [página de carreiras](https://cline.bot/join-us).

<details>
<summary>Instruções para desenvolvimento local</summary>

1. Clone o repositório _(Necessário [git-lfs](https://git-lfs.com/))_:
                ```bash
                git clone https://github.com/cline/cline.git
                ```
2. Abra o projeto no VSCode:
                ```bash
                code cline
                ```
3. Instale as dependências necessárias para a extensão e webview-gui:
                ```bash
                npm run install:all
                ```
4. Inicie pressionando `F5` (ou `Executar`->`Iniciar Depuração`) para abrir uma nova janela do VSCode com a extensão carregada. (Pode ser necessário instalar a [extensão esbuild problem matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) se você encontrar problemas ao compilar seu projeto.)

</details>

## Licença

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
