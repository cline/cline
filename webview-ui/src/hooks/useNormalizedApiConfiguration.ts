import type { ModelInfo } from "@shared/api"
import { isMigratedSdkProvider } from "@shared/model-catalog/provider-helpers"
import { ResolveModelInfoRequest } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { useEffect, useMemo, useState } from "react"
import {
	getModeSpecificFields,
	type NormalizedApiConfig,
	normalizeApiConfiguration,
} from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

const unknownModelInfo: ModelInfo = {
	supportsPromptCache: false,
}

function getActiveProviderAndModelId(apiConfiguration: ReturnType<typeof useExtensionState>["apiConfiguration"], mode: Mode) {
	const provider =
		(mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) || "anthropic"
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const providerSpecificModelIds: Partial<Record<string, string | undefined>> = {
		cline: modeFields.clineModelId,
		deepseek: modeFields.apiModelId,
		openai: modeFields.openAiModelId,
		openrouter: modeFields.openRouterModelId,
		requesty: modeFields.requestyModelId,
		litellm: modeFields.liteLlmModelId,
		"vercel-ai-gateway": modeFields.vercelAiGatewayModelId,
		groq: modeFields.groqModelId,
		baseten: modeFields.basetenModelId,
		huggingface: modeFields.huggingFaceModelId,
		hicap: modeFields.hicapModelId,
		aihubmix: modeFields.aihubmixModelId,
		nousResearch: modeFields.nousResearchModelId,
		oca: modeFields.ocaModelId,
		"huawei-cloud-maas": modeFields.huaweiCloudMaasModelId,
		together: modeFields.togetherModelId,
	}

	return {
		provider,
		modelId: Object.hasOwn(providerSpecificModelIds, provider) ? providerSpecificModelIds[provider] : modeFields.apiModelId,
	}
}

export function useNormalizedApiConfiguration(mode: Mode): NormalizedApiConfig {
	const { apiConfiguration } = useExtensionState()
	const { provider, modelId } = getActiveProviderAndModelId(apiConfiguration, mode)
	const isMigrated = isMigratedSdkProvider(provider)
	const [resolvedInfo, setResolvedInfo] = useState<
		Awaited<ReturnType<typeof ModelsServiceClient.resolveModelInfo>> | undefined
	>(undefined)

	useEffect(() => {
		setResolvedInfo(undefined)
		if (!isMigrated) {
			return
		}

		let cancelled = false
		void ModelsServiceClient.resolveModelInfo(
			ResolveModelInfoRequest.create({ providerId: provider, modelId: modelId || undefined }),
		).then((response) => {
			if (!cancelled) {
				setResolvedInfo(response)
			}
		})

		return () => {
			cancelled = true
		}
	}, [isMigrated, provider, modelId])

	return useMemo(() => {
		if (!isMigrated) {
			return normalizeApiConfiguration(apiConfiguration, mode)
		}

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
	}, [apiConfiguration, mode, isMigrated, provider, modelId, resolvedInfo])
}
