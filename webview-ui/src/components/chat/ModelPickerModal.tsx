import type { ModelInfo as ModelInfoType } from "@shared/api"
import { ANTHROPIC_MAX_THINKING_BUDGET, ANTHROPIC_MIN_THINKING_BUDGET, ApiProvider } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Mode } from "@shared/storage/types"
import { ArrowLeftRight, Brain, Check, ChevronDownIcon, Search, Settings } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useWindowSize } from "react-use"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import PopupModalContainer from "@/components/common/PopupModalContainer"

const PLAN_MODE_COLOR = "var(--vscode-activityWarningBadge-background)"
const ACT_MODE_COLOR = "var(--vscode-focusBorder)"

const SETTINGS_ONLY_PROVIDERS: ApiProvider[] = [
	"openai",
	"ollama",
	"lmstudio",
	"vscode-lm",
	"litellm",
	"requesty",
	"hicap",
	"dify",
	"oca",
	"aihubmix",
	"together",
]

// Helper to get provider-specific configuration info and empty state guidance
const getProviderInfo = (
	provider: ApiProvider,
	apiConfiguration: any,
	effectiveMode: "plan" | "act",
): { modelId?: string; baseUrl?: string; helpText: string } => {
	switch (provider) {
		case "lmstudio":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeLmStudioModelId : apiConfiguration.actModeLmStudioModelId,
				baseUrl: apiConfiguration.lmStudioBaseUrl,
				helpText: "Start LM Studio and load a model to begin",
			}
		case "ollama":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeOllamaModelId : apiConfiguration.actModeOllamaModelId,
				baseUrl: apiConfiguration.ollamaBaseUrl,
				helpText: "Run `ollama serve` and pull a model",
			}
		case "litellm":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeLiteLlmModelId : apiConfiguration.actModeLiteLlmModelId,
				baseUrl: apiConfiguration.liteLlmBaseUrl,
				helpText: "Add your LiteLLM proxy URL in settings",
			}
		case "openai":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeOpenAiModelId : apiConfiguration.actModeOpenAiModelId,
				baseUrl: apiConfiguration.openAiBaseUrl,
				helpText: "Add your OpenAI API key and endpoint",
			}
		case "vscode-lm":
			return {
				modelId: undefined,
				baseUrl: undefined,
				helpText: "Select a VS Code language model from settings",
			}
		case "requesty":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeRequestyModelId : apiConfiguration.actModeRequestyModelId,
				baseUrl: apiConfiguration.requestyBaseUrl,
				helpText: "Add your Requesty API key in settings",
			}
		case "together":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeTogetherModelId : apiConfiguration.actModeTogetherModelId,
				baseUrl: undefined,
				helpText: "Add your Together AI API key in settings",
			}
		case "dify":
			return {
				modelId: undefined,
				baseUrl: apiConfiguration.difyBaseUrl,
				helpText: "Configure your Dify workflow URL and API key",
			}
		case "hicap":
			return {
				modelId: effectiveMode === "plan" ? apiConfiguration.planModeHicapModelId : apiConfiguration.actModeHicapModelId,
				baseUrl: undefined,
				helpText: "Add your HiCap API key in settings",
			}
		case "oca":
			return {
				modelId: effectiveMode === "plan" ? apiConfiguration.planModeOcaModelId : apiConfiguration.actModeOcaModelId,
				baseUrl: apiConfiguration.ocaBaseUrl,
				helpText: "Configure your OCA endpoint in settings",
			}
		case "aihubmix":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeAihubmixModelId : apiConfiguration.actModeAihubmixModelId,
				baseUrl: apiConfiguration.aihubmixBaseUrl,
				helpText: "Add your AIHubMix API key in settings",
			}
		default:
			return {
				modelId: undefined,
				baseUrl: undefined,
				helpText: "Configure this provider in model settings",
			}
	}
}

const OPENROUTER_MODEL_PROVIDERS: ApiProvider[] = ["cline", "openrouter", "vercel-ai-gateway"]

import { freeModels, recommendedModels } from "@/components/settings/OpenRouterModelPicker"
import { SUPPORTED_ANTHROPIC_THINKING_MODELS } from "@/components/settings/providers/AnthropicProvider"
import { SUPPORTED_BEDROCK_THINKING_MODELS } from "@/components/settings/providers/BedrockProvider"
import {
	filterOpenRouterModelIds,
	getModelsForProvider,
	getModeSpecificFields,
	normalizeApiConfiguration,
	syncModeConfigurations,
} from "@/components/settings/utils/providerUtils"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { getConfiguredProviders, getProviderLabel } from "@/utils/getConfiguredProviders"

interface ModelPickerModalProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	currentMode: Mode
	children: React.ReactNode
}

