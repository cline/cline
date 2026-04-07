import type { ApiProviderInfo } from "@/core/api"

export const mockProviderInfo: ApiProviderInfo = {
	providerId: "test",
	model: { id: "fast", info: { supportsPromptCache: false } },
	mode: "act",
}
