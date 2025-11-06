import { bedrockDefaultModelId, bedrockModels, CLAUDE_SONNET_1M_SUFFIX } from "@shared/api"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeRadio, VSCodeRadioGroup } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"

const CLAUDE_MODELS = [
	"anthropic.claude-3-7-sonnet-20250219-v1:0",
	"anthropic.claude-sonnet-4-20250514-v1:0",
	"anthropic.claude-sonnet-4-5-20250929-v1:0",
	`anthropic.claude-sonnet-4-20250514-v1:0${CLAUDE_SONNET_1M_SUFFIX}`,
	`anthropic.claude-sonnet-4-5-20250929-v1:0${CLAUDE_SONNET_1M_SUFFIX}`,
	"anthropic.claude-opus-4-1-20250805-v1:0",
	"anthropic.claude-opus-4-20250514-v1:0",
	"anthropic.claude-haiku-4-5-20251001-v1:0",
]

const AWS_REGIONS = [
	"us-east-1",
	"us-east-2",
	"us-west-1",
	"us-west-2",
	"ap-south-1",
	"ap-northeast-1",
	"ap-northeast-2",
	"ap-northeast-3",
	"ap-southeast-1",
	"ap-southeast-2",
	"ap-southeast-3",
	"ap-southeast-4",
	"ap-southeast-5",
	"ap-southeast-7",
	"ca-central-1",
	"eu-central-1",
	"eu-central-2",
	"eu-west-1",
	"eu-west-2",
	"eu-west-3",
	"eu-north-1",
	"eu-south-1",
	"eu-south-2",
	"sa-east-1",
	"us-gov-east-1",
	"us-gov-west-1",
]

// Z-index constants for proper dropdown layering
const DROPDOWN_Z_INDEX = 1000

