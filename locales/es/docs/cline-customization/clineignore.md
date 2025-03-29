### Soporte para .clineignore

Para darte más control sobre qué archivos son accesibles para Cline, hemos implementado la funcionalidad de `.clineignore`, similar a `.gitignore`. Esto te permite especificar archivos y directorios que Cline **no** debe acceder o procesar. Esto es útil para:

*   **Privacidad:** Evitar que Cline acceda a archivos sensibles o privados en tu espacio de trabajo.
*   **Rendimiento:** Excluir directorios o archivos grandes que no sean relevantes para tus tareas, lo que podría mejorar la eficiencia de Cline.
*   **Gestión de contexto:** Centrar la atención de Cline en las partes relevantes de tu proyecto.

**Cómo usar `.clineignore`**

1.  **Crear un archivo `.clineignore`:** En el directorio raíz de tu espacio de trabajo (al mismo nivel que tu carpeta `.vscode`, o la carpeta de nivel superior que abriste en VS Code), crea un nuevo archivo llamado `.clineignore`.

2.  **Definir patrones de ignorar:** Abre el archivo `.clineignore` y especifica los patrones para los archivos y directorios que quieres que Cline ignore. La sintaxis es la misma que `.gitignore`:

    *   Cada línea en el archivo representa un patrón.
    *   **Se admiten patrones glob estándar:**
        *   `*` coincide con cero o más caracteres
        *   `?` coincide con un carácter
        *   `[]` coincide con un rango de caracteres
        *   `**` coincide con cualquier número de directorios y subdirectorios.

    *   **Patrones de directorio:** Añade `/` al final de un patrón para especificar un directorio.
    *   **Patrones de negación:** Comienza un patrón con `!` para negar (designorar) un patrón previamente ignorado.
    *   **Comentarios:** Comienza una línea con `#` para añadir comentarios.

    **Ejemplo de archivo `.clineignore`:**

    ```
    # Ignorar archivos de registro
    *.log

    # Ignorar todo el directorio 'node_modules'
    node_modules/

    # Ignorar todos los archivos en el directorio 'temp' y sus subdirectorios
    temp/**

    # Pero NO ignorar 'important.log' incluso si está en la raíz
    !important.log

    # Ignorar cualquier archivo llamado 'secret.txt' en cualquier subdirectorio
    **/secret.txt
    ```

3.  **Cline respeta tu `.clineignore`:** Una vez que guardes el archivo `.clineignore`, Cline reconocerá y aplicará automáticamente estas reglas.

    *   **Control de acceso a archivos:** Cline no podrá leer el contenido de los archivos ignorados usando herramientas como `read_file`. Si intentas usar una herramienta en un archivo ignorado, Cline te informará que el acceso está bloqueado debido a la configuración de `.clineignore`.
    *   **Listado de archivos:** Cuando pidas a Cline que liste los archivos en un directorio (por ejemplo, usando `list_files`), los archivos y directorios ignorados todavía serán listados, pero estarán marcados con un símbolo **🔒** junto a su nombre para indicar que están ignorados. Esto te ayuda a entender con qué archivos Cline puede y no puede interactuar.

4.  **Actualizaciones dinámicas:** Cline monitorea tu archivo `.clineignore` en busca de cambios. Si modificas, creas o eliminas tu archivo `.clineignore`, Cline actualizará automáticamente sus reglas de ignorar sin necesidad de reiniciar VS Code o la extensión.

**En resumen**

El archivo `.clineignore` proporciona una manera poderosa y flexible de controlar el acceso de Cline a los archivos de tu espacio de trabajo, mejorando la privacidad, el rendimiento y la gestión de contexto. Al aprovechar la sintaxis familiar de `.gitignore`, puedes adaptar fácilmente el enfoque de Cline a las partes más relevantes de tus proyectos.