interface ModelItem {
	id: string
	name: string
	provider?: string
	description?: string
	label?: string
	info?: ModelInfoType
}

// Star icon for favorites (only for openrouter/vercel-ai-gateway providers)
const StarIcon = ({ isFavorite, onClick }: { isFavorite: boolean; onClick: (e: React.MouseEvent) => void }) => {
	return (
		<div
			onClick={onClick}
			style={{
				cursor: "pointer",
				color: isFavorite ? "var(--vscode-terminal-ansiYellow)" : "var(--vscode-descriptionForeground)",
				marginLeft: "8px",
				fontSize: "14px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}>
			{isFavorite ? "★" : "☆"}
		</div>
	)
}

const ModelPickerModal: React.FC<ModelPickerModalProps> = ({ isOpen, onOpenChange, currentMode, children }) => {
	const {
		apiConfiguration,
		openRouterModels,
		navigateToSettings,
		planActSeparateModelsSetting,
		showSettings,
		showMcp,
		showHistory,
		showAccount,
		favoritedModelIds,
	} = useExtensionState()
	const { handleModeFieldChange, handleModeFieldsChange, handleFieldsChange } = useApiConfigurationHandlers()

	const [searchQuery, setSearchQuery] = useState("")
	const [activeEditMode, setActiveEditMode] = useState<Mode>(currentMode) // which mode we're editing in split view
	const [menuPosition, setMenuPosition] = useState(0)
	const [arrowPosition, setArrowPosition] = useState(0)
	const [isProviderExpanded, setIsProviderExpanded] = useState(false)
	const [providerDropdownPosition, setProviderDropdownPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 200 })
	const [selectedIndex, setSelectedIndex] = useState(-1) // For keyboard navigation
	const searchInputRef = useRef<HTMLInputElement>(null)
	const triggerRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const providerRowRef = useRef<HTMLDivElement>(null)
	const providerDropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([]) // For scrollIntoView
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()

	// Get current provider from config - use activeEditMode when in split mode
	const effectiveMode = planActSeparateModelsSetting ? activeEditMode : currentMode
	const { selectedProvider, selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, effectiveMode)

	// Get both Plan and Act models for split view
	const planModel = useMemo(() => normalizeApiConfiguration(apiConfiguration, "plan"), [apiConfiguration])
	const actModel = useMemo(() => normalizeApiConfiguration(apiConfiguration, "act"), [apiConfiguration])

	// Use the setting for split mode
	const isSplit = planActSeparateModelsSetting

	// Check if model supports thinking
	const supportsThinking = useMemo(() => {
		if (selectedProvider === "anthropic" || selectedProvider === "claude-code") {
			return SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId)
		}
		if (selectedProvider === "bedrock") {
			return SUPPORTED_BEDROCK_THINKING_MODELS.includes(selectedModelId)
		}
		return selectedModelInfo?.supportsReasoning || !!selectedModelInfo?.thinkingConfig
	}, [selectedProvider, selectedModelId, selectedModelInfo])

	// Get thinking budget from current mode config
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const thinkingBudget = modeFields.thinkingBudgetTokens || 0
	const thinkingEnabled = thinkingBudget > 0

	// Handle thinking toggle - uses ANTHROPIC_MIN_THINKING_BUDGET as default when enabling
	const handleThinkingToggle = useCallback(
		(enabled: boolean) => {
			const budget = enabled ? ANTHROPIC_MIN_THINKING_BUDGET : 0
			handleModeFieldChange(
				{ plan: "planModeThinkingBudgetTokens", act: "actModeThinkingBudgetTokens" },
				budget,
				currentMode,
			)
		},
		[handleModeFieldChange, currentMode],
	)

	// Handle thinking budget slider change
	const handleThinkingBudgetChange = useCallback(
		(value: number) => {
			handleModeFieldChange(
				{ plan: "planModeThinkingBudgetTokens", act: "actModeThinkingBudgetTokens" },
				value,
				currentMode,
			)
		},
		[handleModeFieldChange, currentMode],
	)

	// Get configured providers
	const configuredProviders = useMemo(() => {
		return getConfiguredProviders(apiConfiguration)
	}, [apiConfiguration])

	// Get models for current provider
	const allModels = useMemo((): ModelItem[] => {
		if (OPENROUTER_MODEL_PROVIDERS.includes(selectedProvider)) {
			const modelIds = Object.keys(openRouterModels || {})
			const filteredIds = filterOpenRouterModelIds(modelIds, selectedProvider)

			return filteredIds.map((id) => ({
				id,
				name: id.split("/").pop() || id,
				provider: id.split("/")[0],
				info: openRouterModels[id],
			}))
		}

		// Use centralized helper for static provider models
		const models = getModelsForProvider(selectedProvider, apiConfiguration)
		if (models) {
			return Object.entries(models).map(([id, info]) => ({
				id,
				name: id,
				provider: selectedProvider,
				info,
			}))
		}

		return []
	}, [selectedProvider, openRouterModels, apiConfiguration])

	// Multi-word substring search - all words must match somewhere in id/name/provider
	const matchesSearch = useCallback((model: ModelItem, query: string): boolean => {
		if (!query.trim()) return true
		const queryWords = query.toLowerCase().trim().split(/\s+/)
		const searchText = `${model.id} ${model.name} ${model.provider || ""}`.toLowerCase()
		return queryWords.every((word) => searchText.includes(word))
	}, [])

	// Filtered models - for OpenRouter/Vercel show all by default, for Cline only when searching
	const filteredModels = useMemo(() => {
		const isCline = selectedProvider === "cline"

		// For Cline: only show non-featured models when searching
		if (isCline && !searchQuery) return []

		let models: ModelItem[]
		if (searchQuery) {
			models = allModels.filter((m) => matchesSearch(m, searchQuery))
		} else {
			// For non-Cline OpenRouter providers: show all models by default
			models = [...allModels]
		}

		// Filter out current model
		models = models.filter((m) => m.id !== selectedModelId)

		// For Cline when searching, also filter out featured models (they're shown separately)
		if (isCline) {
			const featuredIds = new Set([...recommendedModels, ...freeModels].map((m) => m.id))
			models = models.filter((m) => !featuredIds.has(m.id))
		}

		// For openrouter/vercel-ai-gateway (not cline): put favorites first
		if (!isCline && (selectedProvider === "openrouter" || selectedProvider === "vercel-ai-gateway")) {
			const favoriteSet = new Set(favoritedModelIds || [])
			const favoritedModels = models.filter((m) => favoriteSet.has(m.id))
			const nonFavoritedModels = models.filter((m) => !favoriteSet.has(m.id))
			// Sort non-favorited alphabetically by provider
			nonFavoritedModels.sort((a, b) => (a.provider || "").localeCompare(b.provider || ""))
			return [...favoritedModels, ...nonFavoritedModels]
		}

		// Sort alphabetically by provider
		models = models.sort((a, b) => (a.provider || "").localeCompare(b.provider || ""))
		return models
	}, [searchQuery, matchesSearch, selectedModelId, selectedProvider, allModels, favoritedModelIds])

	// Featured models for Cline provider (recommended + free)
	const featuredModels = useMemo(() => {
		if (selectedProvider !== "cline") return []

		const allFeatured = [...recommendedModels, ...freeModels].map((m) => ({
			...m,
			name: m.id.split("/").pop() || m.id,
			provider: m.id.split("/")[0],
		}))

		// Filter out current model
		const filtered = allFeatured.filter((m) => m.id !== selectedModelId)

		// Apply search filter if searching (uses same multi-word logic)
		if (searchQuery) {
			return filtered.filter((m) => matchesSearch(m, searchQuery))
		}

		return filtered
	}, [selectedProvider, searchQuery, selectedModelId, matchesSearch])

	// Handle model selection - in split mode uses activeEditMode, otherwise closes modal
	const handleSelectModel = useCallback(
		(modelId: string, modelInfo?: ModelInfoType) => {
			const modeToUse = isSplit ? activeEditMode : currentMode

			if (OPENROUTER_MODEL_PROVIDERS.includes(selectedProvider)) {
				const modelInfoToUse = modelInfo || openRouterModels[modelId]
				handleModeFieldsChange(
					{
						openRouterModelId: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
						openRouterModelInfo: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
					},
					{
						openRouterModelId: modelId,
						openRouterModelInfo: modelInfoToUse,
					},
					modeToUse,
				)
			} else {
				// Static model providers use apiModelId
				handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, modelId, modeToUse)
			}
			// Only close modal if not in split mode
			if (!isSplit) {
				onOpenChange(false)
			}
		},
		[
			selectedProvider,
			handleModeFieldsChange,
			handleModeFieldChange,
			currentMode,
			isSplit,
			activeEditMode,
			openRouterModels,
			onOpenChange,
		],
	)

	// Handle provider selection from inline list
	const handleProviderSelect = useCallback(
		(provider: ApiProvider) => {
			const modeToUse = isSplit ? activeEditMode : currentMode
			handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, provider, modeToUse)
			setIsProviderExpanded(false)
		},
		[handleModeFieldChange, currentMode, isSplit, activeEditMode],
	)

	// Handle split toggle - should NOT close modal
	const handleSplitToggle = useCallback(
		async (enabled: boolean) => {
			// Update the setting
			await StateServiceClient.updateSettings(
				UpdateSettingsRequest.create({
					planActSeparateModelsSetting: enabled,
				}),
			)
			// If disabling split mode, sync configurations
			if (!enabled) {
				syncModeConfigurations(apiConfiguration, currentMode, handleFieldsChange)
			}
		},
		[apiConfiguration, currentMode, handleFieldsChange],
	)

	// Handle configure link click
	const handleConfigureClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			e.preventDefault()
			onOpenChange(false)
			navigateToSettings?.()
		},
		[onOpenChange, navigateToSettings],
	)

	// Keyboard navigation handler
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			const totalItems = filteredModels.length + featuredModels.length
			if (totalItems === 0) return

			switch (e.key) {
				case "ArrowDown":
					e.preventDefault()
					setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev))
					break
				case "ArrowUp":
					e.preventDefault()
					setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
					break
				case "Enter":
					e.preventDefault()
					if (selectedIndex >= 0) {
						// Determine which list the index falls into
						if (selectedIndex < featuredModels.length) {
							const model = featuredModels[selectedIndex]
							handleSelectModel(model.id, openRouterModels[model.id])
						} else {
							const model = filteredModels[selectedIndex - featuredModels.length]
							handleSelectModel(model.id, model.info)
						}
					}
					break
				case "Escape":
					e.preventDefault()
					onOpenChange(false)
					break
			}
		},
		[filteredModels, featuredModels, selectedIndex, handleSelectModel, openRouterModels, onOpenChange],
	)

	// Reset selectedIndex and clear refs when search/provider changes
	useEffect(() => {
		setSelectedIndex(-1)
		itemRefs.current = []
	}, [searchQuery, selectedProvider])

	// Scroll selected item into view
	useEffect(() => {
		if (selectedIndex >= 0) {
			// Use requestAnimationFrame to ensure DOM is updated
			requestAnimationFrame(() => {
				const element = itemRefs.current[selectedIndex]
				if (element) {
					element.scrollIntoView({
						block: "nearest",
						behavior: "smooth",
					})
				}
			})
		}
	}, [selectedIndex])

	// Reset states when opening/closing
	useEffect(() => {
		if (isOpen) {
			setIsProviderExpanded(false)
			setSelectedIndex(-1)
			setTimeout(() => searchInputRef.current?.focus(), 100)
		} else {
			setSearchQuery("")
			setSelectedIndex(-1)
		}
	}, [isOpen])

	// Calculate positions for modal and arrow (update on viewport resize)
	useEffect(() => {
		if (isOpen && triggerRef.current) {
			const rect = triggerRef.current.getBoundingClientRect()
			const buttonCenter = rect.left + rect.width / 2
			const rightPosition = document.documentElement.clientWidth - buttonCenter - 5
			setMenuPosition(rect.top + 1)
			setArrowPosition(rightPosition)
		}
	}, [isOpen, viewportWidth, viewportHeight])

	// Handle click outside to close
	useEffect(() => {
		if (!isOpen) return

		const handleClickOutside = (e: MouseEvent) => {
			// Don't close if clicking inside modal, trigger, or provider dropdown portal
			if (
				modalRef.current &&
				!modalRef.current.contains(e.target as Node) &&
				triggerRef.current &&
				!triggerRef.current.contains(e.target as Node) &&
				(!providerDropdownRef.current || !providerDropdownRef.current.contains(e.target as Node))
			) {
				onOpenChange(false)
			}
		}

		// Delay adding listener to avoid immediate close
		const timeoutId = setTimeout(() => {
			document.addEventListener("mousedown", handleClickOutside)
		}, 0)

		return () => {
			clearTimeout(timeoutId)
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOpen, onOpenChange])

	// Handle escape key
	useEffect(() => {
		if (!isOpen) return

		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onOpenChange(false)
			}
		}

		document.addEventListener("keydown", handleEscape)
		return () => document.removeEventListener("keydown", handleEscape)
	}, [isOpen, onOpenChange])

	// Close modal when navigating to other views (settings, MCP, history, account)
	useEffect(() => {
		if (isOpen && (showSettings || showMcp || showHistory || showAccount)) {
			onOpenChange(false)
		}
	}, [isOpen, showSettings, showMcp, showHistory, showAccount, onOpenChange])

	// Check if current model actually belongs to current provider (not auto-selected fallback)
	const modelBelongsToProvider = useMemo(() => {
		if (!selectedModelId) return false
		return allModels.some((m) => m.id === selectedModelId)
	}, [selectedModelId, allModels])

	// Handle trigger click
	const handleTriggerClick = useCallback(() => {
		onOpenChange(!isOpen)
	}, [isOpen, onOpenChange])

	const isClineProvider = selectedProvider === "cline"
	const isSearching = !!searchQuery

	return (
		<>
			{/* Trigger wrapper */}
			<div onClick={handleTriggerClick} ref={triggerRef} style={{ cursor: "pointer", display: "inline", minWidth: 0 }}>
				{children}
			</div>

			{/* Modal - rendered via portal with fixed positioning */}
			{isOpen &&
				createPortal(
					<PopupModalContainer
						$arrowPosition={arrowPosition}
						$bottomOffset={5}
						$maxHeight="18em"
						$menuPosition={menuPosition}
						ref={modalRef}>
						{/* Search */}
						<SearchContainer>
							<Search size={14} style={{ color: "var(--vscode-descriptionForeground)", flexShrink: 0 }} />
							<SearchInput
								onChange={(e) => {
									setSearchQuery(e.target.value)
									setIsProviderExpanded(false)
								}}
								onKeyDown={handleKeyDown}
								placeholder={`Search ${allModels.length} models`}
								ref={searchInputRef as any}
								value={searchQuery}
							/>
						</SearchContainer>

						{/* Settings section - provider + icon toggles */}
						<SettingsSection onClick={(e) => e.stopPropagation()}>
							<SettingsHeader>
								{/* Provider - collapsible with dropdown portal */}
								<Tooltip>
									<TooltipTrigger asChild>
										<ProviderRow
											onClick={() => {
												if (providerRowRef.current) {
													const rect = providerRowRef.current.getBoundingClientRect()
													const viewportHeight = window.innerHeight
													const spaceBelow = viewportHeight - rect.bottom
													const itemHeight = 28 // approximate height per item
													const numItems = configuredProviders.length + 1 // +1 for "Add provider"
													const dropdownHeight = Math.min(numItems * itemHeight + 8, 200) // 8px for padding

													// If not enough space below, position above
													const shouldFlipUp = spaceBelow < dropdownHeight + 10 && rect.top > spaceBelow

													setProviderDropdownPosition({
														top: shouldFlipUp ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
														left: rect.left,
														width: modalRef.current?.getBoundingClientRect().width || rect.width,
														maxHeight: shouldFlipUp ? rect.top - 10 : spaceBelow - 10,
													})
												}
												setIsProviderExpanded(!isProviderExpanded)
											}}
											ref={providerRowRef}>
											<ProviderLabel>Provider:</ProviderLabel>
											<span style={{ fontSize: 11, color: "var(--vscode-foreground)" }}>
												{getProviderLabel(selectedProvider)}
											</span>
											<ChevronDownIcon size={12} style={{ color: "var(--vscode-descriptionForeground)" }} />
										</ProviderRow>
									</TooltipTrigger>
									{!isProviderExpanded && (
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											Configured providers
										</TooltipContent>
									)}
								</Tooltip>

								{/* Icon toggles */}
								<IconToggles>
									<Tooltip>
										<TooltipTrigger asChild>
											<IconToggle
												$isActive={thinkingEnabled}
												$isDisabled={!supportsThinking}
												onClick={(e) => {
													e.stopPropagation()
													supportsThinking && handleThinkingToggle(!thinkingEnabled)
												}}>
												<Brain size={14} />
											</IconToggle>
										</TooltipTrigger>
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											{!supportsThinking
												? "Thinking not supported by this model"
												: thinkingEnabled
													? "Extended thinking enabled"
													: "Enable extended thinking for enhanced reasoning"}
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<IconToggle
												$isActive={isSplit}
												onClick={(e) => {
													e.stopPropagation()
													handleSplitToggle(!isSplit)
												}}>
												<ArrowLeftRight size={14} />
											</IconToggle>
										</TooltipTrigger>
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											Use different models for Plan vs Act
										</TooltipContent>
									</Tooltip>
								</IconToggles>
							</SettingsHeader>
							{/* Thinking budget slider - shown when model supports thinking, greyed out when disabled */}
							{supportsThinking && (
								<ThinkingSliderRow $isDisabled={!thinkingEnabled} onClick={(e) => e.stopPropagation()}>
									<ThinkingSliderLabel>
										Thinking ({(thinkingEnabled ? thinkingBudget : 0).toLocaleString()} tokens)
									</ThinkingSliderLabel>
									<ThinkingSlider
										disabled={!thinkingEnabled}
										max={ANTHROPIC_MAX_THINKING_BUDGET}
										min={0}
										onChange={(e) => {
											const value = Number(e.target.value)
											const clampedValue = Math.max(value, ANTHROPIC_MIN_THINKING_BUDGET)
											handleThinkingBudgetChange(clampedValue)
										}}
										type="range"
										value={thinkingEnabled ? thinkingBudget : 0}
									/>
								</ThinkingSliderRow>
							)}
						</SettingsSection>

						{/* Scrollable content */}
						<ModelListContainer>
							<>
								{/* Current model - inside scroll area for seamless scrolling */}
								{isSplit ? (
									<SplitModeRow onClick={(e) => e.stopPropagation()}>
										<Tooltip>
											<TooltipTrigger asChild>
												<SplitModeCell
													$isActive={activeEditMode === "plan"}
													onClick={() => setActiveEditMode("plan")}>
													<SplitModeLabel $mode="plan">P</SplitModeLabel>
													<SplitModeModel>
														{planModel.selectedModelId?.split("/").pop() || "Not set"}
													</SplitModeModel>
												</SplitModeCell>
											</TooltipTrigger>
											<TooltipContent side="top" style={{ zIndex: 9999 }}>
												Plan mode
											</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<SplitModeCell
													$isActive={activeEditMode === "act"}
													onClick={() => setActiveEditMode("act")}>
													<SplitModeLabel $mode="act">A</SplitModeLabel>
													<SplitModeModel>
														{actModel.selectedModelId?.split("/").pop() || "Not set"}
													</SplitModeModel>
												</SplitModeCell>
											</TooltipTrigger>
											<TooltipContent side="top" style={{ zIndex: 9999 }}>
												Act mode
											</TooltipContent>
										</Tooltip>
									</SplitModeRow>
								) : (
									selectedModelId &&
									modelBelongsToProvider &&
									(() => {
										// Check if current model has a featured label (only for Cline provider)
										const currentFeaturedModel = isClineProvider
											? [...recommendedModels, ...freeModels].find((m) => m.id === selectedModelId)
											: undefined
										return (
											<CurrentModelRow onClick={() => onOpenChange(false)}>
												<ModelInfoRow>
													<ModelName>{selectedModelId.split("/").pop() || selectedModelId}</ModelName>
													<ModelProvider>
														{OPENROUTER_MODEL_PROVIDERS.includes(selectedProvider)
															? selectedModelId.split("/")[0]
															: selectedProvider}
													</ModelProvider>
												</ModelInfoRow>
												{currentFeaturedModel?.label && (
													<ModelLabel>{currentFeaturedModel.label}</ModelLabel>
												)}
												<Check
													size={14}
													style={{
														color: "var(--vscode-foreground)",
														flexShrink: 0,
													}}
												/>
											</CurrentModelRow>
										)
									})()
								)}

								{/* For Cline: Show recommended models */}
								{isClineProvider &&
									featuredModels.map((model, index) => (
										<ModelItemContainer
											$isSelected={index === selectedIndex}
											key={model.id}
											onClick={() => handleSelectModel(model.id, openRouterModels[model.id])}
											onMouseEnter={() => setSelectedIndex(index)}
											ref={(el) => (itemRefs.current[index] = el)}>
											<ModelInfoRow>
												<ModelName>{model.name}</ModelName>
												<ModelProvider>{model.provider}</ModelProvider>
											</ModelInfoRow>
											<ModelLabel>{model.label}</ModelLabel>
										</ModelItemContainer>
									))}

								{/* All other models (for non-Cline always, for Cline only when searching) */}
								{filteredModels.map((model, index) => {
									const globalIndex = featuredModels.length + index
									const isFavorite = (favoritedModelIds || []).includes(model.id)
									const showStar = selectedProvider === "openrouter" || selectedProvider === "vercel-ai-gateway"
									return (
										<ModelItemContainer
											$isSelected={globalIndex === selectedIndex}
											key={model.id}
											onClick={() => handleSelectModel(model.id, model.info)}
											onMouseEnter={() => setSelectedIndex(globalIndex)}
											ref={(el) => (itemRefs.current[globalIndex] = el)}>
											<ModelInfoRow>
												<ModelName>{model.name}</ModelName>
												<ModelProvider>{model.provider}</ModelProvider>
											</ModelInfoRow>
											{showStar && (
												<StarIcon
													isFavorite={isFavorite}
													onClick={(e) => {
														e.stopPropagation()
														StateServiceClient.toggleFavoriteModel(
															StringRequest.create({ value: model.id }),
														).catch((error: Error) =>
															console.error("Failed to toggle favorite model:", error),
														)
													}}
												/>
											)}
										</ModelItemContainer>
									)
								})}

								{/* Settings-only providers: show configured model info and help text */}
								{SETTINGS_ONLY_PROVIDERS.includes(selectedProvider) &&
									(() => {
										const providerInfo = getProviderInfo(selectedProvider, apiConfiguration, effectiveMode)
										return (
											<SettingsOnlyContainer>
												{/* Show configured model if exists */}
												{providerInfo.modelId && (
													<ConfiguredModelRow>
														<ConfiguredModelLabel>Current model:</ConfiguredModelLabel>
														<ConfiguredModelName>{providerInfo.modelId}</ConfiguredModelName>
													</ConfiguredModelRow>
												)}
												{/* Show base URL if configured */}
												{providerInfo.baseUrl && (
													<ConfiguredModelRow>
														<ConfiguredModelLabel>Endpoint:</ConfiguredModelLabel>
														<ConfiguredModelUrl>{providerInfo.baseUrl}</ConfiguredModelUrl>
													</ConfiguredModelRow>
												)}
												{/* Help text / empty state guidance */}
												{!providerInfo.modelId && <HelpTextRow>{providerInfo.helpText}</HelpTextRow>}
												{/* Configure link */}
												<SettingsOnlyLink onClick={handleConfigureClick}>
													<Settings size={12} />
													<span>
														{providerInfo.modelId ? "Edit in settings" : "Configure in settings"}
													</span>
												</SettingsOnlyLink>
											</SettingsOnlyContainer>
										)
									})()}

								{/* Empty state */}
								{isSearching &&
									filteredModels.length === 0 &&
									featuredModels.length === 0 &&
									!SETTINGS_ONLY_PROVIDERS.includes(selectedProvider) && (
										<EmptyState>No models found</EmptyState>
									)}
							</>
						</ModelListContainer>
					</PopupModalContainer>,
					document.body,
				)}

			{/* Provider dropdown - rendered via portal to avoid clipping */}
			{isOpen &&
				isProviderExpanded &&
				createPortal(
					<ProviderDropdownPortal
						onClick={(e) => e.stopPropagation()}
						ref={providerDropdownRef}
						style={{
							top: providerDropdownPosition.top,
							left: providerDropdownPosition.left,
							width: providerDropdownPosition.width - 20, // Account for modal padding
							maxHeight: providerDropdownPosition.maxHeight,
						}}>
						{configuredProviders.map((provider) => (
							<ProviderDropdownItem
								$isSelected={provider === selectedProvider}
								key={provider}
								onClick={() => handleProviderSelect(provider)}>
								{provider === selectedProvider && <span style={{ marginRight: 4 }}>✓</span>}
								<span>{getProviderLabel(provider)}</span>
							</ProviderDropdownItem>
						))}
						<ProviderDropdownItem $isSelected={false} onClick={handleConfigureClick}>
							<span style={{ color: "var(--vscode-textLink-foreground)" }}>+ Add provider</span>
						</ProviderDropdownItem>
					</ProviderDropdownPortal>,
					document.body,
				)}
		</>
	)
}

