# Arquitetura da Extensão Cline

Este diretório contém a documentação arquitetônica para a extensão Cline do VSCode.

## Diagrama de Arquitetura da Extensão

O arquivo [extension-architecture.mmd](./extension-architecture.mmd) contém um diagrama Mermaid que mostra a arquitetura de alto nível da extensão Cline. O diagrama ilustra:

1. **Extensão Principal**
   - Ponto de entrada da extensão e classes principais
   - Gerenciamento de estado através do estado global e armazenamento de segredos do VSCode
   - Lógica de negócios principal na classe Cline

2. **Interface de Usuário Webview**
   - Interface de usuário baseada em React
   - Gerenciamento de estado através do ExtensionStateContext
   - Hierarquia de componentes

3. **Armazenamento**
   - Armazenamento específico de tarefas para histórico e estado
   - Sistema de checkpoints baseado em Git para alterações de arquivos

4. **Fluxo de Dados**
   - Fluxo de dados da extensão principal entre componentes
   - Fluxo de dados da interface de usuário Webview
   - Comunicação bidirecional entre o núcleo e a webview

## Visualizando o Diagrama

Para visualizar o diagrama:
1. Instale uma extensão de visualizador de diagramas Mermaid no VSCode
2. Abra o arquivo extension-architecture.mmd
3. Use o recurso de visualização da extensão para renderizar o diagrama

Você também pode visualizar o diagrama no GitHub, que tem suporte integrado para renderização de Mermaid.

## Esquema de Cores

O diagrama utiliza um esquema de cores de alto contraste para melhor visibilidade:
- Rosa (#ff0066): Componentes de estado global e armazenamento de segredos
- Azul (#0066ff): Contexto de estado da extensão
- Verde (#00cc66): Provedor Cline
- Todos os componentes usam texto branco para máxima legibilidade