import type { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useMemo } from "react"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

interface AtomicChatProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const AtomicChatProvider = ({ currentMode, isPopup, showModelOptions }: AtomicChatProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { config, write, commitSelection } = useProviderConfig("atomic-chat")
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels("atomic-chat")

	const atomicChatBaseUrl = useMemo(
		() => config?.baseUrl ?? apiConfiguration?.atomicChatBaseUrl ?? "http://127.0.0.1:1337/v1",
		[apiConfiguration?.atomicChatBaseUrl, config?.baseUrl],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("atomic-chat", currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
	})
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Atomic Chat",
		write,
	})

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value }).catch((error) => console.error("Failed to update Atomic Chat base URL:", error))
		},
		[write],
	)

	const handleModelSelect = useCallback(
		(selection: ModelPickerSelection) => {
			void commitModelSelection(selection).catch((error) =>
				console.error("Failed to update Atomic Chat model selection:", error),
			)
		},
		[commitModelSelection],
	)

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={atomicChatBaseUrl}
				label="Use custom base URL"
				onChange={handleBaseUrlChange}
				placeholder="Default: http://127.0.0.1:1337/v1"
			/>

			<ApiKeyField
				helpText="Optional API key for authenticated Atomic Chat instances. Leave empty for local use."
				initialValue={savedApiKeyMask}
				onChange={handleApiKeyChange}
				placeholder="Enter API Key (optional)..."
				providerName="Atomic Chat"
			/>

			{showModelOptions && (
				<>
					<ModelPickerWithManualEntry
						allowsCustomIds={true}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={models}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}

			<UseCustomPromptCheckbox providerId="atomic-chat" />

			<p className="text-xs text-description">
				Atomic Chat runs local models with an OpenAI-compatible API. See{" "}
				<VSCodeLink href="https://atomic.chat" style={{ display: "inline", fontSize: "inherit" }}>
					atomic.chat
				</VSCodeLink>{" "}
				for setup instructions.
			</p>
		</div>
	)
}
