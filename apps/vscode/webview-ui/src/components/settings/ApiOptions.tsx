import type { ApiConfiguration } from "@shared/api"
import { toLegacyApiProvider, toVscodeSupportedProvider } from "@shared/model-catalog/provider-helpers"
import { getRemoteLockedProviderFieldPaths } from "@shared/model-catalog/remote-config-locks"
import { Mode } from "@shared/storage/types"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { CLINE_PASS_FEATURE_FLAG } from "@/constants/featureFlags"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHasFeatureFlag } from "@/hooks/useFeatureFlag"
import { useProviderListings } from "@/hooks/useProviderListings"
import { ClinePassProvider } from "./providers/ClinePassProvider"
import { ClineProvider } from "./providers/ClineProvider"
import { GenericProviderSettings } from "./providers/GenericProviderSettings"
import { OcaProvider } from "./providers/OcaProvider"
import { OpenAiCodexProvider } from "./providers/OpenAiCodexProvider"
import { VSCodeLmProvider } from "./providers/VSCodeLmProvider"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

// This is necessary to ensure dropdown opens downward, important for when this is used in popup.
export const DROPDOWN_Z_INDEX = 1_002

export const DropdownContainer = styled.div<{ zIndex?: number }>`
	position: relative;
	z-index: ${(props) => props.zIndex || DROPDOWN_Z_INDEX};

	// Force dropdowns to open downward
	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`

declare module "vscode" {
	interface LanguageModelChatSelector {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}
}

