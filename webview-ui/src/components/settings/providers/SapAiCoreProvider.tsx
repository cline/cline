import { ApiConfiguration, sapAiCoreModels } from "@shared/api"
import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the SapAiCoreProvider component
 */
interface SapAiCoreProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The SAP AI Core provider configuration component
 */
export const SapAiCoreProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: SapAiCoreProviderProps) => {
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<VSCodeTextField
				value={apiConfiguration?.sapAiCoreClientId || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("sapAiCoreClientId")}
				placeholder="Enter AI Core Client Id...">
				<span style={{ fontWeight: 500 }}>AI Core Client Id</span>
			</VSCodeTextField>
			{apiConfiguration?.sapAiCoreClientId && (
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
					Client Id is set. To change it, please re-enter the value.
				</p>
			)}

			<VSCodeTextField
				value={apiConfiguration?.sapAiCoreClientSecret ? "********" : ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("sapAiCoreClientSecret")}
				placeholder="Enter AI Core Client Secret...">
				<span style={{ fontWeight: 500 }}>AI Core Client Secret</span>
			</VSCodeTextField>
			{apiConfiguration?.sapAiCoreClientSecret && (
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
					Client Secret is set. To change it, please re-enter the value.
				</p>
			)}

			<VSCodeTextField
				value={apiConfiguration?.sapAiCoreBaseUrl || ""}
				style={{ width: "100%" }}
				onInput={handleInputChange("sapAiCoreBaseUrl")}
				placeholder="Enter AI Core Base URL...">
				<span style={{ fontWeight: 500 }}>AI Core Base URL</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.sapAiCoreTokenUrl || ""}
				style={{ width: "100%" }}
				onInput={handleInputChange("sapAiCoreTokenUrl")}
				placeholder="Enter AI Core Auth URL...">
				<span style={{ fontWeight: 500 }}>AI Core Auth URL</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.sapAiResourceGroup || ""}
				style={{ width: "100%" }}
				onInput={handleInputChange("sapAiResourceGroup")}
				placeholder="Enter AI Core Resource Group...">
				<span style={{ fontWeight: 500 }}>AI Core Resource Group</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				These credentials are stored locally and only used to make API requests from this extension.
				<VSCodeLink
					href="https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/access-sap-ai-core-via-api"
					style={{ display: "inline" }}>
					You can find more information about SAP AI Core API access here.
				</VSCodeLink>
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						models={sapAiCoreModels}
						selectedModelId={selectedModelId}
						onChange={handleInputChange("apiModelId")}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
