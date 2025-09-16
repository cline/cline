<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • <b>Español</b> • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuir a Roo Code

Roo Code es un proyecto impulsado por la comunidad y valoramos profundamente cada contribución. Para agilizar la colaboración, operamos con un [enfoque de "primero la incidencia"](#enfoque-de-primero-la-incidencia), lo que significa que todas las [solicitudes de extracción (PR)](#envío-de-una-solicitud-de-extracción) deben estar primero vinculadas a una incidencia de GitHub. Por favor, revise esta guía detenidamente.

## Tabla de contenidos

- [Antes de contribuir](#antes-de-contribuir)
- [Encontrar y planificar su contribución](#encontrar-y-planificar-su-contribución)
- [Proceso de desarrollo y envío](#proceso-de-desarrollo-y-envío)
- [Legal](#legal)

## Antes de contribuir

### 1. Código de conducta

Todos los colaboradores deben adherirse a nuestro [Código de conducta](./CODE_OF_CONDUCT.md).

### 2. Hoja de ruta del proyecto

Nuestra hoja de ruta guía la dirección del proyecto. Alinee sus contribuciones con estos objetivos clave:

### La fiabilidad es lo primero

- Asegúrese de que la edición de diferencias y la ejecución de comandos sean consistentemente fiables.
- Reduzca los puntos de fricción que desalientan el uso regular.
- Garantice un funcionamiento fluido en todas las localidades y plataformas.
- Amplíe el soporte robusto para una amplia variedad de proveedores y modelos de IA.

### Experiencia de usuario mejorada

- Agilice la interfaz de usuario/experiencia de usuario para mayor claridad e intuición.
- Mejore continuamente el flujo de trabajo para cumplir con las altas expectativas que los desarrolladores tienen de las herramientas de uso diario.

### Liderando el rendimiento de los agentes

- Establezca puntos de referencia de evaluación (evals) exhaustivos para medir la productividad en el mundo real.
- Facilite que todos puedan ejecutar e interpretar fácilmente estas evaluaciones.
- Envíe mejoras que demuestren un claro aumento en las puntuaciones de las evaluaciones.

Mencione la alineación con estas áreas en sus solicitudes de extracción.

### 3. Únase a la comunidad de Roo Code

- **Principal:** Únase a nuestro [Discord](https://discord.gg/roocode) y envíe un mensaje directo a **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Los colaboradores experimentados pueden participar directamente a través de [Proyectos de GitHub](https://github.com/orgs/RooCodeInc/projects/1).

## Encontrar y planificar su contribución

### Tipos de contribuciones

- **Correcciones de errores:** abordar problemas de código.
- **Nuevas características:** agregar funcionalidad.
- **Documentación:** mejorar las guías y la claridad.

### Enfoque de primero la incidencia

Todas las contribuciones comienzan con una incidencia de GitHub utilizando nuestras plantillas simplificadas.

- **Compruebe las incidencias existentes**: busque en [Incidencias de GitHub](https://github.com/RooCodeInc/Roo-Code/issues).
- **Cree una incidencia** utilizando:
    - **Mejoras:** plantilla "Solicitud de mejora" (lenguaje sencillo centrado en el beneficio del usuario).
    - **Errores:** plantilla "Informe de error" (reproducción mínima + esperado vs. real + versión).
- **¿Quiere trabajar en ello?** Comente "Reclamando" en la incidencia y envíe un mensaje directo a **Hannes Rudolph (`hrudolph`)** en [Discord](https://discord.gg/roocode) para que se le asigne. La asignación se confirmará en el hilo.
- **Las solicitudes de extracción deben enlazar a la incidencia.** Las solicitudes de extracción no enlazadas pueden cerrarse.

### Decidir en qué trabajar

- Consulte el [Proyecto de GitHub](https://github.com/orgs/RooCodeInc/projects/1) para ver las incidencias "Incidencia [Sin asignar]".
- Para la documentación, visite [Documentos de Roo Code](https://github.com/RooCodeInc/Roo-Code-Docs).

### Informar de errores

- Compruebe primero si existen informes.
- Cree un nuevo error utilizando la [plantilla "Informe de error"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) con:
    - Pasos de reproducción claros y numerados
    - Resultado esperado vs. real
    - Versión de Roo Code (obligatorio); proveedor/modelo de API si es relevante
- **Problemas de seguridad**: informe de forma privada a través de [avisos de seguridad](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Proceso de desarrollo y envío

### Configuración de desarrollo

1. **Bifurcar y clonar:**

```
git clone https://github.com/SU_NOMBRE_DE_USUARIO/Roo-Code.git
```

2. **Instalar dependencias:**

```
pnpm install
```

3. **Depuración:** Abra con VS Code (`F5`).

### Directrices para escribir código

- Una solicitud de extracción centrada por característica o corrección.
- Siga las mejores prácticas de ESLint y TypeScript.
- Escriba confirmaciones claras y descriptivas que hagan referencia a las incidencias (p. ej., `Corrige #123`).
- Proporcione pruebas exhaustivas (`npm test`).
- Rebase a la rama `main` más reciente antes del envío.

### Envío de una solicitud de extracción

- Comience como una **PR en borrador** si busca comentarios tempranos.
- Describa claramente sus cambios siguiendo la plantilla de solicitud de extracción.
- Enlace la incidencia en la descripción/título de la PR (p. ej., "Corrige #123").
- Proporcione capturas de pantalla/vídeos para los cambios en la interfaz de usuario.
- Indique si es necesario actualizar la documentación.

### Política de solicitud de extracción

- Debe hacer referencia a una incidencia de GitHub asignada. Para que se le asigne: comente "Reclamando" en la incidencia y envíe un mensaje directo a **Hannes Rudolph (`hrudolph`)** en [Discord](https://discord.gg/roocode). La asignación se confirmará en el hilo.
- Las solicitudes de extracción no enlazadas pueden cerrarse.
- Las solicitudes de extracción deben pasar las pruebas de CI, estar alineadas con la hoja de ruta y tener una documentación clara.

### Proceso de revisión

- **Clasificación diaria:** comprobaciones rápidas por parte de los mantenedores.
- **Revisión semanal en profundidad:** evaluación exhaustiva.
- **Itere rápidamente** en función de los comentarios.

## Legal

Al contribuir, acepta que sus contribuciones se licenciarán bajo la Licencia Apache 2.0, de acuerdo con la licencia de Roo Code.
