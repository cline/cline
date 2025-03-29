# Construcción de servidores MCP desde repositorios de GitHub

Esta guía proporciona una descripción paso a paso de cómo utilizar Cline para construir un servidor MCP existente desde un repositorio de GitHub.

## **Búsqueda de un servidor MCP**

Hay varios lugares en línea para encontrar servidores MCP:

-   **Cline puede añadir automáticamente servidores MCP a su lista, que luego puedes editar.** Cline puede clonar repositorios directamente desde GitHub y construir los servidores por ti.
-   **GitHub:** Dos de los lugares más comunes para encontrar servidores MCP en GitHub incluyen:
    -   [Repositorio oficial de servidores MCP](https://github.com/modelcontextprotocol/servers)
    -   [Repositorio Awesome-MCP servers](https://github.com/punkpeye/awesome-mcp-servers)
-   **Directorios en línea:** Varios sitios web listan servidores MCP, incluyendo:

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    Estos directorios permiten a los usuarios ordenar los servidores por diversos criterios como descargas, fecha, estrellas y caso de uso. Cada entrada proporciona información como características, herramientas e instrucciones de configuración.

-   **PulseMCP:** Este sitio web tiene una publicación de blog que discute cómo la IA podría usar servidores MCP para hacer obsoletos los sitios web. PulseMCP también incluye una sección de preguntas frecuentes sobre servidores MCP: [https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **Construcción con Cline**

1.  **Iniciar el proceso:** Proporciona a Cline la siguiente información:
    -   **URL del repositorio de GitHub:** La URL del repositorio del servidor.
    -   **Contenido de README.md:** Esto es opcional pero útil para que Cline entienda el propósito y la configuración del servidor. Puedes copiar el archivo README.md del repositorio de GitHub.
2.  **Ejemplo de interacción con Cline:**

    ```
    Usuario: "Cline, quiero añadir el servidor MCP para el control del navegador Brave. Aquí está el enlace de GitHub: https://github.com/modelcontextprotocol/servers/tree/main/src/brave ¿Puedes añadirlo?"

    Cline: "OK. Clonando el repositorio al directorio MCP. Necesita ser construido porque tiene un archivo 'package.json'. ¿Debo ejecutar 'npm run build'?"

    Usuario: "Sí, constrúyelo."

    Cline: "Construcción completada. Este servidor necesita una ruta del navegador. ¿Dónde está el ejecutable del navegador Brave?"

    Usuario: "Está en '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'."

    Cline: "OK. He actualizado la configuración del servidor con esa ruta y la he añadido a 'cline_mcp_settings.json'. ¿Algo más?"

    Usuario: "No, eso es todo. Vamos a probarlo."

    Cline: "¡Genial! Iniciando el Inspector MCP para probar la conexión del servidor. Después de eso, podemos intentar controlar el navegador desde Cline."
    ```
3. **Acciones de Cline:** Basado en tus instrucciones, Cline realizará lo siguiente:
    - **Clonación del repositorio:** Cline clonará el repositorio en tu máquina local, generalmente en el directorio especificado en tu configuración.
    - **Ajustes:** Puedes guiar a Cline para modificar la configuración del servidor. Por ejemplo:
        - **Usuario:** "Este servidor requiere una clave API. ¿Puedes encontrar dónde debería agregarse?"
        - Cline puede actualizar automáticamente el archivo `cline_mcp_settings.json` u otros archivos relevantes basados en tus instrucciones.
    - **Construcción del servidor:** Cline ejecutará el comando de construcción adecuado para el servidor, que comúnmente es `npm run build`.
    - **Agregar el servidor a la configuración:** Cline agregará la configuración del servidor al archivo `cline_mcp_settings.json`.

## **Pruebas y solución de problemas**

1. **Prueba el servidor:** Una vez que Cline finalice el proceso de construcción, prueba el servidor para asegurarte de que funcione como se espera. Cline puede ayudarte si encuentras algún problema.
2. **Inspector MCP:** Puedes usar el Inspector MCP para probar la conexión y la funcionalidad del servidor.

## **Mejores prácticas**

- **Comprender lo básico:** Aunque Cline simplifica el proceso, es beneficioso tener un entendimiento básico del código del servidor, el protocolo MCP y cómo configurar el servidor. Esto permite una solución de problemas y personalización más efectivas.
- **Instrucciones claras:** Proporciona instrucciones claras y específicas a Cline a lo largo del proceso.
- **Pruebas:** Prueba exhaustivamente el servidor después de la instalación y configuración para asegurarte de que funcione correctamente.
- **Control de versiones:** Usa un sistema de control de versiones (como Git) para rastrear los cambios en el código del servidor.
- **Mantente actualizado:** Mantén tus servidores MCP actualizados para beneficiarte de las últimas características y parches de seguridad.