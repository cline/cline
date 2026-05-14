import type { ModelInfo } from "@shared/api"
import { isMigratedSdkProvider } from "@shared/model-catalog/provider-helpers"
import { ResolveModelInfoRequest } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { useEffect, useMemo, useState } from "react"
import { type NormalizedApiConfig, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

const unknownModelInfo: ModelInfo = {
	supportsPromptCache: false,
}

function getActiveProviderAndModelId(apiConfiguration: ReturnType<typeof useExtensionState>["apiConfiguration"], mode: Mode) {
	return {
		provider: (mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) || "anthropic",
		modelId: mode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId,
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
