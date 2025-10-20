# Extension-for-Extension Pattern in VS Code

## Core Principle

One extension (the "host") exports an API that other extensions (the "plugins") can import and use. This creates an extensibility ecosystem where your extension becomes a platform.

## Key Components

**1. API Export**
- The host extension's `activate()` function returns an object - this becomes its public API
- Any extension can access this API via `vscode.extensions.getExtension()` and reading the `.exports` property
- The returned API object should be a well-defined TypeScript interface

**2. Discovery Mechanism**
- **Explicit**: Plugin extensions declare `extensionDependencies` in their `package.json` to ensure the host loads first
- **Automatic**: Host scans `vscode.extensions.all` to find compatible plugins by checking their `package.json` metadata (typically in the `contributes` section)

**3. Registration**
- Plugins call a registration method on the host's API (e.g., `registerPlugin()`) 
- Host maintains a registry of active plugins and can invoke their functionality as needed

**4. Shared Contract**
- Define TypeScript interfaces for the API in a shared npm package, or document them clearly
- Include version information to handle API evolution

## VS Code APIs Used

- `vscode.extensions.getExtension(id)` - retrieve another extension
- `extension.activate()` - ensure extension is loaded
- `extension.exports` - access the exported API
- `extension.packageJSON` - read metadata for discovery
- `vscode.extensions.onDidChange` - detect newly installed extensions

## Activation Timing

Host should use early activation events (`*` or `onStartupFinished`) so it's available when plugins activate.