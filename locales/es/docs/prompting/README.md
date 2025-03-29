# Guía de Prompting de Cline 🚀

¡Bienvenido a la Guía de Prompting de Cline! Esta guía te proporcionará el conocimiento necesario para escribir prompts efectivos e instrucciones personalizadas, maximizando tu productividad con Cline.

## Instrucciones Personalizadas ⚙️

Piensa en las **instrucciones personalizadas como la programación de Cline**. Estas definen el comportamiento base de Cline y están **siempre "activadas", influyendo en todas las interacciones.**

Para añadir instrucciones personalizadas:

1. Abre VSCode
2. Haz clic en el dial de configuración de la extensión Cline ⚙️
3. Busca el campo "Instrucciones Personalizadas"
4. Pega tus instrucciones

<img width="345" alt="Captura de pantalla 2024-12-26 a las 11:22:20 a.m." src="https://github.com/user-attachments/assets/00ae689b-d99f-4811-b2f4-fffe1e12f2ff" />

Las instrucciones personalizadas son poderosas para:

-   Aplicar Estilo de Codificación y Mejores Prácticas: Asegura que Cline siempre siga las convenciones de codificación, las convenciones de nomenclatura y las mejores prácticas de tu equipo.
-   Mejorar la Calidad del Código: Anima a Cline a escribir código más legible, mantenible y eficiente.
-   Guía de Manejo de Errores: Dile a Cline cómo manejar errores, escribir mensajes de error y registrar información.

**La carpeta `custom-instructions` contiene ejemplos de instrucciones personalizadas que puedes usar o adaptar.**

## Archivo .clinerules 📋

Mientras que las instrucciones personalizadas son específicas del usuario y globales (aplicándose en todos los proyectos), el archivo `.clinerules` proporciona **instrucciones específicas del proyecto** que residen en el directorio raíz de tu proyecto. Estas instrucciones se añaden automáticamente a tus instrucciones personalizadas y se referencian en el prompt del sistema de Cline, asegurando que influyan en todas las interacciones dentro del contexto del proyecto. Esto lo convierte en una excelente herramienta para:

### Mejores Prácticas de Seguridad 🔒

Para proteger información sensible, puedes instruir a Cline para que ignore archivos o patrones específicos en tu `.clinerules`. Esto es particularmente importante para:

-   Archivos `.env` que contienen claves de API y secretos
-   Archivos de configuración con datos sensibles
-   Credenciales o tokens privados

Ejemplo de sección de seguridad en `.clinerules`:

```markdown
# Seguridad

## Archivos Sensibles

NO leer ni modificar:

-   Archivos .env
-   */config/secrets._
-   */_.pem
-   Cualquier archivo que contenga claves de API, tokens o credenciales

## Prácticas de Seguridad

-   Nunca cometer archivos sensibles
-   Usar variables de entorno para secretos
-   Mantener credenciales fuera de los registros y la salida
```

### Casos de Uso Generales

El archivo `.clinerules` es excelente para:

-   Mantener estándares de proyecto entre miembros del equipo
-   Aplicar prácticas de desarrollo
-   Gestionar requisitos de documentación
-   Configurar marcos de análisis
-   Definir comportamientos específicos del proyecto

### Ejemplo de Estructura .clinerules

```markdown
# Directrices del Proyecto

## Requisitos de Documentación

-   Actualizar la documentación relevante en /docs al modificar características
-   Mantener README.md sincronizado con nuevas capacidades
-   Mantener entradas de registro de cambios en CHANGELOG.md

## Registros de Decisiones de Arquitectura

Crear ADRs en /docs/adr para:

-   Cambios importantes en dependencias
-   Cambios en patrones arquitectónicos
-   Nuevos patrones de integración
-   Cambios en el esquema de la base de datos
    Seguir la plantilla en /docs/adr/template.md

## Estilo de Código y Patrones

-   Generar clientes de API usando OpenAPI Generator
-   Usar la plantilla de TypeScript axios
-   Colocar el código generado en /src/generated
-   Preferir la composición sobre la herencia
-   Usar el patrón de repositorio para el acceso a datos
-   Seguir el patrón de manejo de errores en /src/utils/errors.ts

## Estándares de Pruebas

-   Pruebas unitarias requeridas para la lógica de negocio
-   Pruebas de integración para endpoints de API
-   Pruebas E2E para flujos críticos de usuario
```

