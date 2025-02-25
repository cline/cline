<div align="center"><sub>
Inglês | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/pt-br/README.md" target="_blank">Português (BR)</a>
</sub></div>

# Cline: Seu Parceiro Colaborativo de IA para Trabalhos de Engenharia Sérios

Transforme sua equipe de engenharia com um parceiro de IA totalmente colaborativo. Open source, completamente extensível e projetado para ampliar o impacto dos desenvolvedores.

<p align="center">
  <video alt="Demonstração do agente de IA do Cline mostrando recursos de desenvolvimento colaborativo" autoplay loop muted playsinline width="100%">
    <source src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demoForWebsiteNew.mp4" type="video/mp4">
  </video>
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
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Pedidos de Funcionalidades</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>Primeiros Passos</strong></a>
</td>
</tbody>
</table>
</div>

Cline não é apenas um agente autônomo – é seu parceiro de IA na otimização dos fluxos de trabalho de desenvolvimento. Trabalhando com você em um plano antes de agir, o Cline explica seu raciocínio e detalha tarefas complexas passo a passo. Com ferramentas para criar e editar arquivos, explorar projetos e executar comandos, o Cline monitora seu ambiente – desde terminais e arquivos até logs de erros – garantindo um progresso suave.

Enquanto scripts de IA tradicionais rodam em ambientes isolados, o Cline oferece uma interface gráfica com intervenção humana para aprovar cada alteração de arquivo e comando no terminal. Através da integração com o MCP (Model Context Protocol), o Cline amplia seu alcance a bancos de dados externos e documentos ao vivo, detectando automaticamente problemas e aplicando correções, para que você possa se concentrar na inovação. Projetado com segurança em nível corporativo, você pode acessar modelos de ponta via endpoints AWS Bedrock, GCP Vertex ou Azure, mantendo seu código protegido.

1. Insira sua tarefa e adicione imagens para converter maquetes em aplicativos funcionais ou para corrigir bugs utilizando capturas de tela.
2. O Cline inicia analisando a estrutura dos seus arquivos e as ASTs do código-fonte, realizando buscas com expressões regulares e lendo os arquivos relevantes para se atualizar nos projetos existentes. Ao gerenciar cuidadosamente as informações adicionadas ao contexto, o Cline pode fornecer suporte valioso mesmo para projetos grandes e complexos, sem sobrecarregar a janela de contexto.
3. Uma vez que o Cline possui as informações necessárias, ele pode:
    - Criar e editar arquivos, além de monitorar erros de linter/compilador, permitindo que corrija de forma proativa problemas como imports ausentes e erros de sintaxe.
    - Executar comandos diretamente em seu terminal e monitorar suas saídas, possibilitando, por exemplo, reagir a problemas do servidor de desenvolvimento após a edição de um arquivo.
    - Para tarefas de desenvolvimento web, o Cline pode lançar o site em um navegador headless, realizar cliques, digitar, rolar e capturar screenshots e logs do console, corrigindo erros de runtime e problemas visuais.
4. Quando uma tarefa é concluída, o Cline apresentará o resultado com um comando de terminal como `open -a "Google Chrome" index.html`, que você pode executar com um clique.

> [!TIP]
> Use o atalho `CMD/CTRL + Shift + P` para abrir a paleta de comandos e digite "Cline: Open In New Tab" para abrir a extensão em uma nova aba no seu editor. Assim, você pode usar o Cline lado a lado com o explorador de arquivos e visualizar mais claramente como seu ambiente de trabalho é alterado.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4" alt="Interface flexível de integração de modelos do Cline">

### Utilize qualquer API e Modelo

O Cline suporta provedores de API como OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure e GCP Vertex. Você também pode configurar qualquer API compatível com OpenAI ou utilizar um modelo local através do LM Studio/Ollama. Se você usar o OpenRouter, a extensão busca a lista mais recente de modelos, permitindo que você utilize os modelos mais atualizados assim que estiverem disponíveis.

A extensão também monitora o total de tokens e o custo de uso da API para o ciclo completo da tarefa e para solicitações individuais, mantendo você informado sobre os gastos a cada etapa.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76" alt="Interface de execução de comandos no terminal do Cline">

### Execute Comandos no Terminal

Graças às novas atualizações de integração de terminal no [VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), o Cline pode executar comandos diretamente no seu terminal e receber a saída. Isso permite que ele realize uma ampla variedade de tarefas, desde instalar pacotes e executar scripts de build até implantar aplicações, gerenciar bancos de dados e executar testes, adaptando-se ao seu ambiente de desenvolvimento e conjunto de ferramentas para fazer o trabalho corretamente.

Para processos de longa duração, como servidores de desenvolvimento, use o botão "Continuar enquanto executa" para permitir que o Cline prossiga com a tarefa enquanto o comando roda em segundo plano. À medida que trabalha, o Cline receberá notificações de qualquer nova saída do terminal, permitindo que reaja a problemas, como erros de compilação ao editar arquivos.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588" alt="Interface de edição de arquivos com visualização de diff do Cline">

### Crie e Edite Arquivos

O Cline pode criar e editar arquivos diretamente no seu editor, apresentando uma visualização de diff das alterações realizadas. Você pode editar ou reverter as mudanças do Cline diretamente na visualização de diff ou fornecer feedback via chat até ficar satisfeito com o resultado. Além disso, o Cline monitora erros de linter/compilador (como imports faltantes ou erros de sintaxe) para que possa corrigir problemas de forma autônoma.

