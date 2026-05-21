import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { DropdownContainer } from "../common/ModelSelector"
import { getModeSpecificFields } from "../utils/providerUtils"
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
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { lmStudioModelId } = getModeSpecificFields(apiConfiguration, currentMode)

	const [lmStudioModels, setLmStudioModels] = useState<LMStudioApiModel[]>([])

	const currentLMStudioModel = useMemo(
		() => lmStudioModels.find((model) => model.id === lmStudioModelId),
		[lmStudioModels, lmStudioModelId],
	)
	const endpoint = useMemo(
		() => apiConfiguration?.lmStudioBaseUrl || "http://localhost:1234",
		[apiConfiguration?.lmStudioBaseUrl],
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
	}, [])

	const lmStudioMaxTokens = currentLMStudioModel?.max_context_length?.toString()
	const currentLoadedContext = currentLMStudioModel?.loaded_context_length?.toString()

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
				initialValue={apiConfiguration?.lmStudioBaseUrl}
				label="Use custom base URL"
				onChange={(value) => handleFieldChange("lmStudioBaseUrl", value)}
				placeholder="Default: http://localhost:1234"
			/>

			<div className="font-semibold">Model</div>
			{lmStudioModels.length > 0 ? (
				<DropdownContainer className="dropdown-container" zIndex={10}>
					<VSCodeDropdown
						className="w-full mb-3"
						onChange={(e: any) => {
							const value = e?.target?.value
							handleModeFieldChange(
								{
									plan: "planModeLmStudioModelId",
									act: "actModeLmStudioModelId",
								},
								value,
								currentMode,
							)
						}}
						value={lmStudioModelId}>
						{lmStudioModels.map((model) => (
							<VSCodeOption className="w-full" key={model.id} value={model.id}>
								{model.id}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			) : (
				<DebouncedTextField
					initialValue={lmStudioModelId || ""}
					onChange={(value) =>
						handleModeFieldChange(
							{
								plan: "planModeLmStudioModelId",
								act: "actModeLmStudioModelId",
							},
							value,
							currentMode,
						)
					}
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
					<span className="font-semibold">Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.
				</div>
			</div>
		</div>
	)
}