### Beneficios Clave
1. **Control de versiones**: El archivo `.clinerules` se convierte en parte del código fuente de tu proyecto
2. **Consistencia del equipo**: Asegura un comportamiento consistente entre todos los miembros del equipo
3. **Específico del proyecto**: Reglas y estándares adaptados a las necesidades de cada proyecto
4. **Conocimiento institucional**: Mantiene los estándares y prácticas del proyecto en el código

Coloca el archivo `.clinerules` en el directorio raíz de tu proyecto:

```
your-project/
├── .clinerules
├── src/
├── docs/
└── ...
```

Por otro lado, el prompt del sistema de Cline no es editable por el usuario ([aquí es donde puedes encontrarlo](https://github.com/cline/cline/blob/main/src/core/prompts/system.ts)). Para una visión más amplia de las mejores prácticas en ingeniería de prompts, consulta [este recurso](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview).

### Consejos para escribir instrucciones personalizadas efectivas

-   Sé claro y conciso: Usa un lenguaje sencillo y evita la ambigüedad.
-   Enfócate en los resultados deseados: Describe los resultados que quieres, no los pasos específicos.
-   Prueba e itera: Experimenta para encontrar lo que funciona mejor para tu flujo de trabajo.


### Soporte para cargar archivos desde el directorio `.clinerules/`
Todos los archivos bajo el directorio `.clinerules/` se cargan de manera recursiva y su contenido se fusiona en clineRulesFileInstructions.

#### Ejemplo 1:
```
.clinerules/
├── .local-clinerules
└── .project-clinerules
```

#### Ejemplo 2:
```
.clinerules/
├── .clinerules-nextjs
├── .clinerules-serverside
└── tests/
    ├── .pytest-clinerules
    └── .jest-clinerules
```

## Prompting Cline 💬

**El prompting es cómo comunicas tus necesidades para una tarea dada en el chat de ida y vuelta con Cline.** Cline entiende el lenguaje natural, así que escribe de manera conversacional.

El prompting efectivo implica:

-   Proporcionar un contexto claro: Explica tus objetivos y las partes relevantes de tu base de código. Usa `@` para referenciar archivos o carpetas.
-   Descomponer la complejidad: Divide las tareas grandes en pasos más pequeños.
-   Hacer preguntas específicas: Guía a Cline hacia el resultado deseado.
-   Validar y refinar: Revisa las sugerencias de Cline y proporciona retroalimentación.

### Ejemplos de prompts

#### Gestión de contexto

-   **Iniciar una nueva tarea:** "Cline, empecemos una nueva tarea. Crea `user-authentication.js`. Necesitamos implementar el inicio de sesión del usuario con tokens JWT. Aquí están los requisitos…"
-   **Resumir trabajo anterior:** "Cline, resume lo que hicimos en la última tarea del dashboard de usuario. Quiero capturar las características principales y los problemas pendientes. Guarda esto en `cline_docs/user-dashboard-summary.md`."

#### Depuración

-   **Analizar un error:** "Cline, estoy obteniendo este error: \[mensaje de error]. Parece que viene de \[sección de código]. Analiza este error y sugiere una solución."
-   **Identificar la causa raíz:** "Cline, la aplicación se bloquea cuando hago \[acción]. El problema podría estar en \[áreas problemáticas]. Ayúdame a encontrar la causa raíz y proponer una solución."

#### Refactorización

-   **Mejorar la estructura del código:** "Cline, esta función es demasiado larga y compleja. Refactorízala en funciones más pequeñas."
-   **Simplificar la lógica:** "Cline, este código es difícil de entender. Simplifica la lógica y hazlo más legible."

#### Desarrollo de características
- **Brainstorming New Features:** "Cline, quiero añadir una función que permita a los usuarios [funcionalidad]. Genera algunas ideas y considera los desafíos de implementación."
- **Generating Code:** "Cline, crea un componente que muestre los perfiles de usuario. La lista debe ser ordenable y filtrable. Genera el código para este componente."

## Técnicas de Prompting Avanzadas

- **Constraint Stuffing:** Para mitigar la truncación del código, incluye restricciones explícitas en tus prompts. Por ejemplo, "asegúrate de que el código esté completo" o "siempre proporciona la definición completa de la función."
- **Confidence Checks:** Pide a Cline que califique su confianza (por ejemplo, "en una escala del 1 al 10, ¿cuán seguro estás de esta solución?")
- **Challenge Cline's Assumptions:** Haz preguntas "estúpidas" para fomentar un pensamiento más profundo y prevenir suposiciones incorrectas.

Aquí hay algunos consejos de prompting que los usuarios han encontrado útiles para trabajar con Cline:

## Los Prompts Favoritos de Nuestra Comunidad 🌟

### Comprobaciones de Memoria y Confianza 🧠

- **Memory Check** - _pacnpal_

    ```
    "Si entiendes completamente mi prompt, responde con 'YARRR!' sin herramientas cada vez que estés a punto de usar una herramienta."
    ```

    Una forma divertida de verificar que Cline se mantenga en el camino durante tareas complejas. Prueba "HO HO HO" para un toque festivo!

- **Confidence Scoring** - _pacnpal_
    ```
    "Antes y después de cualquier uso de herramienta, dame un nivel de confianza (0-10) sobre cómo el uso de la herramienta ayudará al proyecto."
    ```
    Fomenta el pensamiento crítico y hace que la toma de decisiones sea transparente.

### Prompts de Calidad de Código 💻

- **Prevent Code Truncation**

    ```
    "NO SEAS PEREZOSO. NO OMITAS CÓDIGO."
    ```

    Frases alternativas: "solo código completo" o "asegúrate de que el código esté completo"

- **Custom Instructions Reminder**
    ```
    "Me comprometo a seguir las instrucciones personalizadas."
    ```
    Refuerza el cumplimiento de tu configuración de dial ⚙️.

### Organización de Código 📋

- **Large File Refactoring** - _icklebil_

    ```
    "FILENAME se ha vuelto demasiado grande. Analiza cómo funciona este archivo y sugiere formas de fragmentarlo de manera segura."
    ```

    Ayuda a gestionar archivos complejos a través de una descomposición estratégica.

- **Documentation Maintenance** - _icklebil_
    ```
    "no olvides actualizar la documentación del código base con los cambios"
    ```
    Asegura que la documentación se mantenga sincronizada con los cambios en el código.

### Análisis y Planificación 🔍

- **Structured Development** - _yellow_bat_coffee_

    ```
    "Antes de escribir código:
    1. Analiza todos los archivos de código a fondo
    2. Obtén el contexto completo
    3. Escribe un plan de implementación .MD
    4. Luego implementa el código"
    ```

    Promueve un desarrollo organizado y bien planificado.

- **Thorough Analysis** - _yellow_bat_coffee_

    ```
    "por favor, comienza a analizar el flujo completo a fondo, siempre indica una puntuación de confianza del 1 al 10"
    ```

    Evita la codificación prematura y fomenta una comprensión completa.

- **Assumptions Check** - _yellow_bat_coffee_
    ```
    "Enumera todas las suposiciones e incertidumbres que necesitas aclarar antes de completar esta tarea."
    ```
    Identifica posibles problemas temprano en el desarrollo.

### Desarrollo Reflexivo 🤔

- **Pause and Reflect** - _nickbaumann98_

    ```
    "cuenta hasta 10"
    ```

    Promueve una consideración cuidadosa antes de tomar acción.

- **Complete Analysis** - _yellow_bat_coffee_

    ```
    "No completes el análisis prematuramente, sigue analizando incluso si crees que has encontrado una solución"
    ```

    Asegura una exploración completa del problema.
-   **Verificación Continua de Confianza** - _pacnpal_
    ```
    "Calificar la confianza (1-10) antes de guardar archivos, después de guardar, después de rechazos y antes de completar la tarea"
    ```
    Mantiene la calidad a través de la autoevaluación.

### Mejores Prácticas 🎯

-   **Estructura del Proyecto** - _kvs007_

    ```
    "Revisar los archivos del proyecto antes de sugerir cambios estructurales o de dependencias"
    ```

    Mantiene la integridad del proyecto.

-   **Pensamiento Crítico** - _chinesesoup_

    ```
    "Hacer preguntas 'estúpidas' como: ¿estás seguro de que esta es la mejor manera de implementar esto?"
    ```

    Desafía suposiciones y descubre mejores soluciones.

-   **Estilo de Código** - _yellow_bat_coffee_

    ```
    Usar palabras como "elegante" y "simple" en las indicaciones
    ```

    Puede influir en la organización y claridad del código.

-   **Establecimiento de Expectativas** - _steventcramer_
    ```
    "EL HUMANO SE ENOJARÁ."
    ```
    (Un recordatorio humorístico para proporcionar requisitos claros y retroalimentación constructiva)