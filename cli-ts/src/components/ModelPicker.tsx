/**
 * Reusable model picker component
 * Shows a searchable list for providers with static models, or text input for dynamic providers
 */

import { Box, Text, useInput } from "ink"
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
	openAiNativeDefaultModelId,
	openAiNativeModels,
	xaiDefaultModelId,
	xaiModels,
} from "@/shared/api"
import { useStdinContext } from "../context/StdinContext"
import { useScrollableList } from "../hooks/useScrollableList"
import { fetchOpenRouterModels, getOpenRouterDefaultModelId, usesOpenRouterModels } from "../utils/openrouter-models"

// Map providers to their static model lists and defaults
export const providerModels: Record<string, { models: Record<string, unknown>; defaultId: string }> = {
	anthropic: { models: anthropicModels, defaultId: anthropicDefaultModelId },
	"openai-native": { models: openAiNativeModels, defaultId: openAiNativeDefaultModelId },
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

const TOTAL_ROWS = 8

export const ModelPicker: React.FC<ModelPickerProps> = ({ provider, onChange, onSubmit, isActive = true }) => {
	const { isRawModeSupported } = useStdinContext()
	const [search, setSearch] = useState("")
	const [index, setIndex] = useState(0)
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

	const filteredModels = useMemo(() => {
		if (!search) return modelList
		return modelList.filter((m) => m.toLowerCase().includes(search.toLowerCase()))
	}, [modelList, search])

	// Use shared scrollable list hook for windowing
	const { visibleStart, visibleCount, showTopIndicator, showBottomIndicator } = useScrollableList(
		filteredModels.length,
		index,
		TOTAL_ROWS,
	)

	const visibleModels = useMemo(() => {
		return filteredModels.slice(visibleStart, visibleStart + visibleCount)
	}, [filteredModels, visibleStart, visibleCount])

	// Reset index when search changes
	useEffect(() => {
		setIndex(0)
	}, [search])

	// Reset search when provider changes
	useEffect(() => {
		setSearch("")
		setIndex(0)
	}, [provider])

	useInput(
		(input, key) => {
			if (key.upArrow) {
				setIndex((prev) => (prev > 0 ? prev - 1 : filteredModels.length - 1))
			} else if (key.downArrow) {
				setIndex((prev) => (prev < filteredModels.length - 1 ? prev + 1 : 0))
			} else if (key.return) {
				if (filteredModels[index]) {
					onChange(filteredModels[index])
					onSubmit(filteredModels[index])
				}
			} else if (key.backspace || key.delete) {
				setSearch((prev) => prev.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta && !key.escape) {
				setSearch((prev) => prev + input)
			}
		},
		{ isActive: isRawModeSupported && isActive },
	)

	// For providers without a model picker, render nothing (parent should handle text input)
	if (!hasModelPicker(provider)) {
		return null
	}

	// Show loading state for async providers
	if (isLoading) {
		return (
			<Box>
				<Text color="blueBright">
					<Spinner type="dots" />
				</Text>
				<Text color="gray"> Loading models...</Text>
			</Box>
		)
	}

	// If async fetch returned no models, render nothing (parent should handle text input)
	if (usesOpenRouterModels(provider) && modelList.length === 0) {
		return null
	}

	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">Search: </Text>
				<Text color="white">{search}</Text>
				<Text color="gray">▌</Text>
			</Box>
			<Text> </Text>
			{showTopIndicator && (
				<Text color="gray" dimColor>
					... {visibleStart} more above
				</Text>
			)}
			{visibleModels.map((model, i) => {
				const actualIndex = visibleStart + i
				return (
					<Box key={model}>
						<Text color={actualIndex === index ? "blueBright" : undefined}>
							{actualIndex === index ? "❯ " : "  "}
							{model}
						</Text>
					</Box>
				)
			})}
			{showBottomIndicator && (
				<Text color="gray" dimColor>
					... {filteredModels.length - visibleStart - visibleCount} more below
				</Text>
			)}
			{filteredModels.length === 0 && (
				<Text color="gray" dimColor>
					No models match "{search}"
				</Text>
			)}
		</Box>
	)
}
