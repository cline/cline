# Arquitectura de la Extensión Cline

Este directorio contiene la documentación arquitectónica para la extensión Cline de VSCode.

## Diagrama de Arquitectura de la Extensión

El archivo [extension-architecture.mmd](./extension-architecture.mmd) contiene un diagrama Mermaid que muestra la arquitectura de alto nivel de la extensión Cline. El diagrama ilustra:

1. **Extensión Principal**
   - Punto de entrada de la extensión y clases principales
   - Gestión de estado a través del estado global y el almacenamiento de secretos de VSCode
   - Lógica de negocio principal en la clase Cline

2. **Interfaz de Usuario de Webview**
   - Interfaz de usuario basada en React
   - Gestión de estado a través de ExtensionStateContext
   - Jerarquía de componentes

3. **Almacenamiento**
   - Almacenamiento específico de tareas para historial y estado
   - Sistema de puntos de control basado en Git para cambios en archivos

4. **Flujo de Datos**
   - Flujo de datos de la extensión principal entre componentes
   - Flujo de datos de la interfaz de usuario de Webview
   - Comunicación bidireccional entre el núcleo y el webview

## Visualización del Diagrama

Para ver el diagrama:
1. Instala una extensión de visualización de diagramas Mermaid en VSCode
2. Abre extension-architecture.mmd
3. Usa la función de vista previa de la extensión para renderizar el diagrama

También puedes ver el diagrama en GitHub, que tiene soporte integrado para la renderización de Mermaid.

## Esquema de Colores

El diagrama utiliza un esquema de colores de alto contraste para una mejor visibilidad:
- Rosa (#ff0066): Componentes de estado global y almacenamiento de secretos
- Azul (#0066ff): Contexto de estado de la extensión
- Verde (#00cc66): Proveedor de Cline
- Todos los componentes utilizan texto blanco para una máxima legibilidad