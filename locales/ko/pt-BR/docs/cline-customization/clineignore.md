### Suporte a `.clineignore`

Para lhe dar mais controle sobre quais arquivos são acessíveis ao Cline, implementamos a funcionalidade `.clineignore`, similar ao `.gitignore`. Isso permite que você especifique arquivos e diretórios que o Cline **não** deve acessar ou processar. Isso é útil para:

*   **Privacidade:** Impedir que o Cline acesse arquivos sensíveis ou privados em seu espaço de trabalho.
*   **Desempenho:** Excluir diretórios ou arquivos grandes que são irrelevantes para suas tarefas, potencialmente melhorando a eficiência do Cline.
*   **Gerenciamento de Contexto:** Focar a atenção do Cline nas partes relevantes do seu projeto.

**Como usar `.clineignore`**

1.  **Criar um arquivo `.clineignore`:** No diretório raiz do seu espaço de trabalho (no mesmo nível da pasta `.vscode`, ou a pasta de nível superior que você abriu no VS Code), crie um novo arquivo chamado `.clineignore`.

2.  **Definir padrões de ignorar:** Abra o arquivo `.clineignore` e especifique os padrões para arquivos e diretórios que você quer que o Cline ignore. A sintaxe é a mesma do `.gitignore`:

    *   Cada linha no arquivo representa um padrão.
    *   **Padrões glob padrão são suportados:**
        *   `*` corresponde a zero ou mais caracteres
        *   `?` corresponde a um caractere
        *   `[]` corresponde a um intervalo de caracteres
        *   `**` corresponde a qualquer número de diretórios e subdiretórios.

    *   **Padrões de diretório:** Anexar `/` ao final de um padrão para especificar um diretório.
    *   **Padrões de negação:** Iniciar um padrão com `!` para negar (designorar) um padrão previamente ignorado.
    *   **Comentários:** Iniciar uma linha com `#` para adicionar comentários.

    **Exemplo de arquivo `.clineignore`:**

    ```
    # Ignorar arquivos de log
    *.log

    # Ignorar todo o diretório 'node_modules'
    node_modules/

    # Ignorar todos os arquivos no diretório 'temp' e seus subdiretórios
    temp/**

    # Mas NÃO ignorar 'important.log' mesmo que esteja na raiz
    !important.log

    # Ignorar qualquer arquivo chamado 'secret.txt' em qualquer subdiretório
    **/secret.txt
    ```

3.  **O Cline respeita seu `.clineignore`:** Uma vez que você salva o arquivo `.clineignore`, o Cline automaticamente reconhece e aplica essas regras.

    *   **Controle de Acesso a Arquivos:** O Cline não poderá ler o conteúdo de arquivos ignorados usando ferramentas como `read_file`. Se você tentar usar uma ferramenta em um arquivo ignorado, o Cline informará que o acesso está bloqueado devido às configurações do `.clineignore`.
    *   **Listagem de Arquivos:** Quando você pede ao Cline para listar arquivos em um diretório (por exemplo, usando `list_files`), arquivos e diretórios ignorados ainda serão listados, mas serão marcados com um símbolo **🔒** ao lado do nome para indicar que são ignorados. Isso ajuda você a entender quais arquivos o Cline pode e não pode interagir.

4.  **Atualizações Dinâmicas:** O Cline monitora seu arquivo `.clineignore` para mudanças. Se você modificar, criar ou deletar seu arquivo `.clineignore`, o Cline automaticamente atualizará suas regras de ignorar sem a necessidade de reiniciar o VS Code ou a extensão.

**Em Resumo**

O arquivo `.clineignore` fornece uma maneira poderosa e flexível de controlar o acesso do Cline aos arquivos do seu espaço de trabalho, melhorando a privacidade, o desempenho e o gerenciamento de contexto. Ao aproveitar a sintaxe familiar do `.gitignore`, você pode facilmente ajustar o foco do Cline para as partes mais relevantes dos seus projetos.