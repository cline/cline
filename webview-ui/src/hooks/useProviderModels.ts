import { ResolveProviderModelsRequest } from "@shared/proto/cline/models"
import { useCallback, useEffect } from "react"
import { type ProviderId, useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

function createRequestId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `provider-models-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Read-only provider model-list hook backed by the unified provider catalog RPC.
 *
 * This hook never writes model selection state; selection commits are owned by
 * useProviderConfig/commitModelSelection in later phases.
 */
export function useProviderModels(providerId: ProviderId) {
	const { providerModelsByProvider, startProviderModelsRequest, applyProviderModelsResponse } = useExtensionState()
	const state = providerModelsByProvider[providerId]

	const refresh = useCallback(async () => {
		const requestId = createRequestId()
		startProviderModelsRequest(providerId, requestId)
		try {
			const response = await ModelsServiceClient.resolveProviderModels(
				ResolveProviderModelsRequest.create({ providerId, forceRefresh: true, requestId }),
			)
			applyProviderModelsResponse(response)
		} catch (error) {
			applyProviderModelsResponse({
				providerId,
				requestId,
				configFingerprint: "",
				fetchedAt: Date.now(),
				ok: false,
				models: {},
				error: {
					kind: "unknown",
					message: error instanceof Error ? error.message : String(error),
				},
			})
		}
	}, [applyProviderModelsResponse, providerId, startProviderModelsRequest])

	useEffect(() => {
		void refresh()
	}, [refresh])

	return {
		models: state?.models ?? {},
		defaultModelId: state?.defaultModelId ?? "",
		isLoading: state?.isLoading ?? false,
		isStale: state?.isStale ?? false,
		error: state?.error,
		refresh,
		fingerprint: state?.configFingerprint ?? "",
	}
}
