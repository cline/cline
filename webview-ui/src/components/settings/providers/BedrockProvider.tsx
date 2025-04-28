import { ApiConfiguration, bedrockModels } from "@shared/api"
import {
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
} from "@vscode/webview-ui-toolkit/react"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { DropdownContainer } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"

/**
 * Props for the BedrockProvider component
 */
interface BedrockProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The AWS Region selector component
 */
const RegionSelector = ({ value, onChange }: { value: string | undefined; onChange: (e: any) => void }) => (
	<DropdownContainer className="dropdown-container" zIndex={999}>
		<label htmlFor="aws-region-dropdown">
			<span style={{ fontWeight: 500 }}>AWS Region</span>
		</label>
		<VSCodeDropdown id="aws-region-dropdown" value={value || ""} style={{ width: "100%" }} onChange={onChange}>
			<VSCodeOption value="">Select a region...</VSCodeOption>
			<VSCodeOption value="us-east-1">us-east-1</VSCodeOption>
			<VSCodeOption value="us-east-2">us-east-2</VSCodeOption>
			<VSCodeOption value="us-west-2">us-west-2</VSCodeOption>
			<VSCodeOption value="ap-south-1">ap-south-1</VSCodeOption>
			<VSCodeOption value="ap-northeast-1">ap-northeast-1</VSCodeOption>
			<VSCodeOption value="ap-northeast-2">ap-northeast-2</VSCodeOption>
			<VSCodeOption value="ap-northeast-3">ap-northeast-3</VSCodeOption>
			<VSCodeOption value="ap-southeast-1">ap-southeast-1</VSCodeOption>
			<VSCodeOption value="ap-southeast-2">ap-southeast-2</VSCodeOption>
			<VSCodeOption value="ca-central-1">ca-central-1</VSCodeOption>
			<VSCodeOption value="eu-central-1">eu-central-1</VSCodeOption>
			<VSCodeOption value="eu-central-2">eu-central-2</VSCodeOption>
			<VSCodeOption value="eu-west-1">eu-west-1</VSCodeOption>
			<VSCodeOption value="eu-west-2">eu-west-2</VSCodeOption>
			<VSCodeOption value="eu-west-3">eu-west-3</VSCodeOption>
			<VSCodeOption value="eu-north-1">eu-north-1</VSCodeOption>
			<VSCodeOption value="sa-east-1">sa-east-1</VSCodeOption>
			<VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption>
			<VSCodeOption value="us-gov-west-1">us-gov-west-1</VSCodeOption>
		</VSCodeDropdown>
	</DropdownContainer>
)

/**
 * The Bedrock provider configuration component
 */
export const BedrockProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: BedrockProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Create a wrapper for handling field changes more directly
	const handleFieldChange = (field: keyof ApiConfiguration) => (value: any) => {
		handleInputChange(field)({ target: { value } })
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<VSCodeRadioGroup
				value={apiConfiguration?.awsUseProfile ? "profile" : "credentials"}
				onChange={(e) => {
					const value = (e.target as HTMLInputElement)?.value
					const useProfile = value === "profile"
					handleFieldChange("awsUseProfile")(useProfile)
				}}>
				<VSCodeRadio value="credentials">AWS Credentials</VSCodeRadio>
				<VSCodeRadio value="profile">AWS Profile</VSCodeRadio>
			</VSCodeRadioGroup>

			{apiConfiguration?.awsUseProfile ? (
				<VSCodeTextField
					value={apiConfiguration?.awsProfile || ""}
					style={{ width: "100%" }}
					onInput={handleInputChange("awsProfile")}
					placeholder="Enter profile name (default if empty)">
					<span style={{ fontWeight: 500 }}>AWS Profile Name</span>
				</VSCodeTextField>
			) : (
				<>
					<VSCodeTextField
						value={apiConfiguration?.awsAccessKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsAccessKey")}
						placeholder="Enter Access Key...">
						<span style={{ fontWeight: 500 }}>AWS Access Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSecretKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsSecretKey")}
						placeholder="Enter Secret Key...">
						<span style={{ fontWeight: 500 }}>AWS Secret Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSessionToken || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsSessionToken")}
						placeholder="Enter Session Token...">
						<span style={{ fontWeight: 500 }}>AWS Session Token</span>
					</VSCodeTextField>
				</>
			)}

			<RegionSelector value={apiConfiguration?.awsRegion} onChange={handleInputChange("awsRegion")} />

			<div style={{ display: "flex", flexDirection: "column" }}>
				<VSCodeCheckbox
					checked={!!apiConfiguration?.awsBedrockEndpoint}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						if (!isChecked) {
							handleFieldChange("awsBedrockEndpoint")("")
						}
					}}>
					Use custom VPC endpoint
				</VSCodeCheckbox>

				{!!apiConfiguration?.awsBedrockEndpoint && (
					<VSCodeTextField
						value={apiConfiguration?.awsBedrockEndpoint || ""}
						style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
						type="url"
						onInput={handleInputChange("awsBedrockEndpoint")}
						placeholder="Enter VPC Endpoint URL (optional)"
					/>
				)}

				<VSCodeCheckbox
					checked={apiConfiguration?.awsUseCrossRegionInference || false}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						handleFieldChange("awsUseCrossRegionInference")(isChecked)
					}}>
					Use cross-region inference
				</VSCodeCheckbox>

				{selectedModelInfo.supportsPromptCache && (
					<VSCodeCheckbox
						checked={apiConfiguration?.awsBedrockUsePromptCache || false}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							handleFieldChange("awsBedrockUsePromptCache")(isChecked)
						}}>
						Use prompt caching
					</VSCodeCheckbox>
				)}
			</div>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{apiConfiguration?.awsUseProfile ? (
					<>
						Using AWS Profile credentials from ~/.aws/credentials. Leave profile name empty to use the default
						profile. These credentials are only used locally to make API requests from this extension.
					</>
				) : (
					<>
						Authenticate by either providing the keys above or use the default AWS credential providers, i.e.
						~/.aws/credentials or environment variables. These credentials are only used locally to make API requests
						from this extension.
					</>
				)}
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						models={bedrockModels}
						selectedModelId={selectedModelId}
						onChange={handleInputChange("apiModelId")}
						label="Model"
						zIndex={998}
					/>

					{/* Add Thinking Budget Slider for supported models */}
					{selectedModelId === "anthropic.claude-3-7-sonnet-20250219-v1:0" && (
						<ThinkingBudgetSlider
							apiConfiguration={apiConfiguration}
							setApiConfiguration={(config) => {
								// Update the API configuration with the new values
								Object.entries(config).forEach(([key, value]) => {
									if (key !== "apiConfiguration") {
										handleFieldChange(key as keyof ApiConfiguration)(value as string)
									}
								})
							}}
							maxBudget={selectedModelInfo.thinkingConfig?.maxBudget}
						/>
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
