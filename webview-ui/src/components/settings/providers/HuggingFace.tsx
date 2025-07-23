import { useCallback, useState, useEffect, useMemo } from "react"
import { useEvent } from "react-use"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { ExtensionMessage } from "@roo/ExtensionMessage"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { SearchableSelect, type SearchableSelectOption } from "@src/components/ui"

import { inputEventTransform } from "../transforms"

type HuggingFaceModel = {
	_id: string
	id: string
	inferenceProviderMapping: Array<{
		provider: string
		providerId: string
		status: "live" | "staging" | "error"
		task: "conversational"
	}>
	trendingScore: number
	config: {
		architectures: string[]
		model_type: string
		tokenizer_config?: {
			chat_template?: string | Array<{ name: string; template: string }>
			model_max_length?: number
		}
	}
	tags: string[]
	pipeline_tag: "text-generation" | "image-text-to-text"
	library_name?: string
}

type HuggingFaceProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const HuggingFace = ({ apiConfiguration, setApiConfigurationField }: HuggingFaceProps) => {
	const { t } = useAppTranslation()
	const [models, setModels] = useState<HuggingFaceModel[]>([])
	const [loading, setLoading] = useState(false)
	const [selectedProvider, setSelectedProvider] = useState<string>(
		apiConfiguration?.huggingFaceInferenceProvider || "auto",
	)

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	// Fetch models when component mounts
	useEffect(() => {
		setLoading(true)
		vscode.postMessage({ type: "requestHuggingFaceModels" })
	}, [])

	// Handle messages from extension
	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "huggingFaceModels":
				setModels(message.huggingFaceModels || [])
				setLoading(false)
				break
		}
	}, [])

	useEvent("message", onMessage)

	// Get current model and its providers
	const currentModel = models.find((m) => m.id === apiConfiguration?.huggingFaceModelId)
	const availableProviders = useMemo(
		() => currentModel?.inferenceProviderMapping || [],
		[currentModel?.inferenceProviderMapping],
	)

	// Set default provider when model changes
	useEffect(() => {
		if (currentModel && availableProviders.length > 0) {
			const savedProvider = apiConfiguration?.huggingFaceInferenceProvider
			if (savedProvider) {
				// Use saved provider if it exists
				setSelectedProvider(savedProvider)
			} else {
				const currentProvider = availableProviders.find((p) => p.provider === selectedProvider)
				if (!currentProvider) {
					// Set to "auto" as default
					const defaultProvider = "auto"
					setSelectedProvider(defaultProvider)
					setApiConfigurationField("huggingFaceInferenceProvider", defaultProvider)
				}
			}
		}
	}, [
		currentModel,
		availableProviders,
		selectedProvider,
		apiConfiguration?.huggingFaceInferenceProvider,
		setApiConfigurationField,
	])

	const handleModelSelect = (modelId: string) => {
		setApiConfigurationField("huggingFaceModelId", modelId)
		// Reset provider selection when model changes
		const defaultProvider = "auto"
		setSelectedProvider(defaultProvider)
		setApiConfigurationField("huggingFaceInferenceProvider", defaultProvider)
	}

	const handleProviderSelect = (provider: string) => {
		setSelectedProvider(provider)
		setApiConfigurationField("huggingFaceInferenceProvider", provider)
	}

	// Format provider name for display
	const formatProviderName = (provider: string) => {
		const nameMap: Record<string, string> = {
			sambanova: "SambaNova",
			"fireworks-ai": "Fireworks",
			together: "Together AI",
			nebius: "Nebius AI Studio",
			hyperbolic: "Hyperbolic",
			novita: "Novita",
			cohere: "Cohere",
			"hf-inference": "HF Inference API",
			replicate: "Replicate",
		}
		return nameMap[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
	}

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.huggingFaceApiKey || ""}
				type="password"
				onInput={handleInputChange("huggingFaceApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.huggingFaceApiKey")}</label>
			</VSCodeTextField>

			<div className="flex flex-col gap-2">
				<label className="block font-medium text-sm">
					{t("settings:providers.huggingFaceModelId")}
					{loading && (
						<span className="text-xs text-gray-400 ml-2">{t("settings:providers.huggingFaceLoading")}</span>
					)}
					{!loading && (
						<span className="text-xs text-gray-400 ml-2">
							{t("settings:providers.huggingFaceModelsCount", { count: models.length })}
						</span>
					)}
				</label>

				<SearchableSelect
					value={apiConfiguration?.huggingFaceModelId || ""}
					onValueChange={handleModelSelect}
					options={models.map(
						(model): SearchableSelectOption => ({
							value: model.id,
							label: model.id,
						}),
					)}
					placeholder={t("settings:providers.huggingFaceSelectModel")}
					searchPlaceholder={t("settings:providers.huggingFaceSearchModels")}
					emptyMessage={t("settings:providers.huggingFaceNoModelsFound")}
					disabled={loading}
				/>
			</div>

			{currentModel && availableProviders.length > 0 && (
				<div className="flex flex-col gap-2">
					<label className="block font-medium text-sm">{t("settings:providers.huggingFaceProvider")}</label>
					<SearchableSelect
						value={selectedProvider}
						onValueChange={handleProviderSelect}
						options={[
							{ value: "auto", label: t("settings:providers.huggingFaceProviderAuto") },
							...availableProviders.map(
								(mapping): SearchableSelectOption => ({
									value: mapping.provider,
									label: `${formatProviderName(mapping.provider)} (${mapping.status})`,
								}),
							),
						]}
						placeholder={t("settings:providers.huggingFaceSelectProvider")}
						searchPlaceholder={t("settings:providers.huggingFaceSearchProviders")}
						emptyMessage={t("settings:providers.huggingFaceNoProvidersFound")}
					/>
				</div>
			)}

			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			{!apiConfiguration?.huggingFaceApiKey && (
				<VSCodeButtonLink href="https://huggingface.co/settings/tokens" appearance="secondary">
					{t("settings:providers.getHuggingFaceApiKey")}
				</VSCodeButtonLink>
			)}
		</>
	)
}
