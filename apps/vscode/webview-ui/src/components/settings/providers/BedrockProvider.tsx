import { openAiModelInfoSafeDefaults } from "@shared/api"
import BedrockData from "@shared/providers/bedrock.json"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "../utils/apiKeyMasking"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

const SUPPORTED_BEDROCK_THINKING_MODELS = [
	"anthropic.claude-sonnet-4-6",
	"anthropic.claude-3-7-sonnet-20250219-v1:0",
	"anthropic.claude-sonnet-4-20250514-v1:0",
	"anthropic.claude-sonnet-4-5-20250929-v1:0",
	"anthropic.claude-opus-4-1-20250805-v1:0",
	"anthropic.claude-opus-4-20250514-v1:0",
	"anthropic.claude-haiku-4-5-20251001-v1:0",
]

const AWS_REGIONS = BedrockData.regions

// Z-index constants for proper dropdown layering
const DROPDOWN_Z_INDEX = 1000

interface BedrockProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const BedrockProvider = ({ showModelOptions, isPopup, currentMode }: BedrockProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { models: bedrockModels, defaultModelId: bedrockDefaultModelId } = useProviderModels("bedrock")
	const { config, write, commitSelection } = useProviderConfig("bedrock")
	const { selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection("bedrock", currentMode, {
		models: bedrockModels,
		defaultModelId: bedrockDefaultModelId,
		config,
		commitSelection,
		customModelInfo: (modelId) => ({
			...(bedrockModels[config?.aws?.customModelBaseId ?? ""] ??
				bedrockModels[bedrockDefaultModelId] ??
				openAiModelInfoSafeDefaults),
			name: modelId,
		}),
	})
	const bedrockModelIds = useMemo(() => Object.keys(bedrockModels), [bedrockModels])
	const bedrockFallbackModelId = bedrockDefaultModelId || bedrockModelIds[0] || ""
	const customBaseModelId = config?.aws?.customModelBaseId || bedrockFallbackModelId
	const isCustomModelSelected = Boolean(config?.aws?.customModelBaseId)
	const customModelInputInitialValue = isCustomModelSelected && !bedrockModels[selectedModelId] ? selectedModelId : ""
	const isAdaptiveThinkingModel =
		isClaudeOpusAdaptiveThinkingModel(selectedModelId) || isClaudeOpusAdaptiveThinkingModel(customBaseModelId)
	const supportsGlobalInferenceProfile =
		selectedModelInfo.supportsGlobalEndpoint ||
		selectedModelId.startsWith("global.") ||
		Boolean(bedrockModels[`global.${selectedModelId}`])
	const modeFields =
		currentMode === "plan"
			? {
					reasoningEffort: apiConfiguration?.planModeReasoningEffort,
					thinkingBudgetTokens: apiConfiguration?.planModeThinkingBudgetTokens,
				}
			: {
					reasoningEffort: apiConfiguration?.actModeReasoningEffort,
					thinkingBudgetTokens: apiConfiguration?.actModeThinkingBudgetTokens,
				}
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none"
	const awsAuthentication =
		config?.aws?.authentication === "iam"
			? "credentials"
			: config?.aws?.authentication === "api-key"
				? "apikey"
				: config?.aws?.authentication
	const selectedAuthentication =
		awsAuthentication ?? (config?.apiKeyLength ? "apikey" : config?.aws?.profile ? "profile" : "credentials")
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Bedrock",
		write,
	})
	const accessKeyMask = getSavedApiKeyMask(config?.aws?.accessKeyLength)
	const secretKeyMask = getSavedApiKeyMask(config?.aws?.secretKeyLength)
	const sessionTokenMask = getSavedApiKeyMask(config?.aws?.sessionTokenLength)
	const handleAwsSecretChange = (
		field: "accessKey" | "secretKey" | "sessionToken",
		value: string,
		savedMask: string,
		label: string,
	) => {
		const sanitizedValue = sanitizeMaskedApiKeyInput(value, savedMask)
		if (sanitizedValue === undefined) {
			return
		}
		writeAws({ [field]: sanitizedValue }, label)
	}
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!config?.aws?.endpoint)

	// Region combobox state
	const currentRegion = config?.region || ""
	const [searchTerm, setSearchTerm] = useState("")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)
	const isSelectingRef = useRef(false)
	const authInteractionRef = useRef(false)

	useEffect(() => {
		setSearchTerm(currentRegion)
	}, [currentRegion])

	useEffect(() => {
		setAwsEndpointSelected(!!config?.aws?.endpoint)
	}, [config?.aws?.endpoint])

	const writeProviderConfig = (patch: Parameters<typeof write>[0], label: string) => {
		void write(patch).catch((err) => console.error(`Failed to update Bedrock ${label}:`, err))
	}
	const writeAws = (aws: NonNullable<Parameters<typeof write>[0]["aws"]>, label: string) => {
		writeProviderConfig({ aws }, label)
	}

	const fuse = useMemo(() => {
		return new Fuse(AWS_REGIONS, {
			threshold: 0.3,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [])

	const regionSearchResults = useMemo(() => {
		if (!searchTerm) {
			return AWS_REGIONS
		}
		return fuse.search(searchTerm).map((r) => r.item)
	}, [searchTerm, fuse])

	const handleRegionChange = (newRegion: string) => {
		setSearchTerm(newRegion)
		writeProviderConfig({ region: newRegion }, "region")
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < regionSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < regionSearchResults.length) {
					handleRegionChange(regionSearchResults[selectedIndex])
					setIsDropdownVisible(false)
				} else {
					// User typed a custom region
					handleRegionChange(searchTerm)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	// Reset selection when search term changes
	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	// Scroll selected item into view
	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	return (
		<div className="flex flex-col gap-1">
			<VSCodeRadioGroup
				onChange={(e) => {
					if (!authInteractionRef.current) {
						return
					}
					authInteractionRef.current = false
					const value = (e.target as HTMLInputElement)?.value
					if (value === selectedAuthentication) {
						return
					}
					const authentication = value === "credentials" ? "iam" : value
					writeProviderConfig({ aws: { authentication } }, "authentication")
				}}
				onKeyDown={() => {
					authInteractionRef.current = true
				}}
				onMouseDown={() => {
					authInteractionRef.current = true
				}}
				value={selectedAuthentication}>
				<VSCodeRadio checked={selectedAuthentication === "apikey"} value="apikey">
					API Key
				</VSCodeRadio>
				<VSCodeRadio checked={selectedAuthentication === "profile"} value="profile">
					AWS Profile
				</VSCodeRadio>
				<VSCodeRadio checked={selectedAuthentication === "credentials"} value="credentials">
					AWS Credentials
				</VSCodeRadio>
			</VSCodeRadioGroup>

			{selectedAuthentication === "profile" ? (
				<DebouncedTextField
					className="w-full"
					initialValue={config?.aws?.profile ?? ""}
					key="profile"
					onChange={(value) => writeAws({ profile: value }, "profile")}
					placeholder="Enter profile name (default if empty)">
					<span className="font-medium">AWS Profile Name</span>
				</DebouncedTextField>
			) : selectedAuthentication === "apikey" ? (
				<ApiKeyField
					helpText="This key is stored locally and only used to make API requests from this extension."
					initialValue={savedApiKeyMask}
					key="apikey"
					label="AWS Bedrock API 密钥"
					onChange={handleApiKeyChange}
					placeholder="Enter Bedrock Api Key"
					providerName="Bedrock"
				/>
			) : (
				<>
					<ApiKeyField
						helpText="This key is stored locally and only used to make API requests from this extension."
						initialValue={accessKeyMask}
						key="accessKey"
						label="AWS 访问密钥"
						onChange={(value) => handleAwsSecretChange("accessKey", value, accessKeyMask, "access key")}
						placeholder="Enter Access Key..."
						providerName="AWS"
					/>
					<ApiKeyField
						helpText="This key is stored locally and only used to make API requests from this extension."
						initialValue={secretKeyMask}
						label="AWS 秘密密钥"
						onChange={(value) => handleAwsSecretChange("secretKey", value, secretKeyMask, "secret key")}
						placeholder="Enter Secret Key..."
						providerName="AWS"
					/>
					<ApiKeyField
						helpText="This key is stored locally and only used to make API requests from this extension."
						initialValue={sessionTokenMask}
						label="AWS 会话令牌"
						onChange={(value) => handleAwsSecretChange("sessionToken", value, sessionTokenMask, "session token")}
						placeholder="Enter Session Token..."
						providerName="AWS"
					/>
				</>
			)}

			<Tooltip>
				<TooltipContent hidden={remoteConfigSettings?.awsRegion === undefined}>
					This setting is managed by your organization's remote configuration
				</TooltipContent>
				<TooltipTrigger>
					<DropdownContainer className="dropdown-container mb-2.5" zIndex={DROPDOWN_Z_INDEX - 1}>
						<div className="flex items-center gap-2 mb-1">
							<label htmlFor="aws-region">
								<span className="font-medium">AWS Region</span>
							</label>
							{remoteConfigSettings?.awsRegion !== undefined && (
								<i className="codicon codicon-lock text-description text-sm flex items-center" />
							)}
						</div>
						<RegionDropdownWrapper ref={dropdownRef}>
							<VSCodeTextField
								aria-autocomplete="list"
								aria-expanded={isDropdownVisible}
								disabled={remoteConfigSettings?.awsRegion !== undefined}
								id="aws-region"
								onBlur={() => {
									if (!isSelectingRef.current && searchTerm !== currentRegion) {
										handleRegionChange(searchTerm || currentRegion)
									}
									isSelectingRef.current = false
								}}
								onFocus={() => {
									setIsDropdownVisible(true)
									setSearchTerm("")
								}}
								onInput={(e) => {
									setSearchTerm((e.target as HTMLInputElement)?.value || "")
									setIsDropdownVisible(true)
								}}
								onKeyDown={handleKeyDown}
								placeholder="Search or enter custom region..."
								role="combobox"
								style={{
									width: "100%",
									zIndex: DROPDOWN_Z_INDEX - 1,
									position: "relative",
									minWidth: 130,
								}}
								value={searchTerm}>
								{searchTerm && searchTerm !== currentRegion && (
									<div
										aria-label="Clear search"
										className="input-icon-button codicon codicon-close"
										onClick={() => {
											setSearchTerm("")
											setIsDropdownVisible(true)
										}}
										slot="end"
										style={{
											display: "flex",
											justifyContent: "center",
											alignItems: "center",
											height: "100%",
										}}
									/>
								)}
							</VSCodeTextField>
							{isDropdownVisible && regionSearchResults.length > 0 && (
								<RegionDropdownList ref={dropdownListRef} role="listbox">
									{regionSearchResults.map((region, index) => (
										<RegionDropdownItem
											aria-selected={index === selectedIndex}
											isSelected={index === selectedIndex}
											key={region}
											onClick={() => {
												handleRegionChange(region)
												setIsDropdownVisible(false)
												isSelectingRef.current = false
											}}
											onMouseDown={() => {
												isSelectingRef.current = true
											}}
											onMouseEnter={() => setSelectedIndex(index)}
											ref={(el) => {
												itemRefs.current[index] = el
											}}
											role="option">
											<span>{region}</span>
										</RegionDropdownItem>
									))}
								</RegionDropdownList>
							)}
						</RegionDropdownWrapper>
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
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									setAwsEndpointSelected(isChecked)
									if (!isChecked) {
										writeAws({ endpoint: "" }, "endpoint")
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
								initialValue={config?.aws?.endpoint || ""}
								onChange={(value) => writeAws({ endpoint: value }, "endpoint")}
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
								checked={config?.aws?.useCrossRegionInference || false}
								disabled={remoteConfigSettings?.awsUseCrossRegionInference !== undefined}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true

									writeAws({ useCrossRegionInference: isChecked }, "cross-region inference")
								}}>
								Use cross-region inference
							</VSCodeCheckbox>
							{remoteConfigSettings?.awsUseCrossRegionInference !== undefined && (
								<i className="codicon codicon-lock text-description text-sm" />
							)}
						</div>
					</TooltipTrigger>
				</Tooltip>

				{config?.aws?.useCrossRegionInference && supportsGlobalInferenceProfile && (
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.awsUseGlobalInference === undefined}>
							This setting is managed by your organization's remote configuration
						</TooltipContent>
						<TooltipTrigger>
							<div className="flex items-center gap-2">
								<VSCodeCheckbox
									checked={config?.aws?.useGlobalInference || false}
									disabled={remoteConfigSettings?.awsUseGlobalInference !== undefined}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										writeAws({ useGlobalInference: isChecked }, "global inference")
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
									checked={config?.aws?.usePromptCache || false}
									disabled={remoteConfigSettings?.awsBedrockUsePromptCache !== undefined}
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										writeAws({ usePromptCache: isChecked }, "prompt caching")
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
				{selectedAuthentication === "profile"
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
							key={`bedrock-model-${isCustomModelSelected ? "custom" : selectedModelId}-${bedrockModelIds.length}`}
							onChange={(e: any) => {
								const value = e.target.value
								if (value === "custom") {
									writeAws(
										{ customModelBaseId: customBaseModelId || bedrockFallbackModelId },
										"custom base model",
									)
									return
								}
								writeAws({ customModelBaseId: "" }, "custom base model")
								void commitModelSelection({
									modelId: value,
									modelInfo: bedrockModels[value] ?? selectedModelInfo,
								}).catch((err) => console.error("Failed to commit Bedrock model selection:", err))
							}}
							value={isCustomModelSelected ? "custom" : selectedModelId}>
							<VSCodeOption value="">Select a model...</VSCodeOption>
							{bedrockModelIds.map((modelId) => (
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

					{isCustomModelSelected && (
						<div>
							<p className="mt-1 text-sm text-description">
								Select "Custom" when using the Application Inference Profile in Bedrock. Enter the Application
								Inference Profile ARN in the Model ID field.
							</p>
							<DebouncedTextField
								className="w-full mt-0.5"
								id="bedrock-model-input"
								initialValue={customModelInputInitialValue}
								key={`custom-${customModelInputInitialValue}`}
								onChange={(value) => {
									if (!value.trim()) {
										return
									}
									void commitModelSelection({
										modelId: value,
										modelInfo: bedrockModels[customBaseModelId] ?? selectedModelInfo,
									}).catch((err) => console.error("Failed to commit Bedrock custom model selection:", err))
								}}
								placeholder="输入自定义模型 ID...">
								<span className="font-medium">Model ID</span>
							</DebouncedTextField>
							<label htmlFor="bedrock-base-model-dropdown">
								<span className="font-medium">Base Inference Model</span>
							</label>
							<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 3}>
								<VSCodeDropdown
									className="w-full"
									id="bedrock-base-model-dropdown"
									key={`bedrock-base-model-${customBaseModelId || bedrockFallbackModelId}-${bedrockModelIds.length}`}
									onChange={(e: any) => writeAws({ customModelBaseId: e.target.value }, "custom base model")}
									value={customBaseModelId || bedrockFallbackModelId}>
									<VSCodeOption value="">Select a model...</VSCodeOption>
									{bedrockModelIds.map((modelId) => (
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

					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							label="自适应思考"
						/>
					) : SUPPORTED_BEDROCK_THINKING_MODELS.includes(selectedModelId) ||
						(isCustomModelSelected &&
							customBaseModelId &&
							SUPPORTED_BEDROCK_THINKING_MODELS.includes(customBaseModelId)) ? (
						<ThinkingBudgetSlider currentMode={currentMode} />
					) : null}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

const RegionDropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

const RegionDropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${DROPDOWN_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`

const RegionDropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;
	text-align: left;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`