const SearchContainer = styled.div`
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	border-bottom: 1px solid var(--vscode-editorGroup-border);
	display: flex;
	align-items: center;
	gap: 8px;
`

const SearchInput = styled.input`
	flex: 1;
	background: transparent;
	border: none;
	outline: none;
	font-size: 11px;
	color: var(--vscode-foreground);
	&:focus {
		outline: none;
	}
	&::placeholder {
		color: var(--vscode-descriptionForeground);
		opacity: 0.7;
	}
`

const SettingsSection = styled.div`
	position: relative;
	padding: 4px 10px;
	border-bottom: 1px solid var(--vscode-editorGroup-border);
	display: flex;
	flex-direction: column;
`

const SettingsHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
`

const IconToggles = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
`

const IconToggle = styled.button<{ $isActive: boolean; $isDisabled?: boolean }>`
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	background: transparent;
	border: none;
	border-radius: 4px;
	cursor: ${(props) => (props.$isDisabled ? "not-allowed" : "pointer")};
	color: ${(props) =>
		props.$isDisabled
			? "var(--vscode-disabledForeground)"
			: props.$isActive
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"};
	opacity: ${(props) => (props.$isDisabled ? 0.4 : 1)};
	transition: all 0.15s ease;
	&:hover {
		background: ${(props) => (props.$isDisabled ? "transparent" : "var(--vscode-list-hoverBackground)")};
	}
`

