import type { ApiProvider, ModelInfo } from "@shared/api"
import { ResolveModelInfoRequest } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { useEffect, useMemo, useState } from "react"
import { getModeSpecificFields, type NormalizedApiConfig } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

/**
 * Neutral placeholder returned while the catalog has not yet produced a
 * concrete `ModelInfo`. Callers that gate behavior on capabilities
 * (TaskHeader cost display, context-window meter, prompt-cache reasoning
 * surfaces) read these defaults as "we don't know yet" — see the field
 * comments at consumers.
 */
const unknownModelInfo: ModelInfo = {
	supportsPromptCache: false,
}

/**
 * Map a provider id to the `ApiConfiguration.{plan,act}Mode<…>ModelId`
 * field that stores its selected model id. For dynamic-list providers
 * (openrouter, openai-compatible, ollama, …) each one maintains its own
 * per-provider field; static-list providers share the common
 * `apiModelId` field.
 *
 * This mapping mirrors the writers in each provider component / picker
 * and the schema documented in `@/shared/storage/state-keys.ts`. When
 * adding a provider that needs its own model-id field, extend the map
 * here and the corresponding writer.
 */
function getActiveProviderAndModelId(apiConfiguration: ReturnType<typeof useExtensionState>["apiConfiguration"], mode: Mode) {
	const provider = ((mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) ||
		"anthropic") as ApiProvider
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const providerSpecificModelIds: Partial<Record<string, string | undefined>> = {
		cline: modeFields.clineModelId,
		deepseek: modeFields.apiModelId,
		openai: modeFields.openAiModelId,
		openrouter: modeFields.openRouterModelId,
		requesty: modeFields.requestyModelId,
		litellm: modeFields.liteLlmModelId,
		"vercel-ai-gateway": modeFields.vercelAiGatewayModelId,
		ollama: modeFields.ollamaModelId,
		lmstudio: modeFields.lmStudioModelId,
		groq: modeFields.groqModelId,
		baseten: modeFields.basetenModelId,
		huggingface: modeFields.huggingFaceModelId,
		hicap: modeFields.hicapModelId,
		aihubmix: modeFields.aihubmixModelId,
		nousResearch: modeFields.nousResearchModelId,
		oca: modeFields.ocaModelId,
		"huawei-cloud-maas": modeFields.huaweiCloudMaasModelId,
		together: modeFields.togetherModelId,
		fireworks: modeFields.fireworksModelId,
		sapaicore: modeFields.sapAiCoreModelId,
		"vscode-lm": modeFields.vsCodeLmModelSelector
			? `${modeFields.vsCodeLmModelSelector.vendor}/${modeFields.vsCodeLmModelSelector.family}`
			: undefined,
	}

	return {
		provider,
		modelId: Object.hasOwn(providerSpecificModelIds, provider) ? providerSpecificModelIds[provider] : modeFields.apiModelId,
	}
}

/**
 * Webview's universal handle on "what model is currently selected, with
 * what capabilities". Sources its answer from the extension over gRPC
 * (`ResolveModelInfo`), which combines the SDK catalog with the user's
 * committed selection.
 *
 * The returned `selectedModelInfo` may be `unknownModelInfo` for a few
 * render frames while the gRPC call is in flight, especially the first
 * time a provider is selected after a config change. UI callers must
 * treat `unknownModelInfo` as "no data yet" — render placeholders, do
 * not assume features are unsupported.
 */
export function useNormalizedApiConfiguration(mode: Mode): NormalizedApiConfig {
	const { apiConfiguration } = useExtensionState()
	const { provider, modelId } = getActiveProviderAndModelId(apiConfiguration, mode)
	const [resolvedInfo, setResolvedInfo] = useState<
		Awaited<ReturnType<typeof ModelsServiceClient.resolveModelInfo>> | undefined
	>(undefined)

	useEffect(() => {
		setResolvedInfo(undefined)
		let cancelled = false
		// The host-side handler awaits the catalog on a cache miss, so a
		// single round-trip yields authoritative data. We do not retry
		// or warm; if the response is `unknown`, the catalog truly has no
		// data and the UI renders a placeholder.
		void ModelsServiceClient.resolveModelInfo(
			ResolveModelInfoRequest.create({ providerId: provider, modelId: modelId || undefined }),
		)
			.then((response) => {
				if (!cancelled) {
					setResolvedInfo(response)
				}
			})
			.catch(() => {
				// The handler does not throw in production paths; a host-side
				// error here is logged at the gRPC layer. Leave resolvedInfo
				// undefined so the hook returns the neutral loading state.
			})
		return () => {
			cancelled = true
		}
	}, [provider, modelId])

	return useMemo(() => {
		if (!resolvedInfo || resolvedInfo.source === "unknown" || !resolvedInfo.modelInfo) {
			return {
				selectedProvider: provider,
				selectedModelId: resolvedInfo?.modelId || modelId || "",
				selectedModelInfo: unknownModelInfo,
			}
		}
		return {
			selectedProvider: provider,
			selectedModelId: resolvedInfo.modelId,
			selectedModelInfo: fromProtobufModelInfo(resolvedInfo.modelInfo),
		}
	}, [provider, modelId, resolvedInfo])
}
