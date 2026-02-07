/**
 * Model picker component for model selection
 * Supports static model lists and async loading for OpenRouter and SAP AI Core
 */

import { Box, Text } from "ink"
import Spinner from "ink-spinner"
// biome-ignore lint/correctness/noUnusedImports: React is required for JSX transformation (tsconfig jsx: react)
// biome-ignore lint/style/useImportType: React must be imported as a value for JSX transformation
import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { refreshOpenRouterModels } from "@/core/controller/models/refreshOpenRouterModels"
import { StateManager } from "@/core/storage/StateManager"
import {
	type ApiProvider,
	anthropicDefaultModelId,
	anthropicModels,
	askSageDefaultModelId,
	askSageModels,
	basetenDefaultModelId,
	basetenModels,
	bedrockDefaultModelId,
	bedrockModels,
	cerebrasDefaultModelId,
	cerebrasModels,
	claudeCodeDefaultModelId,
	claudeCodeModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	doubaoDefaultModelId,
	doubaoModels,
	fireworksDefaultModelId,
	fireworksModels,
	geminiDefaultModelId,
	geminiModels,
	groqDefaultModelId,
	groqModels,
	huaweiCloudMaasDefaultModelId,
	huaweiCloudMaasModels,
	huggingFaceDefaultModelId,
	huggingFaceModels,
	internationalQwenDefaultModelId,
	internationalQwenModels,
	internationalZAiDefaultModelId,
	internationalZAiModels,
	minimaxDefaultModelId,
	minimaxModels,
	mistralDefaultModelId,
	mistralModels,
	moonshotDefaultModelId,
	moonshotModels,
	nebiusDefaultModelId,
	nebiusModels,
	nousResearchDefaultModelId,
	nousResearchModels,
	openAiCodexDefaultModelId,
	openAiCodexModels,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	qwenCodeDefaultModelId,
	qwenCodeModels,
	sambanovaDefaultModelId,
	sambanovaModels,
	sapAiCoreDefaultModelId,
	sapAiCoreModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
} from "@/shared/api"
import { filterOpenRouterModelIds } from "@/shared/utils/model-filters"
import { COLORS } from "../constants/colors"
import { getOpenRouterDefaultModelId, usesOpenRouterModels } from "../utils/openrouter-models"
import { getSapAiCoreModels, type SapAiCoreCredentials, type SapAiCoreModelItem } from "../utils/sapaicore-models"
import { SearchableList, type SearchableListItem } from "./SearchableList"

// Map providers to their static model lists and defaults
export const providerModels: Record<string, { models: Record<string, unknown>; defaultId: string }> = {
	anthropic: { models: anthropicModels, defaultId: anthropicDefaultModelId },
	asksage: { models: askSageModels, defaultId: askSageDefaultModelId },
	baseten: { models: basetenModels, defaultId: basetenDefaultModelId },
	bedrock: { models: bedrockModels, defaultId: bedrockDefaultModelId },
	cerebras: { models: cerebrasModels, defaultId: cerebrasDefaultModelId },
	"claude-code": { models: claudeCodeModels, defaultId: claudeCodeDefaultModelId },
	deepseek: { models: deepSeekModels, defaultId: deepSeekDefaultModelId },
	doubao: { models: doubaoModels, defaultId: doubaoDefaultModelId },
	fireworks: { models: fireworksModels, defaultId: fireworksDefaultModelId },
	gemini: { models: geminiModels, defaultId: geminiDefaultModelId },
	groq: { models: groqModels, defaultId: groqDefaultModelId },
	"huawei-cloud-maas": { models: huaweiCloudMaasModels, defaultId: huaweiCloudMaasDefaultModelId },
	huggingface: { models: huggingFaceModels, defaultId: huggingFaceDefaultModelId },
	minimax: { models: minimaxModels, defaultId: minimaxDefaultModelId },
	mistral: { models: mistralModels, defaultId: mistralDefaultModelId },
	moonshot: { models: moonshotModels, defaultId: moonshotDefaultModelId },
	nebius: { models: nebiusModels, defaultId: nebiusDefaultModelId },
	nousResearch: { models: nousResearchModels, defaultId: nousResearchDefaultModelId },
	"openai-codex": { models: openAiCodexModels, defaultId: openAiCodexDefaultModelId },
	"openai-native": { models: openAiNativeModels, defaultId: openAiNativeDefaultModelId },
	qwen: { models: internationalQwenModels, defaultId: internationalQwenDefaultModelId },
	"qwen-code": { models: qwenCodeModels, defaultId: qwenCodeDefaultModelId },
	sambanova: { models: sambanovaModels, defaultId: sambanovaDefaultModelId },
	sapaicore: { models: sapAiCoreModels, defaultId: sapAiCoreDefaultModelId },
	vertex: { models: vertexModels, defaultId: vertexDefaultModelId },
	xai: { models: xaiModels, defaultId: xaiDefaultModelId },
	zai: { models: internationalZAiModels, defaultId: internationalZAiDefaultModelId },
}

