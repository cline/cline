// Export all variant configurations for easy importing
export { config as genericConfig } from "./generic/config"
export { config as gptConfig } from "./gpt/config"
export { config as nextGenConfig } from "./next-gen/config"

// Variant registry for dynamic loading
export const VARIANT_CONFIGS = {
	generic: () => import("./generic/config").then((m) => m.config),
	gpt: () => import("./gpt/config").then((m) => m.config),
	"next-gen": () => import("./next-gen/config").then((m) => m.config),
} as const

export type VariantId = keyof typeof VARIANT_CONFIGS