interface BedrockProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const BedrockProvider = ({ showModelOptions, isPopup, currentMode }: BedrockProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpoint)

	return (
		<div className="flex flex-col gap-1">
			<VSCodeRadioGroup
				onChange={async (e) => {
					const value = (e.target as HTMLInputElement)?.value
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								options: {
									awsAuthentication: value,
								},
							},
							updateMask: ["options.awsAuthentication"],
						}),
					)
				}}
				value={apiConfiguration?.awsAuthentication ?? (apiConfiguration?.awsProfile ? "profile" : "credentials")}>
				<VSCodeRadio value="apikey">API Key</VSCodeRadio>
				<VSCodeRadio value="profile">AWS Profile</VSCodeRadio>
				<VSCodeRadio value="credentials">AWS Credentials</VSCodeRadio>
			</VSCodeRadioGroup>

			{(apiConfiguration?.awsAuthentication === undefined && apiConfiguration?.awsUseProfile) ||
			apiConfiguration?.awsAuthentication === "profile" ? (
				<DebouncedTextField
					className="w-full"
					initialValue={apiConfiguration?.awsProfile ?? ""}
					key="profile"
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									options: {
										awsProfile: value,
									},
								},
								updateMask: ["options.awsProfile"],
							}),
						)
					}}
					placeholder="Enter profile name (default if empty)">
					<span className="font-medium">AWS Profile Name</span>
				</DebouncedTextField>
			) : apiConfiguration?.awsAuthentication === "apikey" ? (
				<DebouncedTextField
					className="w-full"
					initialValue={apiConfiguration?.awsBedrockApiKey ?? ""}
					key="apikey"
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									secrets: {
										awsBedrockApiKey: value,
									},
								},
								updateMask: ["secrets.awsBedrockApiKey"],
							}),
						)
					}}
					placeholder="Enter Bedrock Api Key"
					type="password">
					<span className="font-medium">AWS Bedrock Api Key</span>
				</DebouncedTextField>
			) : (
				<>
					<DebouncedTextField
						className="w-full"
						initialValue={apiConfiguration?.awsAccessKey || ""}
						key="accessKey"
						onChange={async (value) => {
							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create({
									updates: {
										secrets: {
											awsAccessKey: value,
										},
									},
									updateMask: ["secrets.awsAccessKey"],
								}),
							)
						}}
						placeholder="Enter Access Key..."
						type="password">
						<span className="font-medium">AWS Access Key</span>
					</DebouncedTextField>
					<DebouncedTextField
						className="w-full"
						initialValue={apiConfiguration?.awsSecretKey || ""}
						onChange={async (value) => {
							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create({
									updates: {
										secrets: {
											awsSecretKey: value,
										},
									},
									updateMask: ["secrets.awsSecretKey"],
								}),
							)
						}}
						placeholder="Enter Secret Key..."
						type="password">
						<span className="font-medium">AWS Secret Key</span>
					</DebouncedTextField>
					<DebouncedTextField
						className="w-full"
						initialValue={apiConfiguration?.awsSessionToken || ""}
						onChange={async (value) => {
							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create({
									updates: {
										secrets: {
											awsSessionToken: value,
										},
									},
									updateMask: ["secrets.awsSessionToken"],
								}),
							)
						}}
						placeholder="Enter Session Token..."
						type="password">
						<span className="font-medium">AWS Session Token</span>
					</DebouncedTextField>
				</>
			)}

			<Tooltip>
				<TooltipContent hidden={remoteConfigSettings?.awsRegion === undefined}>
					This setting is managed by your organization's remote configuration
				</TooltipContent>
				<TooltipTrigger>
					<DropdownContainer className="dropdown-container mb-2.5" zIndex={DROPDOWN_Z_INDEX - 1}>
						<div className="flex items-center gap-2 mb-1">
							<label htmlFor="aws-region-dropdown">
								<span className="font-medium">AWS Region</span>
							</label>
							{remoteConfigSettings?.awsRegion !== undefined && (
								<i className="codicon codicon-lock text-description text-sm flex items-center" />
							)}
						</div>
						<VSCodeDropdown
							className="w-full"
							disabled={remoteConfigSettings?.awsRegion !== undefined}
							id="aws-region-dropdown"
							onChange={async (e: any) => {
								await ModelsServiceClient.updateApiConfiguration(
									UpdateApiConfigurationRequestNew.create({
										updates: {
											options: {
												awsRegion: e.target.value,
											},
										},
										updateMask: ["options.awsRegion"],
									}),
								)
							}}
							value={apiConfiguration?.awsRegion || ""}>
							<VSCodeOption value="">Select a region...</VSCodeOption>
							{/* The user will have to choose a region that supports the model they use, but this shouldn't be a problem since they'd have to request access for it in that region in the first place. */}
							{AWS_REGIONS.map((region) => (
								<VSCodeOption key={region} value={region}>
									{region}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</DropdownContainer>
				</TooltipTrigger>
			</Tooltip>

			<div className="flex flex-col">
				<Tooltip>
					<TooltipContent hidden={remoteConfigSettings?.awsBedrockEndpoint === undefined}>
						This setting is managed by your organization's remote configuration
					</TooltipContent>
					<TooltipTrigger>
						<div className="flex items-center gap-2">
							<VSCodeCheckbox
								checked={awsEndpointSelected}
								disabled={remoteConfigSettings?.awsBedrockEndpoint !== undefined}
								onChange={async (e: any) => {
									const isChecked = e.target.checked === true
									setAwsEndpointSelected(isChecked)
									if (!isChecked) {
										await ModelsServiceClient.updateApiConfiguration(
											UpdateApiConfigurationRequestNew.create({
												updates: {
													options: {
														awsBedrockEndpoint: "",
													},
												},
												updateMask: ["options.awsBedrockEndpoint"],
											}),
										)
									}
								}}>
								Use custom VPC endpoint
							</VSCodeCheckbox>
							{remoteConfigSettings?.awsBedrockEndpoint !== undefined && (
								<i className="codicon codicon-lock text-description text-sm flex items-center" />
							)}
						</div>

						{awsEndpointSelected && (
							<DebouncedTextField
								className="mt-0.5 mb-1 text-sm text-description"
								disabled={remoteConfigSettings?.awsBedrockEndpoint !== undefined}
								initialValue={apiConfiguration?.awsBedrockEndpoint || ""}
								onChange={async (value) => {
									await ModelsServiceClient.updateApiConfiguration(
										UpdateApiConfigurationRequestNew.create({
											updates: {
												options: {
													awsBedrockEndpoint: value,
												},
											},
											updateMask: ["options.awsBedrockEndpoint"],
										}),
									)
								}}
								placeholder="Enter VPC Endpoint URL (optional)"
								type="text"
							/>
						)}
					</TooltipTrigger>
				</Tooltip>

				<Tooltip>
					<TooltipContent hidden={remoteConfigSettings?.awsUseCrossRegionInference === undefined}>
						This setting is managed by your organization's remote configuration
					</TooltipContent>
					<TooltipTrigger>
						<div className="flex items-center gap-2">
							<VSCodeCheckbox
								checked={apiConfiguration?.awsUseCrossRegionInference || false}
								disabled={remoteConfigSettings?.awsUseCrossRegionInference !== undefined}
								onChange={async (e: any) => {
									const isChecked = e.target.checked === true

									await ModelsServiceClient.updateApiConfiguration(
										UpdateApiConfigurationRequestNew.create({
											updates: {
												options: {
													awsUseCrossRegionInference: isChecked,
												},
											},
											updateMask: ["options.awsUseCrossRegionInference"],
										}),
									)
								}}>
								Use cross-region inference
							</VSCodeCheckbox>
							{remoteConfigSettings?.awsUseCrossRegionInference !== undefined && (
								<i className="codicon codicon-lock text-description text-sm" />
							)}
						</div>
					</TooltipTrigger>
				</Tooltip>

				{apiConfiguration?.awsUseCrossRegionInference && selectedModelInfo.supportsGlobalEndpoint && (
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.awsUseGlobalInference === undefined}>
							This setting is managed by your organization's remote configuration
						</TooltipContent>
						<TooltipTrigger>
							<div className="flex items-center gap-2">
								<VSCodeCheckbox
									checked={apiConfiguration?.awsUseGlobalInference || false}
									disabled={remoteConfigSettings?.awsUseGlobalInference !== undefined}
									onChange={async (e: any) => {
										const isChecked = e.target.checked === true
										await ModelsServiceClient.updateApiConfiguration(
											UpdateApiConfigurationRequestNew.create({
												updates: {
													options: {
														awsUseGlobalInference: isChecked,
													},
												},
												updateMask: ["options.awsUseGlobalInference"],
											}),
										)
									}}>
									Use global inference profile
								</VSCodeCheckbox>
								{remoteConfigSettings?.awsUseGlobalInference !== undefined && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>
				)}

				{selectedModelInfo.supportsPromptCache && (
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.awsBedrockUsePromptCache === undefined}>
							This setting is managed by your organization's remote configuration
						</TooltipContent>
						<TooltipTrigger>
							<div className="flex items-center gap-2">
								<VSCodeCheckbox
									checked={apiConfiguration?.awsBedrockUsePromptCache || false}
									disabled={remoteConfigSettings?.awsBedrockUsePromptCache !== undefined}
									onChange={async (e: any) => {
										const isChecked = e.target.checked === true
										await ModelsServiceClient.updateApiConfiguration(
											UpdateApiConfigurationRequestNew.create({
												updates: {
													options: {
														awsBedrockUsePromptCache: isChecked,
													},
												},
												updateMask: ["options.awsBedrockUsePromptCache"],
											}),
										)
									}}>
									Use prompt caching
								</VSCodeCheckbox>
								{remoteConfigSettings?.awsBedrockUsePromptCache !== undefined && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>
				)}
			</div>

			<p className="mt-1 text-sm text-description">
				{apiConfiguration?.awsUseProfile
					? "Using AWS Profile credentials from ~/.aws/credentials. Leave profile name empty to use the default profile. These credentials are only used locally to make API requests from this extension."
					: "Authenticate by either providing the keys above or use the default AWS credential providers, i.e. ~/.aws/credentials or environment variables. These credentials are only used locally to make API requests from this extension."}
			</p>

			{showModelOptions && (
				<>
					<label htmlFor="bedrock-model-dropdown">
						<span className="font-medium">Model</span>
					</label>
					<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 2}>
						<VSCodeDropdown
							className="w-full"
							id="bedrock-model-dropdown"
							onChange={async (e: any) => {
								const isCustom = e.target.value === "custom"

								await ModelsServiceClient.updateApiConfiguration(
									UpdateApiConfigurationRequestNew.create(
										currentMode === "plan"
											? {
													updates: {
														options: {
															planModeApiModelId: isCustom ? "" : e.target.value,
															planModeAwsBedrockCustomSelected: isCustom,
															planModeAwsBedrockCustomModelBaseId: bedrockDefaultModelId,
														},
													},
													updateMask: [
														"options.planModeApiModelId",
														"options.planModeAwsBedrockCustomSelected",
														"options.planModeAwsBedrockCustomModelBaseId",
													],
												}
											: {
													updates: {
														options: {
															actModeApiModelId: isCustom ? "" : e.target.value,
															actModeAwsBedrockCustomSelected: isCustom,
															actModeAwsBedrockCustomModelBaseId: bedrockDefaultModelId,
														},
													},
													updateMask: [
														"options.actModeApiModelId",
														"options.actModeAwsBedrockCustomSelected",
														"options.actModeAwsBedrockCustomModelBaseId",
													],
												},
									),
								)
							}}
							value={modeFields.awsBedrockCustomSelected ? "custom" : selectedModelId}>
							<VSCodeOption value="">Select a model...</VSCodeOption>
							{Object.keys(bedrockModels).map((modelId) => (
								<VSCodeOption
									className="whitespace-normal wrap-break-word max-w-full"
									key={modelId}
									value={modelId}>
									{modelId}
								</VSCodeOption>
							))}
							<VSCodeOption value="custom">Custom</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>

					{modeFields.awsBedrockCustomSelected && (
						<div>
							<p className="mt-1 text-sm text-description">
								Select "Custom" when using the Application Inference Profile in Bedrock. Enter the Application
								Inference Profile ARN in the Model ID field.
							</p>
							<DebouncedTextField
								className="w-full mt-0.5"
								id="bedrock-model-input"
								initialValue={modeFields.apiModelId || ""}
								onChange={async (value) => {
									await ModelsServiceClient.updateApiConfiguration(
										UpdateApiConfigurationRequestNew.create(
											currentMode === "plan"
												? {
														updates: { options: { planModeApiModelId: value } },
														updateMask: ["options.planModeApiModelId"],
													}
												: {
														updates: { options: { actModeApiModelId: value } },
														updateMask: ["options.actModeApiModelId"],
													},
										),
									)
								}}
								placeholder="Enter custom model ID...">
								<span className="font-medium">Model ID</span>
							</DebouncedTextField>
							<label htmlFor="bedrock-base-model-dropdown">
								<span className="font-medium">Base Inference Model</span>
							</label>
							<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 3}>
								<VSCodeDropdown
									className="w-full"
									id="bedrock-base-model-dropdown"
									onChange={async (e: any) => {
										await ModelsServiceClient.updateApiConfiguration(
											UpdateApiConfigurationRequestNew.create(
												currentMode === "plan"
													? {
															updates: {
																options: { planModeAwsBedrockCustomModelBaseId: e.target.value },
															},
															updateMask: ["options.planModeAwsBedrockCustomModelBaseId"],
														}
													: {
															updates: {
																options: { actModeAwsBedrockCustomModelBaseId: e.target.value },
															},
															updateMask: ["options.actModeAwsBedrockCustomModelBaseId"],
														},
											),
										)
									}}
									value={modeFields.awsBedrockCustomModelBaseId || bedrockDefaultModelId}>
									<VSCodeOption value="">Select a model...</VSCodeOption>
									{Object.keys(bedrockModels).map((modelId) => (
										<VSCodeOption
											className="whitespace-normal wrap-break-word max-w-full"
											key={modelId}
											value={modelId}>
											{modelId}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
							</DropdownContainer>
						</div>
					)}

					{(CLAUDE_MODELS.includes(selectedModelId) ||
						(modeFields.awsBedrockCustomSelected &&
							modeFields.awsBedrockCustomModelBaseId &&
							CLAUDE_MODELS.includes(modeFields.awsBedrockCustomModelBaseId))) && (
						<ThinkingBudgetSlider currentMode={currentMode} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
