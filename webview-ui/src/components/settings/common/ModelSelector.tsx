import { ModelInfo } from "@shared/api"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
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

/*
OG Saoud Note:

	VSCodeDropdown has an open bug where dynamically rendered options don't auto select the provided value prop. You can see this for yourself by comparing  it with normal select/option elements, which work as expected.
	https://github.com/microsoft/vscode-webview-ui-toolkit/issues/433

	In our case, when the user switches between providers, we recalculate the selectedModelId depending on the provider, the default model for that provider, and a modelId that the user may have selected. Unfortunately, the VSCodeDropdown component wouldn't select this calculated value, and would default to the first "Select a model..." option instead, which makes it seem like the model was cleared out when it wasn't.

	As a workaround, we create separate instances of the dropdown for each provider, and then conditionally render the one that matches the current provider.
	*/

/**
 * A reusable component for selecting models from a dropdown
 */
export const ModelSelector = ({ models, selectedModelId, onChange, zIndex, label = "Model" }: ModelSelectorProps) => {
	return (
		<DropdownContainer className="dropdown-container" zIndex={zIndex}>
			<label htmlFor="model-id">
				<span style={{ fontWeight: 500 }}>{label}</span>
			</label>
			<VSCodeDropdown id="model-id" onChange={onChange} style={{ width: "100%" }} value={selectedModelId}>
				<VSCodeOption value="">Select a model...</VSCodeOption>
				{Object.keys(models).map((modelId) => (
					<VSCodeOption
						key={modelId}
						style={{
							whiteSpace: "normal",
							wordWrap: "break-word",
							maxWidth: "100%",
						}}
						value={modelId}>
						{modelId}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		</DropdownContainer>
	)
}
