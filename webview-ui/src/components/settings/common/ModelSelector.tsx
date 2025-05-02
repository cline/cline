import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { ModelInfo } from "@shared/api"
import styled from "styled-components"

/**
 * Container for dropdowns that ensures proper z-index handling
 * This is necessary to ensure dropdown opens downward
 */
export const DropdownContainer = styled.div.attrs<{ zIndex?: number }>(({ zIndex }) => ({
	style: {
		zIndex: zIndex || 1000,
	},
}))`
	position: relative;

	// Force dropdowns to open downward
	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`

/**
 * Props for the ModelSelector component
 */
interface ModelSelectorProps {
	models: Record<string, ModelInfo>
	selectedModelId: string | undefined
	onChange: (e: any) => void
	zIndex?: number
	label?: string
}

/**
 * A reusable component for selecting models from a dropdown
 */
export const ModelSelector = ({ models, selectedModelId, onChange, zIndex, label = "Model" }: ModelSelectorProps) => {
	return (
		<DropdownContainer className="dropdown-container" zIndex={zIndex}>
			<label htmlFor="model-id">
				<span style={{ fontWeight: 500 }}>{label}</span>
			</label>
			<VSCodeDropdown id="model-id" value={selectedModelId} onChange={onChange} style={{ width: "100%" }}>
				<VSCodeOption value="">Select a model...</VSCodeOption>
				{Object.keys(models).map((modelId) => (
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
		</DropdownContainer>
	)
}
