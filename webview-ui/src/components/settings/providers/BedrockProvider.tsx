import { bedrockDefaultModelId, bedrockModels, CLAUDE_SONNET_1M_SUFFIX } from "@shared/api"
import BedrockData from "@shared/providers/bedrock.json"
import type { Mode } from "@shared/storage/types"
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
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

export const SUPPORTED_BEDROCK_THINKING_MODELS = [
	"anthropic.claude-opus-4-6-v1",
	`anthropic.claude-opus-4-6-v1${CLAUDE_SONNET_1M_SUFFIX}`,
	"anthropic.claude-sonnet-4-6",
	`anthropic.claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`,
	"anthropic.claude-3-7-sonnet-20250219-v1:0",
	"anthropic.claude-sonnet-4-20250514-v1:0",
	"anthropic.claude-sonnet-4-5-20250929-v1:0",
	`anthropic.claude-sonnet-4-20250514-v1:0${CLAUDE_SONNET_1M_SUFFIX}`,
	`anthropic.claude-sonnet-4-5-20250929-v1:0${CLAUDE_SONNET_1M_SUFFIX}`,
	"anthropic.claude-opus-4-5-20251101-v1:0",
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
	const { handleFieldChange, handleModeFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpoint)

	// Region combobox state
	const currentRegion = apiConfiguration?.awsRegion || ""
	const [searchTerm, setSearchTerm] = useState("")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)
	const isSelectingRef = useRef(false)

	useEffect(() => {
		setSearchTerm(currentRegion)
	}, [currentRegion])

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
		handleFieldChange("awsRegion", newRegion)
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
					const value = (e.target as HTMLInputElement)?.value
					handleFieldChange("awsAuthentication", value)
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
					onChange={(value) => handleFieldChange("awsProfile", value)}
					placeholder="Enter profile name (default if empty)">
					<span className="font-medium">AWS Profile Name</span>
				</DebouncedTextField>
			) : apiConfiguration?.awsAuthentication === "apikey" ? (
				<DebouncedTextField
					className="w-full"
					initialValue={apiConfiguration?.awsBedrockApiKey ?? ""}
					key="apikey"
					onChange={(value) => handleFieldChange("awsBedrockApiKey", value)}
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
						onChange={(value) => handleFieldChange("awsAccessKey", value)}
						placeholder="Enter Access Key..."
						type="password">
						<span className="font-medium">AWS Access Key</span>
					</DebouncedTextField>
					<DebouncedTextField
						className="w-full"
						initialValue={apiConfiguration?.awsSecretKey || ""}
						onChange={(value) => handleFieldChange("awsSecretKey", value)}
						placeholder="Enter Secret Key..."
						type="password">
						<span className="font-medium">AWS Secret Key</span>
					</DebouncedTextField>
					<DebouncedTextField
						className="w-full"
						initialValue={apiConfiguration?.awsSessionToken || ""}
						onChange={(value) => handleFieldChange("awsSessionToken", value)}
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
										handleFieldChange("awsBedrockEndpoint", "")
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
								onChange={(value) => handleFieldChange("awsBedrockEndpoint", value)}
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
								onChange={(e: any) => {
									const isChecked = e.target.checked === true

									handleFieldChange("awsUseCrossRegionInference", isChecked)
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
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										handleFieldChange("awsUseGlobalInference", isChecked)
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
									onChange={(e: any) => {
										const isChecked = e.target.checked === true
										handleFieldChange("awsBedrockUsePromptCache", isChecked)
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
								onChange={(value) =>
									handleModeFieldChange(
										{ plan: "planModeApiModelId", act: "actModeApiModelId" },
										value,
										currentMode,
									)
								}
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

					{(SUPPORTED_BEDROCK_THINKING_MODELS.includes(selectedModelId) ||
						(modeFields.awsBedrockCustomSelected &&
							modeFields.awsBedrockCustomModelBaseId &&
							SUPPORTED_BEDROCK_THINKING_MODELS.includes(modeFields.awsBedrockCustomModelBaseId))) && (
						<ThinkingBudgetSlider currentMode={currentMode} />
					)}

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
