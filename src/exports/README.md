# Roo Code API

The Roo Code extension exposes an API that can be used by other extensions. To use this API in your extension:

1. Copy `src/extension-api/roo-code.d.ts` to your extension's source directory.
2. Include `roo-code.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

```typescript
import { RooCodeAPI, Package } from "path/to/roo-code"

const extension = vscode.extensions.getExtension<RooCodeAPI>(`${Package.publisher}.${Package.name}`)

if (!extension?.isActive) {
	throw new Error("Extension is not activated")
}

const api = extension.exports

if (!api) {
	throw new Error("API is not available")
}

// Start a new task with an initial message.
await api.startNewTask("Hello, Roo Code API! Let's make a new project...")

// Start a new task with an initial message and images.
await api.startNewTask("Use this design language", ["data:image/webp;base64,..."])

// Send a message to the current task.
await api.sendMessage("Can you fix the @problems?")

// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running').
await api.pressPrimaryButton()

// Simulate pressing the secondary button in the chat interface (e.g. 'Reject').
await api.pressSecondaryButton()
```

**NOTE:** To ensure that the `RooVeterinaryInc.roo-cline` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

```json
"extensionDependencies": ["RooVeterinaryInc.roo-cline"]
```

For detailed information on the available methods and their usage, refer to the `roo-code.d.ts` file.
