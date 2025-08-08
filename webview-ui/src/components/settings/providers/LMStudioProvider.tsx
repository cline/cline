import { VSCodeRadioGroup, VSCodeRadio, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useState, useCallback, useEffect } from "react"
import { useInterval } from "react-use"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelsServiceClient } from "@/services/grpc-client"
import { StringRequest } from "@shared/proto/common"
import { BaseUrlField } from "../common/BaseUrlField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Props for the LMStudioProvider component
 */
interface LMStudioProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The LM Studio provider configuration component
 */
export const LMStudioProvider = ({ showModelOptions, isPopup }: LMStudioProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [lmStudioModels, setLmStudioModels] = useState<string[]>([])

	// Poll LM Studio models
	const requestLmStudioModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getLmStudioModels(
				StringRequest.create({
					value: apiConfiguration?.lmStudioBaseUrl || "",
				}),
			)
			if (response && response.values) {
				setLmStudioModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch LM Studio models:", error)
			setLmStudioModels([])
		}
	}, [apiConfiguration?.lmStudioBaseUrl])

	useEffect(() => {
		requestLmStudioModels()
	}, [requestLmStudioModels])

	useInterval(requestLmStudioModels, 2000)

	return (
		<div>
			<BaseUrlField
				initialValue={apiConfiguration?.lmStudioBaseUrl}
				onChange={(value) => handleFieldChange("lmStudioBaseUrl", value)}
				placeholder="Default: http://localhost:1234"
				label="Use custom base URL"
			/>

			<DebouncedTextField
				initialValue={apiConfiguration?.lmStudioModelId || ""}
				onChange={(value) => handleFieldChange("lmStudioModelId", value)}
				style={{ width: "100%" }}
				placeholder={"e.g. meta-llama-3.1-8b-instruct"}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			{lmStudioModels.length > 0 && (
				<VSCodeRadioGroup
					value={
						lmStudioModels.includes(apiConfiguration?.lmStudioModelId || "") ? apiConfiguration?.lmStudioModelId : ""
					}
					onChange={(e) => {
						const value = (e.target as HTMLInputElement)?.value
						// need to check value first since radio group returns empty string sometimes
						if (value) {
							handleFieldChange("lmStudioModelId", value)
						}
					}}>
					{lmStudioModels.map((model) => (
						<VSCodeRadio key={model} value={model} checked={apiConfiguration?.lmStudioModelId === model}>
							{model}
						</VSCodeRadio>
					))}
				</VSCodeRadioGroup>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				LM Studio allows you to run models locally on your computer. For instructions on how to get started, see their
				<VSCodeLink href="https://lmstudio.ai/docs" style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide.
				</VSCodeLink>
				You will also need to start LM Studio's{" "}
				<VSCodeLink href="https://lmstudio.ai/docs/basics/server" style={{ display: "inline", fontSize: "inherit" }}>
					local server
				</VSCodeLink>{" "}
				feature to use it with this extension.{" "}
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>
		</div>
	)
}
