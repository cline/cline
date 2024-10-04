import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo } from "react"
import { useMount } from "react-use"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { ModelInfoView, normalizeApiConfiguration } from "./ApiOptions"
import { memo, useEffect } from "react"
import { useRemark } from "react-remark"
import styled from "styled-components"

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

	const modelIds = useMemo(() => {
		return Object.keys(openRouterModels).sort((a, b) => a.localeCompare(b))
	}, [openRouterModels])

	return (
		<>
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
					{modelIds.map((modelId) => (
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

			<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} />
		</>
	)
}

export default OpenRouterModelPicker

const StyledMarkdown = styled.div`
	font-family: var(--vscode-font-family), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
		Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);

	p,
	li,
	ol,
	ul {
		line-height: 1.25;
		margin: 0;
	}

	ol,
	ul {
		padding-left: 1.5em;
		margin-left: 0;
	}

	p {
		white-space: pre-wrap;
	}
`

export const ModelDescriptionMarkdown = memo(({ markdown, key }: { markdown?: string; key: string }) => {
	const [reactContent, setMarkdown] = useRemark()

	useEffect(() => {
		setMarkdown(markdown || "")
	}, [markdown, setMarkdown])

	return (
		<StyledMarkdown key={key} style={{ display: "inline-block", marginBottom: 5 }}>
			{reactContent}
		</StyledMarkdown>
	)
})
