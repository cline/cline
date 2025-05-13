# Roo Code Types

TypeScript type definitions for Roo Code.

## Installation

```bash
npm install roo-code-types
```

or

```bash
yarn add roo-code-types
```

## Usage

Import the types in your TypeScript files:

```typescript
import {
	RooCodeAPI,
	RooCodeSettings,
	GlobalSettings,
	ProviderSettings,
	ClineMessage,
	TokenUsage,
	RooCodeEventName,
	RooCodeEvents,
} from "roo-code-types"

// Use the types in your code
const settings: RooCodeSettings = {
	// Your settings here
}

// Example: Type an event handler
function handleMessage(event: RooCodeEvents["message"][0]) {
	console.log(event.message.text)
}
```

## Available Types

- `GlobalSettings`: Global configuration settings for Roo Code
- `ProviderSettings`: Provider-specific settings
- `ProviderSettingsEntry`: Entry for a provider configuration
- `ClineMessage`: Message structure for Cline interactions
- `TokenUsage`: Structure for token usage information
- `RooCodeEvents`: Event types for the Roo Code API
- `RooCodeEventName`: Enum of event names
- `RooCodeSettings`: Combined global and provider settings
- `RooCodeAPI`: Interface for the Roo Code API

## License

MIT
