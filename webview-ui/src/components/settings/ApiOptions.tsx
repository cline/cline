import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { ProviderListItem, UpdateSdkProviderSelectionRequest } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInterval } from "react-use"
import styled from "styled-components"
import { normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"
import { BedrockProvider } from "./providers/BedrockProvider"
import { ClaudeCodeProvider } from "./providers/ClaudeCodeProvider"
import { ClineProvider } from "./providers/ClineProvider"
import { GenericSdkProvider } from "./providers/GenericSdkProvider"
import { LiteLlmProvider } from "./providers/LiteLlmProvider"
import { LMStudioProvider } from "./providers/LMStudioProvider"
import { OcaProvider } from "./providers/OcaProvider"
import { OllamaProvider } from "./providers/OllamaProvider"
import { OpenAICompatibleProvider } from "./providers/OpenAICompatible"
import { OpenAiCodexProvider } from "./providers/OpenAiCodexProvider"
import { OpenRouterProvider } from "./providers/OpenRouterProvider"
import { QwenCodeProvider } from "./providers/QwenCodeProvider"
import { QwenProvider } from "./providers/QwenProvider"
import { RequestyProvider } from "./providers/RequestyProvider"
import { SapAiCoreProvider } from "./providers/SapAiCoreProvider"
import { VertexProvider } from "./providers/VertexProvider"
import { VSCodeLmProvider } from "./providers/VSCodeLmProvider"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

// This is necessary to ensure dropdown opens downward, important for when this is used in popup
export const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX + 2 // Higher than the OpenRouterModelPicker's and ModelSelectorTooltip's z-index

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

interface ProviderOption {
	value: string
	label: string
	provider: ProviderListItem
}

// Providers that still need custom legacy settings forms because their setup is
// more than the generic SDK shape of API key + base URL + model selection.
// Everything else is rendered by GenericSdkProvider.
const CUSTOM_SETTINGS_PROVIDER_IDS = new Set([
	"bedrock",
	"claude-code",
	"cline",
	"litellm",
	"lmstudio",
	"oca",
	"ollama",
	"openai",
	"openai-codex",
	"openrouter",
	"qwen",
	"qwen-code",
	"requesty",
	"sapaicore",
	"vertex",
	"vscode-lm",
])

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

	const { selectedProvider: stateSelectedProvider, selectedModelId } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const [pendingSelectedProvider, setPendingSelectedProvider] = useState<string | undefined>(undefined)
	const selectedProvider = pendingSelectedProvider || stateSelectedProvider

	useEffect(() => {
		if (pendingSelectedProvider && stateSelectedProvider === pendingSelectedProvider) {
			setPendingSelectedProvider(undefined)
		}
	}, [pendingSelectedProvider, stateSelectedProvider])

	const [_ollamaModels, setOllamaModels] = useState<string[]>([])
	const [sdkProviderOptions, setSdkProviderOptions] = useState<ProviderOption[]>([])

	useEffect(() => {
		let cancelled = false

		ModelsServiceClient.listSdkProviders(EmptyRequest.create({}))
			.then((response) => {
				if (cancelled) {
					return
				}

				setSdkProviderOptions(
					response.providers.map((provider) => ({
						value: provider.id,
						label: provider.name || provider.id,
						provider,
					})),
				)
			})
			.catch((error) => {
				console.error("Failed to fetch SDK providers:", error)
			})

		return () => {
			cancelled = true
		}
	}, [])

	// Poll ollama/vscode-lm models
	const requestLocalModels = useCallback(async () => {
		if (selectedProvider === "ollama") {
			try {
				const response = await ModelsServiceClient.getOllamaModels(
					StringRequest.create({
						value: apiConfiguration?.ollamaBaseUrl || "",
					}),
				)
				if (response && response.values) {
					setOllamaModels(response.values)
				}
			} catch (error) {
				console.error("Failed to fetch Ollama models:", error)
				setOllamaModels([])
			}
		}
	}, [selectedProvider, apiConfiguration?.ollamaBaseUrl])
	useEffect(() => {
		if (selectedProvider === "ollama") {
			requestLocalModels()
		}
	}, [selectedProvider, requestLocalModels])
	useInterval(requestLocalModels, selectedProvider === "ollama" ? 2000 : null)

	// Provider search state
	const [searchTerm, setSearchTerm] = useState("")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const providerOptions = useMemo(() => {
		let providers = sdkProviderOptions
		// Filter by platform
		if (PLATFORM_CONFIG.type !== PlatformType.VSCODE) {
			// Don't include VS Code LM API for non-VSCode platforms
			providers = providers.filter((option) => option.value !== "vscode-lm")
		}

		// Filter by remote config if remoteConfiguredProviders is set
		const remoteProviders: string[] = remoteConfigSettings?.remoteConfiguredProviders || []
		if (remoteProviders.length > 0) {
			providers = providers.filter((option) => remoteProviders.includes(option.value))
		}

		return providers
	}, [remoteConfigSettings, sdkProviderOptions])

	const currentProviderLabel = useMemo(() => {
		return providerOptions.find((option) => option.value === selectedProvider)?.label || selectedProvider
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

	const selectedSdkProvider = useMemo(() => {
		const provider = providerOptions.find((option) => option.value === selectedProvider)?.provider
		if (provider) {
			return provider
		}
		if (CUSTOM_SETTINGS_PROVIDER_IDS.has(selectedProvider)) {
			return undefined
		}
		return {
			id: selectedProvider,
			name: selectedProvider,
			models: undefined,
			enabled: false,
			authDescription: "This provider uses API keys for authentication.",
			baseUrlDescription: "The base endpoint to use for provider requests.",
			modelList: [],
		}
	}, [providerOptions, selectedProvider])

	const handleProviderChange = (newProvider: string) => {
		const provider = sdkProviderOptions.find((option) => option.value === newProvider)?.provider
		setPendingSelectedProvider(newProvider)
		ModelsServiceClient.updateSdkProviderSelection(
			UpdateSdkProviderSelectionRequest.create({
				providerId: newProvider,
				mode: currentMode,
				modelId: provider?.defaultModelId || provider?.modelList[0]?.id || undefined,
			}),
		).catch((error) => {
			setPendingSelectedProvider(undefined)
			console.error("Failed to update SDK provider selection:", error)
		})
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

	const customProviderRenderers: Record<string, () => JSX.Element> = {
		bedrock: () => <BedrockProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		"claude-code": () => (
			<ClaudeCodeProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />
		),
		cline: () => (
			<ClineProvider
				currentMode={currentMode}
				initialModelTab={initialModelTab}
				isPopup={isPopup}
				showModelOptions={showModelOptions}
			/>
		),
		litellm: () => <LiteLlmProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		lmstudio: () => <LMStudioProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		oca: () => <OcaProvider currentMode={currentMode} isPopup={isPopup} />,
		ollama: () => <OllamaProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		openai: () => (
			<OpenAICompatibleProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />
		),
		"openai-codex": () => (
			<OpenAiCodexProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />
		),
		openrouter: () => (
			<OpenRouterProvider
				currentMode={currentMode}
				isPopup={isPopup}
				provider={selectedSdkProvider}
				showModelOptions={showModelOptions}
			/>
		),
		qwen: () => <QwenProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		"qwen-code": () => <QwenCodeProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		requesty: () => <RequestyProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		sapaicore: () => <SapAiCoreProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		vertex: () => <VertexProvider currentMode={currentMode} isPopup={isPopup} showModelOptions={showModelOptions} />,
		"vscode-lm": () => <VSCodeLmProvider currentMode={currentMode} />,
	}
	const renderCustomProvider = customProviderRenderers[selectedProvider]

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

			{apiConfiguration && renderCustomProvider?.()}

			{apiConfiguration && selectedSdkProvider && !renderCustomProvider && (
				<GenericSdkProvider
					currentMode={currentMode}
					provider={selectedSdkProvider}
					selectedModelId={selectedModelId}
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
