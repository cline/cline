import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelInfoView, normalizeApiConfiguration } from "./ApiOptions"
import { useMount } from "react-use"
import { vscode } from "../../utils/vscode"

interface OpenRouterModelPickerProps {}

const OpenRouterModelPicker: React.FC<OpenRouterModelPickerProps> = () => {
	const { apiConfiguration, setApiConfiguration, openRouterModels } = useExtensionState()

	const handleModelChange = (event: any) => {
		const newModelId = event.target.value
		setApiConfiguration({
			...apiConfiguration,
			openRouterModelId: newModelId,
			openRouterModelInfo: openRouterModels[newModelId],
		})
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	useMount(() => {
		vscode.postMessage({ type: "refreshOpenRouterModels" })
	})

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div className="dropdown-container">
				<label htmlFor="model-id">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>
				<VSCodeDropdown
					id="model-id"
					value={selectedModelId}
					onChange={handleModelChange}
					style={{ width: "100%" }}>
					<VSCodeOption value="">Select a model...</VSCodeOption>
					{Object.keys(openRouterModels).map((modelId) => (
						<VSCodeOption
							key={modelId}
							value={modelId}
							style={{
								whiteSpace: "normal",
								wordWrap: "break-word",
								maxWidth: "100%",
							}}>
							{modelId}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
			</div>

			{selectedModelInfo.description && (
				<p style={{ fontSize: "12px", marginTop: "2px", color: "var(--vscode-descriptionForeground)" }}>
					{selectedModelInfo.description}
				</p>
			)}

			<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} />
		</div>
	)
}

export default OpenRouterModelPicker
