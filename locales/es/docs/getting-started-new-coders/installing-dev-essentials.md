# Instalación de herramientas esenciales de desarrollo con Cline | Nuevos programadores

Cuando comienzas a programar, necesitarás instalar algunas herramientas esenciales de desarrollo en tu computadora. Cline puede ayudarte a instalar todo lo que necesitas de manera segura y guiada.

## Las herramientas esenciales

Aquí están las herramientas principales que necesitarás para el desarrollo:

-   **Homebrew**: Un gestor de paquetes para macOS que facilita la instalación de otras herramientas
-   **Node.js & npm**: Necesarios para el desarrollo en JavaScript y web
-   **Git**: Para rastrear cambios en tu código y colaborar con otros
-   **Python**: Un lenguaje de programación utilizado por muchas herramientas de desarrollo
-   **Utilidades adicionales**: Herramientas como wget y jq que ayudan con la descarga de archivos y el procesamiento de datos

## Deja que Cline instale todo

Copia este prompt y pégalo en Cline:

```bash
Hola Cline! Necesito ayuda para configurar mi Mac para el desarrollo de software. ¿Podrías ayudarme a instalar las herramientas esenciales de desarrollo como Homebrew, Node.js, Git, Python y cualquier otra utilidad que sea comúnmente necesaria para programar? Me gustaría que me guíes a través del proceso paso a paso, explicando qué hace cada herramienta y asegurándote de que todo se instale correctamente.
```

## Qué sucederá

1. Cline primero instalará Homebrew, que es como una "tienda de aplicaciones" para herramientas de desarrollo
2. Usando Homebrew, Cline luego instalará otras herramientas esenciales como Node.js y Git
3. Para cada paso de instalación:
    - Cline te mostrará el comando exacto que quiere ejecutar
    - Necesitarás aprobar cada comando antes de que se ejecute
    - Cline verificará que cada instalación haya sido exitosa

## Por qué estas herramientas son importantes

-   **Homebrew**: Facilita la instalación y actualización de herramientas de desarrollo en tu Mac
-   **Node.js & npm**: Necesarios para:
    -   Construir sitios web con React o Next.js
    -   Ejecutar código JavaScript
    -   Instalar paquetes de JavaScript
-   **Git**: Te ayuda a:
    -   Guardar diferentes versiones de tu código
    -   Colaborar con otros desarrolladores
    -   Hacer copias de seguridad de tu trabajo
-   **Python**: Utilizado para:
    -   Ejecutar scripts de desarrollo
    -   Procesamiento de datos
    -   Proyectos de aprendizaje automático

## Notas

-   El proceso de instalación es interactivo - Cline te guiará a través de cada paso
-   Puede que necesites ingresar la contraseña de tu computadora para algunas instalaciones. Cuando se te solicite, no verás ningún carácter escrito en la pantalla. Esto es normal y es una característica de seguridad para proteger tu contraseña. Simplemente escribe tu contraseña y presiona Enter.

**Ejemplo:**

```bash
$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
Contraseña:
```

_Escribe tu contraseña aquí, aunque no se muestre nada en la pantalla. Presiona Enter cuando hayas terminado._

-   Todos los comandos se te mostrarán para su aprobación antes de que se ejecuten
-   Si encuentras algún problema, Cline te ayudará a solucionarlo

## Consejos adicionales para nuevos programadores

### Entendiendo la Terminal

La **Terminal** es una aplicación donde puedes escribir comandos para interactuar con tu computadora. En macOS, puedes abrirla buscando "Terminal" en Spotlight.

**Ejemplo:**

```bash
$ open -a Terminal
```

### Entendiendo las características de VS Code

#### Terminal en VS Code

La **Terminal** en VS Code te permite ejecutar comandos directamente desde dentro del editor. Puedes abrirla yendo a `Ver > Terminal` o presionando `` Ctrl + ` ``.

**Ejemplo:**

```bash
$ node -v
v16.14.0
```

#### Vista de documento
La **Vista de Documento** es donde editas tus archivos de código. Puedes abrir archivos haciendo clic en ellos en el panel **Explorador** en el lado izquierdo de la pantalla.

#### Sección de Problemas

La sección **Problemas** en VS Code muestra cualquier error o advertencia en tu código. Puedes acceder a ella haciendo clic en el icono de bombilla o yendo a `Ver > Problemas`.

### Características Comunes

-   **Interfaz de Línea de Comandos (CLI)**: Esta es una interfaz basada en texto donde escribes comandos para interactuar con tu computadora. Puede parecer intimidante al principio, pero es una herramienta poderosa para desarrolladores.
-   **Permisos**: A veces, necesitarás dar permisos a ciertas aplicaciones o comandos. Esta es una medida de seguridad para asegurar que solo las aplicaciones de confianza puedan hacer cambios en tu sistema.

## Próximos Pasos

Después de instalar estas herramientas, ¡estarás listo para empezar a programar! Regresa a la guía [Comenzando con Cline para Nuevos Programadores](../getting-started-new-coders/README.md) para continuar tu viaje.