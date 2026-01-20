// Import all providers to trigger registration
import "./providers/anthropic"
import "./providers/openai"
import "./providers/gemini"

// Export the registry and types for client use
export { ModelRegistry, modelRegistry, type ProviderModels, type RegistryOutput } from "./registry"
export { ApiFormat, type ModelInfo } from "./types"
