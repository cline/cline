<div align="center"><sub>
Inglés | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a>
</sub></div>

# Cline: Tu Socio de IA Colaborativa para Trabajos de Ingeniería Serios

Transforma tu equipo de ingeniería con un socio de IA totalmente colaborativo. De código abierto, completamente extensible y diseñado para amplificar el impacto de los desarrolladores.

<p align="center">
  <video alt="Demostración del agente de IA de Cline mostrando características de desarrollo colaborativo" autoplay loop muted playsinline width="100%">
    <source src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demoForWebsiteNew.mp4" type="video/mp4">
  </video>
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
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>Primeros Pasos</strong></a>
</td>
</tbody>
</table>
</div>

Cline no es solo un agente autónomo: es tu socio de IA en la optimización de flujos de trabajo de desarrollo. Trabajando contigo en un plan antes de actuar, Cline explica su razonamiento y desglosa tareas complejas paso a paso. Con herramientas para crear y editar archivos, explorar proyectos y ejecutar comandos, Cline vigila tu entorno—desde terminales y archivos hasta registros de errores—para asegurar un progreso sin contratiempos.

Mientras que los scripts tradicionales de IA se ejecutan en entornos aislados, Cline ofrece una interfaz gráfica con la participación humana para aprobar cada cambio en los archivos y cada comando en el terminal. A través de la integración del MCP (Model Context Protocol), Cline extiende su alcance a bases de datos externas y documentos en vivo, detectando automáticamente problemas y aplicando soluciones para que puedas centrarte en la innovación. Diseñado con la seguridad a nivel empresarial en mente, puedes acceder a modelos de primera clase a través de endpoints de AWS Bedrock, GCP Vertex o Azure, manteniendo tu código seguro.

1. Ingresa tu tarea y añade imágenes para convertir diseños en aplicaciones funcionales o para corregir errores utilizando capturas de pantalla.
2. Cline comienza analizando la estructura de tus archivos y los ASTs del código fuente, realizando búsquedas con expresiones regulares y leyendo archivos relevantes para ponerse al día en proyectos existentes. Al gestionar cuidadosamente la información que se añade al contexto, Cline puede ofrecer una asistencia valiosa incluso para proyectos grandes y complejos sin saturar la ventana de contexto.
3. Una vez que Cline dispone de la información necesaria, puede:
    - Crear y editar archivos, además de monitorear errores de linters/compiladores, permitiéndole corregir de forma proactiva problemas como importaciones faltantes y errores de sintaxis.
    - Ejecutar comandos directamente en tu terminal y supervisar su salida, permitiéndole, por ejemplo, reaccionar ante problemas del servidor de desarrollo después de editar un archivo.
    - Para tareas de desarrollo web, Cline puede iniciar el sitio en un navegador sin cabeza, hacer clic, escribir, desplazar, y capturar capturas de pantalla y registros de la consola, lo que le permite corregir errores en tiempo de ejecución y fallos visuales.
4. Cuando se completa una tarea, Cline te presentará el resultado con un comando de terminal como `open -a "Google Chrome" index.html`, que ejecutas con un simple clic.

> [!TIP]
> Usa el atajo `CMD/CTRL + Shift + P` para abrir la paleta de comandos y escribe "Cline: Open In New Tab" para abrir la extensión en una nueva pestaña en tu editor. Esto te permite usar Cline junto a tu explorador de archivos y ver más claramente cómo cambia tu espacio de trabajo.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4" alt="Interfaz flexible de integración de modelos de Cline">

### Usa cualquier API y Modelo

Cline soporta proveedores de API como OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure y GCP Vertex. También puedes configurar cualquier API compatible con OpenAI o usar un modelo local a través de LM Studio/Ollama. Si utilizas OpenRouter, la extensión recupera su lista actualizada de modelos, permitiéndote usar los modelos más recientes tan pronto como estén disponibles.

La extensión también lleva un seguimiento del total de tokens y del costo del uso de la API tanto para el ciclo completo de la tarea como para solicitudes individuales, manteniéndote informado sobre el gasto en cada paso.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76" alt="Interfaz de ejecución de comandos en terminal de Cline">

### Ejecuta Comandos en el Terminal

Gracias a las nuevas actualizaciones de integración de terminal en [VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), Cline puede ejecutar comandos directamente en tu terminal y recibir la salida. Esto le permite realizar una amplia gama de tareas, desde instalar paquetes y ejecutar scripts de compilación hasta desplegar aplicaciones, gestionar bases de datos y realizar pruebas, adaptándose a tu entorno de desarrollo y cadena de herramientas para realizar el trabajo correctamente.

Para procesos de larga duración como servidores de desarrollo, utiliza el botón "Continuar mientras se ejecuta" para permitir que Cline continúe con la tarea mientras el comando se ejecuta en segundo plano. A medida que trabaja, Cline será notificado de cualquier nueva salida del terminal, permitiéndole reaccionar ante problemas que puedan surgir, como errores de compilación al editar archivos.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588" alt="Interfaz de edición de archivos de Cline con vista de diferencias">

### Crea y Edita Archivos

Cline puede crear y editar archivos directamente en tu editor, presentándote una vista de diferencia (diff) de los cambios realizados. Puedes editar o revertir los cambios de Cline directamente en el editor de diferencias o dar retroalimentación a través del chat hasta que estés satisfecho con el resultado. Además, Cline supervisa los errores de linters/compiladores (como importaciones faltantes o errores de sintaxis), de modo que puede solucionar los problemas que surjan de manera autónoma.

