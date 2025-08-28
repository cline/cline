import React, { useState, useEffect } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import type { ProviderSettings } from "@roo-code/types"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
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
	apiConfiguration,
	setApiConfigurationField,
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	// Get image generation settings from apiConfiguration
	const imageGenerationSettings = apiConfiguration?.openRouterImageGenerationSettings || {}
	const [openRouterApiKey, setOpenRouterApiKey] = useState(imageGenerationSettings.openRouterApiKey || "")
	const [selectedModel, setSelectedModel] = useState(
		imageGenerationSettings.selectedModel || IMAGE_GENERATION_MODELS[0].value,
	)

	// Update parent state when local state changes
	useEffect(() => {
		const newSettings = {
			openRouterApiKey,
			selectedModel,
		}
		setApiConfigurationField("openRouterImageGenerationSettings", newSettings)
	}, [openRouterApiKey, selectedModel, setApiConfigurationField])

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
							value={openRouterApiKey}
							onInput={(e: any) => setOpenRouterApiKey(e.target.value)}
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
							onChange={(e: any) => setSelectedModel(e.target.value)}
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
					{enabled && !openRouterApiKey && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingKey")}
						</div>
					)}

					{enabled && openRouterApiKey && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
