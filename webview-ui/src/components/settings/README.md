# API Options Component Architecture

This directory contains the refactored API Options components for the Cline extension. The refactoring aims to improve maintainability, code organization, and reduce complexity by separating provider-specific code into modular components.

## Directory Structure

```
settings/
├── ApiOptions.tsx               # Main component that renders provider-specific components
├── common/                      # Reusable UI components
│   ├── ApiKeyField.tsx         # API key input with standard styling
│   ├── BaseUrlField.tsx        # Base URL input with standard styling
│   ├── ErrorMessage.tsx        # Standard error message display
│   ├── ModelInfoView.tsx       # Model information display
│   └── ModelSelector.tsx       # Model selection dropdown
├── providers/                   # Provider-specific components
│   ├── ClineProvider.tsx       # Cline configuration
│   ├── AnthropicProvider.tsx   # Anthropic-specific configuration
│   ├── BedrockProvider.tsx     # AWS Bedrock configuration
│   ├── GeminiProvider.tsx      # Google Gemini configuration
│   ├── MistralProvider.tsx     # Mistral configuration
│   ├── OllamaProvider.tsx      # Ollama configuration
│   ├── OpenAICompatibleProvider.tsx  # OpenAI compatible API configuration
│   ├── OpenRouterProvider.tsx  # OpenRouter configuration
│   └── ...
└── utils/                       # Utility functions
    ├── pricingUtils.ts         # Pricing formatting utilities
    └── providerUtils.ts        # API configuration normalization

```

## Architecture

### Component Hierarchy

```
ApiOptions
└── [ProviderComponent] (based on selected provider)
    ├── ApiKeyField (if needed)
    ├── BaseUrlField (if needed)
    ├── ModelSelector (if showing model options)
    └── ModelInfoView (if showing model options)
```

### Data Flow

1. `ApiOptions` receives the current API configuration from the extension state
2. When a provider is selected, it renders the corresponding provider component
3. Provider-specific components receive `apiConfiguration` and `handleInputChange` to manage their state
4. Changes are propagated back to the extension via the `handleInputChange` callback

## Adding a New Provider

To add a new provider:

1. Create a new file in the `providers` directory, e.g. `MyNewProvider.tsx`
2. Implement the provider component using this template:

```tsx
import { ApiConfiguration, myNewProviderModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the MyNewProvider component
 */
interface MyNewProviderProps {
  apiConfiguration: ApiConfiguration
  handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
  showModelOptions: boolean
  isPopup?: boolean
}

/**
 * The MyNewProvider configuration component
 */
export const MyNewProvider = ({
  apiConfiguration,
  handleInputChange,
  showModelOptions,
  isPopup,
}: MyNewProviderProps) => {
  // Get the normalized configuration
  const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

  return (
    <div>
      {/* Add provider-specific fields */}
      <ApiKeyField
        value={apiConfiguration?.myNewProviderApiKey || ""}
        onChange={handleInputChange("myNewProviderApiKey")}
        providerName="My New Provider"
        signupUrl="https://mynewprovider.com/signup"
      />

      {/* Optional: Base URL field if the provider supports custom endpoints */}
      <BaseUrlField
        value={apiConfiguration?.myNewProviderBaseUrl}
        onChange={handleInputChange("myNewProviderBaseUrl")}
        defaultPlaceholder="https://api.mynewprovider.com"
      />

      {showModelOptions && (
        <>
          <ModelSelector
            models={myNewProviderModels}
            selectedModelId={selectedModelId}
            onChange={handleInputChange("apiModelId")}
            label="Model"
          />

          <ModelInfoView
            selectedModelId={selectedModelId}
            modelInfo={selectedModelInfo}
            isPopup={isPopup}
          />
        </>
      )}
    </div>
  )
}
```

3. Import and add the new provider component to `ApiOptions.tsx`:

```tsx
import { MyNewProvider } from "./providers/MyNewProvider"

// ...

{apiConfiguration && selectedProvider === "mynewprovider" && (
  <MyNewProvider
    apiConfiguration={apiConfiguration}
    handleInputChange={handleInputChange}
    showModelOptions={showModelOptions}
    isPopup={isPopup}
  />
)}
```

4. Add the provider to the dropdown options:

```tsx
<VSCodeOption value="mynewprovider">My New Provider</VSCodeOption>
```

## Best Practices

1. **Reuse Common Components**: Use the common components for consistent UI and behavior
2. **Provider-Specific Logic**: Keep provider-specific logic within the provider component
3. **Type Safety**: Ensure all props and state are properly typed
4. **Error Handling**: Handle edge cases gracefully, such as missing configurations
5. **Documentation**: Document any provider-specific behaviors or requirements

## Testing

Each provider component should be tested in isolation to ensure it renders correctly and handles user input properly.