const ApiOptions = ({
	showModelOptions,
	apiErrorMessage,
	modelIdErrorMessage,
	isPopup,
	currentMode,
	initialModelTab,
}: ApiOptionsProps) => {
	// Use full context state for immediate save payload
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const isClinePassEnabled = useHasFeatureFlag(CLINE_PASS_FEATURE_FLAG)

	const selectedProviderRaw =
		(currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) || "anthropic"
	// Fall back from cline-pass to cline when the feature flag is off.
	const selectedProvider =
		selectedProviderRaw === "cline-pass" && !isClinePassEnabled ? "cline" : toVscodeSupportedProvider(selectedProviderRaw)
	const { providers: catalogProviderListings } = useProviderListings()
	const catalogProviderListing = useMemo(
		() =>
			catalogProviderListings.find(
				(provider) => provider.id === selectedProvider || toLegacyApiProvider(provider.id) === selectedProvider,
			),
		[catalogProviderListings, selectedProvider],
	)
	const configValuesJson = useMemo(
		() =>
			catalogProviderListing
				? withModeSpecificConfigValues(
						catalogProviderListing.id,
						catalogProviderListing.configValuesJson,
						apiConfiguration,
						currentMode,
					)
				: undefined,
		[catalogProviderListing, apiConfiguration, currentMode],
	)
	const lockedFieldPaths = useMemo(
		() =>
			catalogProviderListing ? [...getRemoteLockedProviderFieldPaths(remoteConfigSettings, catalogProviderListing.id)] : [],
		[catalogProviderListing, remoteConfigSettings],
	)

	const { handleModeFieldChange } = useApiConfigurationHandlers()

	// Provider search state
	const [searchTerm, setSearchTerm] = useState("")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const providerOptions = useMemo(() => {
		let providers = catalogProviderListings.map((provider) => ({
			sdkId: provider.id,
			value: toLegacyApiProvider(provider.id),
			label: `${provider.name}${provider.authMethod === "oauth" ? " (OAuth)" : ""}`,
		}))
		if (PLATFORM_CONFIG.type === PlatformType.VSCODE && !providers.some((option) => option.value === "vscode-lm")) {
			providers.push({
				sdkId: "vscode-lm",
				value: "vscode-lm",
				label: "GitHub Copilot",
			})
		}
		if (!isClinePassEnabled) {
			providers = providers.filter((option) => option.value !== "cline-pass")
		}
		// Filter by platform
		if (PLATFORM_CONFIG.type !== PlatformType.VSCODE) {
			// Don't include VS Code LM API for non-VSCode platforms
			providers = providers.filter((option) => option.value !== "vscode-lm")
		}

		// Filter by remote config if remoteConfiguredProviders is set
		const remoteProviders: string[] = remoteConfigSettings?.remoteConfiguredProviders || []
		if (remoteProviders.length > 0) {
			providers = providers.filter(
				(option) => remoteProviders.includes(option.value) || remoteProviders.includes(option.sdkId),
			)
		}

		return providers
	}, [catalogProviderListings, isClinePassEnabled, remoteConfigSettings])

	const currentProviderLabel = useMemo(() => {
		return (
			providerOptions.find((option) => option.value === selectedProvider || option.sdkId === selectedProvider)?.label ||
			selectedProvider
		)
	}, [providerOptions, selectedProvider])

	// Sync search term with current provider when not searching
	useEffect(() => {
		if (!isDropdownVisible) {
			setSearchTerm(currentProviderLabel)
		}
	}, [currentProviderLabel, isDropdownVisible])

	const searchableItems = useMemo(() => {
		return providerOptions.map((option) => ({
			value: option.value,
			html: option.label,
		}))
	}, [providerOptions])

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["html"],
			threshold: 0.3,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [searchableItems])

	const providerSearchResults = useMemo(() => {
		return searchTerm && searchTerm !== currentProviderLabel ? fuse.search(searchTerm)?.map((r) => r.item) : searchableItems
	}, [searchableItems, searchTerm, fuse, currentProviderLabel])

	const handleProviderChange = (newProvider: string) => {
		handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, newProvider as any, currentMode)
		setIsDropdownVisible(false)
		setSelectedIndex(-1)
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < providerSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < providerSearchResults.length) {
					handleProviderChange(providerSearchResults[selectedIndex].value)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				setSearchTerm(currentProviderLabel)
				break
		}
	}

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
				setSearchTerm(currentProviderLabel)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [currentProviderLabel])

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

	/*
	VSCodeDropdown has an open bug where dynamically rendered options don't auto select the provided value prop. You can see this for yourself by comparing  it with normal select/option elements, which work as expected.
	https://github.com/microsoft/vscode-webview-ui-toolkit/issues/433

	In our case, when the user switches between providers, we recalculate the selectedModelId depending on the provider, the default model for that provider, and a modelId that the user may have selected. Unfortunately, the VSCodeDropdown component wouldn't select this calculated value, and would default to the first "Select a model..." option instead, which makes it seem like the model was cleared out when it wasn't.

	As a workaround, we create separate instances of the dropdown for each provider, and then conditionally render the one that matches the current provider.
	*/

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: isPopup ? -10 : 0 }}>
			<style>
				{`
				.provider-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<DropdownContainer className="dropdown-container">
				{remoteConfigSettings?.remoteConfiguredProviders && remoteConfigSettings.remoteConfiguredProviders.length > 0 ? (
					<Tooltip>
						<TooltipTrigger>
							<div className="flex items-center gap-2 mb-1">
								<label htmlFor="api-provider">
									<span style={{ fontWeight: 500 }}>API Provider</span>
								</label>
								<i className="codicon codicon-lock text-description text-sm" />
							</div>
						</TooltipTrigger>
						<TooltipContent>Provider options are managed by your organization's remote configuration</TooltipContent>
					</Tooltip>
				) : (
					<label htmlFor="api-provider">
						<span style={{ fontWeight: 500 }}>API Provider</span>
					</label>
				)}
				<ProviderDropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						data-testid="provider-selector-input"
						id="api-provider"
						onFocus={() => {
							setIsDropdownVisible(true)
							setSearchTerm("")
						}}
						onInput={(e) => {
							setSearchTerm((e.target as HTMLInputElement)?.value || "")
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search and select provider..."
						role="combobox"
						style={{
							width: "100%",
							zIndex: DROPDOWN_Z_INDEX,
							position: "relative",
							minWidth: 130,
						}}
						value={searchTerm}>
						{searchTerm && searchTerm !== currentProviderLabel && (
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
					{isDropdownVisible && (
						<ProviderDropdownList ref={dropdownListRef} role="listbox">
							{providerSearchResults.map((item, index) => (
								<ProviderDropdownItem
									data-testid={`provider-option-${item.value}`}
									isSelected={index === selectedIndex}
									key={item.value}
									onClick={() => handleProviderChange(item.value)}
									onMouseEnter={() => setSelectedIndex(index)}
									ref={(el) => {
										itemRefs.current[index] = el
									}}
									role="option">
									<span>{item.html}</span>
								</ProviderDropdownItem>
							))}
						</ProviderDropdownList>
					)}
				</ProviderDropdownWrapper>
			</DropdownContainer>

			{apiConfiguration && selectedProvider === "cline" && (
				<ClineProvider
					currentMode={currentMode}
					initialModelTab={initialModelTab}
					isPopup={isPopup}
					showModelOptions={showModelOptions}
				/>
			)}

			{apiConfiguration && isClinePassEnabled && selectedProvider === "cline-pass" && (
				<ClinePassProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />
			)}

			{apiConfiguration && selectedProvider === "openai-codex" && (
				<OpenAiCodexProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />
			)}

			{apiConfiguration && selectedProvider === "vscode-lm" && <VSCodeLmProvider currentMode={currentMode} />}

			{apiConfiguration && selectedProvider === "oca" && (
				<OcaProvider
					configFields={catalogProviderListing?.configFields?.filter(
						(field) => field.path !== "oca.mode" && field.path !== "apiKey",
					)}
					configValuesJson={configValuesJson}
					currentMode={currentMode}
					isPopup={isPopup}
					lockedFieldPaths={lockedFieldPaths}
				/>
			)}

			{apiConfiguration &&
				catalogProviderListing &&
				!["cline", "cline-pass", "openai-codex", "vscode-lm", "oca"].includes(selectedProvider) && (
					<GenericProviderSettings
						allowsCustomIds={catalogProviderListing.allowsCustomModelIds}
						configFields={catalogProviderListing.configFields}
						configValuesJson={configValuesJson}
						currentMode={currentMode}
						isPopup={isPopup}
						key={catalogProviderListing.id}
						lockedFieldPaths={lockedFieldPaths}
						providerId={catalogProviderListing.id}
						providerName={catalogProviderListing.name}
						showModelOptions={showModelOptions}
					/>
				)}

			{apiErrorMessage && (
				<p
					style={{
						margin: "-10px 0 4px 0",
						fontSize: 12,
						color: "var(--vscode-errorForeground)",
					}}>
					{apiErrorMessage}
				</p>
			)}
			{modelIdErrorMessage && (
				<p
					style={{
						margin: "-10px 0 4px 0",
						fontSize: 12,
						color: "var(--vscode-errorForeground)",
					}}>
					{modelIdErrorMessage}
				</p>
			)}
		</div>
	)
}

export default ApiOptions

function readModeString(
	apiConfiguration: Partial<ApiConfiguration> | undefined,
	currentMode: Mode,
	keys: { readonly plan: keyof ApiConfiguration; readonly act: keyof ApiConfiguration },
): string | undefined {
	const value = apiConfiguration?.[currentMode === "plan" ? keys.plan : keys.act]
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function withModeSpecificConfigValues(
	providerId: string,
	configValuesJson: Record<string, string> | undefined,
	apiConfiguration: Partial<ApiConfiguration> | undefined,
	currentMode: Mode,
): Record<string, string> | undefined {
	const provider = toLegacyApiProvider(providerId)
	const next = { ...(configValuesJson ?? {}) }

	if (provider === "bedrock") {
		const customModelBaseId = readModeString(apiConfiguration, currentMode, {
			plan: "planModeAwsBedrockCustomModelBaseId",
			act: "actModeAwsBedrockCustomModelBaseId",
		})
		if (customModelBaseId) {
			next["aws.customModelBaseId"] = JSON.stringify(customModelBaseId)
		}
	}

	if (provider === "sapaicore") {
		const deploymentId = readModeString(apiConfiguration, currentMode, {
			plan: "planModeSapAiCoreDeploymentId",
			act: "actModeSapAiCoreDeploymentId",
		})
		if (deploymentId) {
			next["sap.deploymentId"] = JSON.stringify(deploymentId)
		}
	}

	return Object.keys(next).length > 0 ? next : undefined
}

const ProviderDropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

const ProviderDropdownList = styled.div`
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

const ProviderDropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`
