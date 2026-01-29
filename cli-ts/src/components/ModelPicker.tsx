/**
 * Model picker component for model selection
 * Supports static model lists and async loading for OpenRouter
 */

import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import React, { useEffect, useMemo, useState } from "react"
import {
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	groqDefaultModelId,
	groqModels,
	mistralDefaultModelId,
	mistralModels,
	openAiCodexDefaultModelId,
	openAiCodexModels,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	xaiDefaultModelId,
	xaiModels,
} from "@/shared/api"
import { COLORS } from "../constants/colors"
import { fetchOpenRouterModels, getOpenRouterDefaultModelId, usesOpenRouterModels } from "../utils/openrouter-models"
import { SearchableList, SearchableListItem } from "./SearchableList"

// Map providers to their static model lists and defaults
export const providerModels: Record<string, { models: Record<string, unknown>; defaultId: string }> = {
	anthropic: { models: anthropicModels, defaultId: anthropicDefaultModelId },
	"openai-native": { models: openAiNativeModels, defaultId: openAiNativeDefaultModelId },
	"openai-codex": { models: openAiCodexModels, defaultId: openAiCodexDefaultModelId },
	gemini: { models: geminiModels, defaultId: geminiDefaultModelId },
	bedrock: { models: bedrockModels, defaultId: bedrockDefaultModelId },
	deepseek: { models: deepSeekModels, defaultId: deepSeekDefaultModelId },
	mistral: { models: mistralModels, defaultId: mistralDefaultModelId },
	groq: { models: groqModels, defaultId: groqDefaultModelId },
	xai: { models: xaiModels, defaultId: xaiDefaultModelId },
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
	onChange: (modelId: string) => void
	onSubmit: (modelId: string) => void
	isActive?: boolean
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ provider, onChange, onSubmit, isActive = true }) => {
	const [isLoading, setIsLoading] = useState(false)
	const [asyncModels, setAsyncModels] = useState<string[]>([])

	// Fetch OpenRouter models when needed
	useEffect(() => {
		if (usesOpenRouterModels(provider)) {
			setIsLoading(true)
			fetchOpenRouterModels()
				.then((models) => {
					setAsyncModels(models)
				})
				.finally(() => {
					setIsLoading(false)
				})
		}
	}, [provider])

	const modelList = useMemo(() => {
		if (usesOpenRouterModels(provider)) {
			return asyncModels
		}
		return getModelList(provider)
	}, [provider, asyncModels])

	const items: SearchableListItem[] = useMemo(() => {
		return modelList.map((modelId) => ({
			id: modelId,
			label: modelId,
		}))
	}, [modelList])

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
				onSubmit(item.id)
			}}
		/>
	)
}
