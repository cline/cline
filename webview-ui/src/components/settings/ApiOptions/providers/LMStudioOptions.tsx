import { VSCodeTextField, VSCodeLink, VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import { useCallback, useEffect, useState } from "react"
import { useEvent, useInterval } from "react-use"
import { vscode } from "@/utils/vscode"
import type { ExtensionMessage } from "@shared/ExtensionMessage"

const LMStudioOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()
	const [lmStudioModels, setLmStudioModels] = useState<string[]>([])

	// Request LM Studio models
	const requestLmStudioModels = useCallback(() => {
		vscode.postMessage({
			type: "requestLmStudioModels",
			text: apiConfiguration?.lmStudioBaseUrl,
		})
	}, [apiConfiguration?.lmStudioBaseUrl])

	// Request LM Studio models when component mounts
	useEffect(() => {
		requestLmStudioModels()
	}, [requestLmStudioModels])

	// Poll LM Studio models periodically
	useInterval(requestLmStudioModels, 2000)

	// Handle message events for LM Studio models
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "lmStudioModels" && message.lmStudioModels) {
			setLmStudioModels(message.lmStudioModels)
		}
	}, [])

	useEvent("message", handleMessage)

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.lmStudioBaseUrl || ""}
				style={{ width: "100%" }}
				type="url"
				onInput={handleInputChange("lmStudioBaseUrl")}
				placeholder={"Default: http://localhost:1234"}>
				<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.lmStudioModelId || ""}
				style={{ width: "100%", marginTop: 10 }}
				onInput={handleInputChange("lmStudioModelId")}
				placeholder={"e.g. meta-llama-3.1-8b-instruct"}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>
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

export default LMStudioOptions
