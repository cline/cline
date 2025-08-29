import React, { useState, useEffect } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setOpenRouterImageApiKey: (apiKey: string) => void
	setImageGenerationSelectedModel: (model: string) => void
}

// Hardcoded list of image generation models
const IMAGE_GENERATION_MODELS = [
	{ value: "google/gemini-2.5-flash-image-preview", label: "Gemini 2.5 Flash Image Preview" },
	{ value: "google/gemini-2.5-flash-image-preview:free", label: "Gemini 2.5 Flash Image Preview (Free)" },
	// Add more models as they become available
]

export const ImageGenerationSettings = ({
	enabled,
	onChange,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	const [apiKey, setApiKey] = useState(openRouterImageApiKey || "")
	const [selectedModel, setSelectedModel] = useState(
		openRouterImageGenerationSelectedModel || IMAGE_GENERATION_MODELS[0].value,
	)

	// Update local state when props change (e.g., when switching profiles)
	useEffect(() => {
		setApiKey(openRouterImageApiKey || "")
		setSelectedModel(openRouterImageGenerationSelectedModel || IMAGE_GENERATION_MODELS[0].value)
	}, [openRouterImageApiKey, openRouterImageGenerationSelectedModel])

	// Handle API key changes
	const handleApiKeyChange = (value: string) => {
		setApiKey(value)
		setOpenRouterImageApiKey(value)
	}

	// Handle model selection changes
	const handleModelChange = (value: string) => {
		setSelectedModel(value)
		setImageGenerationSelectedModel(value)
	}

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="ml-2 space-y-3">
					{/* API Key Configuration */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyLabel")}
						</label>
						<VSCodeTextField
							value={apiKey}
							onInput={(e: any) => handleApiKeyChange(e.target.value)}
							placeholder={t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder")}
							className="w-full"
							type="password"
						/>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
							<a
								href="https://openrouter.ai/keys"
								target="_blank"
								rel="noopener noreferrer"
								className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
								openrouter.ai/keys
							</a>
						</p>
					</div>

					{/* Model Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
						</label>
						<VSCodeDropdown
							value={selectedModel}
							onChange={(e: any) => handleModelChange(e.target.value)}
							className="w-full">
							{IMAGE_GENERATION_MODELS.map((model) => (
								<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
									{model.label}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionDescription")}
						</p>
					</div>

					{/* Status Message */}
					{enabled && !apiKey && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingKey")}
						</div>
					)}

					{enabled && apiKey && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
