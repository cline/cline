import { bedrockDefaultModelId, bedrockModels, CLAUDE_SONNET_4_1M_SUFFIX } from "@shared/api"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeRadio, VSCodeRadioGroup } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration, getModeSpecificFields } from "../utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { Mode } from "@shared/storage/types"
// Z-index constants for proper dropdown layering
const DROPDOWN_Z_INDEX = 1000

interface BedrockProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const BedrockProvider = ({ showModelOptions, isPopup, currentMode }: BedrockProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleFieldsChange, handleModeFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpoint)

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 5,
			}}>
			<VSCodeRadioGroup
				value={apiConfiguration?.awsAuthentication ?? (apiConfiguration?.awsProfile ? "profile" : "credentials")}
				onChange={(e) => {
					const value = (e.target as HTMLInputElement)?.value
					handleFieldChange("awsAuthentication", value)
				}}>
				<VSCodeRadio value="apikey">API Key</VSCodeRadio>
				<VSCodeRadio value="profile">AWS Profile</VSCodeRadio>
				<VSCodeRadio value="credentials">AWS Credentials</VSCodeRadio>
			</VSCodeRadioGroup>

			{(apiConfiguration?.awsAuthentication === undefined && apiConfiguration?.awsUseProfile) ||
			apiConfiguration?.awsAuthentication == "profile" ? (
				<DebouncedTextField
					key="profile"
					initialValue={apiConfiguration?.awsProfile ?? ""}
					style={{ width: "100%" }}
					onChange={(value) => handleFieldChange("awsProfile", value)}
					placeholder="Enter profile name (default if empty)">
					<span style={{ fontWeight: 500 }}>AWS Profile Name</span>
				</DebouncedTextField>
			) : apiConfiguration?.awsAuthentication == "apikey" ? (
				<DebouncedTextField
					key="apikey"
					type="password"
					initialValue={apiConfiguration?.awsBedrockApiKey ?? ""}
					style={{ width: "100%" }}
					onChange={(value) => handleFieldChange("awsBedrockApiKey", value)}
					placeholder="Enter Bedrock Api Key">
					<span style={{ fontWeight: 500 }}>AWS Bedrock Api Key</span>
				</DebouncedTextField>
			) : (
				<>
					<DebouncedTextField
						key="accessKey"
						initialValue={apiConfiguration?.awsAccessKey || ""}
						onChange={(value) => handleFieldChange("awsAccessKey", value)}
						style={{ width: "100%" }}
						type="password"
						placeholder="Enter Access Key...">
						<span style={{ fontWeight: 500 }}>AWS Access Key</span>
					</DebouncedTextField>
					<DebouncedTextField
						initialValue={apiConfiguration?.awsSecretKey || ""}
						onChange={(value) => handleFieldChange("awsSecretKey", value)}
						style={{ width: "100%" }}
						type="password"
						placeholder="Enter Secret Key...">
						<span style={{ fontWeight: 500 }}>AWS Secret Key</span>
					</DebouncedTextField>
					<DebouncedTextField
						initialValue={apiConfiguration?.awsSessionToken || ""}
						onChange={(value) => handleFieldChange("awsSessionToken", value)}
						style={{ width: "100%" }}
						type="password"
						placeholder="Enter Session Token...">
						<span style={{ fontWeight: 500 }}>AWS Session Token</span>
					</DebouncedTextField>
				</>
			)}

			<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 1} className="dropdown-container">
				<label htmlFor="aws-region-dropdown">
					<span style={{ fontWeight: 500 }}>AWS Region</span>
				</label>
				<VSCodeDropdown
					id="aws-region-dropdown"
					value={apiConfiguration?.awsRegion || ""}
					style={{ width: "100%" }}
					onChange={(e: any) => handleFieldChange("awsRegion", e.target.value)}>
					<VSCodeOption value="">Select a region...</VSCodeOption>
					{/* The user will have to choose a region that supports the model they use, but this shouldn't be a problem since they'd have to request access for it in that region in the first place. */}
					<VSCodeOption value="us-east-1">us-east-1</VSCodeOption>
					<VSCodeOption value="us-east-2">us-east-2</VSCodeOption>
					{/* <VSCodeOption value="us-west-1">us-west-1</VSCodeOption> */}
					<VSCodeOption value="us-west-2">us-west-2</VSCodeOption>
					{/* <VSCodeOption value="af-south-1">af-south-1</VSCodeOption> */}
					{/* <VSCodeOption value="ap-east-1">ap-east-1</VSCodeOption> */}
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
					<VSCodeOption value="eu-south-1">eu-south-1</VSCodeOption>
					<VSCodeOption value="eu-south-2">eu-south-2</VSCodeOption>
					{/* <VSCodeOption value="me-south-1">me-south-1</VSCodeOption> */}
					<VSCodeOption value="sa-east-1">sa-east-1</VSCodeOption>
					<VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption>
					<VSCodeOption value="us-gov-west-1">us-gov-west-1</VSCodeOption>
					{/* <VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption> */}
				</VSCodeDropdown>
			</DropdownContainer>

			<div style={{ display: "flex", flexDirection: "column" }}>
				<VSCodeCheckbox
					checked={awsEndpointSelected}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						setAwsEndpointSelected(isChecked)
						if (!isChecked) {
							handleFieldChange("awsBedrockEndpoint", "")
						}
					}}>
					Use custom VPC endpoint
				</VSCodeCheckbox>

				{awsEndpointSelected && (
					<DebouncedTextField
						initialValue={apiConfiguration?.awsBedrockEndpoint || ""}
						onChange={(value) => handleFieldChange("awsBedrockEndpoint", value)}
						style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
						type="url"
						placeholder="Enter VPC Endpoint URL (optional)"
					/>
				)}

				<VSCodeCheckbox
					checked={apiConfiguration?.awsUseCrossRegionInference || false}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true

						handleFieldChange("awsUseCrossRegionInference", isChecked)
					}}>
					Use cross-region inference
				</VSCodeCheckbox>

				{selectedModelInfo.supportsPromptCache && (
					<>
						<VSCodeCheckbox
							checked={apiConfiguration?.awsBedrockUsePromptCache || false}
							onChange={(e: any) => {
								const isChecked = e.target.checked === true
								handleFieldChange("awsBedrockUsePromptCache", isChecked)
							}}>
							Use prompt caching
						</VSCodeCheckbox>
					</>
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
					<label htmlFor="bedrock-model-dropdown">
						<span style={{ fontWeight: 500 }}>Model</span>
					</label>
					<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
						<VSCodeDropdown
							id="bedrock-model-dropdown"
							value={modeFields.awsBedrockCustomSelected ? "custom" : selectedModelId}
							onChange={(e: any) => {
								const isCustom = e.target.value === "custom"

								handleModeFieldsChange(
									{
										apiModelId: { plan: "planModeApiModelId", act: "actModeApiModelId" },
										awsBedrockCustomSelected: {
											plan: "planModeAwsBedrockCustomSelected",
											act: "actModeAwsBedrockCustomSelected",
										},
										awsBedrockCustomModelBaseId: {
											plan: "planModeAwsBedrockCustomModelBaseId",
											act: "actModeAwsBedrockCustomModelBaseId",
										},
									},
									{
										apiModelId: isCustom ? "" : e.target.value,
										awsBedrockCustomSelected: isCustom,
										awsBedrockCustomModelBaseId: bedrockDefaultModelId,
									},
									currentMode,
								)
							}}
							style={{ width: "100%" }}>
							<VSCodeOption value="">Select a model...</VSCodeOption>
							{Object.keys(bedrockModels).map((modelId) => (
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
							<VSCodeOption value="custom">Custom</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>

					{modeFields.awsBedrockCustomSelected && (
						<div>
							<p
								style={{
									fontSize: "12px",
									marginTop: "5px",
									color: "var(--vscode-descriptionForeground)",
								}}>
								Select "Custom" when using the Application Inference Profile in Bedrock. Enter the Application
								Inference Profile ARN in the Model ID field.
							</p>
							<DebouncedTextField
								id="bedrock-model-input"
								initialValue={modeFields.apiModelId || ""}
								onChange={(value) =>
									handleModeFieldChange(
										{ plan: "planModeApiModelId", act: "actModeApiModelId" },
										value,
										currentMode,
									)
								}
								style={{ width: "100%", marginTop: 3 }}
								placeholder="Enter custom model ID...">
								<span style={{ fontWeight: 500 }}>Model ID</span>
							</DebouncedTextField>
							<label htmlFor="bedrock-base-model-dropdown">
								<span style={{ fontWeight: 500 }}>Base Inference Model</span>
							</label>
							<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 3} className="dropdown-container">
								<VSCodeDropdown
									id="bedrock-base-model-dropdown"
									value={modeFields.awsBedrockCustomModelBaseId || bedrockDefaultModelId}
									onChange={(e: any) =>
										handleModeFieldChange(
											{
												plan: "planModeAwsBedrockCustomModelBaseId",
												act: "actModeAwsBedrockCustomModelBaseId",
											},
											e.target.value,
											currentMode,
										)
									}
									style={{ width: "100%" }}>
									<VSCodeOption value="">Select a model...</VSCodeOption>
									{Object.keys(bedrockModels).map((modelId) => (
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
						</div>
					)}

					{(selectedModelId === "anthropic.claude-3-7-sonnet-20250219-v1:0" ||
						selectedModelId === "anthropic.claude-sonnet-4-20250514-v1:0" ||
						selectedModelId === `anthropic.claude-sonnet-4-20250514-v1:0${CLAUDE_SONNET_4_1M_SUFFIX}` ||
						selectedModelId === "anthropic.claude-opus-4-1-20250805-v1:0" ||
						selectedModelId === "anthropic.claude-opus-4-20250514-v1:0" ||
						(modeFields.awsBedrockCustomSelected &&
							modeFields.awsBedrockCustomModelBaseId === "anthropic.claude-3-7-sonnet-20250219-v1:0") ||
						(modeFields.awsBedrockCustomSelected &&
							modeFields.awsBedrockCustomModelBaseId === "anthropic.claude-sonnet-4-20250514-v1:0") ||
						(modeFields.awsBedrockCustomSelected &&
							modeFields.awsBedrockCustomModelBaseId ===
								`anthropic.claude-sonnet-4-20250514-v1:0${CLAUDE_SONNET_4_1M_SUFFIX}`) ||
						(modeFields.awsBedrockCustomSelected &&
							modeFields.awsBedrockCustomModelBaseId === "anthropic.claude-opus-4-1-20250805-v1:0") ||
						(modeFields.awsBedrockCustomSelected &&
							modeFields.awsBedrockCustomModelBaseId === "anthropic.claude-opus-4-20250514-v1:0")) && (
						<ThinkingBudgetSlider currentMode={currentMode} />
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
