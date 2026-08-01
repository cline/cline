import type { ModelInfo } from "@shared/api"

export function resolveProviderModelDisplayName(
	modelId: string,
	models?: Record<string, ModelInfo>,
	fallbackName?: string,
): string {
	const catalogName = models?.[modelId]?.name?.trim()
	const endpointName = fallbackName?.trim()
	const modelIdTail = modelId.split("/").at(-1) ?? modelId
	const displayName = catalogName || (endpointName && endpointName !== modelId ? endpointName : undefined) || modelIdTail

	return displayName
		.replace(/\s*\(free\)\s*$/i, "")
		.replace(/:free$/i, "")
		.trim()
}
