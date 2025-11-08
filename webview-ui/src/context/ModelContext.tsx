import { EmptyRequest } from "@shared/proto/cline/common"
import type { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useReducer } from "react"
import { type ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../../src/shared/api"
import { ModelsServiceClient } from "../services/grpc-client"

export enum ModelRefreshProvider {
	OpenRouter = "openRouter",
	Cline = "cline",
	VercelAIGateway = "vercel-ai-gateway",
}

type ProviderModelContext = {
	[key in ModelRefreshProvider]: Record<string, ModelInfo>
}

interface ModelContextType {
	refreshModels: (provider: ModelRefreshProvider) => void
	models: ProviderModelContext
}

interface ModelContextAction {
	provider: ModelRefreshProvider
	models: Record<string, ModelInfo>
}

// in case the extension sent a model list without the default model
const DefaultModel = { [openRouterDefaultModelId]: openRouterDefaultModelInfo }

export const ModelContext = createContext<ModelContextType | undefined>(undefined)

export const ModelContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	// Use reducer state to manage models by provider with action
	const [cachedModels, dispatch] = useReducer(
		(state: ProviderModelContext, action: ModelContextAction) => {
			console.log(`Updating models for provider: ${action.provider}`, action.models)
			return {
				...state,
				[action.provider]: action.models,
			}
		},
		{
			// in case the extension sent a model list without the default model
			[ModelRefreshProvider.OpenRouter]: DefaultModel,
			[ModelRefreshProvider.Cline]: DefaultModel,
			[ModelRefreshProvider.VercelAIGateway]: DefaultModel,
		},
	)

	const refreshModels = useCallback((provider: ModelRefreshProvider = ModelRefreshProvider.OpenRouter) => {
		let refreshPromise: Promise<OpenRouterCompatibleModelInfo>

		if (provider === ModelRefreshProvider.OpenRouter) {
			refreshPromise = ModelsServiceClient.refreshOpenRouterModelsRpc(EmptyRequest.create({}))
		} else if (provider === ModelRefreshProvider.VercelAIGateway) {
			refreshPromise = ModelsServiceClient.refreshVercelAiGatewayModelsRpc(EmptyRequest.create({}))
		} else {
			refreshPromise = ModelsServiceClient.refreshClineModelsRpc(EmptyRequest.create({}))
		}

		refreshPromise
			.then((response: OpenRouterCompatibleModelInfo) => {
				dispatch({
					provider,
					models: {
						...DefaultModel,
						...fromProtobufModels(response.models),
					},
				})
			})
			.catch((error: Error) => console.error(`Failed to refresh ${provider} models:`, error))
	}, [])

	// Handle auth status update events
	useEffect(() => {
		const cancelSubscription = ModelsServiceClient.subscribeToOpenRouterModels(
			{},
			{
				onResponse: (response: OpenRouterCompatibleModelInfo) => {
					dispatch({
						provider: ModelRefreshProvider.OpenRouter,
						models: {
							[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
							...fromProtobufModels(response.models),
						},
					})
				},
				onError: (error) => {
					console.error("Error in OpenRouter models subscription:", error)
				},
				onComplete: () => {
					console.log("OpenRouter models subscription completed")
				},
			},
		)
		// Cleanup function to cancel subscription when component unmounts
		return () => {
			cancelSubscription()
		}
	}, [])

	return <ModelContext.Provider value={{ models: cachedModels, refreshModels }}>{children}</ModelContext.Provider>
}

export const useModelContext = () => {
	const context = useContext(ModelContext)
	if (context === undefined) {
		throw new Error("useModelContext must be used within a ModelContextProvider")
	}
	return context
}
