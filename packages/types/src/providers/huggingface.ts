/**
 * HuggingFace provider constants
 */

// Default values for HuggingFace models
export const HUGGINGFACE_DEFAULT_MAX_TOKENS = 2048
export const HUGGINGFACE_MAX_TOKENS_FALLBACK = 8192
export const HUGGINGFACE_DEFAULT_CONTEXT_WINDOW = 128_000

// UI constants
export const HUGGINGFACE_SLIDER_STEP = 256
export const HUGGINGFACE_SLIDER_MIN = 1
export const HUGGINGFACE_TEMPERATURE_MAX_VALUE = 2

// API constants
export const HUGGINGFACE_API_URL = "https://router.huggingface.co/v1/models?collection=roocode"
export const HUGGINGFACE_CACHE_DURATION = 1000 * 60 * 60 // 1 hour
