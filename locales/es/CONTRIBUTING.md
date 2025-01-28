# Contribuir a Cline

Nos alegra que estés interesado en contribuir a Cline. Ya sea que corrijas un error, añadas una función o mejores nuestra documentación, ¡cada contribución hace que Cline sea más inteligente! Para mantener nuestra comunidad viva y acogedora, todos los miembros deben cumplir con nuestro [Código de Conducta](CODE_OF_CONDUCT.md).

## Informar de errores o problemas

¡Los informes de errores ayudan a mejorar Cline para todos! Antes de crear un nuevo problema, por favor revisa los [problemas existentes](https://github.com/cline/cline/issues) para evitar duplicados. Cuando estés listo para informar un error, dirígete a nuestra [página de Issues](https://github.com/cline/cline/issues/new/choose), donde encontrarás una plantilla que te ayudará a completar la información relevante.

<blockquote class='warning-note'>
    🔐 <b>Importante:</b> Si descubres una vulnerabilidad de seguridad, utiliza la <a href="https://github.com/cline/cline/security/advisories/new">herramienta de seguridad de GitHub para informarla de manera privada</a>.
</blockquote>

## Decidir en qué trabajar

¿Buscas una buena primera contribución? Revisa los issues etiquetados con ["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue) o ["help wanted"](https://github.com/cline/cline/labels/help%20wanted). ¡Estos están especialmente seleccionados para nuevos colaboradores y son áreas donde nos encantaría recibir ayuda!

También damos la bienvenida a contribuciones a nuestra [documentación](https://github.com/cline/cline/tree/main/docs). Ya sea corrigiendo errores tipográficos, mejorando guías existentes o creando nuevos contenidos educativos, queremos construir un repositorio de recursos gestionado por la comunidad que ayude a todos a sacar el máximo provecho de Cline. Puedes comenzar explorando `/docs` y buscando áreas que necesiten mejoras.

Si planeas trabajar en una función más grande, por favor crea primero una [solicitud de función](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) para que podamos discutir si se alinea con la visión de Cline.

## Configurar el entorno de desarrollo

1. **Extensiones de VS Code**

    - Al abrir el proyecto, VS Code te pedirá que instales las extensiones recomendadas
    - Estas extensiones son necesarias para el desarrollo, por favor acepta todas las solicitudes de instalación
    - Si rechazaste las solicitudes, puedes instalarlas manualmente en la sección de extensiones

2. **Desarrollo local**
    - Ejecuta `npm run install:all` para instalar las dependencias
    - Ejecuta `npm run test` para ejecutar las pruebas localmente
    - Antes de enviar un PR, ejecuta `npm run format:fix` para formatear tu código

## Escribir y enviar código

Cualquiera puede contribuir código a Cline, pero te pedimos que sigas estas pautas para asegurar que tus contribuciones se integren sin problemas:

1. **Mantén los Pull Requests enfocados**

    - Limita los PRs a una sola función o corrección de errores
    - Divide los cambios más grandes en PRs más pequeños y coherentes
    - Divide los cambios en commits lógicos que puedan ser revisados independientemente

2. **Calidad del código**

    - Ejecuta `npm run lint` para verificar el estilo del código
    - Ejecuta `npm run format` para formatear el código automáticamente
    - Todos los PRs deben pasar las verificaciones de CI, que incluyen linting y formateo
    - Corrige todas las advertencias o errores de ESLint antes de enviar
    - Sigue las mejores prácticas para TypeScript y mantén la seguridad de tipos

3. **Pruebas**

    - Añade pruebas para nuevas funciones
    - Ejecuta `npm test` para asegurarte de que todas las pruebas pasen
    - Actualiza las pruebas existentes si tus cambios las afectan
    - Añade tanto pruebas unitarias como de integración donde sea apropiado

4. **Pautas de commits**

    - Escribe mensajes de commit claros y descriptivos
    - Usa el formato de commit convencional (por ejemplo, "feat:", "fix:", "docs:")
    - Haz referencia a los issues relevantes en los commits con #número-del-issue

5. **Antes de enviar**

    - Rebasea tu rama con el último Main
    - Asegúrate de que tu rama se construya correctamente
    - Verifica que todas las pruebas pasen
    - Revisa tus cambios para eliminar cualquier código de depuración o registros de consola

6. **Descripción del Pull Request**
    - Describe claramente lo que hacen tus cambios
    - Añade pasos para probar los cambios
    - Enumera cualquier cambio importante
    - Añade capturas de pantalla para cambios en la interfaz de usuario

## Acuerdo de contribución

Al enviar un Pull Request, aceptas que tus contribuciones se licencien bajo la misma licencia que el proyecto ([Apache 2.0](LICENSE)).

Recuerda: Contribuir a Cline no solo significa escribir código, sino ser parte de una comunidad que está dando forma al futuro del desarrollo asistido por IA. ¡Hagamos algo grandioso juntos! 🚀
