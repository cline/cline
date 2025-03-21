# Contribuir a Roo Code

Estamos encantados de que estés interesado en contribuir a Roo Code. Ya sea que estés arreglando un error, añadiendo una función o mejorando nuestra documentación, ¡cada contribución hace que Roo Code sea más inteligente! Para mantener nuestra comunidad vibrante y acogedora, todos los miembros deben adherirse a nuestro [Código de Conducta](CODE_OF_CONDUCT.md).

## Únete a nuestra comunidad

¡Animamos encarecidamente a todos los colaboradores a unirse a nuestra [comunidad de Discord](https://discord.gg/roocode)! Formar parte de nuestro servidor de Discord te ayuda a:

- Obtener ayuda y orientación en tiempo real para tus contribuciones
- Conectar con otros colaboradores y miembros del equipo principal
- Mantenerte actualizado sobre los desarrollos y prioridades del proyecto
- Participar en discusiones que dan forma al futuro de Roo Code
- Encontrar oportunidades de colaboración con otros desarrolladores

## Reportar errores o problemas

¡Los informes de errores ayudan a mejorar Roo Code para todos! Antes de crear un nuevo issue, por favor [busca entre los existentes](https://github.com/RooVetGit/Roo-Code/issues) para evitar duplicados. Cuando estés listo para reportar un error, dirígete a nuestra [página de issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose) donde encontrarás una plantilla para ayudarte a completar la información relevante.

<blockquote class='warning-note'>
     🔐 <b>Importante:</b> Si descubres una vulnerabilidad de seguridad, por favor utiliza la <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">herramienta de seguridad de GitHub para reportarla de forma privada</a>.
</blockquote>

## Decidir en qué trabajar

¿Buscas una buena primera contribución? Revisa los issues en la sección "Issue [Unassigned]" de nuestro [Proyecto GitHub de Roo Code](https://github.com/orgs/RooVetGit/projects/1). ¡Estos están específicamente seleccionados para nuevos colaboradores y áreas donde nos encantaría recibir ayuda!

¡También damos la bienvenida a contribuciones a nuestra [documentación](https://docs.roocode.com/)! Ya sea arreglando errores tipográficos, mejorando guías existentes o creando nuevo contenido educativo - nos encantaría construir un repositorio de recursos impulsado por la comunidad que ayude a todos a sacar el máximo provecho de Roo Code. Puedes hacer clic en "Edit this page" en cualquier página para llegar rápidamente al lugar correcto en Github para editar el archivo, o puedes ir directamente a https://github.com/RooVetGit/Roo-Code-Docs.

Si estás planeando trabajar en una función más grande, por favor crea una [solicitud de función](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) primero para que podamos discutir si se alinea con la visión de Roo Code. También puedes consultar nuestra [Hoja de Ruta del Proyecto](#hoja-de-ruta-del-proyecto) a continuación para ver si tu idea encaja con nuestra dirección estratégica.

## Hoja de Ruta del Proyecto

Roo Code tiene una hoja de ruta de desarrollo clara que guía nuestras prioridades y dirección futura. Entender nuestra hoja de ruta puede ayudarte a:

- Alinear tus contribuciones con los objetivos del proyecto
- Identificar áreas donde tu experiencia sería más valiosa
- Entender el contexto detrás de ciertas decisiones de diseño
- Encontrar inspiración para nuevas funciones que apoyen nuestra visión

Nuestra hoja de ruta actual se centra en seis pilares clave:

### Soporte de Proveedores

Nuestro objetivo es dar soporte a tantos proveedores como sea posible:

- Soporte más versátil para "OpenAI Compatible"
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Soporte mejorado para Ollama y LM Studio

### Soporte de Modelos

Queremos que Roo funcione bien con tantos modelos como sea posible, incluidos los modelos locales:

- Soporte para modelos locales a través de system prompting personalizado y flujos de trabajo
- Evaluaciones de benchmarking y casos de prueba

### Soporte de Sistemas

Queremos que Roo funcione bien en el ordenador de todos:

- Integración de terminal multiplataforma
- Soporte sólido y consistente para Mac, Windows y Linux

### Documentación

Queremos una documentación completa y accesible para todos los usuarios y colaboradores:

- Guías de usuario y tutoriales ampliados
- Documentación clara de la API
- Mejor orientación para colaboradores
- Recursos de documentación multilingües
- Ejemplos interactivos y muestras de código

### Estabilidad

Queremos disminuir significativamente el número de errores y aumentar las pruebas automatizadas:

- Interruptor de registro de depuración
- Botón de copia de "Información de Máquina/Tarea" para enviar con solicitudes de soporte/errores

### Internacionalización

Queremos que Roo hable el idioma de todos:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

Damos especialmente la bienvenida a contribuciones que avancen nuestros objetivos de la hoja de ruta. Si estás trabajando en algo que se alinea con estos pilares, por favor menciónalo en la descripción de tu PR.

## Configuración de desarrollo

1. **Clona** el repositorio:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Instala dependencias**:

```sh
npm run install:all
```

3. **Inicia la vista web (aplicación Vite/React con HMR)**:

```sh
npm run dev
```

4. **Depuración**:
   Presiona `F5` (o **Ejecutar** → **Iniciar depuración**) en VSCode para abrir una nueva sesión con Roo Code cargado.

Los cambios en la vista web aparecerán inmediatamente. Los cambios en la extensión principal requerirán un reinicio del host de extensión.

Alternativamente, puedes construir un archivo .vsix e instalarlo directamente en VSCode:

```sh
npm run build
```

Un archivo `.vsix` aparecerá en el directorio `bin/` que puede ser instalado con:

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## Escribir y enviar código

Cualquiera puede contribuir con código a Roo Code, pero te pedimos que sigas estas pautas para asegurar que tus contribuciones puedan integrarse sin problemas:

1. **Mantén los Pull Requests enfocados**

    - Limita los PRs a una sola función o corrección de errores
    - Divide los cambios más grandes en PRs más pequeños y relacionados
    - Separa los cambios en commits lógicos que puedan revisarse independientemente

2. **Calidad del código**

    - Todos los PRs deben pasar las comprobaciones de CI que incluyen tanto linting como formateo
    - Soluciona cualquier advertencia o error de ESLint antes de enviar
    - Responde a todos los comentarios de Ellipsis, nuestra herramienta automatizada de revisión de código
    - Sigue las mejores prácticas de TypeScript y mantén la seguridad de tipos

3. **Pruebas**

    - Añade pruebas para nuevas funciones
    - Ejecuta `npm test` para asegurar que todas las pruebas pasen
    - Actualiza las pruebas existentes si tus cambios les afectan
    - Incluye tanto pruebas unitarias como de integración cuando sea apropiado

4. **Directrices para commits**

    - Escribe mensajes de commit claros y descriptivos
    - Haz referencia a los issues relevantes en los commits usando #número-de-issue

5. **Antes de enviar**

    - Haz rebase de tu rama sobre la última main
    - Asegúrate de que tu rama se construye correctamente
    - Comprueba que todas las pruebas están pasando
    - Revisa tus cambios para detectar código de depuración o logs de consola

6. **Descripción del Pull Request**
    - Describe claramente lo que hacen tus cambios
    - Incluye pasos para probar los cambios
    - Enumera cualquier cambio que rompa la compatibilidad
    - Añade capturas de pantalla para cambios en la interfaz de usuario

## Acuerdo de contribución

Al enviar un pull request, aceptas que tus contribuciones serán licenciadas bajo la misma licencia que el proyecto ([Apache 2.0](../LICENSE)).
