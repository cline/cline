# Cline

<p align="center">
        <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Descargar en VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Solicitudes de Funciones</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>Estamos Contratando!</strong></a>
</td>
</tbody>
</table>
</div>

Conozca a Cline, un asistente de IA que puede usar su **CLI** y **E**ditor.

Gracias a las [habilidades de codificación agencial de Claude 4 Sonnet](https://www.anthropic.com/claude/sonnet), Cline puede abordar tareas complejas de desarrollo de software paso a paso. Con herramientas que le permiten crear y editar archivos, explorar grandes proyectos, usar el navegador y ejecutar comandos de terminal (con su aprobación), puede ayudarle de una manera que va más allá de la autocompletación de código o el soporte técnico. Cline incluso puede usar el Model Context Protocol (MCP) para crear nuevas herramientas y expandir sus propias capacidades. Mientras que los scripts de IA autónomos tradicionalmente se ejecutan en entornos aislados, esta extensión ofrece una GUI con un humano en el bucle para aprobar cada cambio de archivo y comando de terminal, proporcionando una forma segura y accesible de explorar el potencial de la IA agencial.

1. Ingrese su tarea y agregue imágenes para convertir maquetas en aplicaciones funcionales o solucionar errores con capturas de pantalla.
2. Cline comenzará analizando su estructura de archivos y ASTs de código fuente, realizando búsquedas Regex y leyendo archivos relevantes para orientarse en proyectos existentes. Al gestionar cuidadosamente la información agregada, Cline puede proporcionar asistencia valiosa incluso en proyectos grandes y complejos sin sobrecargar la ventana de contexto.
3. Una vez que Cline tenga la información necesaria, puede:
                - Crear y editar archivos + monitorear errores de Linter/Compilador, para que pueda solucionar proactivamente problemas como importaciones faltantes y errores de sintaxis.
                - Ejecutar comandos directamente en su terminal y monitorear su salida, para que pueda responder a problemas del servidor de desarrollo después de editar un archivo.
                - Para tareas de desarrollo web, Cline puede iniciar el sitio web en un navegador sin cabeza, hacer clic, escribir, desplazarse y capturar capturas de pantalla + registros de consola, para que pueda solucionar errores de tiempo de ejecución y errores visuales.
4. Cuando una tarea esté completa, Cline le presentará el resultado con un comando de terminal como `open -a "Google Chrome" index.html`, que puede ejecutar con un clic en un botón.

> [!TIP]
> Use el atajo de teclado `CMD/CTRL + Shift + P` para abrir la paleta de comandos y escriba "Cline: Open In New Tab" para abrir la extensión como una pestaña en su editor. De esta manera, puede usar Cline junto a su explorador de archivos y ver más claramente cómo cambia su espacio de trabajo.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Use cualquier API y modelo

Cline admite proveedores de API como OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure y GCP Vertex. También puede configurar cualquier API compatible con OpenAI o usar un modelo local a través de LM Studio/Ollama. Si usa OpenRouter, la extensión recupera su lista de modelos más reciente, para que pueda usar los modelos más nuevos tan pronto como estén disponibles.

La extensión también rastrea el uso total de tokens y costos de API para todo el ciclo de tareas y solicitudes individuales, para que esté informado sobre los gastos en cada paso.

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Ejecutar comandos en el terminal

Gracias a las nuevas [actualizaciones de integración de Shell en VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), Cline puede ejecutar comandos directamente en su terminal y recibir la salida. Esto le permite realizar una variedad de tareas, desde la instalación de paquetes y la ejecución de scripts de compilación hasta la implementación de aplicaciones, la gestión de bases de datos y la ejecución de pruebas, adaptándose a su entorno de desarrollo y cadena de herramientas para hacer el trabajo correctamente.

Para procesos de larga duración como servidores de desarrollo, use el botón "Continuar mientras se ejecuta" para permitir que Cline continúe con la tarea mientras el comando se ejecuta en segundo plano. Mientras Cline trabaja, será notificado sobre nuevas salidas del terminal, para que pueda responder a problemas que puedan surgir, como errores de compilación al editar archivos.

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### Crear y editar archivos

Cline puede crear y editar archivos directamente en su editor y presentarle una vista de diferencias de los cambios. Puede editar o deshacer los cambios de Cline directamente en el editor de vista de diferencias o proporcionar comentarios en el chat hasta que esté satisfecho con el resultado. Cline también monitorea errores de Linter/Compilador (importaciones faltantes, errores de sintaxis, etc.), para que pueda solucionar problemas que surjan en el camino.

Todos los cambios realizados por Cline se registran en la línea de tiempo de su archivo, proporcionando una forma sencilla de rastrear cambios y deshacerlos si es necesario.

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### Usar el navegador

Con la nueva [habilidad de uso de computadora](https://www.anthropic.com/news/3-5-models-and-computer-use) de Claude 4 Sonnet, Cline puede iniciar un navegador, hacer clic en elementos, escribir texto y desplazarse, capturando capturas de pantalla y registros de consola. Esto permite la depuración interactiva, pruebas de extremo a extremo e incluso el uso general de la web. Esto le da la autonomía para solucionar errores visuales y problemas de tiempo de ejecución sin que tenga que copiar y pegar registros de errores.

Intente pedirle a Cline que "pruebe la aplicación" y observe cómo ejecuta un comando como `npm run dev`, inicia su servidor de desarrollo local en un navegador y realiza una serie de pruebas para confirmar que todo funciona. [Vea una demostración aquí.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "agregar una herramienta que..."

Gracias al [Model Context Protocol](https://github.com/modelcontextprotocol), Cline puede expandir sus habilidades mediante herramientas personalizadas. Mientras que puede usar [servidores creados por la comunidad](https://github.com/modelcontextprotocol/servers), Cline puede en su lugar crear e instalar herramientas adaptadas a su flujo de trabajo específico. Simplemente pida a Cline que "agregue una herramienta" y él se encargará de todo, desde la creación de un nuevo servidor MCP hasta la instalación en la extensión. Estas herramientas personalizadas se convierten en parte del conjunto de herramientas de Cline y están listas para ser utilizadas en tareas futuras.

-   "agregar una herramienta que recupere tickets de Jira": Recuperar ACs de tickets y poner a Cline a trabajar
-   "agregar una herramienta que gestione AWS EC2s": Verificar métricas del servidor y escalar instancias hacia arriba o hacia abajo
-   "agregar una herramienta que recupere los últimos incidentes de PagerDuty": Recuperar detalles y pedir a Cline que solucione errores

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### Agregar contexto

**`@url`:** Inserte una URL para que la extensión la recupere y convierta en Markdown, útil cuando desee proporcionar a Cline los documentos más recientes

**`@problems`:** Agregue errores y advertencias del espacio de trabajo (panel 'Problemas') que Cline debe solucionar

**`@file`:** Agregue el contenido de un archivo para que no tenga que desperdiciar solicitudes de API para aprobar la lectura del archivo (+ para buscar archivos)

**`@folder`:** Agregue los archivos de una carpeta a la vez para acelerar aún más su flujo de trabajo

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### Puntos de control: Comparar y Restaurar

Mientras Cline trabaja en una tarea, la extensión crea una instantánea de su espacio de trabajo en cada paso. Puede usar el botón 'Comparar' para ver una diferencia entre la instantánea y su espacio de trabajo actual, y el botón 'Restaurar' para volver a ese punto.

Por ejemplo, si está trabajando con un servidor web local, puede usar 'Restaurar solo espacio de trabajo' para probar rápidamente diferentes versiones de su aplicación, y luego 'Restaurar tarea y espacio de trabajo' cuando encuentre la versión desde la que desea continuar trabajando. Esto le permite explorar diferentes enfoques de manera segura sin perder progreso.

<!-- Pixel transparente para crear un salto de línea después de la imagen flotante -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Contribuir

Para contribuir al proyecto, comience con nuestra [guía de contribución](CONTRIBUTING.md) para aprender los conceptos básicos. También puede unirse a nuestro [Discord](https://discord.gg/cline) para chatear con otros colaboradores en el canal `#contributors`. Si está buscando un trabajo a tiempo completo, consulte nuestras vacantes en nuestra [página de carreras](https://cline.bot/join-us).

<details>
<summary>Instrucciones de desarrollo local</summary>

1. Clone el repositorio _(Requiere [git-lfs](https://git-lfs.com/))_:
                ```bash
                git clone https://github.com/cline/cline.git
                ```
2. Abra el proyecto en VSCode:
                ```bash
                code cline
                ```
3. Instale las dependencias necesarias para la extensión y la GUI de Webview:
                ```bash
                npm run install:all
                ```
4. Inicie presionando `F5` (o `Run`->`Start Debugging`) para abrir una nueva ventana de VSCode con la extensión cargada. (Es posible que deba instalar la [extensión de emparejadores de problemas de esbuild](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) si encuentra problemas al compilar el proyecto.)

</details>

## Licencia

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
