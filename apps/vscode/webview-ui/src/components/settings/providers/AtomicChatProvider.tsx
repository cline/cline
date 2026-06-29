import { openAiModelInfoSafeDefaults } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { DropdownContainer } from "../common/ModelSelector"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

interface AtomicChatProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const AtomicChatProvider = ({ currentMode }: AtomicChatProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { config, write, commitSelection } = useProviderConfig("atomic-chat")

	const [atomicChatModels, setAtomicChatModels] = useState<string[]>([])

	const atomicChatBaseUrl = useMemo(
		() => config?.baseUrl ?? apiConfiguration?.atomicChatBaseUrl ?? "http://127.0.0.1:1337/v1",
		[apiConfiguration?.atomicChatBaseUrl, config?.baseUrl],
	)

	const atomicChatModelInfoById = useMemo(
		() => Object.fromEntries(atomicChatModels.map((modelId) => [modelId, { ...openAiModelInfoSafeDefaults, name: modelId }])),
		[atomicChatModels],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("atomic-chat", currentMode, {
		models: atomicChatModelInfoById,
		config,
		commitSelection,
		fallbackModelInfo: openAiModelInfoSafeDefaults,
		customModelInfo: (modelId) => ({ ...openAiModelInfoSafeDefaults, name: modelId }),
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

	const requestAtomicChatModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getAtomicChatModels(
				StringRequest.create({
					value: atomicChatBaseUrl,
				}),
			)
			if (response?.values) {
				setAtomicChatModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Atomic Chat models:", error)
			setAtomicChatModels([])
		}
	}, [atomicChatBaseUrl])

	useEffect(() => {
		requestAtomicChatModels()
	}, [requestAtomicChatModels])

	useInterval(requestAtomicChatModels, 6000)

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

			<div className="font-semibold">Model</div>
			{atomicChatModels.length > 0 ? (
				<DropdownContainer className="dropdown-container" zIndex={10}>
					<VSCodeDropdown
						className="w-full mb-3"
						onChange={(e: any) => {
							const value = e?.target?.value
							if (typeof value === "string") {
								const trimmedModelId = value.trim()
								if (!trimmedModelId) return
								void commitModelSelection({
									modelId: trimmedModelId,
									modelInfo: { ...openAiModelInfoSafeDefaults, name: trimmedModelId },
								}).catch((error) => console.error("Failed to update Atomic Chat model selection:", error))
							}
						}}
						value={selectedModel.modelId}>
						{atomicChatModels.map((model) => (
							<VSCodeOption className="w-full" key={model} value={model}>
								{model}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			) : (
				<DebouncedTextField
					initialValue={selectedModel.modelId || ""}
					onChange={(modelId) => {
						const trimmedModelId = modelId.trim()
						if (!trimmedModelId) return
						void commitModelSelection({
							modelId: trimmedModelId,
							modelInfo: { ...openAiModelInfoSafeDefaults, name: trimmedModelId },
						}).catch((error) => console.error("Failed to update Atomic Chat model selection:", error))
					}}
					placeholder="e.g. gemma-local"
					style={{ width: "100%" }}
				/>
			)}

			{atomicChatModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">
					Unable to fetch models from Atomic Chat. Ensure the app is running and a model is loaded, or enter a model ID
					manually.
				</p>
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
