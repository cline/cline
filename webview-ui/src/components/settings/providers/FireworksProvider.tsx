import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ApiKeyField } from "../common/ApiKeyField"

/**
 * Props for the FireworksProvider component
 */
interface FireworksProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Fireworks provider configuration component
 */
export const FireworksProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: FireworksProviderProps) => {
	// Handler for number input fields with validation
	const handleNumberInputChange = (field: keyof ApiConfiguration) => (e: any) => {
		const value = (e.target as HTMLInputElement).value
		if (!value) {
			return
		}
		const num = parseInt(value, 10)
		if (isNaN(num)) {
			return
		}
		handleInputChange(field)({
			target: {
				value: num,
			},
		})
	}

	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.fireworksApiKey || ""}
				onChange={handleInputChange("fireworksApiKey")}
				providerName="Fireworks"
				signupUrl="https://fireworks.ai/settings/users/api-keys"
			/>

			{showModelOptions && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.fireworksModelId || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("fireworksModelId")}
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
							(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
							models. Less capable models may not work as expected.)
						</span>
					</p>
					<VSCodeTextField
						value={apiConfiguration?.fireworksModelMaxCompletionTokens?.toString() || ""}
						style={{ width: "100%", marginBottom: 8 }}
						onInput={handleNumberInputChange("fireworksModelMaxCompletionTokens")}
						placeholder={"2000"}>
						<span style={{ fontWeight: 500 }}>Max Completion Tokens</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.fireworksModelMaxTokens?.toString() || ""}
						style={{ width: "100%", marginBottom: 8 }}
						onInput={handleNumberInputChange("fireworksModelMaxTokens")}
						placeholder={"4000"}>
						<span style={{ fontWeight: 500 }}>Max Context Tokens</span>
					</VSCodeTextField>
				</>
			)}
		</div>
	)
}