Todos los cambios realizados por Cline se registran en la línea de tiempo del archivo, proporcionando una forma sencilla de rastrear y revertir modificaciones si es necesario.

<!-- Transparent pixel to create line break after floating image -->

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5" alt="Interfaz de automatización del navegador de Cline">

### Usa el Navegador

Con la nueva capacidad de [Uso de Computadora](https://www.anthropic.com/news/3-5-models-and-computer-use) de Claude 3.5 Sonnet, Cline puede lanzar un navegador, hacer clic en elementos, escribir texto y desplazarse, capturando capturas de pantalla y registros de consola en cada paso. Esto permite la depuración interactiva, pruebas end-to-end e incluso el uso general de la web. Esto le otorga la autonomía para corregir errores visuales y problemas en tiempo de ejecución sin que tengas que copiar y pegar manualmente los registros de error.

Prueba pedirle a Cline que "pruebe la app" y observa cómo ejecuta un comando como `npm run dev`, abre tu servidor de desarrollo local en el navegador y realiza una serie de pruebas para confirmar que todo funciona correctamente. [Ver demostración.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd" alt="Interfaz de creación de herramientas MCP de Cline">

### "Agrega una herramienta que..."

Gracias al [Model Context Protocol](https://github.com/modelcontextprotocol), Cline puede ampliar sus capacidades mediante herramientas personalizadas. Mientras puedes utilizar [servidores creados por la comunidad](https://github.com/modelcontextprotocol/servers), Cline también puede crear e instalar herramientas adaptadas específicamente a tu flujo de trabajo. Simplemente pídele a Cline: "agrega una herramienta" y él se encargará de todo, desde crear un nuevo servidor MCP hasta instalarlo en la extensión. Estas herramientas personalizadas se convierten en parte del conjunto de herramientas de Cline, listas para usarse en futuras tareas.

- "Agrega una herramienta que recupere tickets de Jira": Recupera los códigos de los tickets y pone a trabajar a Cline.
- "Agrega una herramienta que administre AWS EC2s": Supervisa métricas del servidor y ajusta el escalado de instancias según sea necesario.
- "Agrega una herramienta que extraiga los incidentes más recientes de PagerDuty": Obtén detalles y pide a Cline que solucione errores.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970" alt="Interfaz de gestión de contexto de Cline">

### Añade Contexto

**`@url`:** Pega una URL para que la extensión la recupere y la convierta a Markdown, útil cuando deseas proporcionar a Cline la documentación más reciente.

**`@problems`:** Añade errores y advertencias del espacio de trabajo (panel "Problems") para que Cline los solucione.

**`@file`:** Añade el contenido de un archivo para que no tengas que gastar solicitudes de API aprobando la lectura del mismo.

**`@folder`:** Añade los archivos de una carpeta de una sola vez para acelerar aún más tu flujo de trabajo.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb" alt="Interfaz de comparación de puntos de control de Cline">

### Seguridad a Nivel Empresarial

Mientras Cline trabaja en una tarea, la extensión toma una instantánea de tu espacio de trabajo en cada paso. Puedes usar el botón "Comparar" para ver la diferencia entre la instantánea y tu espacio de trabajo actual, y el botón "Restaurar" para volver a ese punto.

Por ejemplo, al trabajar con un servidor web local, puedes usar la opción "Restaurar solo el espacio de trabajo" para probar rápidamente diferentes versiones de tu aplicación, y luego "Restaurar tarea y espacio de trabajo" cuando encuentres la versión en la que deseas continuar construyendo. Esto te permite explorar diferentes enfoques de forma segura sin perder el progreso.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Contribuir

Para contribuir al proyecto, comienza con nuestra [Guía de Contribución](CONTRIBUTING.md) para aprender lo básico. También puedes unirte a nuestro [Discord](https://discord.gg/cline) para charlar con otros colaboradores en el canal `#contributors`. Si buscas un trabajo a tiempo completo, consulta nuestras posiciones abiertas en nuestra [página de carreras](https://cline.bot/join-us)!

<details>
<summary>Instrucciones para Desarrollo Local</summary>

1. Clona el repositorio _(Requiere [git-lfs](https://git-lfs.com/))_:
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. Abre el proyecto en VSCode:
    ```bash
    code cline
    ```
3. Instala las dependencias necesarias para la extensión y la interfaz webview-gui:
    ```bash
    npm run install:all
    ```
4. Inicia presionando `F5` (o `Run`->`Start Debugging`) para abrir una nueva ventana de VSCode con la extensión cargada. (Puede que necesites instalar la [extensión de esbuild problem matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) si encuentras problemas al compilar el proyecto.)

</details>

<details>
<summary>Creación de un Pull Request</summary>

1. Antes de crear un PR, genera una entrada de changeset:
    ```bash
    npm run changeset
    ```
   Esto te solicitará:
   - Tipo de cambio (mayor, menor, parche)
     - `mayor` → cambios importantes (1.0.0 → 2.0.0)
     - `menor` → nuevas funciones (1.0.0 → 1.1.0)
     - `parche` → corrección de errores (1.0.0 → 1.0.1)
   - Descripción de tus cambios

2. Confirma tus cambios y el archivo `.changeset` generado

3. Sube tu rama y crea un PR en GitHub. Nuestro CI:
   - Ejecutará pruebas y verificaciones
   - Changesetbot creará un comentario mostrando el impacto en la versión
   - Una vez fusionado al main, Changesetbot creará un PR para los paquetes de la versión
   - Tras la fusión del PR de los paquetes, se publicará una nueva versión

</details>

## Licencia

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