// Inline provider row (clickable to expand)
const ProviderRow = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	cursor: pointer;
	&:hover {
		opacity: 0.8;
	}
`

const ProviderLabel = styled.span`
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
`

// Provider dropdown rendered via portal to avoid clipping
const ProviderDropdownPortal = styled.div`
	position: fixed;
	display: flex;
	flex-direction: column;
	padding: 4px 0;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 4px;
	max-height: 200px;
	overflow-y: auto;
	z-index: 2000;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
`

const ProviderDropdownItem = styled.div<{ $isSelected: boolean }>`
	display: flex;
	align-items: center;
	padding: 4px 8px;
	cursor: pointer;
	font-size: 11px;
	color: ${(props) => (props.$isSelected ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	border-radius: 3px;
	&:hover {
		background: var(--vscode-list-hoverBackground);
	}
`

const ModelListContainer = styled.div`
	flex: 1;
	overflow-y: auto;
	min-height: 0;
	scrollbar-width: thin;
	&::-webkit-scrollbar {
		width: 6px;
	}
	&::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 3px;
	}
	&:hover::-webkit-scrollbar-thumb {
		background: var(--vscode-scrollbarSlider-background);
	}
`

const ModelItemContainer = styled.div<{ $isSelected: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	cursor: pointer;
	background: ${(props) => (props.$isSelected ? "var(--vscode-list-activeSelectionBackground)" : "transparent")};
	&:hover {
		background: var(--vscode-list-hoverBackground);
	}
`

const ModelInfoRow = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1;
	min-width: 0;
`

const ModelName = styled.span`
	font-size: 11px;
	color: var(--vscode-foreground);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const ModelProvider = styled.span`
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	white-space: nowrap;
	@media (max-width: 280px) {
		display: none;
	}
`

const ModelLabel = styled.span`
	font-size: 9px;
	color: var(--vscode-textLink-foreground);
	text-transform: uppercase;
	letter-spacing: 0.5px;
	font-weight: 500;
	margin-left: auto;
	margin-right: 8px;
`

const EmptyState = styled.div`
	padding: 12px 10px;
	text-align: center;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
`

// Settings-only provider message - clickable link to settings
const SettingsOnlyMessage = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 16px 10px;
	cursor: pointer;
	color: var(--vscode-textLink-foreground);
	font-size: 12px;
	&:hover {
		text-decoration: underline;
	}
`

// Current model row - highlighted, sticky at top when scrolling, clickable to close
const CurrentModelRow = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	cursor: pointer;
	background: linear-gradient(var(--vscode-list-activeSelectionBackground), var(--vscode-list-activeSelectionBackground)),
		${CODE_BLOCK_BG_COLOR};
	position: sticky;
	top: 0;
	z-index: 1;
`

// Split mode components - sticky at top when scrolling
const SplitModeRow = styled.div`
	display: flex;
	align-items: stretch;
	gap: 0;
	position: sticky;
	top: 0;
	z-index: 1;
	background: ${CODE_BLOCK_BG_COLOR};
`

const SplitModeCell = styled.div<{ $isActive: boolean }>`
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	cursor: pointer;
	flex: 1;
	min-width: 0;
	background: ${(props) =>
		props.$isActive
			? `linear-gradient(var(--vscode-list-activeSelectionBackground), var(--vscode-list-activeSelectionBackground)), ${CODE_BLOCK_BG_COLOR}`
			: "transparent"};
	border-bottom: 2px solid ${(props) => (props.$isActive ? "var(--vscode-focusBorder)" : "transparent")};
	&:hover {
		background: var(--vscode-list-hoverBackground);
	}
`

const SplitModeLabel = styled.span<{ $mode: "plan" | "act" }>`
	font-size: 9px;
	font-weight: 600;
	color: ${(props) => (props.$mode === "plan" ? PLAN_MODE_COLOR : ACT_MODE_COLOR)};
	text-transform: uppercase;
`

const SplitModeModel = styled.span`
	font-size: 10px;
	color: var(--vscode-foreground);
	flex: 1;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

// Thinking budget slider components
const ThinkingSliderRow = styled.div<{ $isDisabled?: boolean }>`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 0;
	margin-top: 2px;
	opacity: ${(props) => (props.$isDisabled ? 0.4 : 1)};
	pointer-events: ${(props) => (props.$isDisabled ? "none" : "auto")};
`

const ThinkingSliderLabel = styled.span`
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	white-space: nowrap;
	min-width: 130px;
`

const ThinkingSlider = styled.input`
	flex: 1;
	height: 4px;
	-webkit-appearance: none;
	appearance: none;
	background: var(--vscode-input-background);
	border-radius: 2px;
	outline: none;
	cursor: pointer;

	&::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		background: var(--vscode-textLink-foreground);
		border-radius: 50%;
		cursor: pointer;
		transition: transform 0.1s ease;
	}

	&::-webkit-slider-thumb:hover {
		transform: scale(1.2);
	}

	&::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: var(--vscode-textLink-foreground);
		border: none;
		border-radius: 50%;
		cursor: pointer;
	}
`

// Settings-only provider container with configured model info
const SettingsOnlyContainer = styled.div`
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 10px;
`

const ConfiguredModelRow = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
`

const ConfiguredModelLabel = styled.span`
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	flex-shrink: 0;
`

const ConfiguredModelName = styled.span`
	font-size: 11px;
	color: var(--vscode-foreground);
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const ConfiguredModelUrl = styled.span`
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	font-family: var(--vscode-editor-font-family);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const HelpTextRow = styled.div`
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	text-align: center;
	padding: 4px 0;
`

const SettingsOnlyLink = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 6px 0;
	margin-top: 4px;
	cursor: pointer;
	color: var(--vscode-textLink-foreground);
	font-size: 11px;
	&:hover {
		text-decoration: underline;
	}
`

export default ModelPickerModal
