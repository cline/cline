import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ApiKeyField } from "../common/ApiKeyField"

/**
 * Props for the TogetherProvider component
 */
interface TogetherProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Together provider configuration component
 */
export const TogetherProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: TogetherProviderProps) => {
	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.togetherApiKey || ""}
				onChange={handleInputChange("togetherApiKey")}
				providerName="Together"
			/>
			<VSCodeTextField
				value={apiConfiguration?.togetherModelId || ""}
				style={{ width: "100%" }}
				onInput={handleInputChange("togetherModelId")}
				placeholder={"Enter Model ID..."}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>
		</div>
	)
}