Todas as alterações realizadas pelo Cline são registradas na linha do tempo do arquivo, oferecendo uma maneira fácil de acompanhar e reverter modificações se necessário.

<!-- Transparent pixel to create line break after floating image -->

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5" alt="Interface de automação do navegador do Cline">

### Utilize o Navegador

Com o novo recurso [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) do Claude 3.5 Sonnet, o Cline pode iniciar um navegador, clicar em elementos, digitar e rolar, capturando screenshots e logs do console a cada etapa. Isso permite a depuração interativa, testes end-to-end e até mesmo o uso geral da web, possibilitando que ele corrija erros visuais e problemas de runtime sem que você precise copiar e colar manualmente os logs de erro.

Peça ao Cline para "testar o app" e observe enquanto ele executa um comando como `npm run dev`, abre seu servidor de desenvolvimento local no navegador e realiza uma série de testes para confirmar que tudo funciona corretamente. [Veja a demonstração](https://x.com/sdrzn/status/1850880547825823989).

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd" alt="Interface de criação de ferramentas MCP do Cline">

### "Adicione uma ferramenta que..."

Graças ao [Model Context Protocol](https://github.com/modelcontextprotocol), o Cline pode expandir suas capacidades através de ferramentas personalizadas. Enquanto você pode utilizar [servidores criados pela comunidade](https://github.com/modelcontextprotocol/servers), o Cline também pode criar e instalar ferramentas ajustadas especificamente para o seu fluxo de trabalho. Basta pedir “adicione uma ferramenta” e ele cuidará de tudo, desde a criação de um novo servidor MCP até sua instalação na extensão. Essas ferramentas personalizadas passam a fazer parte do conjunto de recursos do Cline, prontas para serem utilizadas em tarefas futuras.

- "Adicione uma ferramenta que recupere tickets do Jira": Recupere os códigos dos tickets e coloque o Cline para trabalhar.
- "Adicione uma ferramenta que gerencie AWS EC2s": Monitore as métricas do servidor e ajuste o escalonamento das instâncias conforme necessário.
- "Adicione uma ferramenta que busque os incidentes mais recentes do PagerDuty": Obtenha os detalhes e peça ao Cline para corrigir os bugs.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970" alt="Interface de gerenciamento de contexto do Cline">

### Adicione Contexto

**`@url`:** Cole uma URL para que a extensão a recupere e converta para Markdown, útil quando você deseja fornecer ao Cline a documentação mais recente.

**`@problems`:** Adicione erros e avisos do workspace (painel "Problems") para que o Cline os corrija.

**`@file`:** Adiciona o conteúdo de um arquivo para que você não precise gastar requisições de API aprovando a leitura do mesmo.

**`@folder`:** Adiciona todos os arquivos de uma pasta de uma vez para acelerar ainda mais seu fluxo de trabalho.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb" alt="Interface de comparação de checkpoints do Cline">

### Segurança Corporativa

Enquanto o Cline trabalha em uma tarefa, a extensão captura um snapshot do seu workspace a cada etapa. Você pode usar o botão "Comparar" para ver as diferenças entre o snapshot e o estado atual do workspace, e o botão "Restaurar" para voltar a aquele ponto.

Por exemplo, ao trabalhar com um servidor web local, você pode usar a opção "Restaurar somente o workspace" para testar rapidamente diferentes versões do seu app, e depois "Restaurar tarefa e workspace" quando encontrar a versão que deseja continuar desenvolvendo. Isso permite explorar diferentes abordagens com segurança, sem perder o progresso.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Contribua

Para contribuir com o projeto, comece com o nosso [Guia de Contribuição](CONTRIBUTING.md) para aprender o básico. Você também pode participar do nosso [Discord](https://discord.gg/cline) para conversar com outros colaboradores no canal `#contributors`. Se você está procurando uma oportunidade em tempo integral, confira nossas vagas na [página de carreiras](https://cline.bot/join-us).

<details>
<summary>Instruções para Desenvolvimento Local</summary>

1. Clone o repositório _(Requer [git-lfs](https://git-lfs.com/))_:
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. Abra o projeto no VSCode:
    ```bash
    code cline
    ```
3. Instale as dependências necessárias para a extensão e para a interface webview-gui:
    ```bash
    npm run install:all
    ```
4. Inicie pressionando `F5` (ou selecionando `Run`->`Start Debugging`) para abrir uma nova janela do VSCode com a extensão carregada. (Caso encontre problemas na compilação do projeto, pode ser necessário instalar a [extensão esbuild problem matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers).)

</details>

<details>
<summary>Criando um Pull Request</summary>

1. Antes de criar um PR, gere uma entrada de changeset:
    ```bash
    npm run changeset
    ```
   Isso solicitará:
   - Tipo de mudança (major, minor, patch)
     - `major` → mudanças significativas (1.0.0 → 2.0.0)
     - `minor` → novas funcionalidades (1.0.0 → 1.1.0)
     - `patch` → correção de bugs (1.0.0 → 1.0.1)
   - Descrição das suas mudanças

2. Faça o commit das suas alterações e do arquivo `.changeset` gerado

3. Envie sua branch e crie um PR no GitHub. Nosso CI:
   - Executará testes e verificações
   - O Changesetbot criará um comentário mostrando o impacto na versão
   - Após a fusão no branch principal, o Changesetbot criará um PR para os pacotes de versão
   - Quando o PR dos pacotes for mesclado, uma nova versão será publicada

</details>

## Licença

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
