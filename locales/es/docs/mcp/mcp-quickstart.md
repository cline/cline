# 🚀 Guía de inicio rápido de MCP

## ❓ ¿Qué es un servidor MCP?

Piensa en los servidores MCP como ayudantes especiales que otorgan a Cline poderes adicionales. ¡Permiten a Cline hacer cosas geniales como obtener páginas web o trabajar con tus archivos!

## ⚠️ IMPORTANTE: Requisitos del sistema

¡ALTO! Antes de continuar, DEBES verificar estos requisitos:

### Software requerido

-   ✅ Última versión de Node.js (v18 o más reciente)

    -   Verifica ejecutando: `node --version`
    -   Instala desde: <https://nodejs.org/>

-   ✅ Última versión de Python (v3.8 o más reciente)

    -   Verifica ejecutando: `python --version`
    -   Instala desde: <https://python.org/>

-   ✅ Gestor de paquetes UV
    -   Después de instalar Python, ejecuta: `pip install uv`
    -   Verifica con: `uv --version`

❗ Si alguno de estos comandos falla o muestra versiones anteriores, por favor instala/actualiza antes de continuar.

⚠️ Si encuentras otros errores, consulta la sección "Solución de problemas" a continuación.

## 🎯 Pasos rápidos (¡Solo después de cumplir con los requisitos!)

### 1. 🛠️ Instala tu primer servidor MCP

1. Desde la extensión de Cline, haz clic en la pestaña `MCP Server`
1. Haz clic en el botón `Editar configuración de MCP`

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="Panel de servidor MCP" width="400" />

1. Los archivos de configuración de MCP deberían mostrarse en una pestaña en VS Code.
1. Reemplaza el contenido del archivo con este código:

Para Windows:

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		}
	}
}
```

Para Mac y Linux:

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "npx",
			"args": ["@anaisbetts/mcp-installer"]
		}
	}
}
```

Después de guardar el archivo:

1. Cline detectará el cambio automáticamente
2. Se descargará e instalará el instalador de MCP
3. Cline iniciará el instalador de MCP
4. Verás el estado del servidor en la interfaz de configuración de MCP de Cline:

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="Panel de servidor MCP con instalador" width="400" />

## 🤔 ¿Qué sigue?

Ahora que tienes el instalador de MCP, puedes pedirle a Cline que agregue más servidores desde:

1. Registro de NPM: <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Índice de paquetes de Python: <https://pypi.org/search/?q=mcp+server-&o=>

Por ejemplo, puedes pedirle a Cline que instale el paquete `mcp-server-fetch` encontrado en el Índice de paquetes de Python:

```bash
"instala el servidor MCP llamado `mcp-server-fetch`
- asegúrate de que la configuración de mcp se actualice.
- usa uvx o python para ejecutar el servidor."
```

Deberías ver a Cline:

1. Instalar el paquete de Python `mcp-server-fetch`
1. Actualizar el archivo json de configuración de mcp
1. Iniciar el servidor y comenzar el servidor

El archivo de configuración de mcp debería verse ahora así:

_Para una máquina Windows:_
```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		},
		"mcp-server-fetch": {
			"command": "uvx",
			"args": ["mcp-server-fetch"]
		}
	}
}
```

Siempre puedes verificar el estado de tu servidor accediendo a la pestaña del servidor MCP de clientes. Consulta la imagen anterior.

¡Eso es todo! 🎉 ¡Acabas de darle a Cline algunas habilidades increíbles!

## 📝 Solución de problemas

### 1. Estoy usando `asdf` y obtengo "comando desconocido: npx"

Hay algunas noticias ligeramente malas. Aún deberías poder hacer que las cosas funcionen, pero tendrás que hacer un poco más de trabajo manual a menos que la empaquetación del servidor MCP evolucione un poco. Una opción es desinstalar `asdf`, pero asumiremos que no quieres hacer eso.

En cambio, necesitarás seguir las instrucciones anteriores para "Editar Configuraciones de MCP". Luego, como describe [este post](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n), necesitarás añadir una entrada "env" a las configuraciones de cada servidor.

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

El `path_to_asdf_bin_dir` a menudo se puede encontrar en tu configuración de shell (por ejemplo, `.zshrc`). Si estás usando Homebrew, puedes usar `echo ${HOMEBREW_PREFIX}` para encontrar el inicio del directorio y luego añadir `/opt/asdf/libexec`.

Ahora, algunas buenas noticias. Aunque no es perfecto, puedes hacer que Cline haga esto por ti de manera bastante confiable para futuras instalaciones de servidores. Añade lo siguiente a tus "Instrucciones Personalizadas" en la configuración de Cline (botón de la barra de herramientas en la esquina superior derecha):

> Cuando instales servidores MCP y edites el archivo cline_mcp_settings.json, si el servidor requiere el uso de `npx` como comando, debes copiar la entrada "env" de la entrada "mcp-installer" y añadirla a la nueva entrada. Esto es vital para que el servidor funcione correctamente cuando se usa.

### 2. Sigo obteniendo un error cuando ejecuto el instalador de MCP

Si obtienes un error al ejecutar el instalador de MCP, puedes intentar lo siguiente:

-   Verifica el archivo de configuraciones de MCP en busca de errores
-   Lee la documentación del servidor MCP para asegurarte de que el archivo de configuración de MCP está utilizando el comando y los argumentos correctos. 👈
-   Usa una terminal y ejecuta el comando con sus argumentos directamente. Esto te permitirá ver los mismos errores que Cline está viendo.