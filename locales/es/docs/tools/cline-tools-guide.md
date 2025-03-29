# Guía de referencia de herramientas de Cline

## ¿Qué puede hacer Cline?

Cline es tu asistente de IA que puede:

-   Editar y crear archivos en tu proyecto
-   Ejecutar comandos de terminal
-   Buscar y analizar tu código
-   Ayudar a depurar y solucionar problemas
-   Automatizar tareas repetitivas
-   Integrarse con herramientas externas

## Primeros pasos

1. **Iniciar una tarea**

    - Escribe tu solicitud en el chat
    - Ejemplo: "Crear un nuevo componente de React llamado Header"

2. **Proporcionar contexto**

    - Usa menciones @ para añadir archivos, carpetas o URLs
    - Ejemplo: "@file:src/components/App.tsx"

3. **Revisar cambios**
    - Cline mostrará diferencias antes de hacer cambios
    - Puedes editar o rechazar los cambios

## Características clave

1. **Edición de archivos**

    - Crear nuevos archivos
    - Modificar código existente
    - Buscar y reemplazar en archivos

2. **Comandos de terminal**

    - Ejecutar comandos npm
    - Iniciar servidores de desarrollo
    - Instalar dependencias

3. **Análisis de código**

    - Encontrar y corregir errores
    - Refactorizar código
    - Añadir documentación

4. **Integración con el navegador**
    - Probar páginas web
    - Capturar capturas de pantalla
    - Inspeccionar registros de consola

## Herramientas disponibles

Para los detalles de implementación más actualizados, puedes ver el código fuente completo en el [repositorio de Cline](https://github.com/cline/cline/blob/main/src/core/Cline.ts).

Cline tiene acceso a las siguientes herramientas para diversas tareas:

1. **Operaciones de archivos**

    - `write_to_file`: Crear o sobrescribir archivos
    - `read_file`: Leer el contenido de archivos
    - `replace_in_file`: Hacer ediciones específicas en archivos
    - `search_files`: Buscar archivos usando expresiones regulares
    - `list_files`: Listar el contenido del directorio

2. **Operaciones de terminal**

    - `execute_command`: Ejecutar comandos de CLI
    - `list_code_definition_names`: Listar definiciones de código

3. **Herramientas MCP**

    - `use_mcp_tool`: Usar herramientas de servidores MCP
    - `access_mcp_resource`: Acceder a recursos de servidores MCP
    - Los usuarios pueden crear herramientas MCP personalizadas a las que Cline puede acceder
    - Ejemplo: Crear una herramienta de API meteorológica que Cline puede usar para obtener pronósticos

4. **Herramientas de interacción**
    - `ask_followup_question`: Preguntar al usuario por aclaraciones
    - `attempt_completion`: Presentar resultados finales

Cada herramienta tiene parámetros y patrones de uso específicos. Aquí hay algunos ejemplos:

-   Crear un nuevo archivo (write_to_file):

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Código del componente Header
    </content>
    </write_to_file>
    ```

-   Buscar un patrón (search_files):

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   Ejecutar un comando (execute_command):
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## Tareas comunes

1. **Crear un nuevo componente**

    - "Crear un nuevo componente de React llamado Footer"

2. **Arreglar un error**

    - "Arreglar el error en src/utils/format.ts"

3. **Refactorizar código**

    - "Refactorizar el componente Button para usar TypeScript"

4. **Ejecutar comandos**
    - "Ejecutar npm install para añadir axios"

## Obtener ayuda

-   [Únete a la comunidad de Discord](https://discord.gg/cline)
-   Consulta la documentación
-   Proporciona retroalimentación para mejorar Cline