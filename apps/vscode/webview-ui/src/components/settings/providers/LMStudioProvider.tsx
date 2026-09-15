import { openAiModelInfoSafeDefaults } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { DropdownContainer } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the LMStudioProvider component
 */
interface LMStudioProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The LM Studio provider configuration component
 */
export const LMStudioProvider = ({ currentMode }: LMStudioProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("lmstudio")
	const { models: lmStudioModels, defaultModelId, refresh: requestLmStudioModels } = useProviderModels("lmstudio")
	const [pendingSelectedModelId, setPendingSelectedModelId] = useState<string | undefined>(undefined)

	const { selectedModel, commitModelSelection } = useProviderModelSelection("lmstudio", currentMode, {
		models: lmStudioModels,
		defaultModelId,
		config,
		commitSelection,
		fallbackModelInfo: openAiModelInfoSafeDefaults,
		customModelInfo: (modelId) => ({ ...openAiModelInfoSafeDefaults, name: modelId }),
	})
	const displayedSelectedModelId = pendingSelectedModelId ?? selectedModel.modelId
	const currentLMStudioModel = lmStudioModels[displayedSelectedModelId]

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value })
				.then(requestLmStudioModels)
				.catch((error) => console.error("Failed to update LM Studio base URL:", error))
		},
		[requestLmStudioModels, write],
	)
	const handleBaseUrlClear = useCallback(async () => {
		try {
			await write({ baseUrl: "" })
			await requestLmStudioModels()
		} catch (error) {
			console.error("Failed to clear LM Studio base URL:", error)
			throw error
		}
	}, [requestLmStudioModels, write])

	const handleModelChange = useCallback(
		(modelId: string) => {
			const trimmedModelId = modelId.trim()
			if (!trimmedModelId) {
				return
			}
			setPendingSelectedModelId(trimmedModelId)
			void commitModelSelection({
				modelId: trimmedModelId,
				modelInfo: lmStudioModels[trimmedModelId] ?? {
					...openAiModelInfoSafeDefaults,
					name: trimmedModelId,
				},
			}).catch((error) => {
				console.error("Failed to update LM Studio model selection:", error)
				setPendingSelectedModelId(undefined)
			})
		},
		[commitModelSelection, lmStudioModels],
	)

	const currentLoadedContext = currentLMStudioModel?.contextWindow?.toString()

	useEffect(() => {
		if (pendingSelectedModelId && selectedModel.modelId === pendingSelectedModelId) {
			setPendingSelectedModelId(undefined)
		}
	}, [pendingSelectedModelId, selectedModel.modelId])

	useEffect(() => {
		if (currentLoadedContext && currentLoadedContext !== apiConfiguration?.lmStudioMaxTokens) {
			handleFieldChange("lmStudioMaxTokens", currentLoadedContext)
		}
	}, [apiConfiguration?.lmStudioMaxTokens, currentLoadedContext, handleFieldChange])

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={config?.baseUrl ?? apiConfiguration?.lmStudioBaseUrl}
				label="Use custom base URL"
				onChange={handleBaseUrlChange}
				onClear={handleBaseUrlClear}
				placeholder="Default: http://localhost:1234"
			/>

			<div className="font-semibold">Model</div>
			{Object.keys(lmStudioModels).length > 0 ? (
				<DropdownContainer className="dropdown-container" onFocusCapture={() => void requestLmStudioModels()} zIndex={10}>
					<VSCodeDropdown
						className="w-full mb-3"
						onChange={(e: any) => {
							const value = e?.target?.value
							if (typeof value === "string") {
								handleModelChange(value)
							}
						}}
						value={displayedSelectedModelId}>
						{Object.keys(lmStudioModels).map((modelId) => (
							<VSCodeOption className="w-full" key={modelId} value={modelId}>
								{modelId}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			) : (
				<div onFocusCapture={() => void requestLmStudioModels()}>
					<DebouncedTextField
						initialValue={displayedSelectedModelId || ""}
						onChange={handleModelChange}
						placeholder={"e.g. meta-llama-3.1-8b-instruct"}
						style={{ width: "100%" }}
					/>
				</div>
			)}

			<div className="font-semibold">Context Window</div>
			<VSCodeTextField
				className="w-full pointer-events-none"
				disabled={true}
				title="Not editable - the value is returned by the connected endpoint"
				value={String(currentLoadedContext ?? "0")}
			/>

			<div className="text-xs text-description">
				LM Studio allows you to run models locally on your computer. For instructions on how to get started, see their
				<VSCodeLink href="https://lmstudio.ai/docs" style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide.
				</VSCodeLink>
				You will also need to start LM Studio's{" "}
				<VSCodeLink className="inline" href="https://lmstudio.ai/docs/basics/server">
					local server
				</VSCodeLink>{" "}
				feature with <code>lms server start</code> to use it with this extension.{" "}
				<div className="text-error">
					<span className="font-semibold">Note:</span> Cline uses complex prompts, so behavior can vary across models.
					Less capable models may not work as expected.
				</div>
			</div>
		</div>
	)
}
