[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • <b>Español</b> • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Contribuir a Roo Code

Roo Code es un proyecto impulsado por la comunidad, y valoramos profundamente cada contribución. Para agilizar la colaboración, operamos con un enfoque [Issue-First](#enfoque-issue-first), lo que significa que todos los [Pull Requests (PRs)](#enviar-un-pull-request) deben estar vinculados primero a un Issue de GitHub. Por favor, revisa esta guía cuidadosamente.

## Tabla de Contenidos

- [Antes de Contribuir](#antes-de-contribuir)
- [Encontrar y Planificar tu Contribución](#encontrar-y-planificar-tu-contribución)
- [Proceso de Desarrollo y Envío](#proceso-de-desarrollo-y-envío)
- [Legal](#legal)

## Antes de Contribuir

### 1. Código de Conducta

Todos los colaboradores deben adherirse a nuestro [Código de Conducta](./CODE_OF_CONDUCT.md).

### 2. Hoja de Ruta del Proyecto

Nuestra hoja de ruta guía la dirección del proyecto. Alinea tus contribuciones con estos objetivos clave:

### Confiabilidad Primero

- Garantizar que la edición de diferencias y la ejecución de comandos sean consistentemente confiables.
- Reducir los puntos de fricción que disuaden el uso regular.
- Garantizar un funcionamiento fluido en todos los idiomas y plataformas.
- Ampliar el soporte sólido para una amplia variedad de proveedores y modelos de IA.

### Experiencia de Usuario Mejorada

- Simplificar la interfaz de usuario para mayor claridad e intuitividad.
- Mejorar continuamente el flujo de trabajo para satisfacer las altas expectativas que los desarrolladores tienen para herramientas de uso diario.

### Liderazgo en Rendimiento de Agentes

- Establecer evaluaciones comparativas completas (evals) para medir la productividad en el mundo real.
- Facilitar que todos puedan ejecutar e interpretar estas evaluaciones fácilmente.
- Ofrecer mejoras que demuestren aumentos claros en las puntuaciones de evaluación.

Menciona la alineación con estas áreas en tus PRs.

### 3. Únete a la Comunidad Roo Code

- **Principal:** Únete a nuestro [Discord](https://discord.gg/roocode) y envía un DM a **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Los colaboradores experimentados pueden participar directamente a través de [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1).

## Encontrar y Planificar tu Contribución

### Tipos de Contribuciones

- **Corrección de errores:** Solucionar problemas en el código.
- **Nuevas funciones:** Añadir funcionalidades.
- **Documentación:** Mejorar guías y claridad.

### Enfoque Issue-First

Todas las contribuciones deben comenzar con un Issue de GitHub.

- **Revisar issues existentes**: Busca en [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
- **Crear un issue**: Usa las plantillas apropiadas:
    - **Errores:** Plantilla "Bug Report".
    - **Funciones:** Plantilla "Detailed Feature Proposal". Se requiere aprobación antes de comenzar.
- **Reclamar issues**: Comenta y espera la asignación oficial.

**Los PRs sin issues aprobados pueden ser cerrados.**

### Decidir en Qué Trabajar

- Revisa el [Proyecto GitHub](https://github.com/orgs/RooCodeInc/projects/1) para "Good First Issues" no asignados.
- Para documentación, visita [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Reportar Errores

- Primero verifica si ya existen reportes.
- Crea nuevos reportes de errores usando la [plantilla "Bug Report"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose).
- **Problemas de seguridad**: Reporta de forma privada a través de [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Proceso de Desarrollo y Envío

### Configuración de Desarrollo

1. **Fork & Clona:**

```
git clone https://github.com/TU_USUARIO/Roo-Code.git
```

2. **Instalar Dependencias:**

```
npm run install:all
```

3. **Depuración:** Abre con VS Code (`F5`).

### Guía para Escribir Código

- Un PR enfocado por función o corrección.
- Sigue las mejores prácticas de ESLint y TypeScript.
- Escribe commits claros y descriptivos que referencien issues (ej., `Fixes #123`).
- Proporciona pruebas exhaustivas (`npm test`).
- Rebase sobre la última rama `main` antes de enviar.

### Enviar un Pull Request

- Comienza como **PR en Borrador** si buscas feedback temprano.
- Describe claramente tus cambios siguiendo la Plantilla de Pull Request.
- Proporciona capturas de pantalla/videos para cambios en la UI.
- Indica si son necesarias actualizaciones de documentación.

### Política de Pull Request

- Debe referenciar issues preaprobados y asignados.
- Los PRs que no cumplan con la política pueden ser cerrados.
- Los PRs deben pasar las pruebas de CI, alinearse con la hoja de ruta y tener documentación clara.

### Proceso de Revisión

- **Triage Diario:** Revisiones rápidas por parte de los mantenedores.
- **Revisión Semanal en Profundidad:** Evaluación integral.
- **Itera rápidamente** basándote en el feedback.

## Legal

Al contribuir, aceptas que tus contribuciones serán licenciadas bajo la Licencia Apache 2.0, consistente con la licencia de Roo Code.
