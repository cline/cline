import { type ApiConfiguration, type ModelInfo, openAiModelInfoSafeDefaults, openRouterDefaultModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { useMemo } from "react"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useProviderUsageCostDisplay } from "./useProviderUsageCostDisplay"

/**
 * Reads the `(modelId, modelInfo)` pair that a dynamic-list provider
 * has committed to its provider-specific slot in `ApiConfiguration`.
 * Dynamic-list providers (openrouter, cline, openai-compatible, ollama,
 * lmstudio, requesty, litellm, hicap, groq, baseten, huggingface,
 * vercel-ai-gateway, aihubmix, oca, huawei-cloud-maas, dify, fireworks,
 * together, vscode-lm) all store the user's commit in their own
 * provider-named field instead of the common `apiModelId` plus a shared
 * catalog. This hook surfaces those fields uniformly so picker
 * components do not need to know which field stores their model id.
 *
 * `hideUsageCost` is sourced from the SDK's
 * `ProviderListing.usage_cost_display` (see `useProviderUsageCostDisplay`)
 * so picker components do not hard-code any per-provider knowledge here.
 *
 * When a provider has not yet been committed (first-time use), the
 * hook falls through to safe defaults so the picker UI renders without
 * undefined-shaped surprises; the real values arrive once the user
 * selects a model from the live picker.
 */
export interface DynamicProviderSelection {
	selectedModelId: string
	selectedModelInfo: ModelInfo
	hideUsageCost: boolean
}

const FALLBACK_INFO_BY_PROVIDER: Partial<Record<string, ModelInfo>> = {
	openrouter: openRouterDefaultModelInfo,
	cline: openRouterDefaultModelInfo,
	"vercel-ai-gateway": openRouterDefaultModelInfo,
}

function readFields(apiConfiguration: ApiConfiguration | undefined, mode: Mode) {
	return getModeSpecificFields(apiConfiguration, mode)
}

export function useDynamicProviderSelection(
	providerId: string,
	apiConfiguration: ApiConfiguration | undefined,
	mode: Mode,
): DynamicProviderSelection {
	const hideUsageCost = useProviderUsageCostDisplay(providerId) === "hide"
	return useMemo(() => {
		const fields = readFields(apiConfiguration, mode)
		const fallbackInfo = FALLBACK_INFO_BY_PROVIDER[providerId] ?? openAiModelInfoSafeDefaults

		const resolve = (id: string | undefined, info: ModelInfo | undefined, defaultId = ""): DynamicProviderSelection => ({
			selectedModelId: id || defaultId,
			selectedModelInfo: info ?? fallbackInfo,
			hideUsageCost,
		})

		switch (providerId) {
			case "openrouter":
				return resolve(fields.openRouterModelId, fields.openRouterModelInfo)
			case "cline":
				return resolve(fields.clineModelId, fields.clineModelInfo)
			case "vercel-ai-gateway":
				return resolve(fields.vercelAiGatewayModelId, fields.vercelAiGatewayModelInfo)
			case "openai":
				return resolve(fields.openAiModelId, fields.openAiModelInfo)
			case "requesty":
				return resolve(fields.requestyModelId, fields.requestyModelInfo)
			case "litellm":
				return resolve(fields.liteLlmModelId, fields.liteLlmModelInfo)
			case "groq":
				return resolve(fields.groqModelId, fields.groqModelInfo)
			case "baseten":
				return resolve(fields.basetenModelId, fields.basetenModelInfo)
			case "huggingface":
				return resolve(fields.huggingFaceModelId, fields.huggingFaceModelInfo)
			case "aihubmix":
				return resolve(fields.aihubmixModelId, fields.aihubmixModelInfo)
			case "oca":
				return resolve(fields.ocaModelId, fields.ocaModelInfo)
			case "huawei-cloud-maas":
				return resolve(fields.huaweiCloudMaasModelId, fields.huaweiCloudMaasModelInfo)
			case "hicap":
				return resolve(fields.hicapModelId, undefined)
			case "ollama":
				return resolve(fields.ollamaModelId, undefined)
			case "lmstudio":
				return resolve(fields.lmStudioModelId, undefined)
			case "atomic-chat":
				return resolve(fields.atomicChatModelId, undefined)
			case "together":
				return resolve(fields.togetherModelId, undefined)
			case "fireworks":
				return resolve(fields.fireworksModelId, undefined)
			case "dify":
				return {
					selectedModelId: "dify-workflow",
					selectedModelInfo: fallbackInfo,
					hideUsageCost,
				}
			case "vscode-lm":
				return {
					selectedModelId: fields.vsCodeLmModelSelector
						? `${fields.vsCodeLmModelSelector.vendor}/${fields.vsCodeLmModelSelector.family}`
						: "",
					selectedModelInfo: fallbackInfo,
					hideUsageCost,
				}
			default:
				return resolve(undefined, undefined)
		}
	}, [providerId, apiConfiguration, mode, hideUsageCost])
}
