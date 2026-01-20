import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "vercel-ai-gateway"

const MODELS: Record<string, ModelInfo> = {}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
modelRegistry.setDefaultModel(PROVIDER_NAME, "DeepSeek-V3")