export function hasStaticModels(provider: string): boolean {
	return provider in providerModels
}

export function hasModelPicker(provider: string): boolean {
	return hasStaticModels(provider) || usesOpenRouterModels(provider)
}

export function getDefaultModelId(provider: string): string {
	if (usesOpenRouterModels(provider)) {
		return getOpenRouterDefaultModelId()
	}
	return providerModels[provider]?.defaultId || ""
}

export function getModelList(provider: string): string[] {
	if (!hasStaticModels(provider)) return []
	return Object.keys(providerModels[provider].models)
}

interface ModelPickerProps {
	provider: string
	controller: any
	onChange: (modelId: string) => void
	onSubmit: (modelId: string, deploymentId?: string) => void
	isActive?: boolean
	/** SAP AI Core credentials for direct deployment mode */
	sapAiCoreCredentials?: SapAiCoreCredentials
	/** Whether SAP AI Core is using orchestration mode */
	sapAiCoreUseOrchestrationMode?: boolean
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
	provider,
	controller,
	onChange,
	onSubmit,
	isActive = true,
	sapAiCoreCredentials,
	sapAiCoreUseOrchestrationMode,
}) => {
	const [isLoading, setIsLoading] = useState(false)
	const [asyncModels, setAsyncModels] = useState<string[]>([])
	const [sapAiCoreModelItems, setSapAiCoreModelItems] = useState<SapAiCoreModelItem[]>([])
	const [sapAiCoreError, setSapAiCoreError] = useState<string | null>(null)

	// Fetch OpenRouter models when needed using shared core function
	useEffect(() => {
		if (usesOpenRouterModels(provider)) {
			setIsLoading(true)
			refreshOpenRouterModels(controller)
				.then((models) => {
					const modelIds = Object.keys(models).sort((a, b) => a.localeCompare(b))
					const filtered = filterOpenRouterModelIds(modelIds, provider as ApiProvider)
					setAsyncModels(filtered)
				})
				.finally(() => {
					setIsLoading(false)
				})
		}
	}, [provider, controller])

	// Fetch SAP AI Core models when needed
	// Reference commits: d7b3a5253, c1e3ac860, ea8a7fd7d, f7fe2b854
	useEffect(() => {
		if (provider === "sapaicore") {
			setIsLoading(true)
			setSapAiCoreError(null)

			// Determine orchestration mode: use prop if provided, otherwise check state
			const useOrchestrationMode =
				sapAiCoreUseOrchestrationMode !== undefined
					? sapAiCoreUseOrchestrationMode
					: StateManager.get().getApiConfiguration().sapAiCoreUseOrchestrationMode !== false

			// Get credentials: use props if provided, otherwise try to get from state
			let credentials: SapAiCoreCredentials | null = sapAiCoreCredentials || null
			if (!credentials && !useOrchestrationMode) {
				// Try to get credentials from state for direct deployment mode
				const config = StateManager.get().getApiConfiguration()
				if (
					config.sapAiCoreClientId &&
					config.sapAiCoreClientSecret &&
					config.sapAiCoreBaseUrl &&
					config.sapAiCoreTokenUrl
				) {
					credentials = {
						clientId: config.sapAiCoreClientId,
						clientSecret: config.sapAiCoreClientSecret,
						baseUrl: config.sapAiCoreBaseUrl,
						tokenUrl: config.sapAiCoreTokenUrl,
						resourceGroup: config.sapAiResourceGroup,
					}
				}
			}

			getSapAiCoreModels(credentials, useOrchestrationMode)
				.then((result) => {
					setSapAiCoreModelItems(result.models)
					setSapAiCoreError(result.error)
				})
				.finally(() => {
					setIsLoading(false)
				})
		}
	}, [provider, sapAiCoreCredentials, sapAiCoreUseOrchestrationMode])

	const modelList = useMemo(() => {
		if (usesOpenRouterModels(provider)) {
			return asyncModels
		}
		if (provider === "sapaicore") {
			// For SAP AI Core, we use sapAiCoreModelItems which have richer info
			return sapAiCoreModelItems.map((m) => m.id)
		}
		return getModelList(provider)
	}, [provider, asyncModels, sapAiCoreModelItems])

	const items: SearchableListItem[] = useMemo(() => {
		// For SAP AI Core, use the enhanced model items with deployment info
		if (provider === "sapaicore" && sapAiCoreModelItems.length > 0) {
			// Group by section for visual separation
			const deployedItems = sapAiCoreModelItems.filter((m) => m.section === "deployed")
			const availableItems = sapAiCoreModelItems.filter((m) => m.section === "available")

			const result: SearchableListItem[] = []

			// Add deployed models section header if there are any
			if (deployedItems.length > 0 && availableItems.length > 0) {
				// Only show section headers if we have both sections
				result.push({
					id: "__section_deployed__",
					label: "--- Deployed Models ---",
					isDisabled: true,
				})
			}

			// Add deployed models
			for (const item of deployedItems) {
				result.push({
					id: item.id,
					label: item.label,
					data: { deploymentId: item.deploymentId },
				})
			}

			// Add available models section header if there are any
			if (availableItems.length > 0 && deployedItems.length > 0) {
				result.push({
					id: "__section_available__",
					label: "--- Available Models (not deployed) ---",
					isDisabled: true,
				})
			}

			// Add available models
			for (const item of availableItems) {
				result.push({
					id: item.id,
					label: item.label,
				})
			}

			return result
		}

		return modelList.map((modelId) => ({
			id: modelId,
			label: modelId,
		}))
	}, [modelList, provider, sapAiCoreModelItems])

	// For providers without a model picker, render nothing
	if (!hasModelPicker(provider)) {
		return null
	}

	// Show loading state for async providers
	if (isLoading) {
		return (
			<Box>
				<Text color={COLORS.primaryBlue}>
					<Spinner type="dots" />
				</Text>
				<Text color="gray"> Loading models...</Text>
			</Box>
		)
	}

	// Show error for SAP AI Core if deployment fetching failed
	// Reference: commit e7edd2f7c
	if (provider === "sapaicore" && sapAiCoreError) {
		return (
			<Box flexDirection="column">
				<Box>
					<Text color="yellow">⚠ {sapAiCoreError}</Text>
				</Box>
				<Text color="gray">Showing available models (deployment status unknown)</Text>
				<Text> </Text>
				<SearchableList
					isActive={isActive}
					items={items}
					onSelect={(item) => {
						onChange(item.id)
						onSubmit(item.id, item.data?.deploymentId as string | undefined)
					}}
				/>
			</Box>
		)
	}

	// If async fetch returned no models, render nothing
	if (usesOpenRouterModels(provider) && modelList.length === 0) {
		return null
	}

	return (
		<SearchableList
			isActive={isActive}
			items={items}
			onSelect={(item) => {
				onChange(item.id)
				onSubmit(item.id, item.data?.deploymentId as string | undefined)
			}}
		/>
	)
}
