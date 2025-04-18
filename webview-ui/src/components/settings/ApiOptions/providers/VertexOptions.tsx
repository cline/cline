import { VSCodeTextField, VSCodeLink, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import DropdownContainer from "../DropdownContainer"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../model/OpenRouterModelPicker"

const VertexOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 5,
			}}>
			<VSCodeTextField
				value={apiConfiguration?.vertexProjectId || ""}
				style={{ width: "100%" }}
				onInput={handleInputChange("vertexProjectId")}
				placeholder="Enter Project ID...">
				<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
			</VSCodeTextField>
			<DropdownContainer zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX - 1} className="dropdown-container">
				<label htmlFor="vertex-region-dropdown">
					<span style={{ fontWeight: 500 }}>Google Cloud Region</span>
				</label>
				<VSCodeDropdown
					id="vertex-region-dropdown"
					value={apiConfiguration?.vertexRegion || ""}
					style={{ width: "100%" }}
					onChange={handleInputChange("vertexRegion")}>
					<VSCodeOption value="">Select a region...</VSCodeOption>
					<VSCodeOption value="us-east5">us-east5</VSCodeOption>
					<VSCodeOption value="us-central1">us-central1</VSCodeOption>
					<VSCodeOption value="europe-west1">europe-west1</VSCodeOption>
					<VSCodeOption value="europe-west4">europe-west4</VSCodeOption>
					<VSCodeOption value="asia-southeast1">asia-southeast1</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				To use Google Cloud Vertex AI, you need to
				<VSCodeLink
					href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"1) create a Google Cloud account › enable the Vertex AI API › enable the desired Claude models,"}
				</VSCodeLink>{" "}
				<VSCodeLink
					href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"2) install the Google Cloud CLI › configure Application Default Credentials."}
				</VSCodeLink>
			</p>
		</div>
	)
}

export default VertexOptions
