import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
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

interface LMStudioApiModel {
	id: string
	object?: "model"
	type?: string
	publisher?: string
	arch?: string
	compatibility_type?: string
	quantization?: string
	state?: string
	max_context_length?: number
	loaded_context_length?: number
}

/**
 * The LM Studio provider configuration component
 */
export const LMStudioProvider = ({ currentMode }: LMStudioProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("lmstudio")

	const [lmStudioModels, setLmStudioModels] = useState<LMStudioApiModel[]>([])
	const [pendingSelectedModelId, setPendingSelectedModelId] = useState<string | undefined>(undefined)

	const toLmStudioModelInfo = useCallback((model: LMStudioApiModel | undefined, modelId: string): ModelInfo => {
		const contextWindow = model?.loaded_context_length ?? model?.max_context_length
		return {
			...openAiModelInfoSafeDefaults,
			name: modelId,
			...(contextWindow !== undefined && contextWindow > 0 ? { contextWindow } : {}),
			...(model?.max_context_length !== undefined && model.max_context_length > 0
				? { maxTokens: model.max_context_length }
				: {}),
		}
	}, [])
	const lmStudioModelInfoById = useMemo(
		() => Object.fromEntries(lmStudioModels.map((model) => [model.id, toLmStudioModelInfo(model, model.id)])),
		[lmStudioModels, toLmStudioModelInfo],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("lmstudio", currentMode, {
		models: lmStudioModelInfoById,
		config,
		commitSelection,
		fallbackModelInfo: openAiModelInfoSafeDefaults,
		customModelInfo: (modelId) => toLmStudioModelInfo(undefined, modelId),
	})
	const displayedSelectedModelId = pendingSelectedModelId ?? selectedModel.modelId
	const currentLMStudioModel = useMemo(
		() => lmStudioModels.find((model) => model.id === displayedSelectedModelId),
		[displayedSelectedModelId, lmStudioModels],
	)
	const endpoint = useMemo(
		() => config?.baseUrl ?? apiConfiguration?.lmStudioBaseUrl ?? "http://localhost:1234",
		[apiConfiguration?.lmStudioBaseUrl, config?.baseUrl],
	)

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value }).catch((error) => console.error("Failed to update LM Studio base URL:", error))
		},
		[write],
	)

	const handleModelChange = useCallback(
		(modelId: string) => {
			const trimmedModelId = modelId.trim()
			if (!trimmedModelId) {
				return
			}
			setPendingSelectedModelId(trimmedModelId)
			const model = lmStudioModels.find((candidate) => candidate.id === trimmedModelId)
			void commitModelSelection({
				modelId: trimmedModelId,
				modelInfo: toLmStudioModelInfo(model, trimmedModelId),
			}).catch((error) => {
				console.error("Failed to update LM Studio model selection:", error)
				setPendingSelectedModelId(undefined)
			})
		},
		[commitModelSelection, lmStudioModels, toLmStudioModelInfo],
	)

	// Poll LM Studio models
	const requestLmStudioModels = useCallback(async () => {
		await ModelsServiceClient.getLmStudioModels({
			value: endpoint,
		})
			.then((response) => {
				if (response?.values) {
					const models = response.values.map((v) => JSON.parse(v) as LMStudioApiModel)
					setLmStudioModels(models)
				}
			})
			.catch((error) => {
				console.error("Failed to parse LM Studio models:", error)
			})
	}, [endpoint])

	useEffect(() => {
		requestLmStudioModels()
	}, [requestLmStudioModels])

	const lmStudioMaxTokens = currentLMStudioModel?.max_context_length?.toString()
	const currentLoadedContext = currentLMStudioModel?.loaded_context_length?.toString()

	useEffect(() => {
		if (pendingSelectedModelId && selectedModel.modelId === pendingSelectedModelId) {
			setPendingSelectedModelId(undefined)
		}
	}, [pendingSelectedModelId, selectedModel.modelId])

	useEffect(() => {
		const curr = currentLMStudioModel?.loaded_context_length?.toString()
		const max = currentLMStudioModel?.max_context_length?.toString()
		const choice = apiConfiguration?.lmStudioMaxTokens ?? max
		if (curr && curr !== choice) {
			handleFieldChange("lmStudioMaxTokens", curr)
		}
	}, [
		currentLMStudioModel?.loaded_context_length,
		currentLMStudioModel?.max_context_length,
		apiConfiguration?.lmStudioMaxTokens,
		handleFieldChange,
	])

	useInterval(requestLmStudioModels, 6000)

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={config?.baseUrl ?? apiConfiguration?.lmStudioBaseUrl}
				label="Use custom base URL"
				onChange={handleBaseUrlChange}
				placeholder="Default: http://localhost:1234"
			/>

			<div className="font-semibold">Model</div>
			{lmStudioModels.length > 0 ? (
				<DropdownContainer className="dropdown-container" zIndex={10}>
					<VSCodeDropdown
						className="w-full mb-3"
						onChange={(e: any) => {
							const value = e?.target?.value
							if (typeof value === "string") {
								handleModelChange(value)
							}
						}}
						value={displayedSelectedModelId}>
						{lmStudioModels.map((model) => (
							<VSCodeOption className="w-full" key={model.id} value={model.id}>
								{model.id}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			) : (
				<DebouncedTextField
					initialValue={displayedSelectedModelId || ""}
					onChange={handleModelChange}
					placeholder={"e.g. meta-llama-3.1-8b-instruct"}
					style={{ width: "100%" }}
				/>
			)}

			<div className="font-semibold">Context Window</div>
			<VSCodeTextField
				className="w-full pointer-events-none"
				disabled={true}
				title="Not editable - the value is returned by the connected endpoint"
				value={String(currentLoadedContext ?? lmStudioMaxTokens ?? "0")}
			/>

			<UseCustomPromptCheckbox providerId="lmstudio" />

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
