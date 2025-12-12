import type { ModelInfo as ModelInfoType } from "@shared/api"
import { ANTHROPIC_MIN_THINKING_BUDGET, ApiProvider } from "@shared/api"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Mode } from "@shared/storage/types"
import Fuse from "fuse.js"
import { Brain, ChevronDownIcon, ChevronRightIcon, Search, Settings, Sparkles } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"

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

const OPENROUTER_MODEL_PROVIDERS: ApiProvider[] = ["cline", "openrouter", "vercel-ai-gateway"]

import { freeModels, recommendedModels } from "@/components/settings/OpenRouterModelPicker"
import { SUPPORTED_ANTHROPIC_THINKING_MODELS } from "@/components/settings/providers/AnthropicProvider"
import { SUPPORTED_BEDROCK_THINKING_MODELS } from "@/components/settings/providers/BedrockProvider"
import {
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
	} = useExtensionState()
	const { handleModeFieldChange, handleModeFieldsChange, handleFieldsChange } = useApiConfigurationHandlers()

	const [searchQuery, setSearchQuery] = useState("")
	const [activeEditMode, setActiveEditMode] = useState<Mode>(currentMode) // which mode we're editing in split view
	const [menuPosition, setMenuPosition] = useState(0)
	const [isProviderExpanded, setIsProviderExpanded] = useState(false)
	const searchInputRef = useRef<HTMLInputElement>(null)
	const triggerRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)

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

	// Get configured providers
	const configuredProviders = useMemo(() => {
		return getConfiguredProviders(apiConfiguration)
	}, [apiConfiguration])

	// Get models for current provider
	const allModels = useMemo((): ModelItem[] => {
		if (OPENROUTER_MODEL_PROVIDERS.includes(selectedProvider)) {
			return Object.entries(openRouterModels || {}).map(([id, info]) => ({
				id,
				name: id.split("/").pop() || id,
				provider: id.split("/")[0],
				info,
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

	// Filter models by search
	const fuse = useMemo(() => {
		return new Fuse(allModels, {
			keys: ["id", "name", "provider"],
			threshold: 0.4,
			includeMatches: true,
		})
	}, [allModels])

	// Filtered models - for OpenRouter/Vercel show all by default, for Cline only when searching
	const filteredModels = useMemo(() => {
		const isCline = selectedProvider === "cline"

		// For Cline: only show non-featured models when searching
		if (isCline && !searchQuery) return []

		let models: ModelItem[]
		if (searchQuery) {
			models = fuse.search(searchQuery).map((r) => r.item)
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

		// Sort alphabetically by provider
		models = models.sort((a, b) => (a.provider || "").localeCompare(b.provider || ""))
		return models
	}, [searchQuery, fuse, selectedModelId, selectedProvider, allModels])

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

		// Apply search filter if searching
		if (searchQuery) {
			return filtered.filter((m) => m.id.toLowerCase().includes(searchQuery.toLowerCase()))
		}

		return filtered
	}, [selectedProvider, searchQuery, selectedModelId])

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

	// Calculate menu position when opening + reset expanded states
	useEffect(() => {
		if (isOpen && triggerRef.current) {
			const rect = triggerRef.current.getBoundingClientRect()
			setMenuPosition(rect.top)
			setIsProviderExpanded(false)
			setTimeout(() => searchInputRef.current?.focus(), 100)
		} else {
			setSearchQuery("")
		}
	}, [isOpen])

	// Handle click outside to close
	useEffect(() => {
		if (!isOpen) return

		const handleClickOutside = (e: MouseEvent) => {
			if (
				modalRef.current &&
				!modalRef.current.contains(e.target as Node) &&
				triggerRef.current &&
				!triggerRef.current.contains(e.target as Node)
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
					<FixedModalContainer $menuPosition={menuPosition} ref={modalRef}>
						{/* Search */}
						<SearchContainer>
							<Search size={14} style={{ color: "var(--vscode-descriptionForeground)", flexShrink: 0 }} />
							<SearchInput
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder={`Search ${allModels.length} models`}
								ref={searchInputRef as any}
								value={searchQuery}
							/>
						</SearchContainer>

						{/* Settings section - collapsible provider + icon toggles */}
						<SettingsSection onClick={(e) => e.stopPropagation()}>
							<SettingsHeader>
								{/* Provider - collapsible inline */}
								<ProviderRow onClick={() => setIsProviderExpanded(!isProviderExpanded)}>
									<span style={{ fontSize: 11, color: "var(--vscode-foreground)" }}>
										{getProviderLabel(selectedProvider)}
									</span>
									{isProviderExpanded ? (
										<ChevronDownIcon size={12} style={{ color: "var(--vscode-descriptionForeground)" }} />
									) : (
										<ChevronRightIcon size={12} style={{ color: "var(--vscode-descriptionForeground)" }} />
									)}
								</ProviderRow>

								{/* Icon toggles */}
								<IconToggles>
									<Tooltip>
										<TooltipTrigger asChild>
											<IconToggle
												$isActive={isSplit}
												onClick={(e) => {
													e.stopPropagation()
													handleSplitToggle(!isSplit)
												}}>
												<Sparkles size={14} />
											</IconToggle>
										</TooltipTrigger>
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											{isSplit
												? "Use different models for Plan vs Act"
												: "Click to use different models for Plan vs Act"}
										</TooltipContent>
									</Tooltip>
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
								</IconToggles>
							</SettingsHeader>
							{isProviderExpanded && (
								<ProviderInlineList>
									{configuredProviders.map((provider) => (
										<ProviderInlineItem
											$isSelected={provider === selectedProvider}
											key={provider}
											onClick={() => handleProviderSelect(provider)}>
											{provider === selectedProvider && <span style={{ marginRight: 4 }}>✓</span>}
											<span>{getProviderLabel(provider)}</span>
										</ProviderInlineItem>
									))}
									<ProviderInlineItem $isSelected={false} onClick={handleConfigureClick}>
										<span style={{ color: "var(--vscode-textLink-foreground)" }}>Configure...</span>
									</ProviderInlineItem>
								</ProviderInlineList>
							)}
						</SettingsSection>

						{/* Scrollable content */}
						<ModelListContainer>
							{/* Current model - inside scroll area for seamless scrolling */}
							{isSplit ? (
								<SplitModeRow onClick={(e) => e.stopPropagation()}>
									<SplitModeCell
										$isActive={activeEditMode === "plan"}
										onClick={() => setActiveEditMode("plan")}>
										<SplitModeLabel $mode="plan">P</SplitModeLabel>
										<SplitModeModel>
											{planModel.selectedModelId?.split("/").pop() || "Not set"}
										</SplitModeModel>
									</SplitModeCell>
									<SplitModeCell $isActive={activeEditMode === "act"} onClick={() => setActiveEditMode("act")}>
										<SplitModeLabel $mode="act">A</SplitModeLabel>
										<SplitModeModel>{actModel.selectedModelId?.split("/").pop() || "Not set"}</SplitModeModel>
									</SplitModeCell>
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
											{currentFeaturedModel?.label && <ModelLabel>{currentFeaturedModel.label}</ModelLabel>}
										</CurrentModelRow>
									)
								})()
							)}

							{/* For Cline: Show recommended models */}
							{isClineProvider &&
								featuredModels.map((model) => (
									<ModelItemContainer
										$isSelected={false}
										key={model.id}
										onClick={() => handleSelectModel(model.id, openRouterModels[model.id])}>
										<ModelInfoRow>
											<ModelName>{model.name}</ModelName>
											<ModelProvider>{model.provider}</ModelProvider>
										</ModelInfoRow>
										<ModelLabel>{model.label}</ModelLabel>
									</ModelItemContainer>
								))}

							{/* All other models (for non-Cline always, for Cline only when searching) */}
							{filteredModels.map((model) => (
								<ModelItemContainer
									$isSelected={false}
									key={model.id}
									onClick={() => handleSelectModel(model.id, model.info)}>
									<ModelInfoRow>
										<ModelName>{model.name}</ModelName>
										<ModelProvider>{model.provider}</ModelProvider>
									</ModelInfoRow>
								</ModelItemContainer>
							))}

							{/* Settings-only providers: show configure link instead of model list */}
							{SETTINGS_ONLY_PROVIDERS.includes(selectedProvider) && (
								<SettingsOnlyMessage onClick={handleConfigureClick}>
									<Settings size={14} />
									<span>Configure in model settings</span>
								</SettingsOnlyMessage>
							)}

							{/* Empty state */}
							{isSearching &&
								filteredModels.length === 0 &&
								featuredModels.length === 0 &&
								!SETTINGS_ONLY_PROVIDERS.includes(selectedProvider) && <EmptyState>No models found</EmptyState>}
						</ModelListContainer>
					</FixedModalContainer>,
					document.body,
				)}
		</>
	)
}

// Fixed position modal container - matches original ModelSelectorTooltip positioning
const FixedModalContainer = styled.div<{ $menuPosition: number }>`
	position: fixed;
	bottom: ${(props) => `calc(100vh - ${props.$menuPosition}px + 8px)`};
	left: 15px;
	right: 15px;
	display: flex;
	flex-direction: column;
	max-height: 18em;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 6px;
	overflow: hidden;
	z-index: 1000;
`

const SearchContainer = styled.div`
	padding: 4px 10px;
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
	cursor: pointer;
	&:hover {
		opacity: 0.8;
	}
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
	gap: 4px;
	cursor: pointer;
	&:hover {
		opacity: 0.8;
	}
`

// Floating provider dropdown (overlays content)
const ProviderInlineList = styled.div`
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	display: flex;
	flex-direction: column;
	padding: 4px 0;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 4px;
	max-height: 150px;
	overflow-y: auto;
	z-index: 100;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`

const ProviderInlineItem = styled.div<{ $isSelected: boolean }>`
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
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	cursor: pointer;
	background: var(--vscode-list-activeSelectionBackground);
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
	background: ${(props) => (props.$isActive ? "var(--vscode-list-activeSelectionBackground)" : "transparent")};
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

export default ModelPickerModal
