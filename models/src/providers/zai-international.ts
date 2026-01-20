import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "zai-international"

const MODELS: Record<string, ModelInfo> = {}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
