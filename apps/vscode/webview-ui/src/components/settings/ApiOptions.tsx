import type { Mode } from "@shared/storage/types"
import styled from "styled-components"
import { BedrockProvider } from "./providers/BedrockProvider"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

export const DROPDOWN_Z_INDEX = 1002

export const DropdownContainer = styled.div<{ zIndex?: number }>`
	position: relative;
	z-index: ${(props) => props.zIndex || DROPDOWN_Z_INDEX};

	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`

const ApiOptions = ({ showModelOptions, apiErrorMessage, modelIdErrorMessage, isPopup, currentMode }: ApiOptionsProps) => (
	<div className="flex flex-col gap-2">
		<BedrockProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />
		{apiErrorMessage && <p className="text-error m-0">{apiErrorMessage}</p>}
		{modelIdErrorMessage && <p className="text-error m-0">{modelIdErrorMessage}</p>}
	</div>
)

export default ApiOptions
